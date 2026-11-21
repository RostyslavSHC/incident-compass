import {randomUUID} from 'node:crypto';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {scenarios} from './public/data.mjs';

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
const responderName=user=>[user?.first_name,user?.last_name].filter(Boolean).join(' ').slice(0,100)||'Telegram responder';
const currentMember=result=>result.ok&&['creator','administrator','member','restricted'].includes(result.result?.status)&&
  (result.result.status!=='restricted'||result.result.is_member);

export function renderTelegram(incident,level,kind='notice',wait=60) {
  const [icon,title]=presentations[level];
  const route = {
    notice:'',
    private:`\n\n⏳ <b>Respond within ${wait} seconds</b>\nTap Accept or Decline. You can also reply directly to this message.`,
    critical:'\n\n👥 <b>Team page · Immediate routing</b>\nTap Claim incident to take ownership.',
    decline:'\n\n👥 <b>Team escalation · Responder declined</b>\nTap Claim incident to take ownership.',
    timeout:'\n\n👥 <b>Team escalation · No response before the deadline</b>\nTap Claim incident to take ownership.',
    unavailable:'\n\n👥 <b>Team escalation · Private page could not be confirmed</b>\nTap Claim incident to take ownership.',
  }[kind];
  const markup=`${icon} <b>${level} · ${title}</b>\n<b>${escape(incident.title)}</b>\n<code>${escape(incident.id)}</code> · ${escape(incident.service)} · ${incident.alert} ET\n\n📊 <b>Impact</b> · ${incident.affectedPct}% of monitored operations in this sample\n🔎 <b>First check</b>\n${escape(incident.next)}${route}\n\n🧪 Incident Compass · simulated incident`;
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
  return {id,incident,level,stage,created,deadline,reason,acceptedBy,notice};
}

export function createTelegramRouter({connect,call,onUpdates=()=>{},now=Date.now}) {
  let queue=Promise.resolve();
  let running=false;
  const pending=new Map();
  const notices=new Map();
  const exclusive=operation=>{
    const result=queue.then(operation);
    queue=result.catch(()=>{});
    return result;
  };
  function targets(state,config) {
    const known=state.connections[botId(config.token)] || {};
    const people=known.people || [];
    const owner=privateId(config.owner) ? {id:'default',chat:config.owner,label:people.find(item=>item.chat===config.owner)?.label||'Connected private chat'} : undefined;
    return {team:known.team,people:[owner,...people.filter(item=>item.chat!==config.owner)].filter(Boolean),auto:known.auto||{},enrollment:known.enrollment};
  }
  async function list() {
    const [state,config]=await Promise.all([load(),connect()]);
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
    if(!incident||typeof level!=='string'||!Object.hasOwn(presentations,level))return {error:'Choose a prepared incident and priority.'};
    const [state,config]=await Promise.all([load(),connect()]);
    const target=noticeTarget(state,config,input.recipient);
    if(!config.token||!target)return {error:'Choose the paired team group or a paired private responder.'};
    for(const [id,entry] of notices)if(entry.expires<=now())notices.delete(id);
    if(notices.size>=40)return {error:'Too many notice previews. Try again shortly.'};
    const token=randomUUID();
    const message=renderTelegram(incident,level);
    notices.set(token,{recipient:input.recipient,chat:target.chat,bot:botId(config.token),incident:incident.id,level,message,expires:now()+5*60_000});
    return {token,incident:incident.id,level,text:message.text,label:target.label,destination:masked(target.chat),group:Boolean(target.group)};
  }
  async function sendNotice(input) {
    if(input.confirm!==true)return {error:'Confirm the notification and recipient before sending.'};
    return exclusive(async()=>{
      const notice=notices.get(input.token);
      if(!notice||notice.expires<=now())return {error:'This preview was used or expired. Open a new preview.'};
      const [state,config]=await Promise.all([load(),connect()]);
      const target=noticeTarget(state,config,notice.recipient);
      if(!target||target.chat!==notice.chat||botId(config.token)!==notice.bot)return {error:'The recipient changed. Review a new preview.'};
      if(typeof target.group==='string'){
        const member=await call(config.token,'getChatMember',{chat_id:target.group,user_id:Number(target.chat)});
        if(!currentMember(member))return {error:'This responder could not be verified as a current group member.'};
      }
      notices.delete(input.token);
      const body={chat_id:target.chat,text:notice.message.markup,parse_mode:'HTML',link_preview_options:{is_disabled:true}};
      if(target.group===true)body.reply_markup={inline_keyboard:teamButtons(state,{bot:notice.bot,team:target},false)};
      const sent=await call(config.token,'sendMessage',body);
      const accepted=sent.ok&&Number.isInteger(sent.result?.message_id);
      return {incident:notice.incident,level:notice.level,channel:'telegram',destination:masked(target.chat),label:target.label,
        status:accepted?'accepted':sent.http>=400&&sent.http<500?'rejected':'unknown',time:now()};
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
    const route={id:randomUUID(),bot:entry.bot,incident:entry.incident,level:entry.level,wait:entry.wait,
      owner:entry.owner,team:entry.team,created:now(),event:entry.event,stage:entry.level==='P1'?'queued-team':'queued-private',reason:entry.level==='P1'?'critical':null};
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
      if(!incident||typeof level!=='string'||!Object.hasOwn(presentations,level)||!/^[a-zA-Z0-9_-]{12,100}$/.test(typeof input.event==='string'?input.event:'')){
        return {error:'Invalid alert event.'};
      }
      const config=await connect();
      const state=await load();
      const id=botId(config.token);
      const {team,people,auto}=targets(state,config);
      if(!auto.enabled)return {status:'disabled'};
      const owner=people.find(person=>person.id===auto.owner);
      if(!config.token||!team||(level!=='P1'&&!owner))return {error:'Automatic Telegram delivery needs its group and responder configured.'};
      if(state.routes.some(route=>route.bot===id&&(route.event===input.event||(route.incident===incident.id&&liveStages.has(route.stage)))))return {status:'duplicate'};
      const route=await queueRoute(state,{bot:id,incident:incident.id,level,wait:auto.wait,owner,team,event:input.event});
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
    const decline=inPrivate&&(action==='decline'||(!callback&&/^(decline|reject|busy|no|unavailable)\b/i.test(reply)));
    const accept=inTeam||(inPrivate&&(action==='accept'||(!callback&&reply&&!decline)));
    if(decline){route.stage='queued-team';route.reason='decline';}
    if(accept){route.stage='accepted';route.acceptedBy=responderName(user);}
    if(decline||accept)await save(state);
    if(callback?.id)await call(token,'answerCallbackQuery',{callback_query_id:callback.id,text:accept?'Ownership recorded.':decline?'Escalating to the team.':'This page is no longer available to claim.'});
    if(decline||accept) {
      const incident=scenarios.find(item=>item.id===route.incident);
      const previous=renderTelegram(incident,route.level,inTeam?route.reason:'private',route.wait).markup;
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
    const incident=scenarios.find(item=>item.id===route.incident);
    const message=renderTelegram(incident,route.level,toTeam?route.reason:'private',route.wait);
    route.stage=toTeam?'sending-team':'sending-private';
    if (!toTeam) route.deadline=now()+route.wait*1000;
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
      else {route.privateMessage=result.result.message_id;route.stage='waiting';route.deadline=now()+route.wait*1000;}
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
          await call(config.token,'editMessageReplyMarkup',{chat_id:route.owner.chat,message_id:route.privateMessage,reply_markup:{inline_keyboard:[]}});
        }
        if(route.stage==='queued-private'){await send(state,route,config.token,false);await save(state);}
        if(route.stage==='queued-team'){await send(state,route,config.token,true);await save(state);}
      }
    });}finally {running=false;}
  }
  return {list,register,preview,start,previewNotice,sendNotice,configureAuto,recordAlert,enableEnrollment,step};
}
