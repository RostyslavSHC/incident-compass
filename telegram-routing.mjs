import {randomUUID} from 'node:crypto';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {scenarios,services} from './public/data.mjs';
import {simulationSeverities,simulationStatuses} from './public/simulations.mjs';

const routePath = new URL('./.telegram-routing.local.json',import.meta.url);
const presentations = {P1:['🚨','CRITICAL'],P2:['🟠','HIGH'],P3:['🔵','MONITOR']};
const liveStages = new Set(['queued-private','sending-private','waiting','queued-team','sending-team','open-team']);
const secondsAllowed = new Set([30,60,120,300]);
const escape = value=>String(value).replace(/[&<>]/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[character]));
const plain = value=>value.replace(/<\/?b>|<\/?code>/g,'').replace(/&(?:lt|gt|amp);/g,entity=>({'&lt;':'<','&gt;':'>','&amp;':'&'}[entity]));
const masked = value=>'•••• '+String(value).slice(-4);
const botId = token=>token?.split(':')[0] || '';
const privateId = id=>/^[1-9]\d{3,24}$/.test(id || '');
const groupId = id=>/^-[1-9]\d{3,24}$/.test(id || '');
const telegramName=user=>[user?.first_name,user?.last_name].filter(Boolean).join(' ').trim().slice(0,100)
  || (user?.username ? '@'+user.username : '');
const responderName=user=>telegramName(user)||'Telegram responder';
const ownerProfileKey=config=>config.token && privateId(config.owner) ? botId(config.token)+'/'+config.owner : '';
const currentMember=result=>result.ok&&['creator','administrator','member','restricted'].includes(result.result?.status)&&
  (result.result.status!=='restricted'||result.result.is_member);
const responseClock = new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Toronto',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'
});

function routingText(kind,wait,deadline) {
  const due = deadline ? ` · Reply by ${responseClock.format(deadline)}` : '';
  return {
    notice:'',
    private:`\n\n⏳ <b>Respond within ${wait} seconds</b>${due}\nTap Accept or Decline. You can also reply directly to this message.`,
    critical:'\n\n👥 <b>Team page · Immediate routing</b>\nTap Claim incident to take ownership.',
    decline:'\n\n👥 <b>Team escalation · Responder declined</b>\nTap Claim incident to take ownership.',
    timeout:'\n\n👥 <b>Team escalation · No response before the deadline</b>\nTap Claim incident to take ownership.',
    unavailable:'\n\n👥 <b>Team escalation · Private page could not be confirmed</b>\nTap Claim incident to take ownership.',
  }[kind];
}

export function renderTelegram(incident,level,kind='notice',wait=60,deadline) {
  const [icon,title]=presentations[level];
  const route = routingText(kind,wait,deadline);
  const markup=`${icon} <b>${level} · ${title}</b>\n<b>${escape(incident.title)}</b>\n<code>${escape(incident.id)}</code> · ${escape(incident.service)} · ${incident.alert} ET\n\n📊 <b>Impact</b> · ${incident.affectedPct}% of monitored operations in this sample\n🔎 <b>First check</b>\n${escape(incident.next)}${route}\n\n🧪 Incident Compass · simulated incident`;
  return {markup,text:plain(markup)};
}

function renderRoute(route,kind,deadline) {
  if (route.testMarkup) {
    const markup = route.testMarkup + routingText(kind,route.wait,deadline);
    return {markup,text:plain(markup)};
  }
  return renderTelegram(scenarios.find(item=>item.id===route.incident),route.level,kind,route.wait,deadline);
}

function renderTestNotice(id,level,input) {
  if (typeof id!=='string' || !/^SIM-[\dA-F]{8,12}$/.test(id) || !Object.hasOwn(simulationSeverities,level) ||
      typeof input?.status!=='string' || !Object.hasOwn(simulationStatuses,input.status) ||
      !services.some(service=>service.name===input.service)) return null;
  const text = (key,limit) => typeof input[key]==='string' && input[key].trim().length<=limit
    ? input[key].trim() : null;
  const title = text('title',100);
  const description = text('description',1600);
  const actions = text('actions',1000);
  if (!title || !description || actions===null) return null;
  const sections = [
    '🧪 <b>TEST EVENT · Incident Compass</b>',
    `<b>${level} · ${simulationSeverities[level]}</b> · ${simulationStatuses[input.status]}`,
    `<b>${escape(title)}</b>`,
    `<code>${escape(id)}</code> · ${escape(input.service)}`,
    '',
    escape(description),
    actions ? `\n🔎 <b>Recommended test action</b>\n${escape(actions)}` : '',
  ];
  const markup = sections.join('\n').trimEnd();
  return {markup,text:plain(markup)};
}

async function load() {
  try {return JSON.parse(await readFile(routePath,'utf8'));}
  catch(error){if(error.code==='ENOENT')return {routes:[],offsets:{},connections:{}};throw error;}
}

async function save(state) {
  const temporary=new URL(`.telegram-routing.${randomUUID()}.tmp`,routePath);
  try {
    await writeFile(temporary,JSON.stringify(state),{mode:0o600,flag:'wx'});
    await rename(temporary,routePath);
  } finally {await rm(temporary,{force:true});}
}

function summarize(entry) {
  const {id,incident,level,stage,created,deadline,reason,acceptedBy,notice}=entry;
  return {id,incident,level,stage,created,deadline,reason,acceptedBy,notice,test:Boolean(entry.testMarkup),owner:entry.owner?.label,team:entry.team?.label};
}

export function createTelegramRouter({connect,call,onUpdates=()=>{},now=Date.now}) {
  let queue=Promise.resolve();
  let running=false;
  const pending=new Map();
  const notices=new Map();
  let ownerProfile;
  const exclusive=operation=>{
    const result=queue.then(operation);
    queue=result.catch(()=>{});
    return result;
  };
  function targets(state,config) {
    const known=state.connections[botId(config.token)] || {};
    const people=known.people || [];
    const account = people.find(item=>item.chat===config.owner);
    const label = account?.label || (ownerProfile?.key===ownerProfileKey(config) ? ownerProfile.label : null);
    const owner=privateId(config.owner) ? {id:'default',chat:config.owner,label:label||'Connected private chat'} : undefined;
    return {team:known.team,people:[owner,...people.filter(item=>item.chat!==config.owner)].filter(Boolean),auto:known.auto||{},enrollment:known.enrollment};
  }
  async function resolveOwnerProfile(state,config) {
    const key = ownerProfileKey(config);
    if (!key || state.connections[botId(config.token)]?.people?.some(person=>person.chat===config.owner&&person.label)) return;
    if (ownerProfile?.key===key) {
      if (ownerProfile.pending) return ownerProfile.pending;
      if (ownerProfile.expires>now()) return;
    }
    const profile = {key,label:ownerProfile?.key===key ? ownerProfile.label : ''};
    ownerProfile = profile;
    profile.pending = (async()=>{
      try {
        const chat = await call(config.token,'getChat',{chat_id:config.owner});
        const label = chat.ok && chat.result?.type==='private' && String(chat.result.id)===config.owner
          ? telegramName(chat.result) : '';
        if (label) profile.label = label;
        profile.expires = now() + (label ? 10*60_000 : 30_000);
      } catch {
        profile.expires = now() + 30_000;
      } finally {
        delete profile.pending;
      }
    })();
    return profile.pending;
  }
  async function list() {
    const [state,config]=await Promise.all([load(),connect()]);
    await resolveOwnerProfile(state,config);
    const destinations=targets(state,config);
    return {
      botConnected:Boolean(config.token),
      team:destinations.team ? {label:destinations.team.label,destination:masked(destinations.team.chat)} : null,
      people:destinations.people.map(({id,label,chat})=>({id,label,destination:masked(chat)})),
      auto:{enabled:!!destinations.auto.enabled,owner:destinations.auto.owner||'',wait:destinations.auto.wait||60},
      enrollment:destinations.enrollment ? {url:destinations.enrollment.url} : null,
      routes:state.routes.slice(0,20).map(summarize),
    };
  }
  async function register(token,chat,label,mode) {
    return exclusive(async()=>{
      const config=await connect();
      if (token!==config.token || (mode==='team' ? !groupId(chat) : !privateId(chat))) return false;
      const state=await load();
      const known=state.connections[botId(token)] ||= {people:[]};
      if (mode==='team') {
        if(known.team?.chat!==chat){
          if(known.auto)known.auto.enabled=false;
          delete known.enrollment;
          known.people=(known.people||[]).filter(person=>!person.group);
        }
        known.team={chat,label};
      }
      else {
        const existing=known.people.find(item=>item.chat===chat);
        if (existing) existing.label=label;
        else if (known.people.length<12) known.people.push({id:randomUUID(),chat,label});
        else return false;
      }
      await save(state);
      return true;
    });
  }
  async function preview(input) {
    const incident=scenarios.find(record=>record.id===input.incident);
    const level=input.level;
    const wait=Number(input.wait);
    if (!incident || typeof level!=='string' || !Object.hasOwn(presentations,level) || !secondsAllowed.has(wait)) return {error:'Choose an incident, urgency, and response window.'};
    const [state,config]=await Promise.all([load(),connect()]);
    if(input.owner==='default') await resolveOwnerProfile(state,config);
    const {team,people}=targets(state,config);
    const owner=people.find(person=>person.id===input.owner);
    const direct=level==='P1';
    const canStart=Boolean(config.token && team && (direct || owner));
    const messages=direct ? [{destination:'Team group',body:renderTelegram(incident,level,'critical',wait).text}]
      : [{destination:'Private page',body:renderTelegram(incident,level,'private',wait).text},{destination:'Escalation on timeout',body:renderTelegram(incident,level,'timeout',wait).text}];
    const token=randomUUID();
    for(const [key,draft] of pending) if(draft.expires<=now())pending.delete(key);
    if(canStart && pending.size>=40)return {error:'Too many pending previews. Try again in a few minutes.'};
    if(canStart)pending.set(token,{incident:incident.id,level,wait,owner,team,bot:botId(config.token),expires:now()+5*60_000});
    return {token:canStart?token:null,canStart,messages,direct,team:team?.label,owner:owner?.label,missing:!config.token?'Connect Telegram first.':!team?'Pair a team group before starting live routing.':!direct&&!owner?'Choose a paired private responder.':null};
  }
  function noticeTarget(state,config,recipient) {
    const {team,people}=targets(state,config);
    if(recipient==='team'&&team)return {...team,group:true,label:`Everyone in ${team.label}`};
    return people.find(person=>person.id===recipient);
  }
  async function previewNotice(input) {
    const incident=scenarios.find(record=>record.id===input.incident);
    const level=input.level;
    if(typeof level!=='string')return {error:'Choose an incident and severity.'};
    const message = incident && Object.hasOwn(presentations,level)
      ? renderTelegram(incident,level) : renderTestNotice(input.incident,level,input.simulation);
    if(!message)return {error:'Choose a prepared incident or a valid test event and severity.'};
    const [state,config]=await Promise.all([load(),connect()]);
    if(input.recipient==='default') await resolveOwnerProfile(state,config);
    const target=noticeTarget(state,config,input.recipient);
    if(!config.token||!target)return {error:'Choose the paired team group or a paired private responder.'};
    const {team,auto}=targets(state,config);
    const group = target.group===true;
    if(!group&&!team)return {error:'Pair a team group so the bot can escalate a declined or unanswered private page.'};
    const wait = secondsAllowed.has(auto.wait) ? auto.wait : 60;
    for(const [id,entry] of notices)if(entry.expires<=now())notices.delete(id);
    if(notices.size>=40)return {error:'Too many notice previews. Try again shortly.'};
    const token=randomUUID();
    const route = {incident:input.incident,level,wait,testMarkup:incident?undefined:message.markup};
    notices.set(token,{...route,recipient:input.recipient,chat:target.chat,team,bot:botId(config.token),message,expires:now()+5*60_000});
    return {token,incident:input.incident,level,text:group?message.text:renderRoute(route,'private').text,test:!incident,
      label:target.label,destination:masked(target.chat),group,wait:group?undefined:wait,team:group?undefined:team.label};
  }
  async function sendNotice(input) {
    if(input.confirm!==true)return {error:'Confirm the notification and recipient before sending.'};
    return exclusive(async()=>{
      const notice=notices.get(input.token);
      if(!notice||notice.expires<=now())return {error:'This preview was used or expired. Open a new preview.'};
      const [state,config]=await Promise.all([load(),connect()]);
      const target=noticeTarget(state,config,notice.recipient);
      if(!target||target.chat!==notice.chat||botId(config.token)!==notice.bot)return {error:'The recipient changed. Review a new preview.'};
      if(target.group!==true){
        const {team}=targets(state,config);
        if(!team||team.chat!==notice.team?.chat)return {error:'The team group changed. Review a new preview.'};
        const active=state.routes.find(route=>route.bot===notice.bot&&route.incident===notice.incident&&liveStages.has(route.stage));
        if(active){
          if(active.owner?.chat!==target.chat||active.reason==='critical')return {error:'This incident already has an active Telegram route. Open it in Telegram routing to see who is handling it.'};
          notices.delete(input.token);
          return {route:summarize(active),existing:true};
        }
        const hook=await call(config.token,'getWebhookInfo');
        if(!hook.ok||hook.result?.url)return {error:'Telegram replies require a reachable bot without an active webhook.'};
        const route=await queueRoute(state,{...notice,owner:target,team,direct:false});
        notices.delete(input.token);
        return {route:summarize(route)};
      }
      notices.delete(input.token);
      const body={chat_id:target.chat,text:notice.message.markup,parse_mode:'HTML',link_preview_options:{is_disabled:true}};
      if(target.group===true)body.reply_markup={inline_keyboard:teamButtons(state,{bot:notice.bot,team:target},false)};
      const sent=await call(config.token,'sendMessage',body);
      const accepted=sent.ok&&Number.isInteger(sent.result?.message_id);
      return {incident:notice.incident,level:notice.level,channel:'telegram',destination:masked(target.chat),label:target.label,
        status:accepted?'accepted':sent.http>=400&&sent.http<500?'rejected':'unknown',
        detail:sent.http===403 ? (target.group ? 'Check that the bot can still post in the paired group.' : 'Check that the responder has started the bot and hasn’t blocked it.') : undefined,
        time:now()};
    });
  }
  async function start(input) {
    if(input.confirm!==true)return {error:'Confirm a preview before routing a live alert.'};
    return exclusive(async()=>{
      const entry=pending.get(input.token);
      if(!entry || entry.expires<=now())return {error:'That preview expired. Open a new preview.'};
      const config=await connect();
      const state=await load();
      const {team,people}=targets(state,config);
      if(entry.bot!==botId(config.token)||team?.chat!==entry.team.chat||
        (entry.level!=='P1'&&!people.some(person=>person.id===entry.owner.id&&person.chat===entry.owner.chat)))return {error:'The routing destinations changed. Review a new preview.'};
      if(state.routes.some(route=>route.bot===entry.bot&&route.incident===entry.incident&&liveStages.has(route.stage)))return {error:'This incident already has an active Telegram route.'};
      const hook=await call(config.token,'getWebhookInfo');
      if(!hook.ok || hook.result?.url)return {error:'This bot must be reachable and available for polling. Use a dedicated bot without an active webhook.'};
      const route=await queueRoute(state,entry);
      pending.delete(input.token);
      return {route:summarize(route)};
    });
  }
  async function queueRoute(state,entry) {
    const direct = entry.direct ?? entry.level==='P1';
    const route={id:randomUUID(),bot:entry.bot,incident:entry.incident,level:entry.level,wait:entry.wait,
      testMarkup:entry.testMarkup,owner:entry.owner,team:entry.team,created:now(),event:entry.event,
      stage:direct?'queued-team':'queued-private',reason:direct?'critical':null};
    state.routes.unshift(route);
    state.routes=[...state.routes.filter(item=>liveStages.has(item.stage)),...state.routes.filter(item=>!liveStages.has(item.stage)).slice(0,45)].sort((a,b)=>b.created-a.created);
    await save(state);
    return route;
  }
  async function configureAuto(input) {
    return exclusive(async()=>{
      if(typeof input.enabled!=='boolean')return {error:'Choose whether automatic delivery is on or off.'};
      const config=await connect();
      if(!config.token)return {error:'Connect the Telegram bot first.'};
      const state=await load();
      const id=botId(config.token);
      const known=state.connections[id] ||= {people:[]};
      if(!input.enabled){
        known.auto={...known.auto,enabled:false};
        await save(state);
        return {enabled:false};
      }
      const wait=Number(input.wait);
      const {team,people}=targets(state,config);
      if(!team||!people.some(person=>person.id===input.owner)||!secondsAllowed.has(wait))return {error:'Choose a paired team group, a private responder, and a response window.'};
      const hook=await call(config.token,'getWebhookInfo');
      if(!hook.ok||hook.result?.url)return {error:'Use an accessible Telegram bot without a webhook for automatic delivery.'};
      known.auto={enabled:true,owner:input.owner,wait};
      await save(state);
      return {enabled:true};
    });
  }
  async function recordAlert(input) {
    return exclusive(async()=>{
      const incident=typeof input.incident==='string'&&scenarios.find(record=>record.id===input.incident);
      const level=input.level;
      const test = !incident&&typeof level==='string' ? renderTestNotice(input.incident,level,input.simulation) : null;
      if(!(test||(incident&&typeof level==='string'&&Object.hasOwn(presentations,level))) ||
         !/^[a-zA-Z0-9_-]{12,100}$/.test(typeof input.event==='string'?input.event:'')){
        return {error:'Invalid alert event.'};
      }
      const config=await connect();
      const state=await load();
      const id=botId(config.token);
      const {team,people,auto}=targets(state,config);
      const active=state.routes.find(route=>route.bot===id&&(route.event===input.event||(route.incident===input.incident&&liveStages.has(route.stage))));
      if(active)return {status:'duplicate',route:summarize(active)};
      if(!auto.enabled)return {status:'disabled'};
      if(auto.owner==='default') await resolveOwnerProfile(state,config);
      const owner=(auto.owner==='default'?targets(state,config).people:people).find(person=>person.id===auto.owner);
      if(!config.token||!team||(level!=='P1'&&!owner))return {error:'Automatic Telegram delivery needs its group and responder configured.'};
      const route=await queueRoute(state,{bot:id,incident:input.incident,level,wait:auto.wait,owner,team,event:input.event,testMarkup:test?.markup});
      return {status:'queued',route:summarize(route)};
    });
  }
  async function enableEnrollment(input) {
    return exclusive(async()=>{
      const config=await connect();
      const state=await load();
      const known=state.connections[botId(config.token)];
      if(!config.token||!known?.team)return {error:'Connect the Telegram bot and pair the team group first.'};
      if(input.reset!==true&&known.enrollment)return {url:known.enrollment.url};
      const bot=await call(config.token,'getMe');
      if(!bot.ok||!/^[a-z0-9_]{5,64}$/i.test(String(bot.result?.username||'')))return {error:'Telegram did not return the bot username.'};
      const hook=await call(config.token,'getWebhookInfo');
      if(!hook.ok||hook.result?.url)return {error:'Use an accessible Telegram bot without a webhook for enrollment.'};
      const code='team_'+randomUUID().replace(/-/g,'');
      known.enrollment={code,url:`https://t.me/${bot.result.username}?start=${code}`};
      await save(state);
      return {url:known.enrollment.url};
    });
  }
  async function enrolledMember(state,token,update) {
    const known=state.connections[botId(token)];
    const {message}=update;
    const user=message?.from;
    const userId=String(user?.id);
    const match=/^\/start(?:@\w+)? (team_[a-f0-9]{32})$/.exec(message?.text||'');
    if(!match||known?.enrollment?.code!==match[1]||!known.team||message?.chat?.type!=='private'||String(message.chat.id)!==userId||user?.is_bot)return;
    const member=await call(token,'getChatMember',{chat_id:known.team.chat,user_id:user.id});
    if(!currentMember(member)){
      await call(token,'sendMessage',{chat_id:userId,text:'Join the Incident Compass Telegram group first, then reopen the enrollment link. If you already joined, ask the group administrator to check the bot’s membership permissions.'});
      return;
    }
    const joined=known.people.find(person=>person.chat===userId);
    if(!joined&&known.people.length>=12){
      await call(token,'sendMessage',{chat_id:userId,text:'The local responder roster is full. Contact the group owner to finish setup.'});
      return;
    }
    if(joined)joined.label=responderName(user);
    else known.people.push({id:randomUUID(),chat:userId,label:responderName(user),group:known.team.chat});
    await save(state);
    await call(token,'sendMessage',{chat_id:userId,text:'✅ Private Incident Compass alerts are enabled for this chat. The on-call coordinator can now select you as a responder.'});
  }
  function teamButtons(state,route,claim) {
    const enrollment=state.connections[route.bot]?.enrollment;
    const team=state.connections[route.bot]?.team;
    const rows=claim?[[{text:'🙋 Claim incident',style:'primary',callback_data:`ic:${route.id}:claim`}]]:[];
    if(enrollment&&team?.chat===route.team.chat)rows.push([{text:'🔔 Enable private alerts',url:enrollment.url}]);
    return rows;
  }
  async function acceptUpdate(state,token,update) {
    const bot=botId(token);
    const callback=update.callback_query;
    const message=callback?.message || update.message;
    const user=callback?.from || message?.from;
    const id=String(message?.chat?.id);
    const [prefix,routeId,action]=String(callback?.data||'').split(':');
    const route=callback && prefix==='ic' ? state.routes.find(item=>item.id===routeId&&item.bot===bot) :
      !callback&&message?.reply_to_message&&state.routes.find(item=>item.bot===bot&&item.owner?.chat===id&&item.privateMessage===message.reply_to_message.message_id&&item.stage==='waiting');
    if(!route) {
      if(prefix==='ic'&&callback?.id) await call(token,'answerCallbackQuery',{callback_query_id:callback.id,text:'This page is no longer active.'});
      return;
    }
    const inPrivate=id===route.owner?.chat&&String(user?.id)===id&&route.stage==='waiting'&&
      (!callback||message.message_id===route.privateMessage);
    const inTeam=id===route.team.chat&&route.stage==='open-team'&&message?.message_id===route.teamMessage&&action==='claim'&&user?.id&&!user.is_bot;
    const reply=String(message?.text||message?.caption||'').trim();
    const responseTime = !callback && Number.isInteger(message?.date) ? message.date*1000 : now();
    const withinWindow = inPrivate && responseTime<route.deadline;
    const decline=withinWindow&&(action==='decline'||(!callback&&/^(decline|reject|busy|no|unavailable)\b/i.test(reply)));
    const accept=inTeam||(withinWindow&&(action==='accept'||(!callback&&reply&&!decline)));
    if(decline){route.stage='queued-team';route.reason='decline';}
    if(accept){route.stage='accepted';route.acceptedBy=responderName(user);}
    if(decline||accept)await save(state);
    if(callback?.id)await call(token,'answerCallbackQuery',{callback_query_id:callback.id,text:accept?'Ownership recorded.':decline?'Escalating to the team.':'This page is no longer available to claim.'});
    if(decline||accept) {
      const previous=renderRoute(route,inTeam?route.reason:'private',route.deadline).markup;
      const status=accept?`✅ <b>Accepted by ${escape(route.acceptedBy)}</b>`:'↪ <b>Declined · Escalating to the team</b>';
      await call(token,'editMessageText',{chat_id:id,message_id:callback?message.message_id:route.privateMessage,text:previous+'\n\n'+status,parse_mode:'HTML',reply_markup:{inline_keyboard:inTeam?teamButtons(state,route,false):[]}});
    }
  }
  async function send(state,route,token,toTeam) {
    if(!toTeam&&route.owner.group){
      const member=await call(token,'getChatMember',{chat_id:route.team.chat,user_id:Number(route.owner.chat)});
      if(!currentMember(member)){
        route.stage='queued-team';
        route.reason='unavailable';
        return;
      }
    }
    route.stage=toTeam?'sending-team':'sending-private';
    if (!toTeam) route.deadline=now()+route.wait*1000;
    const message=renderRoute(route,toTeam?route.reason:'private',toTeam?undefined:route.deadline);
    await save(state);
    const data=(name)=>`ic:${route.id}:${name}`;
    const result=await call(token,'sendMessage',{
      chat_id:toTeam?route.team.chat:route.owner.chat,text:message.markup,parse_mode:'HTML',link_preview_options:{is_disabled:true},
      reply_markup:{inline_keyboard:toTeam?teamButtons(state,route,true):[[
        {text:'✅ Accept',style:'success',callback_data:data('accept')},{text:'↪ Decline',style:'danger',callback_data:data('decline')}
      ]]},
    });
    if(result.ok&&Number.isInteger(result.result?.message_id)){
      if(toTeam){route.teamMessage=result.result.message_id;route.stage='open-team';}
      else {route.privateMessage=result.result.message_id;route.stage='waiting';}
    }else if(toTeam){
      route.stage='failed';
      route.notice='Telegram did not confirm the group post. Check the group before starting a new route.';
    }else{
      route.stage='queued-team';
      route.reason='unavailable';
    }
  }
  async function step() {
    if(running)return;
    running=true;
    try {await exclusive(async()=>{
      const config=await connect();
      if(!config.token)return;
      const id=botId(config.token);
      const state=await load();
      const outstanding=state.routes.filter(route=>route.bot===id&&liveStages.has(route.stage));
      const enrolling=Boolean(state.connections[id]?.enrollment);
      if(!outstanding.length&&!enrolling)return;
      if(enrolling||outstanding.some(route=>['waiting','open-team'].includes(route.stage))){
        const data=await call(config.token,'getUpdates',{offset:state.offsets[id] || 0,timeout:0,limit:50,allowed_updates:['message','callback_query']});
        if(data.ok&&Array.isArray(data.result)){
          onUpdates(config.token,data.result);
          for(const update of data.result){
            await enrolledMember(state,config.token,update);
            await acceptUpdate(state,config.token,update);
            if(Number.isInteger(update.update_id))state.offsets[id]=update.update_id+1;
          }
          if(data.result.length)await save(state);
        }
      }
      for(const route of outstanding){
        if(route.stage==='sending-team'){route.stage='failed';route.notice='Server restarted during the group post. Check Telegram before retrying.';await save(state);}
        if(route.stage==='sending-private'&&route.deadline<=now()){route.stage='queued-team';route.reason='unavailable';}
        if(route.stage==='waiting'&&route.deadline<=now()){
          route.stage='queued-team';route.reason='timeout';await save(state);
          await call(config.token,'editMessageText',{chat_id:route.owner.chat,message_id:route.privateMessage,
            text:renderRoute(route,'private',route.deadline).markup+'\n\n⏱ <b>Response window expired · Escalated to the team</b>',
            parse_mode:'HTML',reply_markup:{inline_keyboard:[]}});
        }
        if(route.stage==='queued-private'){await send(state,route,config.token,false);await save(state);}
        if(route.stage==='queued-team'){await send(state,route,config.token,true);await save(state);}
      }
    });}finally {running=false;}
  }
  return {list,register,preview,start,previewNotice,sendNotice,configureAuto,recordAlert,enableEnrollment,step};
}
