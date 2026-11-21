import {randomUUID} from 'node:crypto';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {priority,scenarios} from './public/data.mjs';
import {createTelegramRouter,renderTelegram} from './telegram-routing.mjs';

const contactPath = new URL('./.alert-recipients.local.json',import.meta.url);
const providerPath = new URL('./.alert-providers.local.json',import.meta.url);
const routes = {
  sms:{name:'SMS',provider:'Twilio',keys:['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM']},
  email:{name:'Email',provider:'Resend',keys:['RESEND_API_KEY','ALERT_EMAIL_FROM']},
  telegram:{name:'Telegram',provider:'Telegram Bot API',keys:['TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID']},
};
const validValues = {
  TWILIO_ACCOUNT_SID:/^AC[a-f0-9]{32}$/i,
  TWILIO_AUTH_TOKEN:/^[a-f0-9]{32}$/i,
  TWILIO_FROM:/^\+[1-9]\d{7,14}$/,
  RESEND_API_KEY:/^re_[a-z0-9_-]{8,160}$/i,
  ALERT_EMAIL_FROM:/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/,
  TELEGRAM_BOT_TOKEN:/^\d{5,20}:[a-z0-9_-]{20,100}$/i,
  TELEGRAM_CHAT_ID:/^-?\d{4,24}$|^@[a-z0-9_]{5,64}$/i,
};
const levels = ['P1','P2','P3'];
const severity = {P1:'Critical',P2:'High',P3:'Monitor'};

async function readObject(path) {
  try { return JSON.parse(await readFile(path,'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

async function saveProviders(settings) {
  const temporary = new URL(`.alert-providers.${randomUUID()}.tmp`,providerPath);
  try {
    await writeFile(temporary,JSON.stringify(settings,null,2)+'\n',{mode:0o600,flag:'wx'});
    await rename(temporary,providerPath);
  } finally { await rm(temporary,{force:true}); }
}

async function loadConfig() {
  const [contacts,saved] = await Promise.all([readObject(contactPath),readObject(providerPath)]);
  const settings = Object.fromEntries(Object.keys(validValues).map(name=>[name,process.env[name]?.trim() || saved[name] || '']));
  const targets = {
    sms:(Array.isArray(contacts.sms) ? contacts.sms : []).filter(value=>typeof value==='string' && validValues.TWILIO_FROM.test(value)).slice(0,8),
    email:(Array.isArray(contacts.email) ? contacts.email : []).filter(value=>typeof value==='string' && validValues.ALERT_EMAIL_FROM.test(value)).slice(0,8),
    telegram:validValues.TELEGRAM_CHAT_ID.test(settings.TELEGRAM_CHAT_ID) ? [settings.TELEGRAM_CHAT_ID] : [],
  };
  return {settings,targets};
}

function mask(channel,recipient) {
  if (channel === 'sms') return '••• ••• ' + recipient.slice(-4);
  if (channel === 'telegram') return 'Chat ending ' + recipient.slice(-4);
  const [local,domain] = recipient.split('@');
  return local.slice(0,2) + '•••@' + domain;
}

function channelStatus(config) {
  return Object.fromEntries(Object.entries(routes).map(([channel,route])=>{
    const recipients = config.targets[channel].map((recipient,index)=>({
      id:`${channel}-${index}`, label:`${route.name} recipient ${index+1}`, destination:mask(channel,recipient),
    }));
    return [channel,{name:route.name,provider:route.provider,configured:route.keys.every(name=>validValues[name].test(config.settings[name])),
      recipients,savedFields:route.keys.filter(name=>validValues[name].test(config.settings[name]))}];
  }));
}

function formatAlert(incident,level) {
  const label = severity[level];
  const title = `[Incident Compass demo] ${level} ${label} | ${incident.title}`;
  const impact = `${incident.affectedPct}% of monitored operations in the sample.`;
  return {
    email:{subject:title,text:`${incident.id} · ${incident.service} · ${incident.alert} ET\n${impact}\n\nSuggested first check: ${incident.next}\n\nThis is a simulated incident sent from Incident Compass.`},
    sms:{text:`Incident Compass DEMO: ${level} ${label} ${incident.id} - ${incident.title}. ${incident.affectedPct}% affected in sample. Review Incident Compass.`},
    telegram:renderTelegram(incident,level),
  };
}

export async function deliverAlert(channel,recipient,message,config,requestId,request = fetch) {
  const jsonHeaders = {'Content-Type':'application/json'};
  let url, headers, body;
  if (channel === 'sms') {
    url = `https://api.twilio.com/2010-04-01/Accounts/${config.TWILIO_ACCOUNT_SID}/Messages.json`;
    headers = {Authorization:'Basic ' + Buffer.from(config.TWILIO_ACCOUNT_SID + ':' + config.TWILIO_AUTH_TOKEN).toString('base64'),
      'Content-Type':'application/x-www-form-urlencoded'};
    body = new URLSearchParams({To:recipient,From:config.TWILIO_FROM,Body:message.text});
  } else if (channel === 'email') {
    url = 'https://api.resend.com/emails';
    headers = {...jsonHeaders,Authorization:'Bearer ' + config.RESEND_API_KEY,'Idempotency-Key':requestId};
    body = JSON.stringify({from:config.ALERT_EMAIL_FROM,to:[recipient],subject:message.subject,text:message.text});
  } else {
    url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
    headers = jsonHeaders;
    body = JSON.stringify({chat_id:recipient,text:message.markup || message.text,
      ...(message.markup?{parse_mode:'HTML'}:{}),link_preview_options:{is_disabled:true}});
  }
  try {
    const response = await request(url,{method:'POST',headers,body,signal:AbortSignal.timeout(9000)});
    if (!response.ok) return {status:response.status >= 500 ? 'unknown' : 'rejected',http:response.status};
    const result = await response.json();
    const id = channel==='sms' ? result.sid : channel==='email' ? result.id : result.ok && result.result?.message_id;
    if (channel==='sms' && ['failed','undelivered','canceled'].includes(result.status)) return {status:'rejected',reference:id};
    return id ? {status:'accepted',reference:String(id)} : {status:'unknown'};
  } catch { return {status:'unknown'}; }
}

async function readJson(request) {
  let size=0;
  const chunks=[];
  for await (const chunk of request) {
    size+=chunk.length;
    if (size>12_000) return null;
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return null; }
}

async function providerJson(request,url,options={}) {
  try {
    const response=await request(url,{...options,signal:AbortSignal.timeout(8000)});
    return {http:response.status,ok:response.ok,data:await response.json().catch(()=>null)};
  } catch {return {http:0,ok:false,data:null};}
}

const telegramUrl = (token,method) => `https://api.telegram.org/bot${token}/${method}`;
const telegramBody = (body) => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

export async function checkAlertProvider(channel,settings,request=fetch) {
  if (channel==='sms') {
    const base=`https://api.twilio.com/2010-04-01/Accounts/${settings.TWILIO_ACCOUNT_SID}`;
    const headers={Authorization:'Basic '+Buffer.from(settings.TWILIO_ACCOUNT_SID+':'+settings.TWILIO_AUTH_TOKEN).toString('base64')};
    const account=await providerJson(request,base+'.json',{headers});
    if (!account.ok) return {status:'failed',detail:'Twilio could not validate the Account SID and Auth Token.'};
    const search=new URLSearchParams({PhoneNumber:settings.TWILIO_FROM});
    const sender=await providerJson(request,base+'/IncomingPhoneNumbers.json?'+search,{headers});
    const hasNumber=sender.data?.incoming_phone_numbers?.some(item=>item.phone_number===settings.TWILIO_FROM && item.capabilities?.sms===true);
    const trial=account.data?.type==='Trial';
    if (!hasNumber || trial) return {status:'limited',detail:trial
      ? 'Twilio authenticated a trial account. Its current trial restrictions can block Canadian recipients and custom alert text.'
      : 'Twilio authenticated the account, but this check could not confirm an SMS-capable number matching the sender.'};
    return {status:'verified',detail:'Twilio authenticated the account and found its SMS-capable sender. No SMS was sent.'};
  }
  if (channel==='email') {
    const domain=settings.ALERT_EMAIL_FROM.split('@').at(-1).toLowerCase();
    const result=await providerJson(request,'https://api.resend.com/domains',{headers:{Authorization:'Bearer '+settings.RESEND_API_KEY}});
    if (result.http===403) return {status:'limited',detail:'Sending-only keys cannot list domains. Verify the sender domain in Resend. An email is required to test actual delivery.'};
    if (!result.ok) return {status:'failed',detail:'Resend could not confirm access. Check the API key or try again later.'};
    const verified=result.data?.data?.some(entry=>entry.name?.toLowerCase()===domain && entry.status==='verified');
    return verified ? {status:'verified',detail:'Resend listed the sender domain as verified. No email was sent.'}
      : {status:'limited',detail:'This check could not find a verified domain matching the sender. Check the Domains page in Resend.'};
  }
  const chat=await providerJson(request,telegramUrl(settings.TELEGRAM_BOT_TOKEN,'getChat'),telegramBody({chat_id:settings.TELEGRAM_CHAT_ID}));
  return chat.ok && chat.data?.ok ? {status:'verified',detail:'Telegram confirmed that the bot can see the configured chat. No Telegram message was sent.'}
    : {status:'failed',detail:'Telegram could not find the chat with this token. Confirm that the bot has been added to the chat or started in a direct conversation.'};
}

export function createAlertApi({port,json,request = fetch}) {
  const origin = `http://127.0.0.1:${port}`;
  const previewLifetime = 5*60_000;
  const previews = new Map();
  const recent = new Map();
  const deliveries = [];
  const discoveries = new Map();
  function findPairing(entry,updates) {
    const match=Array.isArray(updates)&&updates.find(({message})=>
      (!(entry.personal||entry.routeMode==='responder') || message?.chat?.type==='private') &&
      (entry.routeMode!=='team'||['group','supergroup'].includes(message?.chat?.type)) &&
      (message?.text===`/start ${entry.code}`||message?.text===`/start@${entry.username} ${entry.code}`));
    if(match?.message?.chat?.id) entry.chatId=String(match.message.chat.id);
  }
  const call=async (token,method,body)=>{
    const response=await providerJson(request,telegramUrl(token,method),body?telegramBody(body):{});
    return {ok:response.ok&&response.data?.ok===true,result:response.data?.result,http:response.http};
  };
  const telegram=createTelegramRouter({
    connect:async()=>{
      const {settings}=await loadConfig();
      return {token:settings.TELEGRAM_BOT_TOKEN,owner:settings.TELEGRAM_CHAT_ID};
    },call,
    onUpdates:(token,updates)=>{
      for(const entry of discoveries.values()) if(entry.token===token&&entry.expires>Date.now()&&!entry.chatId)findPairing(entry,updates);
    },
  });
  setInterval(()=>void telegram.step().catch(()=>{}),2500).unref();
  let saving = false;
  return async (req,res,path)=>{
    if (req.headers.host !== `127.0.0.1:${port}`) return json(res,403,{error:'Open Incident Compass on its local address.'});
    if (path==='/api/alerts/status' && req.method==='GET') {
      return json(res,200,{channels:channelStatus(await loadConfig()),deliveries:deliveries.slice(0,20)});
    }
    if (path==='/api/alerts/telegram-routing' && req.method==='GET') return json(res,200,await telegram.list());
    if (req.method!=='POST' || req.headers.origin!==origin || req.headers['content-type']?.split(';',1)[0].trim()!=='application/json') {
      return json(res,403,{error:'Use the local Incident Compass dashboard.'});
    }
    const input=await readJson(req);
    if (!input || Array.isArray(input) || typeof input!=='object') return json(res,400,{error:'Invalid request.'});
    if (path==='/api/alerts/telegram-route-preview') {
      const result=await telegram.preview(input);
      return json(res,result.error?400:200,result);
    }
    if (path==='/api/alerts/telegram-route-start') {
      const result=await telegram.start(input);
      return json(res,result.error?409:202,result);
    }
    if (path==='/api/alerts/telegram-notice-preview') {
      const result=await telegram.previewNotice(input);
      return json(res,result.error?409:200,result);
    }
    if (path==='/api/alerts/telegram-notice-send') {
      const result=await telegram.sendNotice(input);
      if(result.error)return json(res,409,result);
      deliveries.unshift(result);
      deliveries.length=Math.min(deliveries.length,50);
      return json(res,200,{result});
    }
    if (path==='/api/alerts/telegram-automatic') {
      const result=await telegram.configureAuto(input);
      return json(res,result.error?409:200,result);
    }
    if (path==='/api/alerts/telegram-alert-event') {
      const result=await telegram.recordAlert(input);
      return json(res,result.error?409:202,result);
    }
    if (path==='/api/alerts/telegram-enrollment') {
      const result=await telegram.enableEnrollment(input);
      return json(res,result.error?409:200,result);
    }
    if (path==='/api/alerts/telegram-pair-group') {
      const target=typeof input.chat==='string' ? input.chat.trim() : '';
      if(!/^-[1-9]\d{3,24}$|^@[a-z0-9_]{5,64}$/i.test(target))return json(res,400,{error:'Enter the negative group chat ID or its public @username.'});
      const token=(await loadConfig()).settings.TELEGRAM_BOT_TOKEN;
      if(!validValues.TELEGRAM_BOT_TOKEN.test(token))return json(res,409,{error:'Connect your Telegram bot first.'});
      const chat=await call(token,'getChat',{chat_id:target});
      if(!chat.ok)return json(res,409,{error:'The bot cannot see this group yet. Add the bot as a member in Telegram, then verify again.'});
      if(!['group','supergroup'].includes(chat.result?.type))return json(res,400,{error:'Choose a Telegram group or supergroup.'});
      const bot=await call(token,'getMe');
      if(!bot.ok)return json(res,409,{error:'Telegram could not verify the bot credentials.'});
      const member=await call(token,'getChatMember',{chat_id:chat.result.id,user_id:bot.result?.id});
      const role=member.result?.status;
      if(!member.ok || !['creator','administrator','member','restricted'].includes(role) || (role==='restricted'&&!member.result.is_member))return json(res,409,{error:'Add the bot to this group before pairing it.'});
      if((role==='restricted'&&!member.result.can_send_messages)||(role==='member'&&chat.result.permissions?.can_send_messages===false))return json(res,409,{error:'The bot is in the group, but it does not have permission to post.'});
      const label=String(chat.result.title||'Telegram team group').slice(0,65);
      if(!await telegram.register(token,String(chat.result.id),label,'team'))return json(res,409,{error:'The bot configuration changed while pairing. Try again.'});
      return json(res,200,{saved:true,detail:`${label} paired successfully. No alert was sent.`});
    }
    if (path==='/api/alerts/check') {
      const config=await loadConfig();
      const route=Object.hasOwn(routes,input.channel) ? channelStatus(config)[input.channel] : undefined;
      if (!route?.configured) return json(res,409,{error:'Save the provider settings before checking the connection.'});
      return json(res,200,await checkAlertProvider(input.channel,config.settings,request));
    }
    if (path==='/api/alerts/telegram-discover') {
      const now=Date.now();
      for (const [id,entry] of discoveries) if (entry.expires<=now) discoveries.delete(id);
      if (input.action==='start') {
        const routeMode=['team','responder'].includes(input.mode) ? input.mode : null;
        const token=routeMode ? (await loadConfig()).settings.TELEGRAM_BOT_TOKEN : input.token;
        if (typeof token!=='string' || !validValues.TELEGRAM_BOT_TOKEN.test(token)) return json(res,400,{error:'Connect the BotFather token first.'});
        if (discoveries.size>=12) return json(res,429,{error:'Too many active chat searches. Try again in a few minutes.'});
        const label=String(input.label||'').trim().slice(0,65);
        if(routeMode==='responder'&&!label)return json(res,400,{error:'Enter a name for the responder.'});
        const bot=await providerJson(request,telegramUrl(token,'getMe'));
        const username=bot.data?.result?.username;
        if (!bot.ok || !bot.data?.ok || typeof username!=='string' || !/^[a-z0-9_]{5,64}$/i.test(username)) {
          return json(res,400,{error:'Telegram did not recognize this bot token.'});
        }
        const id=randomUUID();
        const code='ic_'+id.replace(/-/g,'').slice(0,18);
        const personal=input.mode==='personal';
        discoveries.set(id,{token,code,username,personal,routeMode,label,expires:now+5*60_000});
        setTimeout(()=>discoveries.delete(id),5*60_000).unref();
        return json(res,200,{id,url:`https://t.me/${username}?${routeMode==='team'?'startgroup':'start'}=${code}`,groupCommand:`/start@${username} ${code}`});
      }
      const entry=discoveries.get(input.id);
      if (input.action!=='check' || !entry) return json(res,409,{error:'Start a new chat search.'});
      if(!entry.chatId){
        const updates=await providerJson(request,telegramUrl(entry.token,'getUpdates')+'?limit=100&timeout=0');
        if ((!updates.ok||!updates.data?.ok)&&!entry.chatId) return json(res,400,{error:'Telegram could not read bot updates. If another app uses this bot, pair a dedicated one.'});
        findPairing(entry,updates.data?.result);
      }
      const chatId=entry.chatId;
      if(!chatId)return json(res,200,{found:false});
      if (entry.routeMode) {
        const check=await call(entry.token,'getChat',{chat_id:chatId});
        const label=entry.routeMode==='team' ? String(check.result?.title || 'Telegram team group').slice(0,65) : entry.label;
        if(!check.ok || !await telegram.register(entry.token,chatId,label,entry.routeMode))return json(res,409,{error:'Could not save this Telegram destination. Check the bot’s chat access or responder limit.'});
        discoveries.delete(input.id);
        return json(res,200,{found:true,saved:true,detail:`${label} paired successfully. No alert was sent.`});
      }
      if (entry.personal) {
        if (saving) return json(res,200,{found:false});
        saving=true;
        try {
          const settings={TELEGRAM_BOT_TOKEN:entry.token,TELEGRAM_CHAT_ID:chatId};
          const check=await checkAlertProvider('telegram',settings,request);
          if (check.status!=='verified') return json(res,409,{error:check.detail});
          await saveProviders({...await readObject(providerPath),...settings});
          discoveries.delete(input.id);
          return json(res,200,{found:true,saved:true,detail:check.detail});
        } finally {saving=false;}
      }
      discoveries.delete(input.id);
      return json(res,200,{found:true,chatId});
    }
    if (path==='/api/alerts/settings') {
      if (saving) return json(res,409,{error:'Another settings update is in progress.'});
      const route=Object.hasOwn(routes,input.channel) ? routes[input.channel] : undefined;
      if (!route || !input.fields || typeof input.fields!=='object') return json(res,400,{error:'Choose a delivery channel.'});
      const fields=Object.entries(input.fields);
      if (!fields.length || fields.some(([name,value])=>!route.keys.includes(name) || typeof value!=='string' || !validValues[name].test(value))) {
        return json(res,400,{error:'Check the provider credentials and destination format.'});
      }
      saving=true;
      try {
        await saveProviders({...await readObject(providerPath),...Object.fromEntries(fields)});
        return json(res,200,{channels:channelStatus(await loadConfig())});
      } finally { saving=false; }
    }
    const now=Date.now();
    for (const [token,entry] of previews) if (entry.expires<=now) previews.delete(token);
    for (const [key,until] of recent) if (until<=now) recent.delete(key);
    if (path==='/api/alerts/preview') {
      const incident=scenarios.find(entry=>entry.id===input.incident);
      if (!incident || !levels.includes(input.level) || !Array.isArray(input.targets) || input.targets.length>17) {
        return json(res,400,{error:'Choose an incident and priority.'});
      }
      const config=await loadConfig();
      const available=channelStatus(config);
      const targets=[...new Set(input.targets)].map(id=>{
        const channel=Object.keys(routes).find(key=>available[key].recipients.some(target=>target.id===id));
        if (!channel) return null;
        const index=Number(id.slice(id.lastIndexOf('-')+1));
        return {...available[channel].recipients[index],channel,recipient:config.targets[channel][index],ready:available[channel].configured};
      });
      if (targets.some(target=>!target)) return json(res,400,{error:'The selected recipients are no longer available.'});
      if (previews.size>=60) return json(res,429,{error:'Too many previews. Please try again shortly.'});
      const token=randomUUID();
      const messages=formatAlert(incident,input.level);
      previews.set(token,{incident:incident.id,level:input.level,targets,messages,expires:now+previewLifetime});
      return json(res,200,{token,incident:incident.id,level:input.level,suggested:priority(incident),
        messages:Object.fromEntries((targets.length ? [...new Set(targets.map(target=>target.channel))] : Object.keys(routes)).map(channel=>[channel,messages[channel]])),
        targets:targets.map(({recipient,...target})=>target),canSend:targets.length>0 && targets.every(target=>target.ready)});
    }
    if (path==='/api/alerts/send') {
      const preview=previews.get(input.token);
      if (input.confirm!==true || !preview?.targets.length) return json(res,409,{error:'Review a fresh preview and confirm the recipients.'});
      const config=await loadConfig();
      const available=channelStatus(config);
      if (preview.targets.some(target=>!available[target.channel].configured || !config.targets[target.channel].includes(target.recipient))) {
        return json(res,409,{error:'A selected provider or recipient is unavailable. Review the channel setup.'});
      }
      if (!previews.delete(input.token)) return json(res,409,{error:'This preview has already been used.'});
      const results=[];
      for (const target of preview.targets) {
        const key=`${preview.incident}/${target.channel}/${target.recipient}`;
        if (recent.has(key)) {
          results.push({channel:target.channel,destination:target.destination,status:'duplicate'});
          continue;
        }
        recent.set(key,Date.now()+90_000);
        const result=await deliverAlert(target.channel,target.recipient,preview.messages[target.channel],config.settings,
          `${input.token}/${target.id}`,request);
        const entry={...result,channel:target.channel,destination:target.destination,incident:preview.incident,level:preview.level,time:Date.now()};
        deliveries.unshift(entry);
        results.push(entry);
      }
      deliveries.length=Math.min(deliveries.length,50);
      return json(res,200,{results});
    }
    return json(res,404,{error:'Alert action not found.'});
  };
}
