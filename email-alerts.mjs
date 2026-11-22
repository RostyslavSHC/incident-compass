import {randomUUID} from 'node:crypto';
import {readFile,rename,rm,writeFile} from 'node:fs/promises';

const statePath = new URL('./.alert-email.local.json',import.meta.url);
const day = 24*60*60_000;
const labels = {P1:'Critical',P2:'High',P3:'Monitor',P4:'Low'};
const reasons = {
  alert:'Aurelis recorded an incident alert.',
  critical:'A critical alert needs immediate attention.',
  decline:'The private responder declined. The incident was escalated to the team.',
  timeout:'The private responder did not reply in time. The incident was escalated to the team.',
  unavailable:'The private page could not be confirmed. The incident was escalated to the team.',
  unassigned:'The incident was routed to the team group.',
};

export async function gmailTransport(settings) {
  const {default:nodemailer}=await import('nodemailer');
  return nodemailer.createTransport({service:'gmail',auth:{user:settings.GMAIL_ADDRESS,pass:settings.GMAIL_APP_PASSWORD},
    connectionTimeout:8000,greetingTimeout:8000,socketTimeout:10000,disableFileAccess:true,disableUrlAccess:true});
}

export function gmailFailure(error) {
  if (error.code==='ERR_MODULE_NOT_FOUND') return 'Run npm ci in the Aurelis folder to install Gmail support.';
  if (error.code==='EAUTH') return 'Gmail rejected the sign-in. Check the Gmail address and Google app password.';
  if (error.code==='EDNS') return 'This computer could not resolve Gmail’s mail server.';
  if (Number.isInteger(error.responseCode) && error.responseCode>=400) return 'Gmail rejected or deferred this message.';
  return 'Could not confirm the Gmail connection or submission. Check SMTP access and Gmail account activity.';
}

export async function sendGmail(settings,recipient,message) {
  try {
    const transport=await gmailTransport(settings);
    const result = await transport.sendMail({from:{name:'Aurelis Alerts',address:settings.GMAIL_ADDRESS},
      to:recipient,subject:message.subject,text:message.text});
    return result.accepted?.length ? {status:'accepted',reference:result.messageId} : {status:'rejected'};
  } catch (error) {
    const rejected=['EAUTH','ERR_MODULE_NOT_FOUND'].includes(error.code) || (error.responseCode>=400 && error.responseCode<600);
    const unavailable=error.code==='EDNS' || ['CONNECT_TIMEOUT','GREETING_TIMEOUT'].includes(error.timeoutType);
    return {status:unavailable?'unavailable':rejected?'rejected':'unknown',detail:gmailFailure(error)};
  }
}

function formatAutomaticEmail({incident,title,service,level,reason,next}) {
  const severity=`${level} ${labels[level]}`;
  return {subject:`[Aurelis demo] ${severity} | ${service} | ${incident}`,
    text:[title,`${incident} · ${service} · ${severity}`,reasons[reason],next && `First check: ${next}`,
      'This is a simulated incident. Use Telegram to acknowledge the alert or mark it fixed.'].filter(Boolean).join('\n\n')};
}

export function createEmailOutbox({config,deliver,path=statePath,now=Date.now}) {
  let queue=Promise.resolve();
  let sending=false;
  const exclusive=operation=>{
    const result=queue.then(operation);
    queue=result.catch(()=>{});
    return result;
  };
  async function load() {
    try { return JSON.parse(await readFile(path,'utf8')); }
    catch (error) { if (error.code==='ENOENT') return {enabled:false,entries:[]}; throw error; }
  }
  async function save(state) {
    const temporary=new URL(`.alert-email.${randomUUID()}.tmp`,path);
    try {
      await writeFile(temporary,JSON.stringify(state),{mode:0o600,flag:'wx'});
      await rename(temporary,path);
    } finally { await rm(temporary,{force:true}); }
  }
  async function enable(enabled) {
    return exclusive(async()=>{
      const state=await load();
      state.enabled=enabled;
      if (!enabled) state.entries=state.entries.filter(entry=>entry.status!=='queued' || entry.confirmation);
      await save(state);
      return {enabled};
    });
  }
  const pendingConfirmation=(state,recipient)=>state.entries.some(entry=>entry.confirmation && entry.recipient===recipient &&
    ['queued','sending'].includes(entry.status));
  async function hasPendingConfirmation(recipient) {
    return pendingConfirmation(await load(),recipient);
  }
  async function retryConfirmation(recipient,message,detail) {
    return exclusive(async()=>{
      const state=await load();
      if (pendingConfirmation(state,recipient)) return;
      const time=now();
      state.entries=state.entries.filter(entry=>time-entry.time<day || ['sending','queued'].includes(entry.status));
      state.entries.push({key:randomUUID(),recipient,message,confirmation:true,status:'queued',time,retryAt:time+30_000,detail});
      await save(state);
    });
  }
  async function enqueue(alert) {
    return exclusive(async()=>{
      const state=await load();
      if (!state.enabled) return;
      const current=await config();
      if (!current.ready) return;
      const time=now();
      const message=formatAutomaticEmail(alert);
      state.entries=state.entries.filter(entry=>time-entry.time<day || ['sending','queued'].includes(entry.status));
      const fresh=current.recipients.filter(recipient=>!state.entries.some(entry=>entry.key===alert.key && entry.recipient===recipient));
      if (!fresh.length) return;
      state.entries.push(...fresh.map(recipient=>({key:alert.key,recipient,incident:alert.incident,level:alert.level,
        status:'queued',time,message})));
      await save(state);
    });
  }
  async function step() {
    if (sending) return;
    sending=true;
    try {
      const job=await exclusive(async()=>{
        const state=await load();
        const interrupted=state.entries.filter(entry=>entry.status==='sending');
        for (const entry of interrupted) {
          Object.assign(entry,{status:'unknown',detail:'Server restarted before the provider confirmed submission.'});
          delete entry.message;
        }
        const entry=state.entries.find(entry=>entry.status==='queued' && (state.enabled || entry.confirmation) &&
          (!entry.retryAt || entry.retryAt<=now()));
        if (!entry) {
          if (interrupted.length) await save(state);
          return;
        }
        if (entry.retryAt && now()-entry.time>=day) {
          Object.assign(entry,{status:'unavailable',detail:'The retry window ended before the email provider could be reached.'});
          delete entry.message;
          delete entry.retryAt;
          await save(state);
          return;
        }
        const current=await config();
        if (!current.ready || !current.recipients.includes(entry.recipient)) {
          Object.assign(entry,{status:'rejected',detail:'Email configuration changed before delivery.'});
          delete entry.message;
          await save(state);
          return;
        }
        entry.status='sending';
        await save(state);
        return {entry,settings:current.settings};
      });
      if (!job) return;
      const {entry,settings}=job;
      let result;
      try { result=await deliver(entry.recipient,entry.message,settings,`${entry.key}/${entry.recipient}`); }
      catch { result={status:'unknown',detail:'The email provider did not confirm submission.'}; }
      await exclusive(async()=>{
        const state=await load();
        const pending=state.entries.find(item=>item.key===entry.key && item.recipient===entry.recipient);
        if (!pending) return;
        const finished=now();
        if (result.status==='unavailable' && (state.enabled || pending.confirmation) && finished-pending.time<day) {
          pending.attempts=(pending.attempts || 0)+1;
          Object.assign(pending,{status:'queued',retryAt:finished+Math.min(30_000*2**(pending.attempts-1),15*60_000),
            detail:`${result.detail} Aurelis will retry.`});
        } else {
          Object.assign(pending,{...result,time:finished});
          if (!result.detail) delete pending.detail;
          delete pending.message;
          delete pending.retryAt;
        }
        await save(state);
      });
    } finally { sending=false; }
  }
  async function status() {
    const state=await load();
    return {enabled:state.enabled,deliveries:state.entries.toReversed().slice(0,20)};
  }
  return {enable,enqueue,step,status,hasPendingConfirmation,retryConfirmation};
}
