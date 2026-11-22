import {companyKey, companyLabel, documents, groupDuplicate, history, investigate, priority, runbookFreshness, sampleCompanies, sampleCompanyFor, sampleMonitoringDate, sampleMonitoringTime, scenarios, services, teammates, upcoming} from './data.mjs';
import {
  asInvestigation, createSimulation, formatIncidentTime, investigationTemplates, releaseSimulation, simulationCategories,
  simulationSeverities, simulationStatuses, simulationTemplates, updateSimulation, validateReviewedResolution, validateSimulation,
} from './simulations.mjs';
import {acceptedIncidentWork, demoReportEvents, durationLabel, exposureAssumptions, exposureAt, mergeIncidentWork, reportPeriod, reportSummary} from './reports.mjs';

const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const assistantWindow = document.querySelector('#assistant-window');
const persona = document.querySelector('#persona');
const personaMenu = document.querySelector('#persona-menu');
const personaName = document.querySelector('#persona-name');
const night = document.querySelector('#night');
const saveKey = 'incident-compass-workspace-v1';
const windowMs = 30_000;
const entranceTimings = {
  startup:{duration:2000,motion:1100,lead:160},
  menu:{duration:1200,motion:640,lead:70},
};
const tabs = [['brief','Brief'],['details','Case details'],['runbook','Runbooks'],['trace','Investigation log'],['replay','Time Machine'],['compare','Compare'],['family','Family tree']];
const pages = ['desk','alerts','simulator','services','history','runbooks','calendar','reports','chat'];
function byId(id,state = workspace) {
  const record = state.custom[id];
  if (!record) {
    const incident=scenarios.find(item=>item.id===id);
    return incident && {...incident,company:sampleCompanyFor(incident.service)};
  }
  const grouped = Object.values(state.custom).filter(item=>item.groupedUnder===id)
    .map(item=>{
      const alert = asInvestigation(item).events.at(-1);
      return {...alert,seenAt:Math.max(alert.seenAt,record.occurredAt)};
    });
  return asInvestigation(record,grouped);
}
const reviewedArchive = (state = workspace) => Object.values(state.resolutions).filter(record=>
  !state.custom[record.id] || state.custom[record.id].status==='resolved');
const investigateCase = (incident,snapshot = cutoff,state = workspace) =>
  investigate(incident,snapshot,reviewedArchive(state));
const html = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const badge = level => `<span class="badge ${level}">${level}</span>`;
const ref = id => `<button type="button" class="ref" data-source="${html(id)}">${html(id)}</button>`;
const documentLink = document => `<button type="button" class="small doc-link" data-source="${html(document.id)}">${html(document.id)} · ${html(document.title)}</button>`;
const cad = dollars => new Intl.NumberFormat('en-CA', {style:'currency',currency:'CAD',maximumFractionDigits:0}).format(dollars);
const cadUnit = new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',minimumFractionDigits:0,maximumFractionDigits:2});
const levels = ['P1','P2','P3'];
const radarLevels = ['P1','P2','P3','P4'];
const radarSpots = [[38,47],[62,53],[43,19],[60,81],[15,52],[85,47],[66,19],[35,82],[16,19],[86,20],[13,81],[85,81]];
const severityNames = {P1:'Critical',P2:'High',P3:'Monitor'};
const incidentPriority = (incident,state = workspace) => state.custom[incident?.id]?.level
  || state.priorities[incident?.id] || (incident ? priority(incident) : 'P3');
const levelName = (level,isTest = false) => (isTest ? simulationSeverities : severityNames)[level] || simulationSeverities[level] || 'Info';
const testBadge = '<span class="badge test-badge">Test event</span>';
const openIncidents = () => workspace.active.map(id=>byId(id)).filter(Boolean);

function initial() {
  const active = scenarios.slice(0,3).map(incident=>incident.id);
  const analyses = Object.fromEntries(active.map(id=>[id,{status:'queued'}]));
  return {active,tasks:{},messages:[],priorities:{},priorityHistory:{},notifications:[],notes:{},custom:{},analyses,resolutions:{},
    arrivals:{},workHistory:{},telegramWork:[],reportOutbox:{},exposure:{}};
}
function read() {
  try {
    const state = {...initial(), ...JSON.parse(localStorage.getItem(saveKey))};
    state.notifications = state.notifications.map((entry,index)=>({
      key:`legacy-${entry.time}-${index}`,read:false,...entry
    }));
    return state;
  }
  catch { return initial(); }
}
let workspace = read();
let actorChoice = sessionStorage.getItem('ic-actor') || teammates[0];
let actor = teammates.includes(actorChoice) ? actorChoice : teammates[0];
let personaChoice = actor;
let telegramResponders = new Map();
let selected = 'INC-121';
let activeTab = 'brief';
let familyView = 'map';
let reportRange = 'week';
let reportOffset = 0;
let reportCompany = null;
let includeSampleReports = true;
let reportSyncAt = 0;
let reportSyncBusy = false;
const reportInsights = new Map();
let reportInsightTimer;
const exposureWindows = new Map();
let cutoff = '23:59';
let query = '';
let connected = false;
let checkingGemini = location.protocol.startsWith('http');
let analysisBusy = false;
let analysisCooldown = 0;
const toastQueue = [];
const openToasts = new Map();
const toastShelf = document.querySelector('#toast-stack');
const announcer = document.querySelector('#toast-announcer');
let sound = localStorage.getItem('ic-notification-sound') === 'true';
let audio;
let speech;
let dialogRevision = 0;
let escalatorBusy = false;
let conversation = [];
let conversationScope;
let calendarMonth = 2026 * 12 + 10;
let calendarDay;
let alertFilter = 'all';
let alertSort = 'severity';
let alertQuery = '';
let radarFilter = 'all';
let radarPage = 0;
let renderedPage;
let workspaceEntrance;
let revealObserver;
let simulatorDraft = {};
let notificationPanel = null;
let automaticTelegram = false;
let telegramOutboxBusy = false;
let deliveryState;
let deliveryPreview;
const channelSetup = {
  sms:{name:'SMS',provider:'Twilio',setup:'https://console.twilio.com/',fields:[['TWILIO_ACCOUNT_SID','Account SID'],['TWILIO_AUTH_TOKEN','Auth token',true],['TWILIO_FROM','SMS-capable sender number']]},
  email:{name:'Email'},
  telegram:{name:'Telegram',provider:'Telegram Bot API',setup:'https://t.me/BotFather',fields:[['TELEGRAM_BOT_TOKEN','BotFather token',true],['TELEGRAM_CHAT_ID','Chat ID or public channel username']]},
};
const emailSetup = {
  gmail:{provider:'Gmail',setup:'https://myaccount.google.com/apppasswords',link:'Create Google app password',
    fields:[['GMAIL_ADDRESS','Sending Gmail address'],['GMAIL_APP_PASSWORD','Google app password',true]]},
  resend:{provider:'Resend',setup:'https://resend.com/api-keys',link:'Open Resend',
    fields:[['RESEND_API_KEY','Resend API key',true],['ALERT_EMAIL_FROM','Verified sender address']]},
};

renderPersonaChoices();
document.body.classList.toggle('night', localStorage.getItem('ic-night') === 'true');
night.setAttribute('aria-pressed', String(document.body.classList.contains('night')));

function view() {
  const hash = location.hash.slice(1);
  return pages.includes(hash) ? hash : 'desk';
}

function renderPersonaChoices() {
  const existingFocus = document.activeElement?.dataset.personaChoice;
  personaChoice = telegramResponders.has(actorChoice) || teammates.includes(actorChoice) ? actorChoice : teammates[0];
  updatePersonaTrigger();
  const group = (label,entries,telegram=false)=>`<div class="persona-group" role="group" aria-label="${label}">
    <div class="persona-group-label" aria-hidden="true">${label}</div>
    ${entries.map(([key,displayName])=>{
      const initials = (displayName.match(/\p{L}+/gu) || []).slice(0,2).map(word=>word[0]).join('').toUpperCase() || '•';
      return `<button type="button" class="persona-option" role="menuitemradio" aria-checked="${key===personaChoice}" tabindex="-1"
        data-persona-choice="${html(key)}"><span class="persona-avatar ${telegram?'telegram-avatar':''}" aria-hidden="true">${html(initials)}</span>
        <span>${html(displayName)}</span><span class="persona-check" aria-hidden="true">✓</span></button>`;
    }).join('')}</div>`;
  personaMenu.innerHTML = `${telegramResponders.size ? group('Paired Telegram responders',[...telegramResponders],true) : ''}
    ${group('Demo teammates',teammates.map(name=>[name,name]))}`;
  if (existingFocus && personaMenu.matches(':popover-open')) focusPersonaChoice(existingFocus);
}

function focusPersonaChoice(choice = personaChoice) {
  const options = [...personaMenu.querySelectorAll('[data-persona-choice]')];
  (options.find(option=>option.dataset.personaChoice===choice) || options[0])?.focus();
}

function updatePersonaTrigger() {
  const name = telegramResponders.get(personaChoice) || personaChoice;
  personaName.textContent = name;
  persona.setAttribute('aria-label',`Act as responder, ${name}`);
  persona.toggleAttribute('data-linked',telegramResponders.has(personaChoice));
}

function positionPersonaMenu() {
  const anchor = persona.getBoundingClientRect();
  const gutter = 10;
  const width = Math.min(286,document.documentElement.clientWidth-gutter*2);
  const left = Math.max(gutter,Math.min(anchor.left,document.documentElement.clientWidth-width-gutter));
  const below = window.innerHeight-anchor.bottom-gutter;
  const above = anchor.top-gutter;
  const openAbove = below<180 && above>below;
  personaMenu.style.setProperty('--persona-left',`${left}px`);
  personaMenu.style.setProperty('--persona-width',`${width}px`);
  personaMenu.style.setProperty('--persona-max-height',`${Math.max(0,(openAbove ? above : below)-7)}px`);
  personaMenu.style.setProperty('--persona-edge',`${openAbove ? window.innerHeight-anchor.top+7 : anchor.bottom+7}px`);
  personaMenu.dataset.side = openAbove ? 'above' : 'below';
}

function syncTelegramResponders(people) {
  const responders = new Map(people.map(person=>[`telegram:${person.id}:${person.destination}`,person.label]));
  if (responders.size===telegramResponders.size && [...responders].every(([key,label])=>telegramResponders.get(key)===label)) return;
  telegramResponders = responders;
  renderPersonaChoices();
  const name = telegramResponders.get(personaChoice) || personaChoice;
  if (name!==actor) {
    actor = name;
    render();
  }
}
const severityIcons = {P1:'!',P2:'↑',P3:'•',P4:'↓'};

function notificationSound(critical) {
  if (!sound || audio?.state !== 'running') return;
  const tone = audio.createOscillator();
  const gain = audio.createGain();
  const start = audio.currentTime;
  tone.frequency.value = critical ? 660 : 440;
  gain.gain.setValueAtTime(0.075,start);
  gain.gain.exponentialRampToValueAtTime(0.001,start + 0.18);
  tone.connect(gain).connect(audio.destination);
  tone.start(start);
  tone.stop(start + 0.2);
}

function notice(message, kind = 'success') {
  queueToasts([{key:crypto.randomUUID(),title:message,kind}]);
}

function queueToasts(entries) {
  const batch = entries.filter(entry=>!entry.read && !openToasts.has(entry.key) && !toastQueue.some(item=>item.key===entry.key));
  if (!batch.length) return;
  toastQueue.push(...batch);
  toastQueue.sort((a,b)=> (a.level || 'Z').localeCompare(b.level || 'Z'));
  const critical = batch.some(entry=>entry.level==='P1');
  if (critical && openToasts.size >= 3) {
    const lower = [...openToasts.values()].reverse().find(entry=>entry.level!=='P1');
    if (lower) dismissToast(lower.key);
  }
  announcer.textContent = batch.map(entry=>entry.title).join('. ');
  notificationSound(critical);
  showQueuedToasts();
}

function showQueuedToasts() {
  while (openToasts.size < 3 && toastQueue.length) {
    const entry = toastQueue.shift();
    const duration = entry.level === 'P1' ? 0 : entry.level ? 8500 : 4600;
    const item = document.createElement('article');
    item.className = `toast-card ${entry.level || entry.kind || ''}`;
    item.innerHTML = `<div class="toast-icon" aria-hidden="true">${severityIcons[entry.level] || (entry.kind==='error'?'!':'✓')}</div>
      <div class="toast-copy">${entry.level ? `<small>${levelName(entry.level,entry.test)}${entry.test?' · Test event':''}</small>` : ''}
      <strong>${html(entry.title)}</strong>${entry.description ? `<p>${html(entry.description)}</p>` : ''}
      ${entry.id ? `<button class="small" data-open-case="${html(entry.id)}" data-read-notice="${html(entry.key)}">View incident</button>` : ''}</div>
      <button class="toast-dismiss" data-dismiss-toast="${html(entry.key)}" aria-label="Dismiss notification">×</button>
      ${duration ? `<span class="toast-progress" style="--toast-duration:${duration}ms" aria-hidden="true"></span>` : ''}`;
    const dismissButton = item.querySelector('[data-dismiss-toast]');
    toastShelf.append(item);
    const record = {...entry,item,timer:undefined};
    openToasts.set(entry.key,record);
    if (duration) {
      let remaining = duration;
      let started;
      const resume = () => {
        if (record.timer || item.matches(':hover') || item.contains(document.activeElement)) return;
        started = performance.now();
        record.timer = setTimeout(()=>dismissToast(entry.key),remaining);
        item.classList.remove('paused');
      };
      const pause = () => {
        if (!record.timer) return;
        clearTimeout(record.timer);
        record.timer = undefined;
        remaining = Math.max(0,remaining - (performance.now() - started));
        item.classList.add('paused');
      };
      item.addEventListener('pointerenter',pause);
      item.addEventListener('pointerleave',resume);
      item.addEventListener('focusin',pause);
      item.addEventListener('focusout',()=>queueMicrotask(resume));
      item.classList.add('paused');
      resume();
    }
    dismissButton.title = 'Dismiss this toast';
  }
}

function dismissToast(key) {
  const entry = openToasts.get(key);
  if (!entry || entry.item.classList.contains('leaving')) return;
  clearTimeout(entry.timer);
  entry.item.classList.add('leaving');
  const remove = () => {
    entry.item.remove();
    openToasts.delete(key);
    showQueuedToasts();
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) remove();
  else setTimeout(remove,170);
}

function discardRemovedToasts() {
  const keys = new Set(workspace.notifications.map(entry=>entry.key));
  for (let index = toastQueue.length-1; index>=0; index--) {
    if (toastQueue[index].id && !keys.has(toastQueue[index].key)) toastQueue.splice(index,1);
  }
  for (const entry of openToasts.values()) {
    if (entry.id && !keys.has(entry.key)) dismissToast(entry.key);
  }
}

async function update(change) {
  const apply = () => {
    workspace = read();
    const before = new Set(workspace.notifications.map(entry=>entry.key));
    const message = change(workspace);
    localStorage.setItem(saveKey, JSON.stringify(workspace));
    render();
    discardRemovedToasts();
    const arrivals = workspace.notifications.filter(entry=>!before.has(entry.key)).reverse();
    if (arrivals.length) queueToasts(arrivals);
    else if (message) notice(message);
  };
  try {
    if (navigator.locks) await navigator.locks.request(saveKey, apply);
    else apply();
    return true;
  } catch (error) {
    workspace = read();
    render();
    notice(error.message || 'The workspace could not be updated.','error');
    return false;
  }
}

function escalate(state, incident, reason) {
  state.tasks[incident.id] = {status:'open', reason};
  state.messages.push({id:incident.id, type:'open', reason, time:Date.now()});
  notification(state,incident.id,'Team escalation',`Posted to #general. ${reason}`);
}

function notification(state,id,title,description) {
  state.notifications.unshift({
    key:crypto.randomUUID(),id,title,description,time:Date.now(),level:incidentPriority(byId(id,state),state),
    test:Boolean(state.custom[id]),read:false
  });
  state.notifications.length = Math.min(state.notifications.length,100);
}

function pageOnCall(state,incident) {
  state.tasks[incident.id] = {status:'pending', until:Date.now() + windowMs};
  notification(state,incident.id,'Urgent page',`Awaiting acknowledgement from ${incident.owner}.`);
}

function tick() {
  const latest = workspace;
  const now = Date.now();
  const due = latest.active.filter(id => latest.tasks[id]?.status === 'pending' && latest.tasks[id].until <= now);
  const scheduled = Object.values(latest.custom).some(incident=>incident.triggeredAt===null && incident.scheduledAt<=now);
  if ((due.length || scheduled) && !escalatorBusy) {
    escalatorBusy = true;
    update(state => {
      const expired = due.filter(id => state.active.includes(id) && state.tasks[id]?.status === 'pending' && state.tasks[id].until <= Date.now());
      for (const id of expired) {
        const incident = byId(id,state);
        if (incident) escalate(state, incident, 'Acknowledgement timed out.');
      }
      for (const incident of Object.values(state.custom)) publishSimulation(state,incident,Date.now());
    }).finally(() => { escalatorBusy = false; });
  }
  const timer = document.querySelector('[data-countdown]');
  const task = latest.tasks[selected];
  if (timer && task?.status === 'pending') timer.textContent = Math.max(0, Math.ceil((task.until - Date.now()) / 1000)) + 's';
  const telegramTimer = dialog.querySelector('[data-telegram-deadline]');
  if (telegramTimer) telegramTimer.textContent = remainingSeconds(Number(telegramTimer.dataset.telegramDeadline))+'s';
  const pending = Object.values(latest.custom).find(incident=>incident.telegram?.status==='pending' && incident.telegram.nextAt<=now);
  if (pending && !telegramOutboxBusy) void deliverSimulation(pending);
  void runNextAnalysis();
  if (now>=reportSyncAt) void syncReportEvents();
}

function aiIncidentPayload(incident,state = workspace) {
  const {id,title,description,service,company,occurredAt,triggeredAt,level,serviceVersion} = incident;
  const archive = reviewedArchive(state).filter(record=>record.service===service && companyKey(record.company)===companyKey(company))
    .sort((a,b)=>Number(b.fingerprint===incident.fingerprint)-Number(a.fingerprint===incident.fingerprint) ||
      b.resolvedAt-a.resolvedAt).slice(0,3);
  const grouped = incident.sampleAlert ? incident.events
    .filter(event=>event.kind==='Alert' && event.id!==id+'-alert').slice(0,3)
    .map(event=>({...event,detail:event.detail.slice(0,400)})) : [];
  return incident.sampleAlert ? {id,archive,report:{title,description,service,company,occurredAt,triggeredAt,level,serviceVersion,grouped}}
    : {id,archive};
}

async function runNextAnalysis() {
  if (!connected || analysisBusy || Date.now()<analysisCooldown) return;
  const requested = byId(selected);
  const foreground = view()==='desk' && activeTab==='brief' && cutoff==='23:59' && requested && requested.triggeredAt!==null;
  const id = foreground && (!workspace.analyses[selected] || workspace.analyses[selected].status==='queued')
    ? selected : Object.keys(workspace.analyses).find(key=>workspace.analyses[key].status==='queued');
  if (!id) return;
  analysisBusy = true;
  const analyze = async ()=>{
    const state = read();
    const incident = byId(id,state);
    const existing = state.analyses[id];
    if (!incident || incident.triggeredAt===null || (existing && existing.status!=='queued')) return;
    let analysis;
    try {
      const response = await fetch('/api/analysis',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(aiIncidentPayload(incident,state)),
        signal:AbortSignal.timeout(14_000),
      });
      if (response.status===429) analysisCooldown = Date.now()+60_000;
      if (!response.ok) throw Error();
      analysis = {status:'ready',...await response.json()};
    } catch {
      analysis = {status:'unavailable'};
    }
    await update(current=>{
      if (byId(id,current) && current.analyses[id]?.status!=='ready' &&
          current.analyses[id]?.revision===existing?.revision) current.analyses[id] = analysis;
    });
  };
  try {
    if (navigator.locks) {
      await navigator.locks.request(saveKey+'/analysis',{ifAvailable:true},lock=>lock ? analyze() : undefined);
    } else await analyze();
  } finally {
    analysisBusy = false;
  }
}

function actionOnTask(action, id) {
  const incident = byId(id);
  if (!incident) return;
  const performer = actor;
  void update(state => {
    if (!state.active.includes(id)) return;
    const task = state.tasks[id];
    if (action === 'page' && !task && incidentPriority(incident,state) === 'P1') {
      pageOnCall(state,incident);
      return `Urgent page sent to ${incident.owner} in this demo.`;
    }
    if (task?.status === 'pending' && task.until <= Date.now()) {
      escalate(state, incident, 'Acknowledgement timed out.');
      return 'The acknowledgement window ended. Claim it in #general.';
    }
    if (task?.status === 'pending' && (action === 'expire' || (action === 'decline' && performer === incident.owner))) {
      escalate(state, incident, action === 'expire' ? 'Demo: acknowledgement window expired.' : `${performer} is unavailable.`);
      return 'Urgent page escalated to #general.';
    }
    const canAccept = action === 'accept' && task?.status === 'pending' && performer === incident.owner;
    const canClaim = action === 'claim' && task?.status === 'open';
    const canPickUp = action==='accept' && !task && incidentPriority(incident,state)!=='P1';
    if (canAccept || canClaim || canPickUp) {
      state.tasks[id] = {status:'claimed',by:performer,acceptedAt:Date.now()};
      notification(state,id,'Ownership confirmed',`${performer} accepted the task.`);
      if (canClaim) state.messages.push({id, type:'claim', by:performer, time:Date.now()});
      return `${performer} accepted ownership of ${id}.`;
    }
  });
}

function taskBar(incident) {
  const task = workspace.tasks[incident.id];
  if (!workspace.active.includes(incident.id)) return '';
  const taskButton = (action, label, style = '') => `<button class="small ${style}" data-task="${action}" data-id="${incident.id}">${html(label)}</button>`;
  if (!task && incidentPriority(incident)!=='P1') return `<div class="handoff"><span>Response timer starts on acceptance.</span>${taskButton('accept','Accept task')}</div>`;
  if (!task) return `<div class="handoff"><span><strong>Urgent response</strong> · ${incident.owner} on call</span>${taskButton('page','Page on-call','primary')}</div>`;
  if (task.status === 'claimed') return `<div class="handoff"><strong>Accepted by ${html(task.by)}</strong><span class="small quiet">Owner confirmed</span></div>`;
  if (task.status === 'open') return `<div class="handoff"><strong>Escalated to #general</strong><div class="buttons"><button class="small" data-nav="chat">Open team chat</button>${taskButton('claim','Claim as ' + actor,'primary')}</div></div>`;
  return `<div class="handoff"><span><strong>Waiting for ${incident.owner}</strong> · <span class="mono" data-countdown>${Math.max(0,Math.ceil((task.until-Date.now())/1000))}s</span></span><div class="buttons">
    ${actor === incident.owner ? taskButton('accept','Accept task','primary') + taskButton('decline','I’m busy','danger') : ''}
    ${taskButton('expire','Simulate timeout')}</div></div>`;
}

function automaticAnalysis(incident) {
  if (cutoff!=='23:59') return '';
  const analysis = workspace.analyses[incident.id];
  let content;
  if (analysis?.status==='ready') {
    content = `<p class="chat-answer">${html(analysis.summary)}</p>
      <dl class="analysis-checks"><div><dt>First check</dt><dd>${html(analysis.nextCheck)}</dd></div>
        <div><dt>Key uncertainty</dt><dd>${html(analysis.uncertainty)}</dd></div></dl>
      <div class="references" aria-label="Sources cited by Gemini">${analysis.sources.map(ref).join('')}</div>`;
  } else if (checkingGemini) {
    content = '<p class="quiet" role="status">Checking Gemini availability…</p>';
  } else if (!connected) {
    content = '<p class="quiet">Gemini is unavailable. The evidence-linked brief is ready.</p>';
  } else if (analysis?.status==='unavailable') {
    content = `<p class="quiet" role="status">Gemini couldn’t complete the analysis. The evidence-linked brief is ready.</p>
      <button class="small" data-retry-analysis="${html(incident.id)}">Retry AI analysis</button>`;
  } else {
    content = '<p class="quiet" role="status">Gemini is reviewing the incident and its source records…</p>';
  }
  return `<section class="panel block ai-analysis" aria-labelledby="analysis-title">
    <div class="row"><h3 id="analysis-title">AI analysis</h3><span class="badge neutral">Gemini</span></div>
    ${content}</section>`;
}

function freshnessPanel(document, currentVersion, archive = cutoff==='23:59' ? reviewedArchive() : []) {
  const {check,reasons} = runbookFreshness(document,archive,currentVersion);
  return `<div class="runbook-check block">
    <span class="badge neutral">${reasons.length?'Review before use':'Verification recorded'}</span>
    <p class="small">${check ? `Last verified ${html(formatIncidentTime(check.verifiedAt))} by ${html(check.reviewer)} · Version ${html(check.version || 'unknown')}.` : 'No verification is recorded for this procedure.'}</p>
    ${reasons.length ? `<ul class="small">${reasons.map(reason=>`<li>${html(reason)}</li>`).join('')}</ul>` : ''}</div>`;
}

function priorityExplanation(incident) {
  const current = incidentPriority(incident);
  const changes = workspace.priorityHistory[incident.id] || [];
  const rationale = incident.sampleAlert ? 'Severity came from the submitted alert. The report has no measured affected share.'
    : `Suggested ${priority(incident)} · ${incident.affectedPct}% affected in the sample · ${incident.core?'Customer-facing service':'Internal or indirect customer impact'}.`;
  return `<details class="block"><summary>Why ${current}?</summary><p>${rationale}</p>
    ${changes.length ? `<ol class="archive">${changes.map(change=>`<li><strong>${change.previous} → ${change.level}</strong> · ${html(change.reason)}
      <br><small>${html(change.who)} · ${html(formatIncidentTime(change.time))}</small></li>`).join('')}</ol>` : '<small>No severity changes recorded.</small>'}</details>`;
}

function incidentExposure(incident) {
  const group=services.find(item=>item.name===incident.service)?.group;
  return exposureAssumptions(incident,group,workspace.exposure[incident.id]);
}

function exposureLabel(assumptions,minutes) {
  const risk=exposureAt(assumptions,minutes);
  return `${cad(risk.low)}–${cad(risk.high)} CAD`;
}

function exposurePanel(incident,result) {
  const assumptions=incidentExposure(incident);
  const elapsed=Math.max(0,toMinute(result.evidence.at(-1)?.seen || incident.alert)-toMinute(incident.alert));
  const minutes=exposureWindows.get(incident.id) ?? Math.max(15,Math.min(120,elapsed));
  return `<section class="panel block risk-panel" aria-labelledby="risk-title">
    <div class="row"><div><h3 id="risk-title">Potential financial exposure</h3><small>${workspace.exposure[incident.id]?'Your assumptions':'Sample assumptions'} · Estimated, CAD</small></div>
      <button type="button" class="small" data-edit-exposure>Change assumptions</button></div>
    <div class="risk-amount" id="cost-projection" aria-live="polite">${exposureLabel(assumptions,minutes)}</div>
    <label for="cost-window">If impact continues for <output id="cost-minutes">${minutes} minutes</output></label>
    <input type="range" class="range" id="cost-window" min="0" max="120" value="${minutes}">
    <div class="risk-ticks" aria-hidden="true"><span>0</span><span>30m</span><span>1h</span><span>90m</span><span>2h</span></div>
    <p class="quiet small">${assumptions.low}–${assumptions.high} affected operations per minute × ${cadUnit.format(assumptions.order)} per operation. Measures value exposed over time. Actual loss depends on recovery and retries.</p>
  </section>`;
}

function editExposure() {
  const incident=byId(selected);
  const assumptions=incidentExposure(incident);
  openDialog(incident.id,'Financial exposure assumptions',`
    <form class="simulation-form" data-exposure-form="${html(incident.id)}">
      <label>Lower affected operations per minute<input name="low" type="number" min="0" max="100000000" step="any" required value="${assumptions.low}"></label>
      <label>Upper affected operations per minute<input name="high" type="number" min="0" max="100000000" step="any" required value="${assumptions.high}"></label>
      <label>Value per affected operation (CAD)<input name="order" type="number" min="0" max="100000000" step="any" required value="${assumptions.order}"></label>
      <div class="buttons wide"><button type="button" class="small" data-reset-exposure="${html(incident.id)}">Use sample assumptions</button>
        <button class="primary small" type="submit">Save assumptions</button></div>
    </form>`);
}

function brief(incident, result) {
  if (!result.observed) return '<div class="lead"><strong>The alert hasn’t fired yet.</strong><p>Move the Time Machine forward to see the brief as it became available.</p></div>';
  const historical = result.nearby[0];
  const saved = cutoff==='23:59' ? workspace.resolutions[incident.id] : null;
  const work = cutoff==='23:59' ? workspace.workHistory[incidentWork(incident,workspace).key] : null;
  return `<div class="lead"><div class="kicker">${result.certainty} cause</div>
    <h3>${html(result.cause)}</h3>
    <p><strong>First check</strong> · ${html(result.next)}</p>
    ${result.causeSources.length ? `<div class="references"><span class="small">Supporting evidence</span>${result.causeSources.map(ref).join('')}</div>` : ''}
    ${incident.sampleAlert ? `<small>Error signature · ${html(incident.fingerprint || 'No single code detected')}</small>` : ''}</div>
    ${saved && !workspace.active.includes(incident.id) ? `<section class="panel block"><h3>Reviewed resolution</h3>
      <p>${html(saved.fix)}</p><p><strong>Verified by ${html(saved.responder)}</strong> · ${html(saved.verification)}</p>${ref(saved.id)}</section>` : ''}
    ${work?.via==='telegram' && !work.verified ? `<section class="panel block"><h3>Fixed in Telegram</h3>
      <p>${html(work.closedBy)} · ${html(formatIncidentTime(work.closedAt))} · ${durationLabel(work.closedAt-work.openedAt)} from alert</p>
      <button class="small" data-resolve-incident="${html(incident.id)}">Write resolution report</button></section>` : ''}
    ${automaticAnalysis(incident)}
    ${exposurePanel(incident,result)}
    <section class="panel dissent"><div class="kicker">Dissenting Detective</div><details><summary>What would change the diagnosis?</summary>
      <p>${html(result.challenger.claim)}</p><p><strong>How to test it</strong> · ${html(result.challenger.check)}</p>
      <div class="references">${result.challenger.sources.map(ref).join('')}</div></details></section>
    <div class="duo block">
      <div class="panel"><div class="kicker">Known fix</div><h3>${result.known ? html(result.known.fix) : 'No known fix for this alert'}</h3>
      <p class="quiet">${result.known ? `Documented by ${html(result.known.responder)} in ${html(result.known.id)}.` : 'The archive has no verified fix applicable to this alert and version.'}</p>
      ${historical ? ref(result.known?.id || historical.id) : ''}
      ${result.verifiedDocument ? `<div class="block">${documentLink(result.verifiedDocument)}${freshnessPanel(result.verifiedDocument,incident.serviceVersion)}</div>` : ''}</div>
      <div class="panel"><div class="kicker">Key uncertainty</div><h3>${html(incident.unknowns[0])}</h3><button class="small" data-tab="family">Open incident family tree</button></div>
    </div>
    ${result.guide && !result.verifiedDocument ? `<div class="panel block"><div class="kicker">${html(result.guide.kind)}</div><p>${html(result.guide.useWhen)}</p>${documentLink(result.guide)}${freshnessPanel(result.guide,incident.serviceVersion)}</div>` : ''}
    <div class="duo block">
      <div class="panel"><div class="kicker">Recent changes</div><ul class="archive">${result.changes.map(change => `<li><strong>${html(change.title)}</strong><br><small>${change.time} ET</small> ${ref(change.id)}</li>`).join('') || '<li>No relevant change recorded in this snapshot.</li>'}</ul></div>
      ${incident.sampleAlert ? `<div class="panel"><div class="kicker">Related past incidents</div><ul class="archive">${result.nearby.map(record=>
        `<li><strong>${html(record.title)}</strong> ${ref(record.id)}<br><small>${result.exact.includes(record) ? 'Matching error signature' : 'Same service · Different error signature'}</small></li>`
      ).join('') || '<li>No past incident recorded for this service.</li>'}</ul></div>` :
      `<div class="panel"><div class="kicker">Impact and priority</div><h3>${incidentPriority(incident)} · ${incident.affectedPct}% of monitored operations affected</h3>
      <p>Confirmed: ${incident.confirmed.join(', ')}.<br>Possible downstream impact: ${incident.possible.join(', ')}.</p>
      ${priorityExplanation(incident)}</div>`}
    </div>
    ${incident.sampleAlert ? `<section class="panel block">${priorityExplanation(incident)}</section>` : ''}
    ${result.relatedAlerts.length > 1 ? `<div class="panel block"><details open><summary>${result.relatedAlerts.length} alerts grouped into this incident</summary><p>The alerts share an error code and fired within five minutes on the same service or a linked dependency.</p>
    <ul class="archive">${result.relatedAlerts.map(event=>`<li>${html(event.service)} · ${html(event.time)} ET · ${ref(event.id)}</li>`).join('')}</ul><small>Shared cause remains a working hypothesis.</small></details></div>` : ''}
    <div class="panel block"><details><summary>Recovery checks</summary><p>${html(result.verify)}</p></details></div>`;
}

function caseDetails(incident,result) {
  if (!result.observed) return '<p>The alert had not fired at this point in the replay.</p>';
  const ownership = workspace.tasks[incident.id];
  return `<div class="row"><h3>Case facts</h3><span class="badge neutral">Sample records</span></div>
    <dl class="case-facts">
      <div><dt>Alert received</dt><dd>${incident.alert} ET</dd></div><div><dt>Error signature</dt><dd class="mono">${html(incident.fingerprint)}</dd></div>
      <div><dt>Assigned on call</dt><dd>${html(incident.owner)}${ownership?.by ? ' · Accepted by ' + html(ownership.by) : ''}</dd></div>
      <div><dt>Monitored operations affected</dt><dd>${incident.affectedPct}%</dd></div>
      <div><dt>Confirmed impact</dt><dd>${html(incident.confirmed.join(', '))}</dd></div>
      <div><dt>Possible downstream impact</dt><dd>${html(incident.possible.join(', '))}</dd></div>
    </dl>
    <section class="panel block"><h3>Observed evidence</h3><ol class="archive">${result.findings.map(finding=>`<li><p>${html(finding.text)}</p><div class="references">${finding.ids.map(ref).join('')}</div></li>`).join('')}</ol></section>
    <section class="panel block"><h3>Unknowns</h3><ul>${incident.unknowns.map(question=>`<li>${html(question)}</li>`).join('')}</ul><p><strong>First check</strong> · ${html(result.next)}</p></section>
    <section class="panel block"><h3>Raw records in this snapshot</h3><ul class="archive">${result.evidence.map(event=>`<li><div class="row"><strong>${html(event.title)}</strong>${ref(event.id)}</div><small>${html(event.kind)} · Available at ${event.seen} ET</small><p>${html(event.detail)}</p></li>`).join('')}</ul></section>`;
}

function incidentRunbooks(incident,result) {
  if (!result.observed) return '<p>The alert had not fired at this point in the replay.</p>';
  const guide = result.guide;
  return `<div class="lead"><h3>${result.verifiedDocument ? 'Procedure linked to the matching past fix' : 'No verified fix for this error signature'}</h3>
    <p>${result.verifiedDocument ? 'Check the runbook preconditions against the current evidence before following it.' : 'The documentation below can help you investigate or compare this alert with a different case.'}</p></div>
    ${guide ? `<section class="panel block"><div class="kicker">${html(guide.kind)}</div><h3>${html(guide.title)}</h3><p>${html(guide.useWhen)}</p>
    <ol class="archive">${guide.steps.map(([title,step])=>`<li><strong>${html(title)}</strong><p>${html(step)}</p></li>`).join('')}</ol>
    <p><strong>Pause if:</strong> ${html(guide.stopWhen)}</p><p><strong>Verify:</strong> ${html(guide.verify)}</p>${documentLink(guide)}${freshnessPanel(guide,incident.serviceVersion)}</section>` : ''}
    ${result.relatedDocuments.length ? `<section class="panel block"><h3>Related archive documentation</h3><p>Compare the preconditions and error signature before using a procedure from another incident.</p><div class="references">${result.relatedDocuments.map(documentLink).join('')}</div></section>` : ''}`;
}

function toMinute(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function trace(result) {
  return `<h3>Investigation activity</h3><p class="quiet">These are the records the app checked, the search terms it used, and what came back.</p>
    <ol class="trace">${result.activity.map(step=>`<li><strong>${html(step.action)}</strong><br><span class="mono quiet">${html(step.query)}</span><p>${html(step.result)}</p><div class="references">${step.ids.map(ref).join('')}</div></li>`).join('')}</ol>`;
}

function times(incident) {
  return [...new Set(incident.events.map(event=>event.seenAt ?? event.seen))].sort((a,b)=>
    typeof a==='number' ? a-b : a.localeCompare(b));
}

const snapshotLabel = snapshot => typeof snapshot==='number' ? formatIncidentTime(snapshot) : snapshot+' ET';

function replay(incident, result) {
  const stamps = times(incident);
  const index = cutoff === '23:59' ? stamps.length - 1 : stamps.indexOf(cutoff);
  return `<div class="row"><h3>What did we know at the time?</h3><button class="small" data-live>Latest snapshot</button></div>
    <p class="quiet">Scrub through when evidence first became available.</p>
    <label for="replay-range">Evidence available at <strong class="mono" id="replay-time">${snapshotLabel(stamps[index])}</strong></label>
    <input class="range" id="replay-range" type="range" min="0" max="${stamps.length - 1}" value="${index}" aria-valuetext="${snapshotLabel(stamps[index])}">
    <div id="replay-details">${replayDetails(incident,result)}</div>`;
}

function replayDetails(incident,result) {
  return `<p class="lead"><strong>${html(result.cause)}</strong>${result.alternative ? `<br>${html(incident.alternative)}` : ''}</p>
    <ul class="timeline">${result.evidence.map(event=>`<li><span class="mono">${event.seen} ET / ${event.kind}</span><br><strong>${html(event.title)}</strong><p>${html(event.detail)}</p>${ref(event.id)}</li>`).join('')}</ul>`;
}

function compare(incident, result) {
  if (!result.observed) return '<p>The alert has not fired at this point in the replay.</p>';
  return `<div class="lead"><div class="kicker">Current incident</div><h3>${html(incident.title)}</h3>
    <p>${html(incident.service)} · ${html(incident.fingerprint || 'Error signature unknown')}${incident.serviceVersion ? ' · Version '+html(incident.serviceVersion) : ''}</p></div>
    <ol class="archive comparison-list">${result.comparisons.map(({record,match,reasons})=>`<li class="panel">
      <div class="row"><h3>${html(record.title)}</h3>${ref(record.id)}</div>
      <span class="badge neutral">${match?'Signature match':'Related record'}</span>
      <p>${reasons.map(html).join(' · ')}</p><small>${html(record.priority)} · ${html(record.responder)}</small>
      ${record.fix ? `<p>${html(record.fix)}</p>` : ''}</li>`).join('') || '<li>No relevant incidents in History.</li>'}</ol>`;
}

function familyTree(incident,result) {
  if (!result.observed) return '<p>The alert has not fired at this point in the replay.</p>';
  const previous = result.comparisons.map(({record,match})=>({
    id:record.id,time:record.resolvedAt || Date.parse(record.date+' 2026 12:00 UTC'),
    date:record.resolvedAt ? formatIncidentTime(record.resolvedAt) : record.date,
    kind:match ? 'Same error' : 'Related incident', title:record.title,
    detail:record.fix ? `Previous fix · ${record.fix}` : `${record.service} · ${record.fingerprint || 'Error code unknown'}`
  }));
  const current = [...result.changes,...result.relatedAlerts].map(event=>({
    id:event.id,time:event.timeAt ?? sampleMonitoringTime(event.time),date:snapshotLabel(event.timeAt ?? event.time),
    kind:event.kind==='Alert' ? 'Incoming alert' : event.version ? 'Release' : event.kind,title:event.title,detail:event.detail
  }));
  if (!current.some(event=>event.kind==='Incoming alert')) {
    const alert = result.evidence.find(event=>event.kind==='Alert');
    if (alert) current.push({id:alert.id,time:alert.timeAt ?? sampleMonitoringTime(alert.time),date:snapshotLabel(alert.timeAt ?? alert.time),
      kind:'Incoming alert',title:alert.title,detail:alert.detail});
  }
  const response = [];
  if (result.guide) response.push({id:result.guide.id,kind:'Current procedure',date:result.guide.updated,
    title:result.guide.title,detail:result.verifiedDocument ? 'Linked to the matching fix' : result.guide.kind});
  const saved = cutoff==='23:59' && !workspace.active.includes(incident.id) ? workspace.resolutions[incident.id] : null;
  if (saved) response.push({id:saved.id,kind:'Reviewed resolution',date:formatIncidentTime(saved.resolvedAt),title:saved.fix,detail:saved.verification});
  const branches = [
    {name:'History',type:'history',nodes:previous.sort((a,b)=>a.time-b.time)},
    {name:'Alerts & changes',type:'evidence',nodes:current.sort((a,b)=>a.time-b.time)},
    {name:'Response',type:'response',nodes:response},
  ].filter(branch=>branch.nodes.length);
  const renderNodes = (nodes,graphical = false)=>nodes.map((node,index)=>`<li${graphical ? ` style="--family-position:${Math.min(index,7)}"` : ''}>
    <button type="button" class="family-node" data-source="${html(node.id)}">
      <span class="family-node-meta"><span>${html(node.kind)}</span><span>${html(node.date)}</span></span>
      <strong>${html(node.title)}</strong><span class="family-node-detail">${html(node.detail)}</span>
      ${graphical ? `<span class="family-node-ref"><span>${html(node.id)}</span><span aria-hidden="true">↗</span></span>` : ''}
    </button></li>`).join('');
  const viewControl = `<div class="family-view-switch" role="group" aria-label="Family tree view">
    ${[['map','Map'],['list','List']].map(([view,label])=>`<button type="button" class="small" data-family-view="${view}" aria-pressed="${familyView===view}">${label}</button>`).join('')}</div>`;
  const ordered = [...previous,...current].sort((a,b)=>a.time-b.time).concat(response);
  return `<section aria-labelledby="family-title">
    <div class="row family-heading"><div><h3 id="family-title">Incident family tree</h3><p class="quiet">Select a record to open its evidence.</p></div>${viewControl}</div>
    ${familyView==='list' ? `<ol class="family-tree">${renderNodes(ordered)}</ol>` :
      `<div class="family-graphic">
        <button type="button" class="family-root" data-tab="details" aria-label="Open case details for ${html(incident.title)}">
          <span class="family-root-meta"><span class="family-root-signal" aria-hidden="true"></span>
            <span>${html(incident.id)}</span><span>${html(incidentPriority(incident))}</span></span>
          <strong>${html(incident.title)}</strong><span>${html(incident.service)} · ${html(incident.alert)} ET</span>
        </button>
        <div class="family-branches">
          ${branches.map((branch,index)=>`<section class="family-branch" data-family-branch="${branch.type}" style="--family-column:${index}">
            <h4><span aria-hidden="true"></span>${html(branch.name)} <small>${branch.nodes.length}</small></h4>
            <ol>${renderNodes(branch.nodes,true)}</ol>
          </section>`).join('')}
        </div>
      </div>`}
  </section>`;
}

const serviceNames = services.map(service=>service.name);
const options = (entries,value) => entries.map(([key,label])=>
  `<option value="${html(key)}" ${key===value?'selected':''}>${html(label)}</option>`).join('');
const testStatus = incident => incident.triggeredAt===null ? 'Scheduled' : simulationStatuses[incident.status];
function earliestLocalTrigger() {
  const moment = new Date();
  return new Date(moment.getTime()-moment.getTimezoneOffset()*60_000+1000).toISOString().slice(0,19);
}

function publishSimulation(state,record,now) {
  if (!releaseSimulation(record,now)) return;
  const candidates = state.active.map(id=>state.custom[id]).filter(item=>item && Boolean(item.localOnly)===Boolean(record.localOnly))
    .map(item=>asInvestigation(item));
  const match = record.status==='resolved' ? undefined : groupDuplicate(asInvestigation(record),candidates);
  if (match) {
    const parent = state.custom[match.id];
    record.groupedUnder = parent.id;
    const previous = parent.level;
    if (record.level < previous) {
      parent.level = record.level;
      recordPriority(state,parent.id,previous,parent.level,`Grouped ${record.level} alert from ${record.service}.`,actor,now);
      if (record.level==='P1' && !record.localOnly && location.protocol.startsWith('http')) {
        record.telegram = {status:'pending',nextAt:now,attempts:0,level:record.level,simulation:simulationPayload(parent)};
      }
    }
    state.analyses[parent.id] = {status:'queued',revision:record.id};
    notification(state,parent.id,'Alert grouped',`${record.title} · Same error code within five minutes · ${record.service}`);
    return;
  }
  state.analyses[record.id] = {status:'queued'};
  if (!record.localOnly && location.protocol.startsWith('http')) {
    record.telegram = {status:'pending',nextAt:now,attempts:0,level:record.level,simulation:simulationPayload(record)};
  }
  if (record.status !== 'resolved') state.active.push(record.id);
  notification(state,record.id,record.title,`Investigation ready · ${record.service} · ${testStatus(record)}`);
}

function simulator() {
  const draft = simulatorDraft;
  const scheduled = draft.trigger==='scheduled';
  const upcomingTests = Object.values(workspace.custom).filter(record=>record.triggeredAt===null)
    .sort((a,b)=>a.scheduledAt-b.scheduledAt);
  const count = Object.keys(workspace.custom).length;
  const templates = simulationTemplates.map((item,index)=>`<li class="template-card ${item.level}">
    <span class="badge ${item.level}">${simulationSeverities[item.level]}</span>
    <h3>${html(item.title)}</h3><p>${html(item.service)}</p><div class="buttons">
    <button class="small" data-load-template="${index}">Use template</button>
    <button class="small primary" data-fire-template="${index}" aria-label="Run ${html(item.title)}">Run now</button></div></li>`).join('');
  return layout('Incident simulator.','Create a test incident and walk it through the same desk, alert inbox, and archive.',`
    <section class="simulation-banner row"><div><span class="badge test-badge">Demo mode</span>
    <p data-simulation-telegram-hint>${simulationTelegramHint()}</p></div>
    <div class="buttons"><button class="small" data-run-burst>Run all four severities</button>
    <button class="small danger" data-reset-custom ${count?'':'disabled'}>Reset custom simulations</button></div></section>
    <section class="template-section" aria-labelledby="investigation-template-title"><h2 id="investigation-template-title">Challenge 4 alert feed</h2>
    <p class="quiet">Each alert uses the sample monitoring timeline. Its brief appears on the Desk and the notification stays in the app.</p>
    <ul class="template-grid">${investigationTemplates.map((item,index)=>`<li class="template-card ${item.level}">
      ${badge(item.level)}<h3>${html(item.title)}</h3><p>${html(item.service)}</p>
      <button class="small primary" data-investigation-template="${index}" aria-label="Send sample: ${html(item.title)}">Send sample alert</button></li>`).join('')}</ul></section>
    <section class="template-section" aria-labelledby="template-title"><h2 id="template-title">Demo scenarios</h2>
    <ul class="template-grid">${templates}</ul></section>
    <div class="simulator-grid">
    <section class="panel simulator-editor"><h2>Create custom incident</h2><form id="simulation-form" class="simulation-form">
      <label class="wide">Incident title<input name="title" required maxlength="100" value="${html(draft.title)}"></label>
      <label class="wide">Description<textarea name="description" required maxlength="1600" rows="4" aria-describedby="signature-hint">${html(draft.description)}</textarea>
      <small id="signature-hint">Use fictional alert text. Include an error code such as JWKS_CACHE_MISS so Aurelis can match it to sample records.</small></label>
      <label>Service<select name="service" required>${options([['','Choose a service'],...serviceNames.map(value=>[value,value])],draft.service || '')}</select></label>
      <label>Company <small>Optional · fictional data</small><input name="company" maxlength="80" list="sample-companies" value="${html(draft.company)}"></label>
      <datalist id="sample-companies">${sampleCompanies.map(name=>`<option value="${html(name)}"></option>`).join('')}</datalist>
      <label>Service version <small>Optional</small><input name="serviceVersion" maxlength="40" value="${html(draft.serviceVersion)}"></label>
      <label>Category<select name="category">${options(simulationCategories.map(value=>[value,value]),draft.category || 'Availability')}</select></label>
      <label>Incident type<input name="type" required maxlength="70" value="${html(draft.type)}" placeholder="e.g. Service outage"></label>
      <label>Severity<select name="level">${options(Object.entries(simulationSeverities),draft.level || 'P3')}</select></label>
      <label>Location <small>Optional</small><input name="location" maxlength="100" value="${html(draft.location)}"></label>
      <label>Affected area <small>Optional</small><input name="area" maxlength="120" value="${html(draft.area)}"></label>
      <label>Initial status<select name="status">${options(Object.entries(simulationStatuses),draft.status || 'reported')}</select></label>
      <label>Incident timestamp <small>Optional · device time</small><input name="occurred" type="datetime-local" value="${html(draft.occurred)}"></label>
      <p class="wide quiet small">The sample change and log records are dated ${sampleMonitoringDate} (Eastern Time).</p>
      <label class="wide">Recommended actions <small>Optional</small><textarea name="actions" maxlength="1000" rows="3">${html(draft.actions)}</textarea></label>
      <label>Trigger<select name="trigger">${options([['immediate','Immediately'],['scheduled','At a scheduled time']],scheduled?'scheduled':'immediate')}</select></label>
      <label data-scheduled-field ${scheduled?'':'hidden'}>Trigger time <small>Device time</small><input name="scheduled" type="datetime-local" step="1" min="${earliestLocalTrigger()}" value="${html(draft.scheduled)}" ${scheduled?'required':'disabled'}></label>
      <p class="wide quiet small" data-schedule-hint ${scheduled?'':'hidden'}>Keep a workspace tab open for on-time delivery. Overdue events fire when you reopen it.</p>
      <p class="wide form-error" id="simulation-error" role="alert"></p>
      <div class="buttons wide"><button type="submit" class="primary">Preview incident</button></div>
    </form></section>
    <section class="panel scheduled-panel"><div class="row"><h2>Scheduled</h2><span class="badge neutral">${upcomingTests.length}</span></div>
    <ul class="archive">${upcomingTests.map(record=>`<li><div class="row"><strong>${html(record.title)}</strong>${badge(record.level)}</div>
      <p class="small">${html(formatIncidentTime(record.scheduledAt))} · ${html(record.service)}</p>
      <div class="buttons"><button class="small" data-open-case="${record.id}">View incident</button>
      <button class="small danger" data-delete-custom="${record.id}">Cancel schedule</button></div></li>`).join('') || '<li>No scheduled test events.</li>'}</ul></section>
    </div>`);
}

function previewSimulation(values) {
  const input = validateSimulation(values,serviceNames);
  const time = input.occurredAt ?? input.scheduledAt;
  openDialog('Incident simulator','Preview custom incident',`
    <div class="row">${testBadge}<span class="badge ${input.level}">${simulationSeverities[input.level]}</span></div>
    <h3>${html(input.title)}</h3><p class="chat-answer">${html(input.description)}</p>
    <dl class="case-facts">
      <div><dt>Service</dt><dd>${html(input.service)}</dd></div><div><dt>Company</dt><dd>${html(input.company || 'Unassigned')}</dd></div><div><dt>Initial status</dt><dd>${simulationStatuses[input.status]}</dd></div>
      <div><dt>Category and type</dt><dd>${html(input.category)} · ${html(input.type)}</dd></div>
      ${input.location ? `<div><dt>Location</dt><dd>${html(input.location)}</dd></div>` : ''}
      ${input.area ? `<div><dt>Affected area</dt><dd>${html(input.area)}</dd></div>` : ''}
      <div><dt>Incident timestamp</dt><dd>${time===null?'At creation':html(formatIncidentTime(time))}</dd></div>
      <div><dt>Trigger</dt><dd>${input.scheduledAt===null?'Immediately':html(formatIncidentTime(input.scheduledAt))}</dd></div>
    </dl>${input.actions ? `<p class="chat-answer"><strong>Recommended actions</strong><br>${html(input.actions)}</p>` : ''}
    ${automaticTelegram?`<p class="small">Telegram will ${input.level==='P1'?'post this test directly to the group':'page the default responder when this test fires'}.</p>`:''}
    <div class="buttons"><button class="small" data-close>Back to editing</button>
      <button class="small primary" data-confirm-simulation>${input.scheduledAt===null?'Create incident':'Schedule incident'}</button></div>`);
}

function templateValues(index) {
  return {...simulationTemplates[index],trigger:'immediate',status:'reported'};
}

async function createIncidents(values,batch = false,localOnly = false) {
  const firstId = await createSimulationBatch(values,batch,localOnly);
  if (!firstId) return;
  simulatorDraft = {};
  if (dialog.open) dialog.close();
  if (workspace.custom[firstId]?.triggeredAt !== null) openCase(firstId);
  else render();
}

async function createSimulationBatch(values,batch,localOnly) {
  let firstId;
  const succeeded = await update(state=>{
    const now = Date.now();
    const inputs = values.map(item=>validateSimulation(item,serviceNames,now));
    if (Object.keys(state.custom).length+inputs.length > 100) throw Error('This workspace holds up to 100 custom simulations. Delete a test event or reset the simulator.');
    for (const input of inputs) {
      const id = 'SIM-' + crypto.randomUUID().split('-').at(-1).toUpperCase();
      const record = createSimulation(input,actor,now,id);
      if (localOnly) record.localOnly = true;
      state.custom[id] = record;
      publishSimulation(state,record,now);
      firstId ||= id;
    }
    if (!batch && inputs[0].scheduledAt) return 'Test incident scheduled.';
  });
  return succeeded ? firstId : undefined;
}

function openCase(id) {
  id = workspace.custom[id]?.groupedUnder || id;
  if (!byId(id)) return;
  if (dialog.open) dialog.close();
  choose(id);
  if (view()==='desk') render();
  else location.hash='desk';
  requestAnimationFrame(()=>document.querySelector('.case h2')?.focus({preventScroll:false}));
}

function simulationCase(incident,result) {
  const activity = incident.activity.slice().reverse().map(item=>`<li><div class="row"><strong>${html(item.status)}${item.level?' · '+simulationSeverities[item.level]:''}</strong>
    <small>${html(formatIncidentTime(item.time))}</small></div><small>${html(item.who)}</small>
    ${item.note?`<p class="chat-answer">${html(item.note)}</p>`:''}</li>`).join('');
  return `<div class="lead simulation-lead"><h3>Reported symptoms</h3><p class="chat-answer">${html(incident.description)}</p></div>
    <dl class="case-facts">
      <div><dt>Category and type</dt><dd>${html(incident.category)} · ${html(incident.type)}</dd></div>
      <div><dt>Incident timestamp</dt><dd>${html(formatIncidentTime(incident.occurredAt))}</dd></div>
      <div><dt>Created</dt><dd>${html(formatIncidentTime(incident.createdAt))}</dd></div>
      <div><dt>${incident.triggeredAt===null?'Scheduled trigger':'Alert triggered'}</dt><dd>${html(formatIncidentTime(incident.triggeredAt ?? incident.scheduledAt))}</dd></div>
      ${incident.location?`<div><dt>Location</dt><dd>${html(incident.location)}</dd></div>`:''}
      ${incident.area?`<div><dt>Affected area</dt><dd>${html(incident.area)}</dd></div>`:''}
      <div><dt>Latest responder</dt><dd>${html(incident.responder || 'Unassigned')}</dd></div>
    </dl>
    ${incident.actions ? `<section class="panel block"><h3>Reporter’s suggested actions</h3><p class="chat-answer">${html(incident.actions)}</p></section>` : ''}
    ${result.observed ? `<section class="panel block"><h3>Raw evidence</h3><ul class="archive">${result.evidence.map(event=>
      `<li><strong>${html(event.title)}</strong> ${ref(event.id)}<p>${html(event.detail)}</p></li>`).join('')}</ul></section>` : ''}
    <section class="panel block"><h3>Incident activity</h3><ol class="archive">${activity}</ol></section>`;
}

function editSimulation(record, status) {
  if (status==='resolved') { openResolution(record.id,record.level); return; }
  const heading = {acknowledged:'Acknowledge incident'}[status];
  openDialog(record.id+' / Test event',heading || 'Update incident',`
    <p><strong>${html(record.title)}</strong></p>
    <form class="simulation-form" data-edit-simulation="${record.id}">
      <label>Status<select name="status">${options(Object.entries(simulationStatuses),status ?? record.status)}</select></label>
      <label>Severity<select name="level">${options(Object.entries(simulationSeverities),record.level)}</select></label>
      <label class="wide">Update note <small>Optional</small><textarea name="note" rows="3" maxlength="500"></textarea></label>
      <label class="wide">Reason for severity change <small>When changing severity</small><input name="priorityReason" maxlength="300"></label>
      <div class="buttons wide"><button type="button" class="small" data-close>Cancel</button>
      <button class="small primary" type="submit">${heading || 'Save update'}</button></div>
    </form>`);
}

function openResolution(id,level,note = '',priorityReason = '') {
  const incident = byId(id);
  if (!incident || incident.triggeredAt===null) return;
  const current = workspace.resolutions[id];
  const matching = investigateCase(incident,'23:59').exact.filter(record=>record.fix);
  const runbooks = documents.filter(document=>document.service===incident.service);
  openDialog(id,'Resolve incident',`
    <p>${html(incident.title)}</p>
    <form class="simulation-form" data-resolution-form="${html(id)}">
      <input type="hidden" name="level" value="${html(level || incidentPriority(incident))}">
      <input type="hidden" name="priorityReason" value="${html(priorityReason)}">
      ${matching.length ? `<label class="wide">Start from a previous fix<select data-resolution-template>
        ${options([['','Write a new resolution'],...matching.map(record=>[record.id,`${record.id} · ${record.title}`])],'')}</select></label>` : ''}
      <label class="wide">Resolution notes <small>Optional · fictional data only</small><textarea name="notes" rows="3" maxlength="1600" placeholder="What caused the incident, what you changed, and how you checked recovery">${html(note)}</textarea></label>
      <div class="wide buttons"><button type="button" class="small" data-draft-resolution ${connected?'':'disabled'}>Format notes with Gemini</button>
      <span class="small quiet" data-resolution-feedback role="status">${connected?'':'Fill in the review fields directly when Gemini is unavailable.'}</span></div>
      <label class="wide">Confirmed cause<textarea name="cause" required maxlength="500" rows="2">${html(current?.cause)}</textarea></label>
      <label class="wide">Fix applied<textarea name="fix" required maxlength="500" rows="2">${html(current?.fix)}</textarea></label>
      <label class="wide">How recovery was verified<textarea name="verification" required maxlength="500" rows="2">${html(current?.verification)}</textarea></label>
      <label>Service version <small>Optional</small><input name="version" maxlength="40" value="${html(current?.version || incident.serviceVersion)}"></label>
      <label>Runbook actually used<select name="runbook">${options([['','None recorded'],...runbooks.map(item=>[item.id,item.id+' · '+item.title])],current?.runbook || '')}</select></label>
      <div class="buttons wide"><button type="button" class="small" data-close>Cancel</button>
        <button class="small primary" type="submit">Save reviewed resolution</button></div>
    </form>`);
}

async function draftResolution(button) {
  const form = button.form;
  const status = form.querySelector('[data-resolution-feedback]');
  const incident = byId(form.dataset.resolutionForm);
  const notes = form.elements.notes.value.trim();
  if (!notes) { status.textContent = 'Enter your resolution notes first.'; form.elements.notes.focus(); return; }
  button.disabled = true;
  status.textContent = 'Gemini is formatting your notes…';
  try {
    const response = await fetch('/api/resolution',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...aiIncidentPayload(incident),notes})});
    if (!response.ok) throw Error();
    const draft = await response.json();
    if (form.isConnected) {
      for (const name of ['cause','fix','verification']) {
        if (draft[name] && !form.elements[name].value.trim()) form.elements[name].value = draft[name];
      }
      status.textContent = 'Draft ready. Review the fields and add any missing details before saving.';
    }
  } catch {
    if (form.isConnected) status.textContent = 'Gemini is unavailable. You can complete and save these fields directly.';
  } finally { button.disabled = false; }
}

function recordPriority(state,id,previous,level,reason,who,time) {
  if (previous===level) return;
  const changes = state.priorityHistory[id] ||= [];
  changes.unshift({previous,level,reason,who,time});
  changes.length = Math.min(changes.length,20);
}

function incidentWork(incident,state) {
  const {id,title,service} = incident;
  const openedAt = state.arrivals[id] ?? incident.triggeredAt ?? sampleMonitoringTime(incident.alert);
  const task = state.tasks[id];
  const acknowledged = incident.activity?.find(item=>item.status==='Acknowledged' && item.time>=openedAt);
  const localAcceptance = task?.acceptedAt>=openedAt ? {acceptedAt:task.acceptedAt,acceptedBy:task.by}
    : acknowledged ? {acceptedAt:acknowledged.time,acceptedBy:acknowledged.who}
    : task?.status==='claimed' && !task.acceptedAt ? {acceptedBy:task.by} : {};
  return {key:id+'/'+openedAt,incident:id,title,service,openedAt,company:incident.company,fingerprint:incident.fingerprint,
    level:incidentPriority(incident,state),...localAcceptance};
}

function localReportEvents(state = workspace) {
  const rows = new Map(Object.entries(state.workHistory));
  for (const id of [...new Set([...state.active,...Object.keys(state.resolutions),...Object.keys(state.custom)])]) {
    const incident=byId(id,state);
    if (!incident || incident.triggeredAt===null || incident.groupedUnder) continue;
    const row=incidentWork(incident,state);
    if (rows.has(row.key)) continue;
    const saved=!state.active.includes(id) && state.resolutions[id];
    if (saved?.resolvedAt>=row.openedAt) {
      Object.assign(row,{closedAt:saved.resolvedAt,closedBy:saved.responder,via:'website',verified:true,fix:saved.fix});
    } else if (incident.status==='resolved') {
      const event=incident.activity.findLast(item=>item.status==='Resolved' && item.time>row.openedAt);
      if (event) Object.assign(row,{closedAt:event.time,closedBy:event.who,via:'website'});
    }
    rows.set(row.key,row);
  }
  return [...rows.values()];
}

function applyTelegramCompletion(state,route) {
  if (route.stage!=='completed' || route.completedVia!=='telegram' || !state.active.includes(route.incident)) return;
  const incident=byId(route.incident,state);
  if (!incident) return;
  const timing=incidentWork(incident,state);
  if (route.created<timing.openedAt || route.completedAt<timing.openedAt || state.workHistory[timing.key]) return;
  state.workHistory[timing.key]={...timing,acceptedAt:route.acceptedAt,acceptedBy:route.acceptedBy,
    closedAt:route.completedAt,closedBy:route.completedBy,via:'telegram'};
  for (const record of Object.values(state.custom).filter(item=>item.id===incident.id || item.groupedUnder===incident.id)) {
    updateSimulation(record,{status:'resolved',level:record.level,note:'Marked fixed in Telegram.'},route.completedBy,route.completedAt);
  }
  state.active=state.active.filter(id=>id!==incident.id && state.custom[id]?.groupedUnder!==incident.id);
  notification(state,incident.id,`Fixed in Telegram · ${incident.title}`,'Completion time recorded. Add the reviewed resolution when ready.');
}

async function syncReportEvents() {
  if (!location.protocol.startsWith('http')) return;
  if (reportSyncBusy) {
    reportSyncAt=0;
    return;
  }
  reportSyncBusy=true;
  reportSyncAt=Date.now()+8000;
  try {
    const sent=[];
    for (const [key,job] of Object.entries(workspace.reportOutbox).slice(0,5)) {
      await deliveryApi('telegram-complete',job,AbortSignal.timeout(8000));
      sent.push(key);
    }
    const result=await deliveryApi('telegram-report-events',undefined,AbortSignal.timeout(6000));
    if (!Array.isArray(result.events)) return;
    if (sent.length || JSON.stringify(result.events)!==JSON.stringify(workspace.telegramWork)) {
      await update(state=>{
        state.telegramWork=result.events;
        sent.forEach(key=>delete state.reportOutbox[key]);
        for (const route of result.events) applyTelegramCompletion(state,route);
      });
    }
  } catch {
    // The local report remains available while Telegram reconnects.
  } finally { reportSyncBusy=false; }
}

function saveResolution(state,id,fields,who,now) {
  const incident = byId(id,state);
  if (!incident || incident.triggeredAt===null || incident.groupedUnder) throw Error('Open the active incident to save its resolution.');
  const reviewed = validateReviewedResolution(fields);
  if (reviewed.runbook && !documents.some(item=>item.id===reviewed.runbook && item.service===incident.service)) {
    throw Error('Choose a runbook for this service.');
  }
  const custom = state.custom[id];
  const timing = incidentWork(incident,state);
  const previous = state.workHistory[timing.key];
  const closedAt = previous?.closedAt || now;
  const closedBy = previous?.closedBy || who;
  const level = custom && Object.hasOwn(simulationSeverities,fields.level) ? fields.level : incidentPriority(incident,state);
  recordPriority(state,id,incidentPriority(incident,state),level,String(fields.priorityReason || 'Recorded at incident closure.').trim(),who,now);
  state.resolutions[id] = {...reviewed,id,title:incident.title,service:incident.service,company:incident.company,
    fingerprint:incident.fingerprint,priority:level,responder:closedBy,resolvedAt:closedAt,reviewedAt:now};
  state.workHistory[timing.key] = {...timing,...previous,level,closedAt,closedBy,via:previous?.via || 'website',verified:true,fix:reviewed.fix};
  if (!previous && location.protocol.startsWith('http')) state.reportOutbox[timing.key] = {incident:id,openedAt:timing.openedAt,completedAt:closedAt,who};
  for (const record of Object.values(state.custom).filter(item=>item.id===id || item.groupedUnder===id)) {
    updateSimulation(record,{status:'resolved',level:record.id===id ? level : record.level,
      note:record.id===id ? reviewed.fix : `Resolved with ${id}.`},closedBy,now);
  }
  state.active = state.active.filter(item=>item!==id && state.custom[item]?.groupedUnder!==id);
  notification(state,id,`Resolved · ${incident.title}`,'Reviewed resolution saved to History.');
}

function deleteSimulations(state,ids) {
  const targets = new Set(ids.filter(id=>state.custom[id]));
  for (const id of targets) {
    delete state.custom[id];
    delete state.tasks[id];
    delete state.priorities[id];
    delete state.analyses[id];
    delete state.priorityHistory[id];
    delete state.resolutions[id];
    delete state.arrivals[id];
    delete state.exposure[id];
  }
  for (const [key,record] of Object.entries(state.workHistory)) {
    if (targets.has(record.incident)) {
      delete state.workHistory[key];
      delete state.reportOutbox[key];
    }
  }
  for (const record of Object.values(state.custom)) {
    if (!targets.has(record.groupedUnder)) continue;
    delete record.groupedUnder;
    if (record.status!=='resolved' && !state.active.includes(record.id)) state.active.push(record.id);
  }
  for (const key of Object.keys(state.notes)) {
    if (targets.has(key.split('/')[0])) delete state.notes[key];
  }
  state.active = state.active.filter(id=>!targets.has(id));
  state.notifications = state.notifications.filter(entry=>!targets.has(entry.id));
}

function incidentRadar(queue,severityCounts) {
  const hits = radarFilter==='all' ? queue : queue.filter(incident=>incidentPriority(incident)===radarFilter);
  const lastPage = Math.max(0,Math.ceil(hits.length/radarSpots.length)-1);
  radarPage = Math.min(lastPage,radarPage);
  const start = radarPage*radarSpots.length;
  const signals = hits.slice(start,start+radarSpots.length);
  const focusedSignal = signals.find(incident=>incident.id===selected);
  const caption = focusedSignal ? `${incidentPriority(focusedSignal)} · ${focusedSignal.title}` : 'Select a signal to open its incident.';
  const filters = [['all',queue.length],...severityCounts.map(({level,count})=>[level,count])];
  return `<section class="radar" aria-label="Incident radar">
    <div class="radar-header"><h2><span class="radar-emblem" aria-hidden="true"></span>Incident radar</h2><span class="mono">${queue.length} open</span></div>
    <div class="radar-scope" role="group" aria-label="Active incident signals">
      ${signals.map((incident,index)=>{
        const [x,y] = radarSpots[index];
        const level = incidentPriority(incident);
        const label = `${level} ${levelName(level,Boolean(workspace.custom[incident.id]))} · ${incident.title}`;
        return `<button type="button" class="radar-marker" data-radar-incident="${incident.id}" data-level="${level}"
          aria-pressed="${incident.id===selected}" aria-label="${html(label)}" style="--x:${x}%;--y:${y}%"><span aria-hidden="true"></span></button>`;
      }).join('') || '<p class="radar-empty">No signals in this view</p>'}
    </div>
    <div class="radar-filters" role="group" aria-label="Filter radar by priority">
      ${filters.map(([level,count])=>`<button type="button" data-radar-filter="${level}" data-level="${level}"
        aria-label="${level==='all'?'All priorities':level}, ${count} open" aria-pressed="${radarFilter===level}">
        ${level==='all'?'All':`<span class="radar-key" aria-hidden="true"></span>${level}`}<span class="radar-count">${count}</span></button>`).join('')}
    </div>
    <div class="radar-footer"><p data-radar-caption>${html(caption)}</p>
      ${lastPage ? `<div class="radar-pages"><button type="button" data-radar-page="-1" aria-label="Previous radar page" ${radarPage===0?'disabled':''}>‹</button>
        <span class="mono" aria-label="Radar page ${radarPage+1} of ${lastPage+1}">${radarPage+1}/${lastPage+1}</span>
        <button type="button" data-radar-page="1" aria-label="Next radar page" ${radarPage===lastPage?'disabled':''}>›</button></div>` : ''}</div>
  </section>`;
}

function describeRadarSignal(event) {
  const marker = event.target.closest('[data-radar-incident]');
  if (!marker) return;
  const incident = byId(marker.dataset.radarIncident);
  if (incident) marker.closest('.radar').querySelector('[data-radar-caption]').textContent =
    `${incidentPriority(incident)} · ${incident.title}`;
}

function desk() {
  const queue = openIncidents().sort((a,b)=>incidentPriority(a).localeCompare(incidentPriority(b)));
  const incident = byId(selected) || queue[0] || scenarios[0];
  const custom = workspace.custom[incident.id];
  const result = investigateCase(incident);
  const severityCounts = radarLevels.map(level=>({
    level,count:queue.filter(item=>incidentPriority(item)===level).length,
  }));
  const content = {brief:()=>brief(incident,result), details:()=>custom ? simulationCase(incident,result) : caseDetails(incident,result), runbook:()=>incidentRunbooks(incident,result), trace:()=>trace(result), replay:()=>replay(incident,result), compare:()=>compare(incident,result), family:()=>familyTree(incident,result)};
  return `<section class="hero intro"><div><div class="kicker">On-call desk / Brampton AI Innovator</div><h1>THE INCIDENT <em>DESK.</em></h1><p>Review alerts, follow the evidence, and get an engineer on the case.</p></div>
    ${incidentRadar(queue,severityCounts)}</section>
    <div class="stats"><div class="stat"><strong data-stat="services">${services.length}</strong><small>Services monitored</small></div><div class="stat"><strong data-stat="active">${queue.length}</strong><small>Active incidents</small></div>
    <div class="stat"><strong data-stat="urgent">${queue.filter(item=>incidentPriority(item)==='P1').length}</strong><small>Urgent incidents</small></div><div class="stat"><strong data-stat="archived">${history.length+Object.values(workspace.custom).filter(test=>test.triggeredAt!==null && test.status==='resolved').length}</strong><small>Archived incidents</small></div></div>
    <div class="desk">
      <aside class="queue"><div class="section-top"><h2>Alert queue</h2><span class="badge neutral">SIMULATION</span></div>
      <ul class="severity-chart" aria-label="Active incidents by priority">${severityCounts.map(({level,count})=>
        `<li><span class="badge ${level}">${level}</span><span class="severity-track" aria-hidden="true"><i class="${level}" style="--share:${count/(queue.length || 1)}"></i></span><strong aria-label="${count} active">${count}</strong></li>`).join('')}</ul>
      ${queue.map(item=>`<button class="queue-item ${workspace.custom[item.id] && item.triggeredAt>Date.now()-10000?'fresh-incident':''}" data-case="${item.id}" aria-pressed="${item.id===incident.id}"><span class="row"><span>${badge(incidentPriority(item))} <small>${levelName(incidentPriority(item),Boolean(workspace.custom[item.id]))}</small></span><small class="mono">${item.alert} ET</small></span><strong>${html(item.title)}</strong><small>${html(item.service)} · ${item.variant}</small></button>`).join('') || '<p class="quiet">No active incidents.</p>'}
      <div class="simulate"><div class="simulate-head"><span class="kicker">Prepared alerts</span><button class="small" data-reset>Reset prepared alerts</button></div>
      <p class="small quiet" data-auto-telegram-hint>${automaticTelegram?'Prepared alerts automatically route to Telegram when triggered.':'Prepared alerts stay in the dashboard while Telegram automation is off.'}</p>
      <div class="buttons">${scenarios.map(item=>`<button class="small" data-trigger="${item.id}">${item.variant}</button>`).join('')}</div></div></aside>
      <article class="case"><div class="case-head"><div class="case-top"><span class="case-meta">${incident.id} / ${html(incident.service)} / ${incident.alert} ET${incident.company ? ' / '+html(incident.company) : ''}</span>
      <div class="actions">${custom?.triggeredAt===null ? '' : '<button class="small" data-handoff>Draft handoff</button><button class="primary small" data-assistant>✳ Ask assistant</button>'}</div></div>
      <h2 tabindex="-1">${html(incident.title)}</h2><div class="row"><p>${badge(incidentPriority(incident))} ${custom ? testBadge+' <span class="status-chip">'+testStatus(custom)+'</span>' : `<small>${incident.variant}</small>`}
      ${cutoff === '23:59' ? '' : ' <small>· Replay through ' + snapshotLabel(cutoff) + '</small>'}</p>
      ${custom?'':`<div class="buttons"><button class="small" data-priority>Change priority</button>
        <button class="small" data-resolve-incident="${incident.id}">${workspace.active.includes(incident.id)?'Resolve':'Review resolution'}</button></div>`}</div></div>
      ${custom ? `<div class="handoff"><div class="buttons">
        ${custom.triggeredAt!==null ? `${custom.status==='reported'?'<button class="small primary" data-test-status="acknowledged">Acknowledge</button>':''}
        <button class="small" data-test-status="update">Update incident</button><button class="small" data-resolve-incident="${incident.id}">${custom.status==='resolved'?'Review resolution':'Resolve'}</button>
        ${custom.localOnly ? '' : `<button class="small" data-notify-telegram="${custom.id}">Notify in Telegram</button>${simulationTelegramStatus(custom)}`}` : ''}
        <button class="small danger" data-delete-custom="${custom.id}">${custom.triggeredAt===null?'Cancel schedule':'Delete test event'}</button></div></div>` : taskBar(incident)}
      ${custom?.triggeredAt===null ? '' : `<div class="tabs" role="group" aria-label="Incident details">${tabs.map(([key,label])=>`<button class="tab" data-tab="${key}" aria-pressed="${key===activeTab}">${label}</button>`).join('')}</div>`}
      <div class="case-content" id="case-content">${custom?.triggeredAt===null ? simulationCase(incident,result) : content[activeTab]()}</div></article>
    </div>`;
}

function layout(title, detail, content, search = false) {
  return `<section class="page intro"><div class="page-hero"><div><div class="kicker">Aurelis / Demo workspace</div><h1>${title}</h1><p>${detail}</p></div>
    ${search ? '<input id="search" type="search" aria-label="Filter records" placeholder="Filter records…">' : ''}</div>${content}</section>`;
}
function serviceList() {
  const incidents = openIncidents();
  return services.filter(service=>`${service.name} ${service.group}`.toLowerCase().includes(query)).map(service=>{
    const confirmed = incidents.find(incident=>incident.confirmed.includes(service.name));
    const possible = incidents.find(incident=>incident.possible.includes(service.name));
    const label = confirmed ? (workspace.custom[confirmed.id] ? '● Active test event' : '● Incident confirmed')
      : possible ? '◌ Possible impact' : '○ No active alert';
    return `<button data-service="${html(service.name)}"><small class="mono">${service.group}</small><strong>${html(service.name)}</strong><small>${label}</small></button>`;
  }).join('') || '<p>No services match the filter.</p>';
}
function historyList() {
  const reviewed = reviewedArchive().sort((a,b)=>b.resolvedAt-a.resolvedAt)
    .map(record=>({...record,date:formatIncidentTime(record.resolvedAt),test:Boolean(workspace.custom[record.id]),reviewed:true}));
  const resolved = Object.values(workspace.custom).filter(record=>record.triggeredAt!==null && record.status==='resolved')
    .filter(record=>!workspace.resolutions[record.id])
    .sort((a,b)=>b.updatedAt-a.updatedAt).map(record=>({...record,test:true,date:formatIncidentTime(record.updatedAt),priority:record.level}));
  return [...reviewed,...resolved,...history].filter(record=>[...Object.values(record),record.test?'test event':''].join(' ').toLowerCase().includes(query)).map(record=>
    `<li class="row"><div><span class="mono quiet">${html(record.date)} · ${record.id}</span><h3>${html(record.title)}</h3>
    <p>${html(record.service)} · ${html(record.responder || record.owner)} · ${record.reviewed ? 'Reviewed fix' : record.test ? 'Resolved test event' : record.fix ? 'Fix documented' : 'Fix missing'}</p></div>
    <div class="buttons">${badge(record.priority)} ${record.test && !record.reviewed ? `<button class="small" data-open-case="${record.id}">View incident</button>` : ref(record.id)}</div></li>`).join('') || '<li>No incidents match the filter.</li>';
}

const reportChannels = {website:'Website',telegram:'Telegram',sample:'Demo history'};

function reportData() {
  const period=reportPeriod(reportRange,reportOffset);
  const entries=mergeIncidentWork(localReportEvents(),workspace.telegramWork);
  if (includeSampleReports) entries.push(...demoReportEvents);
  const companyOptions=[...new Map(entries.map(row=>[companyKey(row.company),companyLabel(row.company)||'Unassigned'])).entries()]
    .sort((a,b)=>a[1].localeCompare(b[1]));
  const selectedCompany=reportCompany===null ? 'All companies' : companyOptions.find(([key])=>key===reportCompany)?.[1] || 'Unassigned';
  const summary=reportSummary(reportCompany===null ? entries : entries.filter(row=>companyKey(row.company)===reportCompany),period);
  const {opened,resolved,companies,repeated,buckets,mttr,timed}=summary;
  const sampleIncidents=new Set([...opened,...resolved].filter(row=>row.via==='sample').map(row=>row.key)).size;
  const metrics={period:period.label,company:selectedCompany,opened:opened.length,resolved:resolved.length,sampleIncidents,
    averageMinutes:mttr===null ? null : Math.round(mttr/60_000),timed,companies:companies.slice(0,8),
    repeated:repeated.slice(0,8),trend:buckets.map(bucket=>({name:bucket.label,opened:bucket.opened,resolved:bucket.resolved}))};
  return {period,summary,companyOptions,metrics,key:JSON.stringify(metrics)};
}

function reportInsight(report) {
  const entry=reportInsights.get(report.key);
  if (!report.metrics.opened && !report.metrics.resolved) return '<p class="quiet">There were no recorded incidents in this view.</p>';
  if (entry?.data) {
    const {overview,patterns,nextStep}=entry.data;
    return `<p class="report-ai-overview">${html(overview)}</p><div class="report-ai-details">
      <div><strong>Recurring pattern</strong><p>${html(patterns)}</p></div><div><strong>Where to look next</strong><p>${html(nextStep)}</p></div></div>`;
  }
  if (checkingGemini || connected && entry?.status!=='failed') return '<p class="quiet" role="status">Gemini is reviewing the selected report…</p>';
  const leading=report.summary.companies.find(company=>company.opened>0);
  const repeat=report.summary.repeated[0];
  return `<p class="quiet">Gemini analysis is currently unavailable.</p>
    <p>${report.metrics.opened} opened and ${report.metrics.resolved} resolved.${leading ? ' '+html(leading.name)+' recorded '+leading.opened+' opening'+(leading.opened===1?'':'s')+'.' : ''}
    ${repeat ? ' '+html(repeat.fingerprint)+' appeared '+repeat.count+' times at '+html(repeat.company)+'.' : ' No repeat signatures were recorded in this view.'}</p>
    ${connected ? '<button class="small" data-retry-report>Retry Gemini analysis</button>' : ''}`;
}

function scheduleReportInsight() {
  clearTimeout(reportInsightTimer);
  if (!connected || view()!=='reports') return;
  const report=reportData();
  if ((!report.metrics.opened && !report.metrics.resolved) || reportInsights.has(report.key)) return;
  reportInsightTimer=setTimeout(async()=>{
    if (view()!=='reports' || reportData().key!==report.key || reportInsights.has(report.key)) return;
    reportInsights.set(report.key,{status:'loading'});
    try {
      const response=await fetch('/api/report-analysis',{method:'POST',headers:{'Content-Type':'application/json'},
        body:report.key,signal:AbortSignal.timeout(15_000)});
      if (!response.ok) throw Error();
      reportInsights.set(report.key,{data:await response.json()});
    } catch {
      reportInsights.set(report.key,{status:'failed'});
    }
    if (reportInsights.size>24) reportInsights.delete(reportInsights.keys().next().value);
    if (view()==='reports' && reportData().key===report.key) {
      const panel=document.querySelector('[data-report-insight]');
      if (panel) panel.innerHTML=reportInsight(report);
    }
  },350);
}

const reportColors=['#536e4f','#8b5a84','#346c86','#b8693a','#7a7540','#7764a2','#467b7a','#a24d5a'];

function reportDonut(items,centerLabel) {
  const total=items.reduce((sum,item)=>sum+item.count,0);
  let start=0;
  const stops=items.filter(item=>item.count>0).map(item=>{
    const from=start;
    start+=item.count/total*100;
    return `${item.color} ${from}% ${start}%`;
  }).join(',');
  return `<div class="report-donut" style="--donut:${total ? `conic-gradient(${stops})` : 'var(--rule)'}"
    role="img" aria-label="${html(centerLabel)} · ${total} total"><div><strong>${total}</strong><span>${html(centerLabel)}</span></div></div>`;
}

function reports() {
  const report=reportData();
  const {period,companyOptions}=report;
  const {opened,resolved,people,buckets,mttr,timed,companies,repeated}=report.summary;
  const chartMax=Math.max(1,...buckets.flatMap(bucket=>[bucket.opened,bucket.resolved]));
  const responderMax=Math.max(1,...people.map(person=>person.count));
  const reportKeys={week:'Weekly',month:'Monthly',year:'Yearly'};
  const channelCounts=Object.entries(reportChannels).map(([key,label],index)=>({key,label,count:resolved.filter(row=>row.via===key).length,color:[reportColors[1],reportColors[2],reportColors[3]][index]}));
  const companySlices=companies.map((company,index)=>({...company,count:company.opened,color:reportColors[index%reportColors.length]}));
  const repeatMax=Math.max(1,...repeated.map(item=>item.count));
  return layout('Reports.','Track what came in, what got fixed, and how long the response took.',`
    <section class="report-controls panel">
      <div class="buttons" role="group" aria-label="Report frequency">${Object.entries(reportKeys).map(([key,label])=>
        `<button class="small" data-report-range="${key}" aria-pressed="${key===reportRange}">${label}</button>`).join('')}</div>
      <div class="report-date"><button class="small" data-report-offset="-1" aria-label="Previous report period">←</button>
        <strong>${period.label}</strong><button class="small" data-report-offset="1" aria-label="Next report period" ${reportOffset===0?'disabled':''}>→</button></div>
      <label class="small">Company<select id="report-company">${options([['','All companies'],...companyOptions.map(([key,name])=>['company:'+key,name])],
        reportCompany===null ? '' : 'company:'+reportCompany)}</select></label>
      <label class="small"><input type="checkbox" id="report-samples" ${includeSampleReports?'checked':''}> Include demo history</label>
    </section>
    <div class="report-kpis">
      <section class="panel report-kpi"><div class="kicker">Incidents opened</div><strong>${opened.length}</strong><small>Alert arrived during this period</small></section>
      <section class="panel report-kpi"><div class="kicker">Incidents resolved</div><strong>${resolved.length}</strong><small>Fix recorded during this period</small></section>
      <section class="panel report-kpi"><div class="kicker">Mean time to resolve</div><strong>${durationLabel(mttr)}</strong><small>Alert → fixed · ${timed} timed</small></section>
      <section class="panel report-kpi"><div class="kicker">Responders</div><strong>${people.length}</strong><small>People credited with a fix</small></section>
    </div>
    <div class="report-breakdown">
      <section class="panel report-distribution"><div class="row"><h2>Incidents by company</h2><small>Selected period · Eastern Time</small></div>
        <div class="report-donut-layout">${reportDonut(companySlices,'Opened')}
          <div class="report-company-list">${companySlices.map(company=>`<div class="report-company-row">
            <span class="report-dot" style="--slice-color:${company.color}" aria-hidden="true"></span>
            <strong>${html(company.name)}</strong><small>${company.opened} opened · ${company.resolved} fixed</small></div>`).join('') || '<p class="quiet">No company activity in this view.</p>'}</div>
        </div>
      </section>
      <section class="panel report-distribution"><h2>Resolution channels</h2>
        <div class="report-donut-layout">${reportDonut(channelCounts,'Resolved')}
          <div class="report-company-list">${channelCounts.map(item=>`<div class="report-company-row">
            <span class="report-dot" style="--slice-color:${item.color}" aria-hidden="true"></span><strong>${item.label}</strong><small>${item.count}</small></div>`).join('')}</div>
        </div>
      </section>
    </div>
    <section class="panel report-ai"><div class="row"><h2>AI analysis</h2><span class="badge neutral">Gemini</span></div>
      <div data-report-insight aria-live="polite">${reportInsight(report)}</div></section>
    <div class="report-overview">
      <section class="panel report-activity"><div class="row"><div><h2>Incident activity</h2><p class="quiet">Openings and resolutions across the period.</p></div>
        <div class="report-legend"><span data-report-series="opened">Opened</span><span data-report-series="closed">Resolved</span></div></div>
        <div class="report-chart-scroll"><ol class="report-chart" style="--bucket-count:${buckets.length}" aria-label="Incident activity by date">
          ${buckets.map(bucket=>`<li aria-label="${bucket.label}, ${bucket.opened} opened, ${bucket.resolved} resolved">
            <div class="report-column" aria-hidden="true">
              <span data-report-series="opened" style="--bar-height:${bucket.opened/chartMax*100}%"><b>${bucket.opened || ''}</b></span>
              <span data-report-series="closed" style="--bar-height:${bucket.resolved/chartMax*100}%"><b>${bucket.resolved || ''}</b></span>
            </div><small>${bucket.label}</small></li>`).join('')}
        </ol></div>
      </section>
      <section class="panel report-repeats"><h2>Repeated issues</h2><p class="quiet">The same error code on the same service and company.</p>
        <ol class="report-repeat-list">${repeated.map(issue=>`<li>
          <div class="row"><strong class="mono">${html(issue.fingerprint)}</strong><span class="badge neutral">${issue.count} incidents</span></div>
          <small>${html(issue.company)} · ${html(issue.service)}</small>
          <div class="report-person-bar" aria-hidden="true"><i style="width:${issue.count/repeatMax*100}%"></i></div></li>`).join('') || '<li>No repeated signatures recorded in this view.</li>'}</ol>
      </section>
    </div>
    <section class="panel report-responders"><h2>Responder workload</h2>
      <p class="quiet">Work time runs from acceptance to completion when the same responder recorded both events.</p>
      <ol class="report-people">${people.map(person=>`<li><strong>${html(person.name)}</strong>
        <div class="report-person-bar" aria-hidden="true"><i style="width:${person.count/responderMax*100}%"></i></div>
        <span>${person.count} fixed</span><span><strong>${durationLabel(person.average)}</strong> avg · ${person.timed} timed</span></li>`).join('') || '<li>No responders recorded for this period.</li>'}</ol>
    </section>
    <section class="panel report-log"><h2>Resolution log</h2>
    ${resolved.length ? `<div class="report-table-scroll" role="region" aria-label="Resolution log table" tabindex="0"><table>
      <thead><tr><th scope="col">Incident</th><th scope="col">Fixed by</th><th scope="col">Fixed at (ET)</th><th scope="col">Alert → fix</th><th scope="col">Accepted → fix</th><th scope="col">Recorded in</th></tr></thead>
      <tbody>${resolved.map(row=>{
        const matchingPerson=row.acceptedBy?.toLowerCase()===row.closedBy?.toLowerCase();
        const elapsed=matchingPerson && Number.isFinite(row.acceptedAt) && row.acceptedAt>=row.openedAt ? row.closedAt-row.acceptedAt : null;
        return `<tr><td>${row.via!=='sample' && byId(row.incident) ? `<button class="small" data-open-case="${html(row.incident)}">${html(row.title)}</button>` : `<strong>${html(row.title)}</strong>`}
          <small>${html(row.incident)} · ${html(row.service)} · ${html(companyLabel(row.company) || 'Unassigned')}</small>${row.fix ? `<small class="report-fix">${html(row.fix)}</small>` : ''}</td><td>${html(row.closedBy || 'Responder unknown')}</td>
          <td>${html(formatIncidentTime(row.closedAt))}</td><td>${durationLabel(row.closedAt-row.openedAt)}</td><td>${durationLabel(elapsed)}</td>
          <td>${html(reportChannels[row.via])}${row.verified ? '<small>Reviewed resolution</small>' : ''}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="quiet">No resolutions recorded for this period.</p>'}</section>`);
}
function documentList() {
  return documents.filter(document=>[document.id,document.title,document.service,document.kind,document.useWhen,document.incident].join(' ').toLowerCase().includes(query)).map(document=>`
    <li class="row"><div><span class="mono quiet">${html(document.id)} · ${html(document.kind)}</span><h3>${html(document.title)}</h3><p>${html(document.service)} · ${html(document.owner)}</p></div>${documentLink(document)}</li>
  `).join('') || '<li>No procedures match the filter.</li>';
}
function calendar() {
  const recent = scenarios.flatMap(incident=>incident.events.filter(event=>['Change','Maintenance'].includes(event.kind)).map(event=>({...event,service:incident.service}))).sort((a,b)=>b.time.localeCompare(a.time));
  const monthCodes = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dayFormat = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'});
  const simulated = Object.values(workspace.custom).map(record=>{
    const timestamp = record.triggeredAt ?? record.scheduledAt;
    const date = Object.fromEntries(dayFormat.formatToParts(timestamp).map(part=>[part.type,part.value]));
    return {...record,month:Number(date.year)*12+Number(date.month)-1,day:Number(date.day),
      date:formatIncidentTime(timestamp),kind:record.triggeredAt===null?'Scheduled test event':'Test event',test:true};
  });
  const records = [
    ...history.map(record=>({...record,kind:'Archived incident'})),
    ...recent.map(record=>({...record,date:'Nov 21'})),
    ...upcoming,
  ].map(record=>({...record,month:2026*12+monthCodes.indexOf(record.date.slice(0,3)),day:Number(record.date.slice(4))}));
  const year = Math.floor(calendarMonth/12);
  const month = calendarMonth%12;
  const monthTitle = value=>new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(Date.UTC(Math.floor(value/12),value%12,1)));
  const monthName = monthTitle(calendarMonth);
  const visible = [...records,...simulated].filter(record=>record.month===calendarMonth);
  const byDay = day => visible.filter(record=>record.day===day);
  const firstDay = new Date(Date.UTC(year,month,1)).getUTCDay();
  const days = new Date(Date.UTC(year,month+1,0)).getUTCDate();
  const grid = Array.from({length:days},(_,index)=>{
    const day = index+1;
    const count = byDay(day).length;
    return `<button data-calendar-day="${day}" aria-pressed="${day===calendarDay}" aria-label="${monthName} ${day}, ${count} records">${day}${count ? `<span class="calendar-count">${count}</span>` : ''}</button>`;
  }).join('');
  const items = (calendarDay ? byDay(calendarDay) : visible).sort((a,b)=>a.day-b.day || (a.time || '').localeCompare(b.time || ''))
    .map(record=>`<li class="row"><div><span class="mono">${html(record.date)}${record.time ? ' · ' + record.time + ' ET' : ''}</span><br><strong>${html(record.title)}</strong><br>
    <small>${html(record.service)} · ${html(record.kind)}</small></div>${record.test ? `<button class="small" data-open-case="${record.id}">View incident</button>` : record.id ? ref(record.id) : ''}</li>`).join('');
  const months = [...new Set([calendarMonth,calendarMonth-1,calendarMonth+1,...records.map(record=>record.month),...simulated.map(record=>record.month)])].sort((a,b)=>a-b);
  return layout('Change calendar.','Browse changes, incident history, and upcoming test events.',`<div class="duo">
    <section class="panel"><div class="row"><h2>${monthName}</h2><label><span class="sr-only">Calendar month</span><select id="calendar-month">${options(months.map(value=>[value,monthTitle(value)]),calendarMonth)}</select></label></div>
    <div class="calendar-grid" role="group" aria-label="${monthName} dates">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=>`<small>${day}</small>`).join('')}${'<span></span>'.repeat(firstDay)}${grid}</div></section>
    <section class="panel"><div class="row"><h2>${calendarDay ? 'Day ' + calendarDay : 'Month agenda'}</h2>${calendarDay ? '<button class="small" data-calendar-all>Show month</button>' : ''}</div><ul class="archive">${items || '<li>No records on this date.</li>'}</ul></section></div>`);
}
function chat() {
  const records = workspace.messages.map(message=>{
    const incident = byId(message.id);
    if (!incident) return '';
    const available = workspace.tasks[message.id]?.status === 'open';
    const time = new Date(message.time).toLocaleTimeString('en-CA',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit'});
    return `<li><small class="mono">${html(time)} ET · ${message.type === 'open' ? 'A U R E L I S / @TEAM' : 'OWNERSHIP CONFIRMED'}</small>
      ${message.type === 'open' ? `<h3>Unclaimed at escalation: ${incident.title}</h3><p>${html(message.reason)} · ${incident.id} · P1 · ${incident.service}</p>` : `<p><strong>${html(message.by)}</strong> accepted ${message.id}.</p>`}
      <div class="buttons"><button data-open-case="${incident.id}" class="small">Open incident</button>
      ${message.type === 'open' && available ? `<button class="small primary" data-task="claim" data-id="${incident.id}">Claim as ${html(actor)}</button>` : ''}</div></li>`;
  }).join('');
  return layout('# General.','Simulated team chat. Switch teammates at the top to test the handoff.',`<ul class="channel">${records || '<li>No escalations. Page an engineer from the urgent incident to try it.</li>'}</ul>`);
}

function alertCards(incidents = openIncidents()) {
  const sorted = [...incidents].sort((a,b)=>alertSort==='recent'
    ? (b.triggeredAt ?? Date.parse('2026-11-21T'+b.alert+'-05:00'))-(a.triggeredAt ?? Date.parse('2026-11-21T'+a.alert+'-05:00'))
    : incidentPriority(a).localeCompare(incidentPriority(b)));
  return sorted.filter(item=>(alertFilter==='all' || incidentPriority(item)===alertFilter)
    && [item.title,item.service,item.id,item.category,item.type,item.variant].join(' ').toLowerCase().includes(alertQuery)).map(incident=>{
    const level=incidentPriority(incident);
    const custom = workspace.custom[incident.id];
    const alerts=incident.events.filter(event=>event.kind==='Alert');
    const task=workspace.tasks[incident.id];
    const status=custom ? testStatus(custom) : task?.status==='claimed' ? 'Accepted by ' + task.by : task?.status==='open' ? 'Waiting for a team claim'
      : task?.status==='pending' ? 'Waiting for acknowledgement' : 'Needs review';
    return `<li class="alert-card ${level}"><div class="row"><div class="buttons"><span class="badge ${level}">${level} · ${levelName(level,Boolean(custom))}</span>${custom?testBadge:''}</div><small class="mono">${incident.id} · ${incident.alert} ET</small></div>
      <h2>${html(incident.title)}</h2><p>${html(incident.service)} · ${custom ? html(incident.type) : incident.affectedPct+'% affected in sample'}</p>
      <div class="references alert-sources" aria-label="Source alerts">${alerts.map(event=>ref(event.id)).join('')}</div>
      <div class="row"><small>${html(status)}</small><div class="buttons"><button class="small" data-open-case="${incident.id}">Open incident</button>
      <button class="small" data-notify-telegram="${incident.id}">Notify in Telegram</button>
      ${custom ? '' : `<button class="small" data-route-incident="${incident.id}">Route in Telegram</button><button class="small" data-deliver="${incident.id}">Review delivery</button>`}</div></div></li>`;
  }).join('') || '<li>No alerts match these filters.</li>';
}

function alertInbox() {
  const incidents = openIncidents();
  const stats = [['all','All alerts'],['P1','P1 Critical'],['P2','P2 High'],['P3','P3 Medium / Monitor'],['P4','P4 Low']].map(([level,label])=>
    `<button class="small" aria-pressed="${alertFilter===level}" data-alert-filter="${level}">${label} (${level==='all' ? incidents.length : incidents.filter(item=>incidentPriority(item)===level).length})</button>`
  ).join('');
  return layout('Alert inbox.','Review alerts by urgency, open their evidence, and preview outgoing messages.',`
    <div class="row"><div class="buttons" role="group" aria-label="Filter by urgency">${stats}</div><div class="buttons"><span class="badge neutral" data-auto-telegram-badge>Telegram auto: ${automaticTelegram?'on':'off'}</span><button class="small" data-notify-telegram="">Send Telegram notification</button><button class="small" data-telegram-routing>Telegram routing</button><button class="small" data-channels>Delivery setup</button></div></div>
    <div class="alert-tools"><label>Find alerts<input id="alert-search" type="search" placeholder="Title, service, category…" value="${html(alertQuery)}"></label>
    <label>Sort alerts<select id="alert-sort">${options([['severity','Severity'],['recent','Most recent']],alertSort)}</select></label></div>
    <ul class="alert-list" id="alert-list">${alertCards(incidents)}</ul>`);
}

function render() {
  const page = view();
  const focused = document.activeElement;
  const focusKeys = focused && main.contains(focused) ? [...focused.attributes].filter(attribute=>attribute.name.startsWith('data-')) : [];
  const focusedId = main.contains(focused) && focused.id;
  const previousStats = new Map([...main.querySelectorAll('[data-stat]')].map(item=>[item.dataset.stat,Number(item.textContent)]));
  const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pageChanged = page!==renderedPage;
  const openingElapsed = workspaceEntrance ? performance.now() - workspaceEntrance.startedAt : Infinity;
  const continuingEntrance = animate && !pageChanged && workspaceEntrance && openingElapsed<workspaceEntrance.duration;
  const queuePositions = animate && !continuingEntrance && page===renderedPage && page==='desk'
    ? new Map([...main.querySelectorAll('.queue-item')].slice(0,12).map(item=>[item.dataset.case,item.getBoundingClientRect().top]))
    : new Map();
  const content = {
    desk, calendar, chat, simulator, reports, alerts:alertInbox,
    services:()=>layout('Service inventory.','The 30 fictional cloud services in this workspace.',`<div class="service-grid" id="list">${serviceList()}</div>`,true),
    history:()=>layout('Incident archive.','Compare previous causes, owners, priorities and documented fixes.',`<ul class="archive" id="list">${historyList()}</ul>`,true),
    runbooks:()=>layout('Runbook library.','Search the sample database for service procedures, recovery checks, and investigation guides.',`<ul class="archive" id="list">${documentList()}</ul>`,true)
  };
  main.innerHTML = content[page]();
  scheduleReportInsight();
  if (pageChanged) {
    const initial = renderedPage===undefined;
    workspaceEntrance = undefined;
    if (animate) {
      workspaceEntrance = {...entranceTimings[initial?'startup':'menu'],initial,startedAt:performance.now()};
      playWorkspaceEntrance(page,workspaceEntrance);
    }
    renderedPage = page;
    observeSectionReveals(animate);
  } else if (continuingEntrance) {
    playWorkspaceEntrance(page,workspaceEntrance,openingElapsed);
    observeSectionReveals(animate);
  } else {
    revealObserver?.disconnect();
  }
  if (queuePositions.size) {
    const shifts = [...main.querySelectorAll('.queue-item')].slice(0,12).map(item=>({
      item,distance:queuePositions.get(item.dataset.case)-item.getBoundingClientRect().top,
    }));
    for (const {item,distance} of shifts) {
      if (Number.isFinite(distance) && Math.abs(distance)>2) {
        item.animate([{transform:`translateY(${distance}px)`},{transform:'translateY(0)'}],{
          duration:230,easing:'cubic-bezier(.2,.75,.25,1)'
        });
      }
    }
  }
  for (const item of main.querySelectorAll('[data-stat]')) {
    const previous = previousStats.get(item.dataset.stat);
    if (previous!==undefined && previous!==Number(item.textContent)) item.classList.add('stat-updated');
  }
  document.querySelectorAll('[data-view]').forEach(link=> {
    if (link.dataset.view === page) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  const count = workspace.active.filter(id=>workspace.tasks[id]?.status==='open').length;
  const countLabel = document.querySelector('#chat-count');
  countLabel.hidden = !count;
  countLabel.textContent = count;
  const unread = workspace.notifications.filter(entry=>!entry.read).length;
  const unreadBadge = document.querySelector('#notification-count');
  unreadBadge.hidden = !unread;
  unreadBadge.textContent = unread>99 ? '99+' : unread;
  document.querySelector('#notifications').setAttribute('aria-label',unread ? `Notifications, ${unread} unread` : 'Notifications');
  if (notificationPanel && dialog.open) refreshNotificationHistory();
  const search = document.querySelector('#search');
  if (search) search.value = query;
  if (focusKeys.length) {
    const selector = focusKeys.map(key=>`[${key.name}="${CSS.escape(key.value)}"]`).join('');
    main.querySelector(selector)?.focus({preventScroll:true});
  } else if (focusedId) {
    document.getElementById(focusedId)?.focus({preventScroll:true});
  } else if (page==='simulator' && focused?.name && focused.closest('#simulation-form')) {
    document.querySelector('#simulation-form').elements.namedItem(focused.name)?.focus({preventScroll:true});
  }
}

function playWorkspaceEntrance(page,entrance,elapsed=0) {
  const surfaces = page==='desk' ? [
    ['.hero > div:first-child',94], ['.hero > .radar',158], ['.stats > .stat',220,48],
    ['.desk > .queue',400], ['.desk > .case',510],
  ] : [
    ['.page-hero',94], ['.page > .row, .simulation-banner, .template-section > h2, .alert-tools',174,54],
    ['.template-grid > li, .alert-list > li, .service-grid > *, .page > .archive > li, .page > .channel > li',277,46],
    ['.simulator-grid > .panel, .page > .duo > .panel',485,70],
  ];
  const viewportBottom = window.innerHeight;
  const lastStage = 560;
  if (entrance.initial) surfaces.push(['.frame > footer',lastStage]);
  const entrances = surfaces.flatMap(([selector,stage,step=0])=>
    [...document.querySelectorAll(selector)].slice(0,12).map((element,index)=>({
      element,stage:Math.min(lastStage,stage+index*step),
    }))
  ).filter(({element})=>{
    const bounds = element.getBoundingClientRect();
    return bounds.height>0 && bounds.bottom>0 && bounds.top<viewportBottom;
  });
  if (!entrances.length) return;
  entrance.firstStage ??= Math.min(...entrances.map(item=>item.stage));
  entrance.lastStage ??= Math.max(...entrances.map(item=>item.stage));
  const {duration,motion,lead,firstStage,lastStage:finalStage} = entrance;
  const range = finalStage - firstStage;
  const elementDuration = range ? motion : duration-lead;
  for (const {element,stage} of entrances) {
    if (elapsed && !main.contains(element)) continue;
    const progress = range ? (Math.min(finalStage,Math.max(firstStage,stage))-firstStage)/range : 0;
    const delay = lead + Math.round((duration-elementDuration-lead)*progress);
    if (elapsed>=delay+elementDuration) continue;
    element.style.setProperty('--opening-delay',`${delay-elapsed}ms`);
    element.style.setProperty('--opening-duration',`${elementDuration}ms`);
    element.classList.add('workspace-arrival');
  }
}

function observeSectionReveals(animate) {
  revealObserver?.disconnect();
  if (!animate || !('IntersectionObserver' in window)) return;
  revealObserver = new IntersectionObserver((entries,observer)=>{
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.remove('awaiting-reveal');
      entry.target.classList.add('section-revealed');
      observer.unobserve(entry.target);
    }
  },{rootMargin:'0px 0px 28px'});
  const panels = '.desk > .queue,.desk > .case,.simulator-grid > .panel,.page > .duo > .panel';
  const belowFold = [...main.querySelectorAll(panels+',.template-card,.alert-card,.service-grid button')]
    .filter(element=>element.getBoundingClientRect().top>window.innerHeight+60);
  for (const element of belowFold) {
    element.classList.add('awaiting-reveal');
    revealObserver.observe(element);
  }
}

function choose(id) {
  if (assistantWindow.open) assistantWindow.close();
  selected = id;
  activeTab = 'brief';
  cutoff = '23:59';
}
function openDialog(kicker,title,content) {
  notificationPanel = null;
  dialog.innerHTML = `<div class="dialog-head"><div><div class="kicker">${html(kicker)}</div><h2 id="dialog-title">${html(title)}</h2></div><button data-close aria-label="Close dialog">✕</button></div><div class="dialog-body">${content}</div>`;
  if (!dialog.open) dialog.showModal();
  else dialog.querySelector('[data-close]').focus({preventScroll:true});
}
function source(id) {
  const document = documents.find(item=>item.id===id);
  if (document) {
    openDialog(document.kind + ' / ' + id,document.title,`
      <p><small>${html(document.service)} · Owner: ${html(document.owner)} · Updated ${html(document.updated)} · Sample database</small></p>
      <p><strong>When to use it</strong><br>${html(document.useWhen)}</p>
      <ol class="archive">${document.steps.map(([title,step])=>`<li><strong>${html(title)}</strong><p>${html(step)}</p></li>`).join('')}</ol>
      <p><strong>When to pause</strong><br>${html(document.stopWhen)}</p>
      <p><strong>How to verify recovery</strong><br>${html(document.verify)}</p>
      ${document.incident ? `<p>Linked incident ${ref(document.incident)}</p>` : ''}
      ${freshnessPanel(document,byId(selected)?.service===document.service ? byId(selected).serviceVersion : undefined)}`);
    return;
  }
  const record = reviewedArchive().find(item=>item.id===id) || history.find(item=>item.id===id);
  if (record) {
    const procedure = documents.find(item=>item.incident===record.id || item.id===record.runbook);
    openDialog('Incident archive / ' + id,record.title,`<p>${html(record.service)} · ${html(record.resolvedAt ? formatIncidentTime(record.resolvedAt) : record.date)} · ${record.priority} · ${html(record.responder)}</p>
      <p><strong>Prior cause</strong><br>${html(record.cause)}</p><p><strong>Documented resolution</strong><br>${html(record.fix || 'No resolution steps recorded.')}</p>
      ${record.verification ? `<p><strong>Recovery verification</strong><br>${html(record.verification)}</p>` : ''}
      ${record.version ? `<p><strong>Verified service version</strong> · ${html(record.version)}</p>` : ''}
      ${record.resolvedAt ? `<button class="small" data-open-case="${html(record.id)}">Open incident</button>` : ''}
      ${procedure ? `<div class="block">${documentLink(procedure)}</div>` : '<p class="quiet">No runbook is linked to this archive record.</p>'}`);
    return;
  }
  const event = byId(selected)?.events.find(item=>item.id===id) ||
    [...scenarios,...Object.values(workspace.custom).map(asInvestigation)].flatMap(item=>item.events).find(item=>item.id===id);
  if (event) openDialog(event.kind + ' / ' + id,event.title,`<p>${html(event.detail)}</p>
    <p class="mono">Occurred ${snapshotLabel(event.timeAt ?? event.time)} · Available ${snapshotLabel(event.seenAt ?? event.seen)}</p>`);
}
function draft() {
  const incident = byId(selected);
  const result = investigateCase(incident);
  if (!result.observed) {
    openDialog('Draft handoff',incident.title,'<p>No incident brief exists at this point in the replay.</p>');
    return;
  }
  const note = [
    `${incident.id} · ${incident.title} · ${incidentPriority(incident)}`,
    `Owner: ${workspace.tasks[incident.id]?.by || 'Not confirmed'}`,
    workspace.custom[incident.id] && 'Test event · Submitted symptoms: ' + incident.description,
    `Working hypothesis: ${result.cause}`,
    `Evidence: ${result.causeSources.join(', ')}`,
    result.alternative && `Alternative: ${incident.alternative} [${result.alternative.id}]`,
    `Next check: ${result.next}`,
    result.guide && `Documentation: ${result.guide.id} · ${result.guide.title}`,
    `Recovery check: ${result.verify}`,
    'Confirmed cause and actual resolution: [Engineer to complete]'
  ].filter(Boolean).join('\n');
  const draftKey = incident.id + '/' + cutoff;
  const saved = workspace.notes?.[draftKey];
  openDialog('Draft handoff',incident.title,`<label for="draft-note">Review and add what the engineer confirmed</label><textarea id="draft-note" maxlength="2500" rows="11">${html(saved ?? note)}</textarea>
    <div class="buttons"><button class="small primary" data-save-note="${draftKey}">Save draft</button><button class="small" data-copy>Copy draft</button></div>`);
}

function showNotifications() {
  openDialog('Incident desk','Notifications',`
    <div class="tabs notification-tabs" role="group" aria-label="Notification views">
      <button class="tab" data-notification-panel="history" aria-pressed="true" aria-controls="notification-history-panel">Activity</button>
      <button class="tab" data-notification-panel="accepted" aria-pressed="false" aria-controls="notification-accepted-panel">Accepted</button>
    </div>
    <section id="notification-history-panel" aria-label="Notification activity">
      <div class="notification-toolbar row">
        <span class="quiet small" data-unread-summary></span><div class="buttons">
        <button class="small" data-mark-all>Mark all as read</button>
        <button class="small" data-toggle-sound aria-pressed="${sound}">Sound ${sound?'on':'off'}</button></div></div>
      <ul class="notification-history" data-notification-history></ul>
    </section>
    <section id="notification-accepted-panel" aria-label="Accepted requests" hidden>
      <ul class="notification-history" data-accepted-requests></ul>
    </section>`);
  notificationPanel = 'history';
  refreshNotificationHistory();
}

function refreshAcceptedRequests() {
  const list = dialog.querySelector('[data-accepted-requests]');
  const focused = document.activeElement;
  const focusAttribute = focused?.hasAttribute('data-open-case') ? 'data-open-case' : 'data-resolve-incident';
  const focusId = list.contains(focused) && focused.getAttribute(focusAttribute);
  const requests = acceptedIncidentWork(localReportEvents(),workspace.telegramWork);
  list.innerHTML = requests.flatMap(request=>{
    const incident = byId(request.incident);
    if (!incident || incident.triggeredAt===null || incident.groupedUnder) return [];
    const id = html(request.incident);
    const level = incidentPriority(incident);
    const acceptedOn = request.acceptedAt ? ` · ${html(formatIncidentTime(request.acceptedAt))}` : '';
    return `<li class="notification-record accepted-request">
      <div class="row"><span class="badge ${level}">${levelName(level,Boolean(workspace.custom[request.incident]))}</span>
        <span class="badge neutral">${request.closedAt ? 'Report needed' : 'In progress'}</span></div>
      <strong>${html(incident.title)}</strong>
      <small class="quiet">${id} · ${html(incident.service)}<br>Accepted by ${html(request.acceptedBy)}${acceptedOn}</small>
      <div class="buttons"><button class="small" data-open-case="${id}">View incident</button>
        <button class="small primary" data-resolve-incident="${id}">Write report</button></div>
    </li>`;
  }).join('') || '<li class="quiet">No accepted requests need a report. Incidents accepted here or in Telegram will appear here.</li>';
  if (focusId) {
    (list.querySelector(`[${focusAttribute}="${CSS.escape(focusId)}"]`) ||
      dialog.querySelector('[data-notification-panel="accepted"]')).focus({preventScroll:true});
  }
}

function refreshNotificationHistory() {
  const list = dialog.querySelector('[data-notification-history]');
  if (!list) return;
  const accepted = notificationPanel==='accepted';
  dialog.querySelector('#notification-history-panel').hidden = accepted;
  dialog.querySelector('#notification-accepted-panel').hidden = !accepted;
  for (const tab of dialog.querySelectorAll('[data-notification-panel]')) {
    tab.setAttribute('aria-pressed',String(tab.dataset.notificationPanel===notificationPanel));
  }
  if (accepted) {
    refreshAcceptedRequests();
    return;
  }
  const expanded = new Set([...list.querySelectorAll('details[open]')].map(detail=>detail.dataset.noticeKey));
  const focused = document.activeElement;
  const focusKey = focused?.dataset?.markNotice || focused?.closest('[data-notice-key]')?.dataset.noticeKey;
  const unread = workspace.notifications.filter(entry=>!entry.read).length;
  dialog.querySelector('[data-unread-summary]').textContent = unread ? `${unread} unread` : 'You’re caught up';
  dialog.querySelector('[data-mark-all]').disabled = !unread;
  list.innerHTML = workspace.notifications.map(entry=>{
    const level = Object.hasOwn(simulationSeverities,entry.level) ? entry.level : incidentPriority(byId(entry.id));
    return `<li class="notification-record ${level} ${entry.read?'':'unread'}">
      <details data-notice-key="${html(entry.key)}" ${expanded.has(entry.key)?'open':''}>
        <summary><span class="badge ${level}">${levelName(level,entry.test)}</span><strong>${html(entry.title)}</strong>
        <small>${entry.read?'Read':'Unread'}${entry.test?' · Test event':''}</small></summary>
        <p>${html(entry.description)}</p><p class="small quiet">${html(formatIncidentTime(entry.time))}</p><div class="buttons">
          ${byId(entry.id)?`<button class="small" data-open-case="${html(entry.id)}" data-read-notice="${html(entry.key)}">View incident</button>`:''}
          ${entry.read?'':`<button class="small" data-mark-notice="${html(entry.key)}">Mark as read</button>`}
        </div>
      </details></li>`;
  }).join('') || '<li>No notifications yet. Run a simulation to see one here.</li>';
  if (focusKey) list.querySelector(`[data-notice-key="${CSS.escape(focusKey)}"] summary`)?.focus({preventScroll:true});
  else if (focused?.matches('[data-mark-all]') && !unread) dialog.querySelector('[data-toggle-sound]').focus({preventScroll:true});
}

function markNotices(key) {
  return update(state=>{
    for (const entry of state.notifications) {
      if (!key || entry.key===key) entry.read = true;
    }
  });
}

async function toggleSound(button) {
  try {
    if (!sound) {
      audio ||= new AudioContext();
      await audio.resume();
    }
    sound = !sound;
    localStorage.setItem('ic-notification-sound',String(sound));
    if (button.isConnected) {
      button.textContent = sound ? 'Sound on' : 'Sound off';
      button.setAttribute('aria-pressed',String(sound));
    }
    if (sound) notificationSound(false);
  } catch {
    if (button.isConnected) button.textContent = 'Sound unavailable';
  }
}

async function deliveryApi(action,payload,signal) {
  if (!location.protocol.startsWith('http')) throw Error('Start the local server to configure or preview external delivery.');
  const options=payload ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)} : {};
  const response=await fetch('/api/alerts/'+action,{...options,signal});
  const data=await response.json();
  if (!response.ok) throw Object.assign(Error(data.error || 'Delivery service unavailable.'),{status:response.status});
  return data;
}

function deliveryLog(entries) {
  if (!entries?.length) return '<p class="quiet">No recent provider submissions.</p>';
  const states={queued:'Queued',sending:'Sending',accepted:'Accepted by provider',rejected:'Rejected by provider',unknown:'Outcome unknown',duplicate:'Recently submitted'};
  return `<ul class="archive">${entries.map(entry=>`<li><div class="row"><strong>${html(channelSetup[entry.channel].name)} · ${html(entry.destination)}</strong><span class="badge neutral">${states[entry.status]}</span></div>
    <small>${html(entry.incident || '')} ${html(entry.level || '')}${entry.http ? ' · HTTP ' + entry.http : ''}</small>
    ${entry.detail ? `<p class="small">${html(entry.detail)}</p>` : ''}
    ${entry.incident ? `<button class="small delivery-open" data-open-case="${html(entry.incident)}">Open incident</button>` : ''}</li>`).join('')}</ul>`;
}

function deliveryError(error) {
  const status=dialog.querySelector('[data-delivery-status]');
  if (status) status.textContent=error.message.startsWith('Unexpected') ? 'The local delivery service could not respond.' : error.message;
}

async function showChannels() {
  deliveryPreview=undefined;
  openDialog('Alert delivery','Delivery setup','<p data-delivery-status role="status">Checking local settings…</p>');
  const target=dialog.querySelector('[data-delivery-status]');
  try {
    deliveryState=await deliveryApi('status');
    if (!dialog.open || !target.isConnected) return;
    openDialog('Alert delivery','Delivery setup',`<p>Provider settings stay on this computer. Saving them makes no external request.</p>
      <div class="delivery-channels">${Object.entries(channelSetup).map(([key,channel])=>{
        const status=deliveryState.channels[key];
        return `<section class="panel"><div class="row"><h3>${channel.name} · ${html(status.provider)}</h3>
          <span class="badge neutral">${status.configured ? 'Configured' : 'Needs setup'}</span></div>
          <p><small>${status.recipients.length ? status.recipients.map(item=>html(item.destination)).join(' · ') : 'No destination configured'}</small></p>
          <div class="buttons"><button class="small" data-provider="${key}">${status.configured ? 'Update' : 'Configure'} ${channel.name}</button>
            ${status.configured ? `<button class="small" data-check-provider="${key}">Check connection</button>` : channel.setup ? `<a class="small" target="_blank" rel="noreferrer" href="${channel.setup}">Open ${key==='telegram'?'BotFather':channel.provider}</a>` : ''}
            ${key==='telegram'?'<button class="small" data-telegram-routing>Team routing</button>':''}</div>
          ${key==='email'?`<div class="row block"><strong>Automatic email</strong><span class="badge neutral">${deliveryState.emailAutomatic?'On':'Off'}</span></div>
          <p class="small">Every new incident and confirmed Telegram alert gets an informational email copy. Respond in Telegram.</p>
          <div class="buttons"><button class="small" data-email-test="review" ${status.configured&&status.recipients.length?'':'disabled'}>Send test email</button>
            <button class="small" data-email-automatic="${deliveryState.emailAutomatic?'off':'on'}" ${deliveryState.emailAutomatic||status.configured&&status.recipients.length?'':'disabled'}>${deliveryState.emailAutomatic?'Disable':'Enable'} automatic email</button></div>`:''}
          <p class="small quiet" id="check-${key}" role="status"></p></section>`;
      }).join('')}</div><h3 class="block">Recent provider submissions</h3>${deliveryLog(deliveryState.deliveries)}`);
  } catch(error) { if (target.isConnected) deliveryError(error); }
}

const routeLabels = {
  'queued-private':'Private page queued','sending-private':'Sending private page','waiting':'Waiting for private response',
  'queued-team':'Team post queued','sending-team':'Posting to team group','open-team':'Posted to team · Awaiting claim',
  accepted:'Accepted',failed:'Delivery needs review'
};
const remainingSeconds = deadline=>Math.max(0,Math.ceil((deadline-Date.now())/1000));

function routeDetails(route) {
  const deadline=route.stage==='waiting'&&route.deadline ? `<p>Reply by <strong>${html(new Date(route.deadline).toLocaleTimeString('en-CA',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit',second:'2-digit'}))} ET</strong> · <strong class="mono" role="timer" aria-live="off" data-telegram-deadline="${route.deadline}">${remainingSeconds(route.deadline)}s</strong> remaining</p>` : '';
  const reason={critical:'Sent directly to the group because this alert is P1 Critical.',decline:'The private responder declined.',timeout:'The private response window expired.',unavailable:'Telegram did not confirm the private page.'}[route.reason];
  return `<p><strong>${html(route.stage==='completed'?'Fixed':routeLabels[route.stage])}</strong>${route.acceptedBy?' · '+html(route.acceptedBy):''} ${route.test?testBadge:''}</p>
    ${route.owner&&!route.acceptedBy&&['queued-private','sending-private','waiting'].includes(route.stage)?`<p>Responder: ${html(route.owner)}</p>`:''}${deadline}
    ${route.acceptedAt ? `<p>Accepted ${html(formatIncidentTime(route.acceptedAt))}</p>` : ''}
    ${route.completedAt ? `<p>Fixed by ${html(route.completedBy)} · ${html(formatIncidentTime(route.completedAt))}
      ${route.acceptedAt && route.acceptedAt<=route.completedAt ? ' · '+durationLabel(route.completedAt-route.acceptedAt)+' from acceptance' : ''}</p>` : ''}
    ${reason?`<p>${html(reason)}</p>`:''}${route.notice?`<p>${html(route.notice)}</p>`:''}`;
}

async function showTelegramRouting() {
  openDialog('Alert delivery','Telegram routing','<p data-delivery-status role="status">Checking routing settings…</p>');
  const anchor=dialog.querySelector('[data-delivery-status]');
  try {
    const info=await deliveryApi('telegram-routing');
    setAutomaticIndicator(info.auto.enabled);
    syncTelegramResponders(info.people);
    if(!dialog.open||!anchor.isConnected)return;
    openDialog('Alert delivery','Telegram routing',`<p><strong>P1 Critical</strong> goes directly to the team group. Lower severities page the default responder and escalate to the group if declined or unanswered.</p>
      <div class="panel"><div class="row"><h3>Automatic Telegram alerts</h3><span class="badge ${info.auto.enabled?'P2':'neutral'}">${info.auto.enabled?'On':'Off'}</span></div>
      <p>Prepared alerts and custom incidents use these settings when they fire. Scheduled incidents route when the dashboard releases them.</p>
      <form class="delivery-form" data-auto-telegram>
        <label for="automatic-responder">Default private responder</label>
        <select id="automatic-responder" name="owner">${info.people.map(person=>`<option value="${html(person.id)}" ${person.id===info.auto.owner?'selected':''}>${html(person.label)}</option>`).join('')||'<option value="">No responder paired</option>'}</select>
        <label for="automatic-wait">Response timeout</label>
        <select id="automatic-wait" name="wait">${[[30,'30 seconds'],[60,'1 minute'],[120,'2 minutes'],[300,'5 minutes']].map(([seconds,label])=>`<option value="${seconds}" ${seconds===info.auto.wait?'selected':''}>${label}</option>`).join('')}</select>
        <div class="buttons"><button class="small primary" type="submit" ${info.team&&info.people.length?'':'disabled'}>${info.auto.enabled?'Save automatic routing':'Enable automatic routing'}</button>
        ${info.auto.enabled?'<button class="small" type="button" data-disable-auto-telegram>Turn off automatic routing</button>':''}</div>
        <p data-auto-status role="status"></p></form></div>
      <div class="panel"><div class="row"><h3>Team group</h3><button class="small" data-pair-team ${info.botConnected?'':'disabled'}>${info.team?'Replace team group':'Pair team group'}</button></div>
      <p>${info.team?`${html(info.team.label)} · ${html(info.team.destination)}`:'A group is needed for escalation and critical alerts.'}</p></div>
      <div class="panel block"><div class="row"><h3>Private responders</h3><button class="small" data-pair-responder ${info.botConnected?'':'disabled'}>Pair a responder</button></div>
      ${info.people.length?`<ul class="archive">${info.people.map(person=>`<li>${html(person.label)} · ${html(person.destination)}</li>`).join('')}</ul>`:'<p>No private chats have been paired.</p>'}
      <div class="block"><h3>Shared responder link</h3><p>Share it with people in the group. When they tap <strong>Start</strong>, the bot verifies membership and adds them to the private responder list. Team alerts will include the link.</p>
      ${info.enrollment?`<p><a id="team-responder-link" href="${html(info.enrollment.url)}" target="_blank" rel="noreferrer">Open responder enrollment</a></p>
      <div class="buttons"><button class="small" type="button" data-copy-enrollment>Copy responder link</button><button class="small" type="button" data-refresh-responders>Refresh responders</button><button class="small" type="button" data-create-enrollment="reset">Replace link</button></div>`
      :`<button class="small" type="button" data-create-enrollment="new" ${info.team?'':'disabled'}>Create shared responder link</button>`}
      <p data-enrollment-status role="status"></p></div></div>
      ${info.botConnected?'':'<p>Connect the bot in Delivery setup first.</p>'}
      <section class="block"><h3>Recent routes</h3><ul class="archive">${info.routes.map(route=>`<li><div class="row"><strong>${html(route.incident)} · ${html(route.level)}</strong><button class="small" data-route-status="${html(route.id)}">Track route</button></div>${routeDetails(route)}</li>`).join('')||'<li>No routes started.</li>'}</ul></section>
      <button class="small" data-channels>Delivery setup</button>`);
  }catch(error){if(anchor.isConnected)deliveryError(error);}
}

async function updateTelegramMode(input,button) {
  const target=dialog.querySelector('[data-auto-status]');
  button.disabled=true;
  target.textContent='Saving automatic routing…';
  try {
    const result=await deliveryApi('telegram-automatic',input);
    setAutomaticIndicator(result.enabled);
    if(target.isConnected&&dialog.open)void showTelegramRouting();
  }catch(error){if(target.isConnected){target.textContent=error.message;button.disabled=false;}}
}

function setAutomaticIndicator(enabled) {
  automaticTelegram=enabled===true;
  const badge=main.querySelector('[data-auto-telegram-badge]');
  const hint=main.querySelector('[data-auto-telegram-hint]');
  const simulationHint=main.querySelector('[data-simulation-telegram-hint]');
  if(badge)badge.textContent='Telegram auto: '+(automaticTelegram?'on':'off');
  if(hint)hint.textContent=automaticTelegram?'Prepared alerts automatically route to Telegram when triggered.':'Prepared alerts stay in the dashboard while Telegram automation is off.';
  if(simulationHint)simulationHint.textContent=simulationTelegramHint();
}

function simulationTelegramHint() {
  return automaticTelegram
    ? 'Automatic Telegram is on. Triggering a test event shares its description and recommended actions with the configured responder or group.'
    : 'Test events appear in the dashboard. Enable automatic Telegram routing in Alerts to page the team when they fire.';
}

function simulationPayload(record) {
  const {title,description,service,company,status,actions}=record;
  return {title,description,service,company,status,actions};
}

function simulationTelegramStatus(record) {
  const delivery=record.telegram;
  if(!delivery) return '';
  if(delivery.route) return `<button class="small" data-route-status="${html(delivery.route)}">Track Telegram route</button>`;
  if(delivery.status==='failed') return `<small role="status">Telegram: ${html(delivery.error)}</small>`;
  return `<small role="status">${delivery.status==='pending'?'Queuing Telegram route…':'Telegram automation is off'}</small>`;
}

async function deliverSimulation(record) {
  telegramOutboxBusy=true;
  const {attempts,level,simulation}=record.telegram;
  let result;
  let failure;
  try {
    result=await deliveryApi('telegram-alert-event',{
      event:'simulation-'+record.id,incident:record.groupedUnder || record.id,level,simulation
    },AbortSignal.timeout(15_000));
  }catch(error){failure=error;}
  try {
    await update(state=>{
      const current=state.custom[record.id];
      if(current?.telegram?.status!=='pending')return;
      if(result){
        current.telegram={status:result.status,route:result.route?.id};
        return;
      }
      if((!failure.status||failure.status>=500)&&attempts<2){
        current.telegram={...current.telegram,attempts:attempts+1,nextAt:Date.now()+5000*(attempts+1)};
        return;
      }
      current.telegram={status:'failed',error:failure.message};
      return 'Telegram could not queue '+record.title+'.';
    });
  }finally{telegramOutboxBusy=false;}
}

function refreshAutomaticIndicator() {
  if(location.protocol.startsWith('http')) void deliveryApi('telegram-routing').then(info=>{
    setAutomaticIndicator(info.auto.enabled);
    syncTelegramResponders(info.people);
  }).catch(()=>{});
}

async function createEnrollment(button) {
  const target=dialog.querySelector('[data-enrollment-status]');
  button.disabled=true;
  target.textContent='Preparing the shared link…';
  try{
    await deliveryApi('telegram-enrollment',{reset:button.dataset.createEnrollment==='reset'});
    if(target.isConnected&&dialog.open)void showTelegramRouting();
  }catch(error){if(target.isConnected){target.textContent=error.message;button.disabled=false;}}
}

async function relayNewAlert(incident,level) {
  if(!location.protocol.startsWith('http'))return;
  try {
    const result=await deliveryApi('telegram-alert-event',{event:crypto.randomUUID(),incident:incident.id,level});
    if(result.status==='queued')notice(`Telegram route queued for ${incident.id}.`);
    else if(result.status==='duplicate')notice(`Telegram already has a route for ${incident.id}.`);
  }catch(error){notice('Telegram auto routing: '+error.message);}
}

function pairRouteDestination(mode) {
  const team=mode==='team';
  openDialog('Telegram routing',team?'Pair the team group':'Pair a private responder',`<form class="delivery-form" data-route-pair="${mode}">
    <p>${team?'Add the Aurelis bot to your Telegram team group. The pairing command identifies the group.':'Name the responder and share the generated one-time link with them. They tap Start in the private bot chat.'}</p>
    ${team?'':'<label for="pager-name">Responder name</label><input id="pager-name" name="label" required maxlength="65">'}
    <div class="buttons"><button class="small primary" type="submit">Create pairing link</button><button class="small" type="button" data-telegram-routing>Back</button></div>
    <div data-route-pairing></div><p data-delivery-status role="status"></p></form>
    ${team?`<details class="panel block"><summary>Bot already added? Verify by group ID</summary>
      <form class="delivery-form" data-verify-team>
        <label for="telegram-team-id">Group ID or public @username</label><input id="telegram-team-id" name="chat" maxlength="64" required placeholder="For Telegram Web, use the negative number after #">
        <div class="buttons"><button class="small primary" type="submit">Verify and pair group</button></div><p data-team-result role="status"></p>
      </form></details>`:''}`);
}

async function startRoutePair(form) {
  const mode=form.dataset.routePair;
  const anchor=form.querySelector('[data-route-pairing]');
  const status=form.querySelector('[data-delivery-status]');
  const submit=form.querySelector('[type=submit]');
  submit.disabled=true;
  status.textContent='Creating the pairing link…';
  try {
    const result=await deliveryApi('telegram-discover',{action:'start',mode,label:form.elements.label?.value});
    if(!anchor.isConnected)return;
    anchor.innerHTML=mode==='team'
      ? `<div class="panel"><a target="_blank" rel="noreferrer" href="${html(result.url)}">Open Telegram and select the team group</a>
         <p>If the bot is already in the group, post this command there:</p><p><code>${html(result.groupCommand)}</code></p></div>`
      : `<div class="panel"><a target="_blank" rel="noreferrer" href="${html(result.url)}">One-time responder link</a><p>Have the intended responder open this link in their Telegram account and tap Start.</p></div>`;
    status.textContent='Waiting for the pairing command in Telegram…';
    for(let attempt=0;attempt<65;attempt++){
      await new Promise(resolve=>setTimeout(resolve,4000));
      if(!anchor.isConnected||!dialog.open)return;
      const match=await deliveryApi('telegram-discover',{action:'check',id:result.id});
      if(!anchor.isConnected)return;
      if(match.saved){
        openDialog('Telegram routing','Destination paired',`<p>${html(match.detail)}</p><button class="small primary" data-telegram-routing>View Telegram routing</button>`);
        return;
      }
    }
    status.textContent='Pairing timed out. Create a fresh pairing link to try again.';
  }catch(error){if(status.isConnected)status.textContent=error.message;}
  finally{if(submit.isConnected)submit.disabled=false;}
}

async function reviewTelegramRoute(id) {
  const incident=byId(id);
  if(!incident)return;
  openDialog(id,'Review Telegram route','<p data-delivery-status role="status">Loading paired chats…</p>');
  const anchor=dialog.querySelector('[data-delivery-status]');
  try {
    const info=await deliveryApi('telegram-routing');
    if(!dialog.open||!anchor.isConnected)return;
    const level=incidentPriority(incident);
    const direct=level==='P1';
    openDialog(id,'Review Telegram route',`<p>${badge(level)} <strong>${html(incident.title)}</strong></p>
      <p>${direct?'This critical alert skips the private page and posts directly to the group.':'A private page asks the responder to accept or decline. Decline or timeout posts to the group.'}</p>
      <p><strong>Team group:</strong> ${html(info.team?.label||'Not paired')}</p>
      <form class="delivery-form" data-routing-preview="${id}">
        ${direct?'':`<label for="routing-owner">Private responder</label><select id="routing-owner" name="owner">${info.people.map(person=>`<option value="${html(person.id)}">${html(person.label)} · ${html(person.destination)}</option>`).join('')||'<option value="">No responder paired</option>'}</select>
        <label for="routing-window">Response window</label><select id="routing-window" name="wait"><option value="30">30 seconds</option><option value="60" selected>1 minute</option><option value="120">2 minutes</option><option value="300">5 minutes</option></select>`}
        <div class="buttons"><button class="small primary" type="submit">Preview Telegram route</button><button class="small" type="button" data-telegram-routing>Routing setup</button></div>
        <p data-delivery-status role="status"></p></form>`);
  }catch(error){if(anchor.isConnected)deliveryError(error);}
}

async function openTelegramNotice(incidentId='',recipient='') {
  openDialog('Telegram delivery','Send Telegram notification','<p data-delivery-status role="status">Loading paired recipients…</p>');
  const target=dialog.querySelector('[data-delivery-status]');
  try {
    const info=await deliveryApi('telegram-routing');
    if(!target.isConnected||!dialog.open)return;
    const recipients=info.team||info.people.length;
    const incidentOptions = items=>items.map(incident=>`<option value="${incident.id}" ${incident.id===incidentId?'selected':''}>
      ${incidentPriority(incident)} · ${html(incident.title)}</option>`).join('');
    const tests = Object.values(workspace.custom).filter(incident=>incident.triggeredAt!==null);
    openDialog('Telegram delivery','Send Telegram notification',`
      <p>Choose the team group for one post, or choose a private responder to request acknowledgement with a deadline. Custom incidents are labeled as test events.</p>
      <form class="delivery-form" data-telegram-notice-form>
        <label for="notice-incident">Incident</label><select id="notice-incident" name="incident">
          <optgroup label="Prepared incidents">${incidentOptions(scenarios)}</optgroup>
          ${tests.length?`<optgroup label="Custom test events">${incidentOptions(tests)}</optgroup>`:''}
        </select>
        <label for="notice-recipient">Send to</label><select id="notice-recipient" name="recipient" required>
          <option value="" ${recipient?'':'selected'} disabled>Choose the team or a responder</option>
          ${info.team?`<optgroup label="Team group"><option value="team" ${recipient==='team'?'selected':''}>Everyone in ${html(info.team.label)}</option></optgroup>`:''}
          ${info.people.length?`<optgroup label="Private responders">${info.people.map(person=>`<option value="${html(person.id)}" ${recipient===person.id?'selected':''}>${html(person.label)} · ${html(person.destination)}</option>`).join('')}</optgroup>`:''}
        </select>
        <div class="buttons"><button class="small primary" type="submit" ${recipients?'':'disabled'}>Preview notification</button><button class="small" type="button" data-telegram-routing>Manage recipients</button></div>
        <p data-delivery-status role="status">${recipients?'':'Pair a Telegram group or private responder first.'}</p>
      </form>`);
  }catch(error){if(target.isConnected)deliveryError(error);}
}

function showTelegramNotice(notice,recipient) {
  openDialog(notice.incident,'Preview Telegram notification',`
    <p><strong>To ${html(notice.label)}</strong> · ${notice.group?'One post in the group':'Private chat'}</p>
    ${emailCopySummary(notice.emailRecipients)}
    ${notice.test?`<p>${testBadge} · This message includes the test description and any recommended actions.</p>`:''}
    ${notice.wait?`<p>The responder has <strong>${notice.wait} seconds</strong> to reply. A decline or timeout escalates to <strong>${html(notice.team)}</strong>.</p>`:''}
    <section class="panel"><p class="chat-answer">${html(notice.text)}</p>${notice.group?'<small>The group post includes the responder enrollment button if a link has been created.</small>':''}</section>
    <p data-delivery-status role="status"></p>
    <div class="buttons"><button class="small" data-notify-telegram="${html(notice.incident)}" data-notice-recipient="${html(recipient)}">Back</button>
    <button class="small primary" data-send-notice="${html(notice.token)}">${notice.wait?'Send and start timer':'Send notification'}</button></div>`);
}

function emailCopySummary(recipients) {
  return recipients?.length ? `<p class="small"><strong>Email copy</strong> · ${recipients.map(html).join(' · ')}. Responses stay in Telegram.</p>` : '';
}

function previewTelegramRoute(incident,preview) {
  openDialog(incident,'Preview Telegram route',`
    ${preview.messages.map(message=>`<section class="panel block"><h3>${html(message.destination)}</h3><p class="chat-answer">${html(message.body)}</p></section>`).join('')}
    ${preview.canStart?`<p>${preview.direct?`Send to <strong>${html(preview.team)}</strong> now.`:`Page <strong>${html(preview.owner)}</strong> now. Send to <strong>${html(preview.team)}</strong> if the responder declines or misses the deadline.`}</p>`:`<p><strong>${html(preview.missing)}</strong></p>`}
    ${emailCopySummary(preview.emailRecipients)}
    <div class="buttons"><button class="small" data-route-incident="${html(incident)}">Back</button>
    ${preview.canStart?`<button class="small primary" data-start-route="${html(preview.token)}">Confirm and start live routing</button>`:'<button class="small" data-telegram-routing>Routing setup</button>'}</div><p data-delivery-status role="status"></p>`);
}

async function trackTelegramRoute(id,initial) {
  openDialog('Telegram routing','Track Telegram route',`<div data-route-tracking role="status">${initial?routeDetails(initial):'Checking route…'}</div><button class="small" data-telegram-routing>All routes</button>`);
  const slot=dialog.querySelector('[data-route-tracking]');
  let lastRoute=JSON.stringify(initial);
  try {
    while(dialog.open&&slot.isConnected){
      const state=await deliveryApi('telegram-routing');
      if(!slot.isConnected)return;
      const route=state.routes.find(item=>item.id===id);
      if(!route){slot.textContent='This route is no longer in the recent list.';return;}
      const snapshot=JSON.stringify(route);
      if(lastRoute!==snapshot){
        slot.innerHTML=routeDetails(route);
        lastRoute=snapshot;
      }
      if(['completed','failed'].includes(route.stage))return;
      await new Promise(resolve=>setTimeout(resolve,3000));
    }
  }catch(error){if(slot.isConnected)slot.textContent=error.message;}
}

function providerForm(key,provider = deliveryState?.channels.email.providerKey || 'gmail') {
  const isEmail=key==='email';
  const channel=isEmail ? {...channelSetup.email,...emailSetup[provider]} : channelSetup[key];
  if (!channel) return;
  const selected=deliveryState?.channels[key];
  const saved=(!isEmail || selected?.providerKey===provider) && selected?.savedFields || [];
  const guidance={
    sms:'Use a Twilio account and an SMS-capable sender that can send custom texts to Canadian numbers. Enter the sender in international format, including the +.',
    email:provider==='gmail' ? 'Use a personal Gmail account with 2-Step Verification. Create an app password for Aurelis and paste it below.'
      : 'Verify a domain you control in Resend, then create a sending-access API key and enter a sender address on that domain.',
    telegram:'Paste your BotFather token and select Pair and save my chat. Aurelis will save and verify the connection after you tap Start in your private chat with the bot.',
  };
  openDialog(channel.provider,'Configure ' + channel.name,`<p>${guidance[key]}</p>
    ${isEmail?`<div class="tabs notification-tabs" role="group" aria-label="Email provider">${Object.entries(emailSetup).map(([id,item])=>
      `<button class="tab" data-email-provider="${id}" aria-pressed="${id===provider}">${item.provider}</button>`).join('')}</div>`:''}
    <p><a target="_blank" rel="noreferrer" href="${channel.setup}">${channel.link || `Open ${key==='telegram'?'BotFather':channel.provider}`}</a>
    ${isEmail&&provider==='resend'?' · <a target="_blank" rel="noreferrer" href="https://resend.com/domains">Verified domains</a>':''}</p>
    <form class="delivery-form" data-provider-form="${key}" ${isEmail?`data-email-service="${provider}"`:''} autocomplete="off">
      ${channel.fields.map(([id,label,masked])=>`<label for="${id}">${label}${saved.includes(id) ? ' · Saved; leave blank to keep' : ''}</label>
      <input id="${id}" name="${id}" type="${masked?'password':'text'}" maxlength="180" autocomplete="off" ${saved.includes(id) ? '' : 'required'}>`).join('')}
      ${isEmail?`<label for="email-recipients">Alert recipients · one address per line</label>
      <textarea id="email-recipients" name="recipients" rows="3" maxlength="1500" placeholder="${selected?.recipients.length?'Leave blank to keep saved recipients':'oncall@example.com'}"></textarea>
      ${selected?.recipients.length?`<p class="small quiet">Saved recipients: ${selected.recipients.map(recipient=>html(recipient.destination)).join(' · ')}.</p>`:''}
      <p class="small quiet">After changing the sender or recipients, send a test and enable automatic email when ready.</p>`:''}
      ${key==='telegram'?'<div class="buttons"><button class="small primary" type="button" data-pair-personal>Pair and save my chat</button><button class="small" type="button" data-find-chat>Find chat ID manually</button></div><div id="telegram-pairing"></div>':''}
      <p data-delivery-status role="status"></p>
      <div class="buttons"><button class="small primary" type="submit">Save settings</button><button class="small" type="button" data-channels>Back</button></div>
    </form>`);
}

async function setEmailAutomation(button) {
  const output=dialog.querySelector('#check-email');
  button.disabled=true;
  try {
    await deliveryApi('email-automatic',{enabled:button.dataset.emailAutomatic==='on'});
    if (button.isConnected) void showChannels();
  } catch (error) {
    if (button.isConnected) { output.textContent=error.message; button.disabled=false; }
  }
}

function reviewEmailTest() {
  const recipients=deliveryState.channels.email.recipients;
  openDialog('Email alerts','Send test email',`<p>Send the <strong>Aurelis demo test alert</strong> to:</p>
    <ul class="archive">${recipients.map(item=>`<li>${html(item.destination)}</li>`).join('')}</ul>
    <p data-delivery-status role="status"></p><div class="buttons">
    <button class="small primary" data-email-test="confirm">Confirm test email</button><button class="small" data-channels>Back</button></div>`);
}

async function sendEmailTest(button) {
  const target=dialog.querySelector('[data-delivery-status]');
  button.disabled=true;
  target.textContent='Submitting the test to your email provider…';
  try {
    const {results}=await deliveryApi('email-test',{confirm:true});
    if (target.isConnected) openDialog('Email alerts','Test email results',`
      <p>Check your recipients’ inboxes, including junk or quarantine, before enabling automatic email.</p>
      ${deliveryLog(results)}<button class="small" data-channels>Back to delivery setup</button>`);
  } catch (error) {
    if (target.isConnected) { deliveryError(error); button.disabled=false; }
  }
}

async function checkProvider(key) {
  const output=dialog.querySelector('#check-'+key);
  if (!output) return;
  output.textContent='Checking the provider without sending…';
  try {
    const result=await deliveryApi('check',{channel:key});
    if (output.isConnected) output.textContent=result.detail;
  } catch(error) { if (output.isConnected) output.textContent=error.message; }
}

async function discoverTelegram(id,personal=false) {
  const pairing=dialog.querySelector('#telegram-pairing');
  const chatField=dialog.querySelector('#TELEGRAM_CHAT_ID');
  if (!pairing || !chatField) return;
  const action=id ? 'check' : 'start';
  const token=dialog.querySelector('#TELEGRAM_BOT_TOKEN').value.trim();
  const status=dialog.querySelector('[data-delivery-status]');
  const pairButton=dialog.querySelector('[data-pair-personal]');
  if(personal) pairButton.disabled=true;
  status.textContent='Checking Telegram…';
  try {
    const result=await deliveryApi('telegram-discover',id ? {action,id} : {action,token,mode:personal?'personal':'manual'});
    if (!pairing.isConnected) return;
    if (action==='start') {
      if (personal) {
        dialog.querySelector('#TELEGRAM_BOT_TOKEN').value='';
        pairing.innerHTML=`<div class="panel"><a href="${html(result.url)}" target="_blank" rel="noreferrer">Open your bot in Telegram</a>
          <p>Tap Start in your private chat with this bot. Aurelis will finish automatically.</p></div>`;
        status.textContent='Waiting for you to tap Start in Telegram…';
        void waitForTelegramPairing(result.id,pairing.firstElementChild,status,pairButton);
        return;
      }
      pairing.innerHTML=`<div class="panel"><p>For a direct chat, <a href="${html(result.url)}" target="_blank" rel="noreferrer">open your bot and click Start</a>.</p>
        <p>For a group, add the bot, then post this command yourself in that group:</p><p><code>${html(result.groupCommand)}</code></p>
        <button type="button" class="small" data-check-chat="${html(result.id)}">Look for chat</button></div>`;
      status.textContent='After sending the pairing command in Telegram, click Look for chat.';
    } else if (result.found) {
      chatField.value=result.chatId;
      pairing.replaceChildren();
      status.textContent='Chat found. Click Save settings to use it.';
    } else {
      status.textContent='Pairing command not found yet. Send it in the intended chat, then check again.';
    }
  } catch(error) {
    if(status.isConnected) status.textContent=error.message;
    if(personal && pairButton.isConnected) pairButton.disabled=false;
  }
}

async function waitForTelegramPairing(id,session,status,pairButton) {
  try {
    for(let attempt=0;attempt<65;attempt++){
      await new Promise(resolve=>setTimeout(resolve,4000));
      if(!session.isConnected || !dialog.open) return;
      const result=await deliveryApi('telegram-discover',{action:'check',id});
      if(!session.isConnected || !dialog.open) return;
      if(result.saved){
        openDialog('Telegram delivery','Telegram connected',`<p>${html(result.detail)}</p><button class="small primary" data-channels>View delivery setup</button>`);
        return;
      }
    }
    if(status.isConnected) status.textContent='Pairing timed out. Paste the token again to start a new session.';
  } catch(error){
    if(status.isConnected) status.textContent=error.message;
  } finally {
    if(pairButton.isConnected) pairButton.disabled=false;
  }
}

async function reviewDelivery(id) {
  const incident=byId(id);
  if (!incident) return;
  deliveryPreview=undefined;
  openDialog(incident.id,'Review alert delivery','<p data-delivery-status role="status">Loading delivery channels…</p>');
  const target=dialog.querySelector('[data-delivery-status]');
  try {
    deliveryState=await deliveryApi('status');
    if (!dialog.open || !target.isConnected) return;
    const level=incidentPriority(incident);
    openDialog(incident.id,'Review alert delivery',`<p>${badge(level)} <strong>${severityNames[level]} · ${html(incident.title)}</strong></p>
      <p>Select recipients, then review the exact message. Leave all boxes clear to preview the three channel formats.</p>
      <form class="delivery-form" data-preview-form="${id}">
        ${Object.entries(deliveryState.channels).map(([key,channel])=>`<fieldset><legend>${html(channel.name)} · ${channel.configured ? 'Configured' : 'Needs setup'}</legend>
          ${channel.recipients.map(item=>`<label class="check-row"><input type="checkbox" name="target" value="${html(item.id)}"> ${html(item.label)} <small>${html(item.destination)}</small></label>`).join('') || '<small>No destination configured.</small>'}
          ${channel.configured ? '' : ` <button class="small" type="button" data-provider="${key}">Configure ${html(channel.name)}</button>`}</fieldset>`).join('')}
        <p data-delivery-status role="status"></p><div class="buttons"><button class="small primary" type="submit">Preview messages</button><button class="small" type="button" data-channels>Delivery setup</button></div>
      </form>`);
  } catch(error) { if (target.isConnected) deliveryError(error); }
}

function showDeliveryPreview(preview) {
  deliveryPreview=preview;
  openDialog(preview.incident,'Preview outgoing messages',`
    <p><strong>${html(preview.level)} · ${severityNames[preview.level]}</strong> · Simulated incident</p>
    ${Object.entries(preview.messages).map(([key,message])=>`<section class="panel block"><h3>${channelSetup[key].name}</h3>
      <small>${preview.targets.filter(target=>target.channel===key).map(target=>html(target.destination)).join(' · ') || 'Format preview only'}</small>
      ${message.subject ? `<p><strong>${html(message.subject)}</strong></p>` : ''}
      <p class="chat-answer">${html(message.text)}</p></section>`).join('')}
    <p data-delivery-status role="status">${preview.canSend ? 'Confirm to send these exact messages to the selected recipients.' : preview.targets.length ? 'Configure the selected providers before sending.' : 'No recipients selected. This preview sends nothing.'}</p>
    <div class="buttons"><button class="small" data-deliver="${html(preview.incident)}">Back to recipients</button>
      ${preview.canSend ? '<button class="small primary" data-send-delivery>Confirm and send live</button>' : ''}</div>`);
}

function changePriority() {
  const incident = byId(selected);
  openDialog(incident.id,'Change priority',`<p>Suggested priority: <strong>${priority(incident)}</strong>. Current priority: <strong>${incidentPriority(incident)}</strong>.</p>
    <label for="priority-reason">Reason for changing priority</label><input id="priority-reason" required maxlength="300" placeholder="e.g. Checkout failures spread to another region">
    <div class="buttons">${levels.map(level=>`<button data-set-level="${level}">${level}</button>`).join('')}<button data-set-level="suggested">Use suggested priority</button></div>`);
}

function fallback(incident,result,question) {
  if (!result.observed) return 'The incident had not fired in this snapshot. Move the replay forward to see the brief.';
  const q = question.toLowerCase();
  if (workspace.custom[incident.id]) {
    if (/verif|recovery|resolved/.test(q)) return [
      result.guide ? `[${result.guide.id}] ${result.verify}` : result.verify,
      incident.activity.findLast(item=>item.note)?.note
    ].filter(Boolean).join('\n\n');
    if (/priorit|urgent|impact|cost|money/.test(q)) {
      return `This test event is ${simulationSeverities[incident.level]} (${incident.level}). The reported scope is ${incident.area || incident.service}. The report provides no measured customer impact or loss estimate.`;
    }
    if (/what changed|deploy|maintenance/.test(q)) return result.changes.map(item=>
      `${item.time} ET: ${item.title}. ${item.detail} [${item.id}]`).join('\n') || 'No same-service changes were available within two hours of this alert.';
    if (/runbook|document|procedure/.test(q) && result.guide) {
      return [`[${result.guide.id}] ${result.guide.title}`,result.guide.useWhen,`First check: ${result.next}`,`Pause if: ${result.guide.stopWhen}`].join('\n\n');
    }
    if (/runbook|document|similar|before|fix|compar/.test(q)) {
      return [result.known ? `[${result.known.id}] ${result.known.responder} documented this fix: ${result.known.fix}`
        : 'No known fix for this alert.',result.guide && `[${result.guide.id}] ${result.guide.title}`,
        ...result.relatedDocuments.map(document=>`Reference: [${document.id}] ${document.title}.`),
        `First check: ${result.next}`].filter(Boolean).join('\n\n');
    }
    return [result.cause,`Evidence: ${result.causeSources.join(', ')}`,
      `Reported for ${incident.service}: ${incident.description}`,`First check: ${result.next}`].join('\n\n');
  }
  if (/verif|recovery|resolved/.test(q) && result.guide) {
    return `[${result.guide.id}] ${result.guide.verify}\n\n${incident.verify}`;
  }
  if (/distinguish|tell.*apart/.test(q)) {
    const step = result.guide?.steps.find(([name])=>name.startsWith('Distinguish'));
    return step ? `[${result.guide.id}] ${step[1]}` : incident.next;
  }
  if (/runbook|document|procedure|step|how (?:do|can|should|to)|what should i (?:do|check)|fix this/.test(q) && result.guide) {
    const guide = result.guide;
    const intro = result.verifiedDocument ? 'This runbook matches the documented previous fix. Verify that the current symptoms meet its preconditions.' : 'No verified fix exists for this alert. Use the guide to distinguish the possible causes.';
    return [intro,`[${guide.id}] ${guide.title}`,...guide.steps.map(([name,step],index)=>`${index+1}. ${name}: ${step}`),`Pause if: ${guide.stopWhen}`,`Verify: ${guide.verify}`].join('\n\n');
  }
  if (/priorit|urgent|first|impact|cost|money/.test(q)) {
    return `${incident.title} is ${priority(incident)}. The monitor shows ${incident.affectedPct}% of operations affected. Confirmed: ${incident.confirmed.join(', ')}. Check first: ${incident.next}`;
  }
  if (/before|past|similar|fix|compar/.test(q)) {
    const record = result.exact[0] || result.nearby[0];
    if (result.known) return `${result.known.responder} handled ${result.known.id}. The error signature matches. Previous resolution: ${result.known.fix}`;
    return `No known fix for this alert.${record ? ' The nearest historical record is ' + record.id + (result.exact.length ? ', but its resolution steps are missing.' : ', with a different error signature.') : ''} ${incident.next}`;
  }
  if (/alternat|dissent|wrong|provider/.test(q)) return result.alternative ? `${incident.alternative} Source: ${result.alternative.id}. ${incident.next}` : 'The selected snapshot has no documented alternative cause. ' + incident.next;
  if (/what changed|deploy|maintenance/.test(q)) return result.changes.map(item=>`${item.time} ET: ${item.title}. ${item.detail} [${item.id}]`).join('\n') || 'No recent changes were recorded in this snapshot.';
  if (/summary|catch|happen|cause|detail|evidence/.test(q)) return [
    result.cause,...result.findings.map(finding=>`• ${finding.text} [${finding.ids.join(', ')}]`),
    `Still open: ${incident.unknowns[0]}`,`Next: ${incident.next}`,
  ].join('\n\n');
  return 'The demo can answer questions about priority, past fixes, recent changes, alternatives, or the incident summary. Try one of the prompts above.';
}

function assistant() {
  if (assistantWindow.open) {
    assistantWindow.querySelector('#question').focus();
    return;
  }
  const incident = byId(selected);
  assistantWindow.innerHTML = `<div class="dialog-head"><div><div class="kicker">Incident assistant / ${incident.id}</div><h2 id="assistant-title">Ask about this incident</h2></div><button data-close aria-label="Close assistant">✕</button></div><div class="dialog-body" role="region" aria-label="Incident assistant conversation" tabindex="0">
    <p class="quiet" id="assistant-mode">${connected ? 'Gemini · Uses the selected evidence snapshot.' : 'Demo mode · Answers come from the sample records.'}</p>
    <div class="buttons">${['What happened, in detail?', 'Which runbook should I use?', incident.document==='DG-023' ? 'What would distinguish the likely causes?' : 'Have we seen this before?', 'How should I verify recovery?'].map(q=>`<button class="small" data-prompt="${html(q)}">${html(q)}</button>`).join('')}</div>
    <form id="assistant-form"><input id="question" aria-label="Ask the incident assistant" maxlength="400" placeholder="Ask about the evidence…" required>
    <button class="primary" type="submit">Ask</button><button type="button" data-mic title="Speak a question using browser dictation">Mic</button></form>
    <p class="quiet small" id="speech-status" role="status"></p>
    <div id="answer-document"></div>
    <div class="panel block"><details id="conversation-history" hidden><summary>Earlier questions and answers</summary><ul class="archive" id="conversation-turns"></ul></details><div class="row"><div class="references" id="answer-sources" aria-label="Sources cited in the answer"></div><button class="small" data-speak disabled>Read aloud</button></div><p class="chat-answer" id="answer" aria-live="polite">Choose a question or type your own.</p></div></div>`;
  refreshAssistantDocument();
  assistantWindow.show();
}

function refreshAssistantDocument() {
  const holder = assistantWindow.querySelector('#answer-document');
  if (!holder) return;
  const result = investigateCase(byId(selected));
  holder.innerHTML = result.guide
    ? `<small>${result.verifiedDocument ? 'Procedure for the matching incident' : 'Documentation for this investigation'}</small><div>${documentLink(result.guide)}</div>` : '';
}

async function ask(question, speak = false) {
  const input = document.querySelector('#question');
  const answer = document.querySelector('#answer');
  const mode = document.querySelector('#assistant-mode');
  const control = assistantWindow.querySelector('[data-speak]');
  const sources = document.querySelector('#answer-sources');
  if (!answer || !question.trim()) return;
  input.value = question;
  answer.textContent = 'Checking the incident records…';
  control.disabled = true;
  sources.replaceChildren();
  const incident = byId(selected);
  const snapshot = cutoff;
  const scope = incident.id + '/' + snapshot;
  if (scope !== conversationScope) {
    conversation = [];
    conversationScope = scope;
  }
  const result = investigateCase(incident,snapshot);
  const revision = ++dialogRevision;
  let reply = fallback(incident,result,question);
  let ids = [...new Set(reply.match(/\b(?:INC|RB|DG|ALT|CHG|LOG|MET|SUP|EXT|MNT)-\d+\b/g) || [])];
  if (workspace.custom[incident.id] && result.observed) ids.unshift(incident.causeSources[0]);
  let label = incident.sampleAlert ? 'Test event · Based on the automatic brief and sample records.' : 'Demo mode · Based on sample records.';
  if (connected) {
    try {
      const earlierQuestions = conversation.map(turn=>turn.question);
      const response = await fetch('/api/ask', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...aiIncidentPayload(incident),cutoff:snapshot,question,earlierQuestions})});
      if (!response.ok) throw Error();
      const data = await response.json();
      reply = data.answer;
      ids = data.sources;
      label = 'Gemini · Based on the selected evidence snapshot.';
    } catch {
      label = 'Gemini unavailable · Showing the demo answer.';
    }
  }
  if (revision !== dialogRevision || !assistantWindow.open) return;
  refreshAssistantDocument();
  answer.textContent = reply;
  mode.textContent = label;
  sources.innerHTML = ids.map(ref).join('');
  const earlier = assistantWindow.querySelector('#conversation-history');
  earlier.hidden = conversation.length === 0;
  assistantWindow.querySelector('#conversation-turns').innerHTML = conversation.map(turn=>
    `<li><strong>${html(turn.question)}</strong><p>${html(turn.reply)}</p></li>`).join('');
  conversation = [...conversation,{question,reply}].slice(-3);
  control.disabled = false;
  const body = answer.closest('.dialog-body');
  const answerTop = answer.getBoundingClientRect().top;
  const bounds = body.getBoundingClientRect();
  if (answerTop < bounds.top || answerTop > bounds.bottom - 48) {
    body.scrollTop += answerTop - bounds.top - 18;
  }
  if (speak) readAloud(reply);
}

function readAloud(text) {
  if (!('speechSynthesis' in window)) return notice('Speech playback is unavailable in this browser.');
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-CA';
  utterance.rate = 0.94;
  const status = assistantWindow.querySelector('#speech-status');
  utterance.onstart = () => { if (status?.isConnected) status.textContent = 'Reading the answer aloud.'; };
  utterance.onend = () => { if (status?.isConnected) status.textContent = 'Finished reading aloud.'; };
  utterance.onerror = event => {
    if (status?.isConnected && !['canceled','interrupted'].includes(event.error)) status.textContent = 'Voice playback is unavailable in this browser.';
  };
  window.speechSynthesis.speak(utterance);
}
function listen() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const status = document.querySelector('#speech-status');
  if (!Speech) { status.textContent = 'This browser lacks speech input. You can still type and play answers.'; return; }
  if (speech) { speech.stop(); return; }
  const current = new Speech();
  speech = current;
  current.lang = 'en-CA';
  status.textContent = 'Listening… Speak a question.';
  current.onresult = event => {
    if (!status.isConnected) return;
    status.textContent = '';
    void ask(event.results[0][0].transcript.slice(0,400), true);
  };
  current.onerror = () => { if (status.isConnected) status.textContent = 'Speech input unavailable. Check microphone permissions or type your question.'; };
  current.onend = () => {
    if (speech === current) speech = null;
    if (status.isConnected && status.textContent.startsWith('Listening')) status.textContent = 'No speech received. Try again or type your question.';
  };
  try { current.start(); }
  catch { speech = null; status.textContent = 'Could not start speech input. Type your question instead.'; }
}

document.addEventListener('click',event=>{
  if (event.isTrusted && sound && audio?.state!=='running') {
    try {
      audio ||= new AudioContext();
      void audio.resume().catch(()=>{});
    } catch { /* Playback is optional on browsers without Web Audio. */ }
  }
  const button = event.target.closest('button');
  if (!button) return;
  const data = button.dataset;
  if (data.dismissToast) dismissToast(data.dismissToast);
  else if (data.markNotice) void markNotices(data.markNotice);
  else if ('markAll' in data) void markNotices();
  else if ('toggleSound' in data) void toggleSound(button);
  else if (data.case) { choose(data.case); render(); }
  else if (data.openCase) {
    if (data.readNotice) {
      dismissToast(data.readNotice);
      void markNotices(data.readNotice);
    }
    openCase(data.openCase);
  }
  else if (data.tab) { activeTab = data.tab; render(); }
  else if (data.nav) location.hash = data.nav;
  else if (data.task) actionOnTask(data.task,data.id);
  else if (data.trigger) {
    const incident = byId(data.trigger);
    choose(incident.id);
    void update(state=>{
      if (!state.active.includes(incident.id)) {
        state.active.push(incident.id);
        state.arrivals[incident.id]=Date.now();
        delete state.tasks[incident.id];
      } else if (!state.tasks[incident.id]?.acceptedAt) state.arrivals[incident.id] ??= Date.now();
      state.analyses[incident.id] ??= {status:'queued'};
      notification(state,incident.id,'Sample alert received',incident.title);
      if (incidentPriority(incident,state)==='P1' && !state.tasks[incident.id]) pageOnCall(state,incident);
      return `Simulated alert received: ${incident.title}.`;
    }).then(saved=>{if (saved) return relayNewAlert(incident,incidentPriority(incident));});
  } else if ('reset' in data) {
    choose('INC-121');
    void update(state=>{
      const defaults = initial();
      state.active = [...defaults.active,...state.active.filter(id=>state.custom[id])];
      state.tasks = {};
      state.messages = [];
      state.priorities = {};
      state.notifications = state.notifications.filter(entry=>state.custom[entry.id]);
      state.notes = Object.fromEntries(Object.entries(state.notes).filter(([key])=>state.custom[key.split('/')[0]]));
      return 'Prepared alerts reset.';
    });
  } else if ('loadTemplate' in data) {
    simulatorDraft = templateValues(Number(data.loadTemplate));
    render();
    document.querySelector('#simulation-form input').focus();
  } else if ('investigationTemplate' in data || 'fireTemplate' in data || 'runBurst' in data || 'confirmSimulation' in data) {
    button.disabled = true;
    button.setAttribute('aria-busy','true');
    const batch = 'runBurst' in data;
    const sample = investigationTemplates[Number(data.investigationTemplate)];
    const entries = sample ? [{...sample,occurred:new Date(sample.occurredAt).toISOString(),trigger:'immediate',status:'reported'}]
      : batch ? simulationTemplates.map((_,index)=>templateValues(index))
      : ['fireTemplate' in data ? templateValues(Number(data.fireTemplate)) : {...simulatorDraft}];
    void createIncidents(entries,batch,Boolean(sample)).finally(()=>{
      button.disabled=false;
      button.removeAttribute('aria-busy');
    });
  } else if (data.testStatus && workspace.custom[selected]) {
    editSimulation(workspace.custom[selected],data.testStatus==='update' ? undefined : data.testStatus);
  } else if (data.resolveIncident) {
    openResolution(data.resolveIncident);
  } else if ('draftResolution' in data) {
    void draftResolution(button);
  } else if (data.familyView==='map' || data.familyView==='list') {
    familyView = data.familyView;
    render();
  } else if (Object.hasOwn({week:true,month:true,year:true},data.reportRange)) {
    reportRange=data.reportRange;
    reportOffset=0;
    render();
  } else if (data.reportOffset==='-1' || data.reportOffset==='1') {
    reportOffset=Math.min(0,reportOffset+Number(data.reportOffset));
    render();
  } else if ('retryReport' in data) {
    reportInsights.delete(reportData().key);
    render();
  } else if ('editExposure' in data) {
    editExposure();
  } else if (data.resetExposure) {
    void update(state=>{delete state.exposure[data.resetExposure];dialog.close();});
  } else if (data.deleteCustom || 'resetCustom' in data) {
    const record = workspace.custom[data.deleteCustom];
    const scheduled = record?.triggeredAt===null;
    openDialog('Incident simulator',record ? (scheduled?'Cancel scheduled test?':'Delete test event?') : 'Reset custom simulations?',`
      <p>${record ? `Remove ${html(record.title)} and its local notification history?`
        : 'Remove every custom simulation and its local notifications, including scheduled events. Prepared incidents, runbooks, and Telegram settings are preserved.'}</p>
      <div class="buttons"><button class="small" data-close>Keep test data</button>
      <button class="small danger" data-confirm-delete="${record?.id || 'all'}">${record ? (scheduled?'Cancel schedule':'Delete test event') : 'Reset custom simulations'}</button></div>`);
  } else if (data.confirmDelete) {
    button.disabled = true;
    void update(state=>{
      const ids = data.confirmDelete==='all' ? Object.keys(state.custom) : [data.confirmDelete];
      if (ids.includes(selected)) choose('INC-121');
      deleteSimulations(state,ids);
      return data.confirmDelete==='all' ? 'Custom simulations reset.' : 'Test event removed.';
    }).then(saved=>{if (saved && button.isConnected) dialog.close(); else button.disabled = false;});
  } else if (data.retryAnalysis) {
    void update(state=>{state.analyses[data.retryAnalysis] = {status:'queued'};}).then(runNextAnalysis);
  } else if (data.source) source(data.source);
  else if ('live' in data) { cutoff='23:59'; render(); }
  else if ('handoff' in data) draft();
  else if ('notifications' in data) showNotifications();
  else if (data.notificationPanel) {
    notificationPanel = data.notificationPanel;
    refreshNotificationHistory();
  }
  else if (data.alertFilter) { alertFilter=data.alertFilter; render(); }
  else if (data.radarIncident) openCase(data.radarIncident);
  else if (data.radarFilter) {
    radarFilter = data.radarFilter;
    radarPage = 0;
    render();
  }
  else if (data.radarPage) {
    radarPage += Number(data.radarPage);
    render();
    if (!main.contains(document.activeElement)) main.querySelector('.radar-pages button:not(:disabled)')?.focus({preventScroll:true});
  }
  else if ('channels' in data) void showChannels();
  else if ('telegramRouting' in data) void showTelegramRouting();
  else if ('disableAutoTelegram' in data) void updateTelegramMode({enabled:false},button);
  else if (data.createEnrollment) void createEnrollment(button);
  else if ('refreshResponders' in data) void showTelegramRouting();
  else if ('copyEnrollment' in data) {
    const link=dialog.querySelector('#team-responder-link');
    if(link)void navigator.clipboard.writeText(link.href).then(()=>notice('Responder enrollment link copied.'),()=>notice('Open the enrollment link and copy its address.'));
  }
  else if ('pairTeam' in data) pairRouteDestination('team');
  else if ('pairResponder' in data) pairRouteDestination('responder');
  else if ('notifyTelegram' in data) void openTelegramNotice(data.notifyTelegram,data.noticeRecipient);
  else if (data.sendNotice) {
    button.disabled=true;
    const target=dialog.querySelector('[data-delivery-status]');
    target.textContent='Submitting the notification to Telegram…';
    void deliveryApi('telegram-notice-send',{token:data.sendNotice,confirm:true}).then(({result,route})=>{
      if(!target.isConnected||!dialog.open)return;
      if(route){void trackTelegramRoute(route.id,route);return;}
      const outcome={accepted:'Telegram accepted the notification.',rejected:'Telegram rejected the notification.',unknown:'Telegram did not confirm delivery. Check the chat before sending again.'}[result.status];
      openDialog(result.incident,'Telegram notification result',`<p>${html(outcome)}</p>
        ${result.detail?`<p>${html(result.detail)}</p>`:''}<p><strong>Recipient:</strong> ${html(result.label)}</p><button class="small" data-notify-telegram="${html(result.incident)}">Preview another notification</button>`);
    },error=>{if(target.isConnected){deliveryError(error);button.disabled=false;}});
  }
  else if (data.routeIncident) void reviewTelegramRoute(data.routeIncident);
  else if (data.routeStatus) void trackTelegramRoute(data.routeStatus);
  else if (data.startRoute) {
    button.disabled=true;
    const target=dialog.querySelector('[data-delivery-status]');
    target.textContent='Starting the Telegram route…';
    void deliveryApi('telegram-route-start',{token:data.startRoute,confirm:true}).then(result=>{
      if(target.isConnected&&dialog.open)void trackTelegramRoute(result.route.id,result.route);
    },error=>{if(target.isConnected){deliveryError(error);button.disabled=false;}});
  }
  else if (data.checkProvider) void checkProvider(data.checkProvider);
  else if (data.emailProvider) providerForm('email',data.emailProvider);
  else if (data.emailAutomatic) void setEmailAutomation(button);
  else if (data.emailTest==='review') reviewEmailTest();
  else if (data.emailTest==='confirm') void sendEmailTest(button);
  else if ('pairPersonal' in data) void discoverTelegram(undefined,true);
  else if ('findChat' in data) void discoverTelegram();
  else if (data.checkChat) void discoverTelegram(data.checkChat);
  else if (data.provider) providerForm(data.provider);
  else if (data.deliver) void reviewDelivery(data.deliver);
  else if ('sendDelivery' in data && deliveryPreview?.canSend) {
    const preview=deliveryPreview;
    deliveryPreview=undefined;
    button.disabled=true;
    const target=dialog.querySelector('[data-delivery-status]');
    target.textContent='Submitting the selected messages…';
    void deliveryApi('send',{token:preview.token,confirm:true}).then(result=>{
      if (!dialog.open || !target.isConnected) return;
      openDialog(preview.incident,'Provider results',`<p>Provider acceptance confirms submission. Delivery to the destination can still fail after acceptance.</p>${deliveryLog(result.results)}
      <button class="small" data-channels>Delivery setup and results</button>`);
    },error=>{ if (target.isConnected) deliveryError(error); });
  }
  else if ('priority' in data) changePriority();
  else if (data.setLevel) {
    const incident = byId(selected);
    if (!levels.includes(data.setLevel) && data.setLevel !== 'suggested') return;
    const reasonInput = dialog.querySelector('#priority-reason');
    const reason = reasonInput.value.trim();
    if (data.setLevel!=='suggested' && data.setLevel!==incidentPriority(incident) && !reason) {
      reasonInput.setCustomValidity('Describe what changed.');
      reasonInput.reportValidity();
      reasonInput.setCustomValidity('');
      return;
    }
    void update(state=>{
      const previous = incidentPriority(incident,state);
      state.priorities ||= {};
      if (data.setLevel === 'suggested') delete state.priorities[incident.id];
      else state.priorities[incident.id] = data.setLevel;
      recordPriority(state,incident.id,previous,incidentPriority(incident,state),reason || 'Returned to the suggested priority based on the sample impact.',actor,Date.now());
      dialog.close();
      return `Priority set to ${incidentPriority(incident,state)}.`;
    });
  }
  else if (data.calendarDay) { calendarDay = Number(data.calendarDay); render(); }
  else if ('calendarAll' in data) { calendarDay = undefined; render(); }
  else if ('assistant' in data) assistant();
  else if ('mic' in data) listen();
  else if ('speak' in data) readAloud(document.querySelector('#answer').textContent);
  else if ('close' in data) button.closest('dialog').close();
  else if (data.prompt) void ask(data.prompt);
  else if ('copy' in data) {
    navigator.clipboard?.writeText(document.querySelector('#draft-note').value)
      .then(()=>notice('Handoff draft copied.'),()=>notice('Select the draft text to copy it.'));
  } else if (data.saveNote) {
    const note = document.querySelector('#draft-note').value;
    void update(state=>{
      (state.notes ||= {})[data.saveNote] = note;
      return 'Handoff draft saved on this computer.';
    });
  } else if (data.service) {
    const service = services.find(item=>item.name===data.service);
    const matching = openIncidents().filter(item=>[...item.confirmed,...item.possible].includes(service.name));
    openDialog(service.group, service.name, matching.length ? matching.map(item=>`<p>${html(item.title)} · ${workspace.custom[item.id] ? 'Test event' : item.confirmed.includes(service.name) ? 'Confirmed impact' : 'Possible impact'}</p><button class="small" data-open-case="${item.id}">Open ${item.id}</button>`).join('') : '<p>No active alerts in this sample workspace.</p>');
  }
});
document.addEventListener('submit',event=>{
  if (event.target.id === 'assistant-form') {
    event.preventDefault();
    void ask(document.querySelector('#question').value);
  }
  const form=event.target;
  if (form.id==='simulation-form') {
    event.preventDefault();
    simulatorDraft = {...simulatorDraft,...Object.fromEntries(new FormData(form))};
    const feedback = form.querySelector('#simulation-error');
    feedback.textContent = '';
    try { previewSimulation(simulatorDraft); }
    catch (error) { feedback.textContent = error.message; }
    return;
  }
  if (form.matches('[data-edit-simulation]')) {
    event.preventDefault();
    const id = form.dataset.editSimulation;
    const fields = Object.fromEntries(new FormData(form));
    if (fields.level!==workspace.custom[id]?.level && !fields.priorityReason.trim()) {
      const reason = form.elements.priorityReason;
      reason.setCustomValidity('Describe what changed.');
      reason.reportValidity();
      reason.setCustomValidity('');
      return;
    }
    if (fields.status==='resolved') { openResolution(id,fields.level,fields.note,fields.priorityReason); return; }
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    void update(state=>{
      const record = state.custom[id];
      if (!record) throw Error('This test event was removed.');
      const now = Date.now();
      const previous = record.level;
      if (record.status==='resolved' && fields.status!=='resolved') state.arrivals[id]=now;
      if (!updateSimulation(record,fields,actor,now)) return 'The incident is already up to date.';
      recordPriority(state,id,previous,record.level,fields.priorityReason.trim(),actor,now);
      if (!state.active.includes(id) && !record.groupedUnder) state.active.push(id);
      notification(state,id,`${testStatus(record)} · ${record.title}`,fields.note.trim() || `Updated by ${actor}`);
    }).then(saved=>{if (saved && submit.isConnected) dialog.close(); else submit.disabled=false;});
    return;
  }
  if (form.matches('[data-resolution-form]')) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    void update(state=>saveResolution(state,form.dataset.resolutionForm,fields,actor,Date.now()))
      .then(saved=>{
        if (saved && submit.isConnected) dialog.close();
        else submit.disabled=false;
        if (saved) void syncReportEvents();
      });
    return;
  }
  if (form.matches('[data-exposure-form]')) {
    event.preventDefault();
    const fields=Object.fromEntries(new FormData(form));
    const assumptions={low:Number(fields.low),high:Number(fields.high),order:Number(fields.order)};
    if (!Object.values(assumptions).every(value=>Number.isFinite(value) && value>=0 && value<=100_000_000) ||
        assumptions.low>assumptions.high) {
      form.elements.high.setCustomValidity('The upper rate must be at least the lower rate.');
      form.elements.high.reportValidity();
      form.elements.high.setCustomValidity('');
      return;
    }
    void update(state=>{state.exposure[form.dataset.exposureForm]=assumptions;dialog.close();});
    return;
  }
  if(form.matches('[data-telegram-notice-form]')){
    event.preventDefault();
    const id=form.elements.incident.value;
    const recipient=form.elements.recipient.value;
    const record=workspace.custom[id];
    const simulation=record ? simulationPayload(record) : undefined;
    const button=form.querySelector('[type=submit]');
    const target=form.querySelector('[data-delivery-status]');
    button.disabled=true;
    target.textContent='Preparing the Telegram notification…';
    void deliveryApi('telegram-notice-preview',{incident:id,level:incidentPriority(byId(id)),recipient,simulation}).then(result=>{
      if(target.isConnected&&dialog.open)showTelegramNotice(result,recipient);
    },error=>{if(target.isConnected){deliveryError(error);button.disabled=false;}});
    return;
  }
  if(form.matches('[data-auto-telegram]')){
    event.preventDefault();
    void updateTelegramMode({enabled:true,owner:form.elements.owner.value,wait:Number(form.elements.wait.value)},form.querySelector('[type=submit]'));
    return;
  }
  if(form.matches('[data-route-pair]')) {event.preventDefault();void startRoutePair(form);return;}
  if(form.matches('[data-verify-team]')){
    event.preventDefault();
    const button=form.querySelector('[type=submit]');
    const target=form.querySelector('[data-team-result]');
    button.disabled=true;
    target.textContent='Checking group membership and posting permissions…';
    void deliveryApi('telegram-pair-group',{chat:form.elements.chat.value}).then(result=>{
      if(target.isConnected&&dialog.open)openDialog('Telegram routing','Destination paired',`<p>${html(result.detail)}</p><button class="small primary" data-telegram-routing>View Telegram routing</button>`);
    },error=>{if(target.isConnected){target.textContent=error.message;button.disabled=false;}});
    return;
  }
  if(form.matches('[data-routing-preview]')) {
    event.preventDefault();
    const id=form.dataset.routingPreview;
    const button=form.querySelector('[type=submit]');
    const target=form.querySelector('[data-delivery-status]');
    button.disabled=true;
    target.textContent='Preparing the exact messages…';
    void deliveryApi('telegram-route-preview',{incident:id,level:incidentPriority(byId(id)),wait:Number(form.elements.wait?.value||60),owner:form.elements.owner?.value}).then(result=>{
      if(target.isConnected&&dialog.open)previewTelegramRoute(id,result);
    },error=>{if(target.isConnected){deliveryError(error);button.disabled=false;}});
    return;
  }
  if (!form.matches('[data-provider-form],[data-preview-form]')) return;
  event.preventDefault();
  const values=new FormData(form);
  const submit=form.querySelector('[type=submit]');
  submit.disabled=true;
  const target=form.querySelector('[data-delivery-status]');
  target.textContent='Working…';
  const incident=form.dataset.previewForm && byId(form.dataset.previewForm);
  const isSettings=Boolean(form.dataset.providerForm);
  const payload=isSettings ? {
    channel:form.dataset.providerForm,
    fields:Object.fromEntries([...values.entries()].map(([name,value])=>[name,value.trim()]).filter(([name,value])=>name!=='recipients' && value)),
    ...(form.dataset.emailService ? {provider:form.dataset.emailService,
      recipients:values.get('recipients').split(/[\n,;]+/).map(value=>value.trim()).filter(Boolean)} : {}),
  } : {incident:incident.id,level:incidentPriority(incident),targets:values.getAll('target')};
  void deliveryApi(isSettings?'settings':'preview',payload).then(result=>{
    if (!dialog.open || !target.isConnected) return;
    if (isSettings) void showChannels();
    else showDeliveryPreview(result);
  },error=>{
    if (!target.isConnected) return;
    deliveryError(error);
    submit.disabled=false;
  });
});
document.addEventListener('input',event=>{
  if (event.target.form?.id==='simulation-form') simulatorDraft[event.target.name] = event.target.value;
  if (event.target.id==='alert-search') {
    alertQuery = event.target.value.trim().toLowerCase();
    document.querySelector('#alert-list').innerHTML = alertCards();
  }
  if (event.target.id === 'cost-window') {
    const incident=byId(selected);
    const minutes = Number(event.target.value);
    exposureWindows.set(incident.id,minutes);
    document.querySelector('#cost-minutes').textContent = `${minutes} minutes`;
    document.querySelector('#cost-projection').textContent = exposureLabel(incidentExposure(incident),minutes);
  }
  if (event.target.id === 'search') {
    query = event.target.value.trim().toLowerCase();
    const lists = {services:serviceList,history:historyList,runbooks:documentList};
    document.querySelector('#list').innerHTML = lists[view()]();
  }
  if (event.target.id === 'replay-range') {
    const incident = byId(selected);
    cutoff = times(incident)[Number(event.target.value)];
    event.target.setAttribute('aria-valuetext',snapshotLabel(cutoff));
    document.querySelector('#replay-time').textContent = snapshotLabel(cutoff);
    document.querySelector('#replay-details').innerHTML = replayDetails(incident,investigateCase(incident));
    if (assistantWindow.open) assistantWindow.close();
  }
});
document.addEventListener('change',event=>{
  if (event.target.id==='report-company') {
    reportCompany=event.target.value ? event.target.value.slice('company:'.length) : null;
    render();
    document.querySelector('#report-company')?.focus({preventScroll:true});
    return;
  }
  if (event.target.id==='report-samples') {
    includeSampleReports=event.target.checked;
    render();
    document.querySelector('#report-samples')?.focus({preventScroll:true});
    return;
  }
  if (event.target.matches('[data-resolution-template]')) {
    const form = event.target.form;
    const incident = byId(form.dataset.resolutionForm);
    const previous = investigateCase(incident,'23:59').exact.find(record=>record.id===event.target.value);
    if (previous) {
      form.elements.cause.value = previous.cause || '';
      form.elements.fix.value = previous.fix || '';
      form.elements.verification.value = '';
      if (documents.some(item=>item.id===previous.runbook && item.service===incident.service)) {
        form.elements.runbook.value = previous.runbook;
      } else {
        form.elements.runbook.value = documents.find(item=>item.incident===previous.id)?.id || '';
      }
      form.querySelector('[data-resolution-feedback]').textContent = 'Prior cause and fix copied for review. Enter what verified recovery this time.';
    }
    return;
  }
  if (event.target.name==='trigger' && event.target.form?.id==='simulation-form') {
    const scheduled = event.target.value==='scheduled';
    const label = event.target.form.querySelector('[data-scheduled-field]');
    const timeInput = label.querySelector('input');
    label.hidden = !scheduled;
    timeInput.disabled = !scheduled;
    timeInput.required = scheduled;
    if (scheduled) timeInput.min = earliestLocalTrigger();
    event.target.form.querySelector('[data-schedule-hint]').hidden = !scheduled;
  }
  if (event.target.id==='alert-sort') {
    alertSort = event.target.value;
    document.querySelector('#alert-list').innerHTML = alertCards();
  }
  if (event.target.id === 'calendar-month') {
    calendarMonth = Number(event.target.value);
    calendarDay = undefined;
    render();
    document.querySelector('#calendar-month').focus();
  }
});
assistantWindow.addEventListener('close',()=>{
  dialogRevision++;
  speech?.abort();
  window.speechSynthesis?.cancel();
});
personaMenu.addEventListener('beforetoggle',event=>{
  if (event.newState==='open') positionPersonaMenu();
});
personaMenu.addEventListener('toggle',()=>{
  const open = personaMenu.matches(':popover-open');
  persona.setAttribute('aria-expanded',String(open));
  if (open && !personaMenu.contains(document.activeElement)) focusPersonaChoice();
});
persona.addEventListener('keydown',event=>{
  if (!['ArrowDown','ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  if (!personaMenu.matches(':popover-open')) personaMenu.showPopover();
  const choices = [...personaMenu.querySelectorAll('[data-persona-choice]')];
  (event.key==='ArrowDown' ? choices[0] : choices.at(-1))?.focus();
});
personaMenu.addEventListener('keydown',event=>{
  if (event.key==='Escape' || event.key==='Tab') {
    if (event.key==='Escape') event.preventDefault();
    personaMenu.hidePopover();
    persona.focus({preventScroll:true});
    return;
  }
  if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const choices = [...personaMenu.querySelectorAll('[data-persona-choice]')];
  const current = choices.indexOf(document.activeElement);
  const next = {Home:0,End:choices.length-1,ArrowDown:(current+1)%choices.length,
    ArrowUp:(current+choices.length-1)%choices.length}[event.key];
  choices[next]?.focus();
});
personaMenu.addEventListener('click',event=>{
  const option = event.target.closest('[data-persona-choice]');
  if (!option) return;
  actorChoice = personaChoice = option.dataset.personaChoice;
  actor = telegramResponders.get(personaChoice) || personaChoice;
  sessionStorage.setItem('ic-actor',actorChoice);
  updatePersonaTrigger();
  for (const item of personaMenu.querySelectorAll('[data-persona-choice]')) {
    item.setAttribute('aria-checked',String(item===option));
  }
  personaMenu.hidePopover();
  persona.focus({preventScroll:true});
  render();
});
for (const eventName of ['resize','scroll']) {
  window.addEventListener(eventName,()=>{
    if (personaMenu.matches(':popover-open')) positionPersonaMenu();
  },{passive:true});
}
main.addEventListener('pointerover',describeRadarSignal);
main.addEventListener('focusin',describeRadarSignal);
night.addEventListener('click',()=>{
  const enabled = document.body.classList.toggle('night');
  night.setAttribute('aria-pressed',String(enabled));
  localStorage.setItem('ic-night',String(enabled));
});
window.addEventListener('storage',event=>{
  if (event.key !== saveKey) return;
  const before = new Set(workspace.notifications.map(entry=>entry.key));
  workspace = read();
  if (!byId(selected)) choose(workspace.active[0] || 'INC-121');
  render();
  discardRemovedToasts();
  queueToasts(workspace.notifications.filter(entry=>!before.has(entry.key)).reverse());
});
window.addEventListener('hashchange',()=>{
  if (location.hash==='#main') return;
  document.querySelector('#nav-toggle').setAttribute('aria-expanded','false');
  if (view()!==renderedPage) window.scrollTo({top:0,behavior:'instant'});
  query=''; render(); main.focus({preventScroll:true});
});
document.querySelector('#nav-toggle').addEventListener('click',event=>{
  const control = event.currentTarget;
  control.setAttribute('aria-expanded',String(control.getAttribute('aria-expanded')!=='true'));
});
document.querySelector('.skip').addEventListener('click',event=>{event.preventDefault(); main.focus();});
window.addEventListener('focus',refreshAutomaticIndicator);
refreshAutomaticIndicator();
tick();
setInterval(tick,500);
if (checkingGemini) {
  fetch('/api/status',{signal:AbortSignal.timeout(5000)})
    .then(response=>response.json())
    .then(status=>{connected = status.gemini===true;})
    .catch(()=>{})
    .finally(()=>{
      checkingGemini = false;
      render();
      void runNextAnalysis();
    });
}
render();
