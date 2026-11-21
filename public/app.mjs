import {documents, history, investigate, priority, scenarios, services, teammates, upcoming} from './data.mjs';

const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const assistantWindow = document.querySelector('#assistant-window');
const persona = document.querySelector('#persona');
const night = document.querySelector('#night');
const saveKey = 'incident-compass-workspace-v1';
const windowMs = 30_000;
const tabs = [['brief','Brief'],['details','Case details'],['runbook','Runbooks'],['trace','Investigation log'],['replay','Time Machine'],['compare','Compare']];
const pages = ['desk','alerts','services','history','runbooks','calendar','chat'];
const byId = id => scenarios.find(incident => incident.id === id);
const html = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const badge = level => `<span class="badge ${level}">${level}</span>`;
const ref = id => `<button type="button" class="ref" data-source="${html(id)}">${html(id)}</button>`;
const documentLink = document => `<button type="button" class="small doc-link" data-source="${html(document.id)}">${html(document.id)} · ${html(document.title)}</button>`;
const cad = dollars => new Intl.NumberFormat('en-CA', {style:'currency',currency:'CAD',maximumFractionDigits:0}).format(dollars);
const levels = ['P1','P2','P3'];
const severityNames = {P1:'Critical',P2:'High',P3:'Monitor'};
const incidentPriority = (incident,state = workspace) => state.priorities?.[incident.id] || priority(incident);

function initial() {
  return {active:scenarios.slice(0,3).map(incident => incident.id), tasks:{}, messages:[], priorities:{}, notifications:[], notes:{}};
}
function read() {
  try { return JSON.parse(localStorage.getItem(saveKey)) || initial(); }
  catch { return initial(); }
}
let workspace = read();
let actor = sessionStorage.getItem('ic-actor') || teammates[0];
let selected = 'INC-121';
let activeTab = 'brief';
let cutoff = '23:59';
let query = '';
let connected = false;
let toastTimer;
let speech;
let dialogRevision = 0;
let escalatorBusy = false;
let conversation = [];
let conversationScope;
let calendarMonth = 10;
let calendarDay;
let alertFilter = 'all';
let automaticTelegram = false;
let deliveryState;
let deliveryPreview;
const channelSetup = {
  sms:{name:'SMS',provider:'Twilio',setup:'https://console.twilio.com/',fields:[['TWILIO_ACCOUNT_SID','Account SID'],['TWILIO_AUTH_TOKEN','Auth token',true],['TWILIO_FROM','SMS-capable sender number']]},
  email:{name:'Email',provider:'Resend',setup:'https://resend.com/api-keys',fields:[['RESEND_API_KEY','API key',true],['ALERT_EMAIL_FROM','Verified sender email']]},
  telegram:{name:'Telegram',provider:'Telegram Bot API',setup:'https://t.me/BotFather',fields:[['TELEGRAM_BOT_TOKEN','BotFather token',true],['TELEGRAM_CHAT_ID','Chat ID or public channel username']]},
};

persona.innerHTML = teammates.map(name => `<option>${html(name)}</option>`).join('');
persona.value = actor;
document.body.classList.toggle('night', localStorage.getItem('ic-night') === 'true');
night.setAttribute('aria-pressed', String(document.body.classList.contains('night')));

function view() {
  const hash = location.hash.slice(1);
  return pages.includes(hash) ? hash : 'desk';
}
function notice(message) {
  const toast = document.querySelector('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toastTimer = setTimeout(() => { toast.textContent = ''; }, 4800);
}

async function update(change) {
  const apply = () => {
    workspace = read();
    const message = change(workspace);
    localStorage.setItem(saveKey, JSON.stringify(workspace));
    render();
    if (message) notice(message);
  };
  if (navigator.locks) await navigator.locks.request(saveKey, apply);
  else apply();
}

function escalate(state, incident, reason) {
  state.tasks[incident.id] = {status:'open', reason};
  state.messages.push({id:incident.id, type:'open', reason, time:Date.now()});
  notification(state,incident.id,'Team escalation',`Posted to #general. ${reason}`);
}

function notification(state,id,title,description) {
  (state.notifications ||= []).unshift({id,title,description,time:Date.now(),level:incidentPriority(byId(id),state)});
  state.notifications.length = Math.min(state.notifications.length,30);
}

function pageOnCall(state,incident) {
  state.tasks[incident.id] = {status:'pending', until:Date.now() + windowMs};
  notification(state,incident.id,'Urgent page',`Awaiting acknowledgement from ${incident.owner}.`);
}

function tick() {
  const latest = read();
  const due = Object.entries(latest.tasks).filter(([, task]) => task.status === 'pending' && task.until <= Date.now());
  if (due.length && !escalatorBusy) {
    escalatorBusy = true;
    update(state => {
      const expired = due.filter(([id]) => state.tasks[id]?.status === 'pending' && state.tasks[id].until <= Date.now());
      for (const [id] of expired) escalate(state, byId(id), 'Acknowledgement timed out.');
      if (expired.length) return 'Urgent page escalated to #general.';
    }).finally(() => { escalatorBusy = false; });
  }
  const timer = document.querySelector('[data-countdown]');
  const task = latest.tasks[selected];
  if (timer && task?.status === 'pending') timer.textContent = Math.max(0, Math.ceil((task.until - Date.now()) / 1000)) + 's';
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
    if (canAccept || canClaim) {
      state.tasks[id] = {status:'claimed', by:performer};
      notification(state,id,'Ownership confirmed',`${performer} accepted the task.`);
      if (canClaim) state.messages.push({id, type:'claim', by:performer, time:Date.now()});
      return `${performer} accepted ownership of ${id}.`;
    }
  });
}

function taskBar(incident) {
  const task = workspace.tasks[incident.id];
  if (!task && incidentPriority(incident) !== 'P1') return '';
  const taskButton = (action, label, style = '') => `<button class="small ${style}" data-task="${action}" data-id="${incident.id}">${html(label)}</button>`;
  if (!task) return `<div class="handoff"><span><strong>Urgent response</strong> · ${incident.owner} on call</span>${taskButton('page','Page on-call','primary')}</div>`;
  if (task.status === 'claimed') return `<div class="handoff"><strong>Accepted by ${html(task.by)}</strong><span class="small quiet">Owner confirmed</span></div>`;
  if (task.status === 'open') return `<div class="handoff"><strong>Escalated to #general</strong><div class="buttons"><button class="small" data-nav="chat">Open team chat</button>${taskButton('claim','Claim as ' + actor,'primary')}</div></div>`;
  return `<div class="handoff"><span><strong>Waiting for ${incident.owner}</strong> · <span class="mono" data-countdown>${Math.max(0,Math.ceil((task.until-Date.now())/1000))}s</span></span><div class="buttons">
    ${actor === incident.owner ? taskButton('accept','Accept task','primary') + taskButton('decline','I’m busy','danger') : ''}
    ${taskButton('expire','Simulate timeout')}</div></div>`;
}

function brief(incident, result) {
  if (!result.observed) return '<div class="lead"><strong>The alert hasn’t fired yet.</strong><p>Move the Time Machine forward to see the brief as it became available.</p></div>';
  const historical = result.nearby[0];
  const money = incident.money;
  const snapshotTime = cutoff === '23:59' ? result.evidence.at(-1)?.seen || incident.alert : cutoff;
  const minutes = Math.max(0,toMinute(snapshotTime)-toMinute(incident.alert));
  const estimate = money && `${cad(money.low * money.order * minutes)}–${cad(money.high * money.order * minutes)} CAD`;
  return `<div class="lead"><div class="kicker">${result.exact.length && result.known ? 'Strong historical match' : incident.variant === 'Unknown issue' ? 'Needs investigation' : 'Working hypothesis'}</div>
    <h3>${html(result.cause)}</h3><div class="references">${incident.causeSources.map(ref).join('')}</div></div>
    ${result.alternative ? `<div class="panel dissent"><div class="kicker">Dissenting Detective</div><p>${html(incident.alternative)}</p>${ref(result.alternative.id)}
    <details class="block"><summary>What would change the lead?</summary><p>If the old version times out at the same rate during the same provider window, the release becomes a weaker explanation.</p></details></div>` : ''}
    <div class="duo block">
      <div class="panel"><div class="kicker">Known fix</div><h3>${result.known ? html(result.known.fix) : 'No known fix for this alert'}</h3>
      <p class="quiet">${result.known ? `Documented by ${html(result.known.responder)} in ${html(result.known.id)}.` : result.exact.length ? `The matching record lists ${html(result.exact[0].responder)} and omits the resolution steps.` : 'The history has no matching error signature with a verified fix.'}</p>
      ${historical ? ref(result.known?.id || historical.id) : ''}
      ${result.verifiedDocument ? `<div class="block">${documentLink(result.verifiedDocument)}</div>` : ''}</div>
      <div class="panel"><div class="kicker">First check</div><h3>${html(incident.next)}</h3><small>The on-call engineer reviews the evidence and decides.</small></div>
    </div>
    ${result.guide && !result.verifiedDocument ? `<div class="panel block"><div class="kicker">${html(result.guide.kind)}</div><p>${html(result.guide.useWhen)}</p>${documentLink(result.guide)}</div>` : ''}
    <div class="duo block">
      <div class="panel"><div class="kicker">Recent changes</div><ul class="archive">${result.changes.map(change => `<li><strong>${html(change.title)}</strong><br><small>${change.time} ET</small> ${ref(change.id)}</li>`).join('') || '<li>No relevant change recorded in this snapshot.</li>'}</ul></div>
      <div class="panel"><div class="kicker">Impact and priority</div><h3>${incidentPriority(incident)} · ${incident.affectedPct}% of monitored operations affected</h3>
      <p>Confirmed: ${incident.confirmed.join(', ')}.<br>Possible downstream impact: ${incident.possible.join(', ')}.</p>
      <details><summary>Why this priority?</summary><p>Suggested ${priority(incident)}. ${incident.core ? 'Customer-facing service.' : 'Internal or indirect customer impact.'} Priority considers the affected share and whether the service is customer-facing. ${historical ? `Previous incident ${historical.id} was ${historical.priority}.` : ''}</p></details>
      ${money ? `<details><summary>${estimate} in orders at risk</summary><p>${minutes} min × ${money.low}–${money.high} affected orders/min × ${cad(money.order)} per order. Fictional inputs through ${snapshotTime} ET. Orders may be delayed or recovered.</p>
      <label for="cost-window">Explore duration: <output id="cost-minutes">${minutes} minutes</output></label><input type="range" class="range" id="cost-window" min="0" max="60" value="${minutes}">
      <p id="cost-projection" role="status">${estimate} at this duration</p></details>` : '<small>Financial impact unknown.</small>'}</div>
    </div>
    ${result.relatedAlerts.length > 1 ? `<div class="panel block"><details><summary>${result.relatedAlerts.length} alerts grouped into this incident</summary><p>The monitors fired in the same minute and reported the same upstream error. Checkout depends on Payments API.</p>
    <ul class="archive">${result.relatedAlerts.map(event=>`<li>${html(event.service)} · ${html(event.time)} ET · ${ref(event.id)}</li>`).join('')}</ul><small>Shared cause remains a working hypothesis.</small></details></div>` : ''}
    <div class="panel block"><details><summary>Recovery checks</summary><p>${html(incident.verify)}</p></details></div>`;
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
    <section class="panel block"><h3>What the records show</h3><ol class="archive">${result.findings.map(finding=>`<li><p>${html(finding.text)}</p><div class="references">${finding.ids.map(ref).join('')}</div></li>`).join('')}</ol></section>
    <section class="panel block"><h3>Open questions</h3><ul>${incident.unknowns.map(question=>`<li>${html(question)}</li>`).join('')}</ul><p><strong>First check:</strong> ${html(incident.next)}</p></section>
    <section class="panel block"><h3>Raw records in this snapshot</h3><ul class="archive">${result.evidence.map(event=>`<li><div class="row"><strong>${html(event.title)}</strong>${ref(event.id)}</div><small>${html(event.kind)} · Available at ${event.seen} ET</small><p>${html(event.detail)}</p></li>`).join('')}</ul></section>`;
}

function incidentRunbooks(result) {
  if (!result.observed) return '<p>The alert had not fired at this point in the replay.</p>';
  const guide = result.guide;
  return `<div class="lead"><h3>${result.verifiedDocument ? 'Procedure linked to the matching past fix' : 'No verified fix for this error signature'}</h3>
    <p>${result.verifiedDocument ? 'Check the runbook preconditions against the current evidence before following it.' : 'The documentation below can help you investigate or compare this alert with a different case.'}</p></div>
    ${guide ? `<section class="panel block"><div class="kicker">${html(guide.kind)}</div><h3>${html(guide.title)}</h3><p>${html(guide.useWhen)}</p>
    <ol class="archive">${guide.steps.map(([title,step])=>`<li><strong>${html(title)}</strong><p>${html(step)}</p></li>`).join('')}</ol>
    <p><strong>Pause if:</strong> ${html(guide.stopWhen)}</p><p><strong>Verify:</strong> ${html(guide.verify)}</p>${documentLink(guide)}</section>` : ''}
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
  return [...new Set(incident.events.map(event=>event.seen))].sort();
}

function replay(incident, result) {
  const stamps = times(incident);
  const index = cutoff === '23:59' ? stamps.length - 1 : stamps.indexOf(cutoff);
  return `<div class="row"><h3>What did we know at the time?</h3><button class="small" data-live>Latest snapshot</button></div>
    <p class="quiet">Scrub through when evidence first became available.</p>
    <label for="replay-range">Evidence available at <strong class="mono" id="replay-time">${stamps[index]} ET</strong></label>
    <input class="range" id="replay-range" type="range" min="0" max="${stamps.length - 1}" value="${index}" aria-valuetext="${stamps[index]} ET">
    <div id="replay-details">${replayDetails(incident,result)}</div>`;
}

function replayDetails(incident,result) {
  return `<p class="lead"><strong>${html(result.cause)}</strong>${result.alternative ? `<br>${html(incident.alternative)}` : ''}</p>
    <ul class="timeline">${result.evidence.map(event=>`<li><span class="mono">${event.seen} ET / ${event.kind}</span><br><strong>${html(event.title)}</strong><p>${html(event.detail)}</p>${ref(event.id)}</li>`).join('')}</ul>`;
}

function compare(incident, result) {
  if (!result.observed) return '<p>The alert has not fired at this point in the replay.</p>';
  const record = result.exact[0] || result.nearby[0];
  if (!record) return '<p>No relevant incident found in the sample archive.</p>';
  const match = incident.fingerprint === record.fingerprint;
  return `<p class="lead"><strong>${match ? 'Same service and error signature.' : 'Same service, different error signature.'}</strong><br>${match ? 'Verify the earlier fix applies to the current environment.' : 'Treat the old resolution as background only.'}</p>
    <div class="duo"><section class="panel"><div class="kicker">Current / ${incident.id}</div><h3>${html(incident.title)}</h3><p class="mono">${incident.fingerprint}</p><p>Suggested priority: ${priority(incident)}</p><p>${html(result.cause)}</p></section>
    <section class="panel"><div class="kicker">Previous / ${record.id}</div><h3>${html(record.title)}</h3><p class="mono">${record.fingerprint}</p><p>${record.priority} · ${html(record.responder)}</p><p>${html(record.fix || 'The responder did not document a fix.')}</p>${ref(record.id)}</section></div>`;
}

function desk() {
  const queue = workspace.active.map(byId).filter(Boolean).sort((a,b)=>incidentPriority(a).localeCompare(incidentPriority(b)));
  const incident = byId(selected) || queue[0];
  const result = investigate(incident,cutoff);
  const content = {brief:()=>brief(incident,result), details:()=>caseDetails(incident,result), runbook:()=>incidentRunbooks(result), trace:()=>trace(result), replay:()=>replay(incident,result), compare:()=>compare(incident,result)};
  return `<section class="hero intro"><div><div class="kicker">On-call desk / Brampton AI Innovator</div><h1>THE INCIDENT <em>DESK.</em></h1><p>Review alerts, follow the evidence, and get an engineer on the case.</p></div>
    <div class="radar" aria-hidden="true"><i style="--size:56px"></i><i style="--size:107px"></i><i style="--size:154px"></i><b style="--x:43%;--y:37%"></b><b style="--x:73%;--y:59%"></b><b style="--x:57%;--y:74%"></b><span class="mono">DEMO SIGNAL</span></div></section>
    <div class="stats"><div class="stat"><strong>${services.length}</strong><small>Services monitored</small></div><div class="stat"><strong>${queue.length}</strong><small>Active incidents</small></div>
    <div class="stat"><strong>${queue.filter(item=>incidentPriority(item)==='P1').length}</strong><small>Urgent incidents</small></div><div class="stat"><strong>${history.length}</strong><small>Archived incidents</small></div></div>
    <div class="desk">
      <aside class="queue"><div class="section-top"><h2>Alert queue</h2><span class="badge neutral">SIMULATION</span></div>
      ${queue.map(item=>`<button class="queue-item" data-case="${item.id}" aria-pressed="${item.id===selected}"><span class="row"><span>${badge(incidentPriority(item))} <small>${severityNames[incidentPriority(item)]}</small></span><small class="mono">${item.alert} ET</small></span><strong>${html(item.title)}</strong><small>${html(item.service)} · ${item.variant}</small></button>`).join('')}
      <div class="simulate"><div class="simulate-head"><span class="kicker">Simulate an alert</span><button class="small" data-reset>Reset</button></div>
      <p class="small quiet" data-auto-telegram-hint>${automaticTelegram?'New simulations automatically send to Telegram.':'Simulations stay in the dashboard while Telegram automation is off.'}</p>
      <div class="buttons">${scenarios.map(item=>`<button class="small" data-trigger="${item.id}">${item.variant}</button>`).join('')}</div></div></aside>
      <article class="case"><div class="case-head"><div class="case-top"><span class="case-meta">${incident.id} / ${html(incident.service)} / ${incident.alert} ET</span><div class="actions"><button class="small" data-handoff>Draft handoff</button><button class="primary small" data-assistant>✳ Ask assistant</button></div></div>
      <h2>${html(incident.title)}</h2><div class="row"><p>${badge(incidentPriority(incident))} <small>${incident.variant}${cutoff === '23:59' ? '' : ' · Replay through ' + cutoff + ' ET'}</small></p><button class="small" data-priority>Change priority</button></div></div>
      ${taskBar(incident)}
      <div class="tabs" role="group" aria-label="Incident details">${tabs.map(([key,label])=>`<button class="tab" data-tab="${key}" aria-pressed="${key===activeTab}">${label}</button>`).join('')}</div>
      <div class="case-content" id="case-content">${content[activeTab]()}</div></article>
    </div>`;
}

function layout(title, detail, content, search = false) {
  return `<section class="page intro"><div class="page-hero"><div><div class="kicker">Incident Compass / Demo workspace</div><h1>${title}</h1><p>${detail}</p></div>
    ${search ? '<input id="search" type="search" aria-label="Filter records" placeholder="Filter records…">' : ''}</div>${content}</section>`;
}
function serviceList() {
  return services.filter(service=>`${service.name} ${service.group}`.toLowerCase().includes(query)).map(service=>{
    const confirmed = workspace.active.map(byId).find(incident=>incident.confirmed.includes(service.name));
    const possible = workspace.active.map(byId).find(incident=>incident.possible.includes(service.name));
    return `<button data-service="${html(service.name)}"><small class="mono">${service.group}</small><strong>${html(service.name)}</strong><small>${confirmed ? '● Incident confirmed' : possible ? '◌ Possible impact' : '○ No active alert'}</small></button>`;
  }).join('') || '<p>No services match the filter.</p>';
}
function historyList() {
  return history.filter(record=>Object.values(record).join(' ').toLowerCase().includes(query)).map(record=>`<li class="row"><div><span class="mono quiet">${record.date} · ${record.id}</span><h3>${html(record.title)}</h3><p>${html(record.service)} · ${html(record.responder)} · ${record.fix ? 'Fix documented' : 'Fix missing'}</p></div><div>${badge(record.priority)} ${ref(record.id)}</div></li>`).join('') || '<li>No incidents match the filter.</li>';
}
function documentList() {
  return documents.filter(document=>[document.id,document.title,document.service,document.kind,document.useWhen,document.incident].join(' ').toLowerCase().includes(query)).map(document=>`
    <li class="row"><div><span class="mono quiet">${html(document.id)} · ${html(document.kind)}</span><h3>${html(document.title)}</h3><p>${html(document.service)} · ${html(document.owner)}</p></div>${documentLink(document)}</li>
  `).join('') || '<li>No procedures match the filter.</li>';
}
function calendar() {
  const recent = scenarios.flatMap(incident=>incident.events.filter(event=>['Change','Maintenance'].includes(event.kind)).map(event=>({...event,service:incident.service}))).sort((a,b)=>b.time.localeCompare(a.time));
  const records = [
    ...history.map(record=>({...record,kind:'Archived incident'})),
    ...recent.map(record=>({...record,date:'Nov 21'})),
    ...upcoming,
  ];
  const month = ['Sep','Oct','Nov'][calendarMonth-8];
  const monthName = ['September','October','November'][calendarMonth-8];
  const visible = records.filter(record=>record.date.startsWith(month + ' '));
  const byDay = day => visible.filter(record=>record.date === `${month} ${String(day).padStart(2,'0')}`);
  const firstDay = new Date(Date.UTC(2026,calendarMonth,1)).getUTCDay();
  const days = new Date(Date.UTC(2026,calendarMonth+1,0)).getUTCDate();
  const grid = Array.from({length:days},(_,index)=>{
    const day = index+1;
    const count = byDay(day).length;
    return `<button data-calendar-day="${day}" aria-pressed="${day===calendarDay}" aria-label="${monthName} ${day}, ${count} records">${day}${count ? `<span class="calendar-count">${count}</span>` : ''}</button>`;
  }).join('');
  const items = (calendarDay ? byDay(calendarDay) : visible).sort((a,b)=>
    Number(a.date.slice(4))-Number(b.date.slice(4)) || (a.time || '').localeCompare(b.time || '')
  ).map(record=>`<li class="row"><div><span class="mono">${record.date}${record.time ? ' · ' + record.time + ' ET' : ''}</span><br><strong>${html(record.title)}</strong><br><small>${html(record.service)} · ${record.kind}</small></div>${record.id ? ref(record.id) : ''}</li>`).join('');
  return layout('Change calendar.','Browse archived incidents, releases, and scheduled maintenance.',`<div class="duo">
    <section class="panel"><div class="row"><h2>${monthName} 2026</h2><label><span class="sr-only">Calendar month</span><select id="calendar-month">${['September','October','November'].map((value,index)=>`<option value="${index+8}" ${index+8===calendarMonth?'selected':''}>${value}</option>`).join('')}</select></label></div>
    <div class="calendar-grid" role="group" aria-label="${monthName} 2026 dates">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=>`<small>${day}</small>`).join('')}${'<span></span>'.repeat(firstDay)}${grid}</div></section>
    <section class="panel"><div class="row"><h2>${calendarDay ? monthName + ' ' + calendarDay : 'Month agenda'}</h2>${calendarDay ? '<button class="small" data-calendar-all>Show month</button>' : ''}</div><ul class="archive">${items || '<li>No records on this date.</li>'}</ul></section></div>`);
}
function chat() {
  const records = workspace.messages.map(message=>{
    const incident = byId(message.id);
    const available = workspace.tasks[message.id]?.status === 'open';
    const time = new Date(message.time).toLocaleTimeString('en-CA',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit'});
    return `<li><small class="mono">${html(time)} ET · ${message.type === 'open' ? 'INCIDENT COMPASS / @TEAM' : 'OWNERSHIP CONFIRMED'}</small>
      ${message.type === 'open' ? `<h3>Unclaimed at escalation: ${incident.title}</h3><p>${html(message.reason)} · ${incident.id} · P1 · ${incident.service}</p>` : `<p><strong>${html(message.by)}</strong> accepted ${message.id}.</p>`}
      <div class="buttons"><button data-open-case="${incident.id}" class="small">Open incident</button>
      ${message.type === 'open' && available ? `<button class="small primary" data-task="claim" data-id="${incident.id}">Claim as ${html(actor)}</button>` : ''}</div></li>`;
  }).join('');
  return layout('# General.','Simulated team chat. Switch teammates at the top to test the handoff.',`<ul class="channel">${records || '<li>No escalations. Page an engineer from the urgent incident to try it.</li>'}</ul>`);
}

function alertInbox() {
  const incidents = workspace.active.map(byId).filter(Boolean).sort((a,b)=>incidentPriority(a).localeCompare(incidentPriority(b)));
  const cards = incidents.filter(item=>alertFilter==='all' || incidentPriority(item)===alertFilter).map(incident=>{
    const level=incidentPriority(incident);
    const alerts=incident.events.filter(event=>event.kind==='Alert');
    const task=workspace.tasks[incident.id];
    const status=task?.status==='claimed' ? 'Accepted by ' + task.by : task?.status==='open' ? 'Waiting for a team claim'
      : task?.status==='pending' ? 'Waiting for acknowledgement' : 'Needs review';
    return `<li class="alert-card ${level}"><div class="row"><span class="badge ${level}">${level} · ${severityNames[level]}</span><small class="mono">${incident.id} · ${incident.alert} ET</small></div>
      <h2>${html(incident.title)}</h2><p>${html(incident.service)} · ${incident.affectedPct}% affected in sample</p>
      <div class="references alert-sources" aria-label="Source alerts">${alerts.map(event=>ref(event.id)).join('')}</div>
      <div class="row"><small>${html(status)}</small><div class="buttons"><button class="small" data-open-case="${incident.id}">Open incident</button><button class="small" data-route-incident="${incident.id}">Route in Telegram</button><button class="small" data-deliver="${incident.id}">Review delivery</button></div></div></li>`;
  }).join('');
  const stats = [['all','All alerts'],...levels.map(level=>[level,level+' '+severityNames[level]])].map(([level,label])=>
    `<button class="small" aria-pressed="${alertFilter===level}" data-alert-filter="${level}">${label} (${level==='all' ? incidents.length : incidents.filter(item=>incidentPriority(item)===level).length})</button>`
  ).join('');
  return layout('Alert inbox.','Review alerts by urgency, open their evidence, and preview outgoing messages.',`
    <div class="row"><div class="buttons" role="group" aria-label="Filter by urgency">${stats}</div><div class="buttons"><span class="badge neutral" data-auto-telegram-badge>Telegram auto: ${automaticTelegram?'on':'off'}</span><button class="small" data-telegram-routing>Telegram routing</button><button class="small" data-channels>Delivery setup</button></div></div>
    <ul class="alert-list">${cards || '<li>No alerts at this urgency level.</li>'}</ul>`);
}

function render() {
  const page = view();
  const focused = document.activeElement;
  const focusKeys = focused && main.contains(focused) ? [...focused.attributes].filter(attribute=>attribute.name.startsWith('data-')) : [];
  const content = {
    desk, calendar, chat, alerts:alertInbox,
    services:()=>layout('Service inventory.','The 30 fictional cloud services in this workspace.',`<div class="service-grid" id="list">${serviceList()}</div>`,true),
    history:()=>layout('Incident archive.','Compare previous causes, owners, priorities and documented fixes.',`<ul class="archive" id="list">${historyList()}</ul>`,true),
    runbooks:()=>layout('Runbook library.','Search the sample database for service procedures, recovery checks, and investigation guides.',`<ul class="archive" id="list">${documentList()}</ul>`,true)
  };
  main.innerHTML = content[page]();
  document.querySelectorAll('[data-view]').forEach(link=> {
    if (link.dataset.view === page) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  const count = Object.values(workspace.tasks).filter(task=>task.status==='open').length;
  const countLabel = document.querySelector('#chat-count');
  countLabel.hidden = !count;
  countLabel.textContent = count;
  document.querySelector('#notifications').textContent = workspace.notifications?.length ? `Notifications (${workspace.notifications.length})` : 'Notifications';
  const search = document.querySelector('#search');
  if (search) search.value = query;
  if (focusKeys.length) {
    const selector = focusKeys.map(key=>`[${key.name}="${CSS.escape(key.value)}"]`).join('');
    main.querySelector(selector)?.focus({preventScroll:true});
  }
}

function choose(id) {
  if (assistantWindow.open) assistantWindow.close();
  selected = id;
  activeTab = 'brief';
  cutoff = '23:59';
}
function openDialog(kicker,title,content) {
  dialog.innerHTML = `<div class="dialog-head"><div><div class="kicker">${html(kicker)}</div><h2 id="dialog-title">${html(title)}</h2></div><button data-close aria-label="Close dialog">✕</button></div><div class="dialog-body">${content}</div>`;
  if (!dialog.open) dialog.showModal();
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
      ${document.incident ? `<p>Linked incident ${ref(document.incident)}</p>` : ''}`);
    return;
  }
  const record = history.find(item=>item.id===id);
  if (record) {
    const procedure = documents.find(item=>item.incident===record.id);
    openDialog('Incident archive / ' + id,record.title,`<p>${html(record.service)} · ${record.date} · ${record.priority} · ${html(record.responder)}</p>
      <p><strong>Prior cause</strong><br>${html(record.cause)}</p><p><strong>Documented resolution</strong><br>${html(record.fix || 'No resolution steps recorded.')}</p>
      ${procedure ? `<div class="block">${documentLink(procedure)}</div>` : '<p class="quiet">No runbook is linked to this archive record.</p>'}`);
    return;
  }
  const event = scenarios.flatMap(item=>item.events).find(item=>item.id===id);
  if (event) openDialog(event.kind + ' / ' + id,event.title,`<p>${html(event.detail)}</p><p class="mono">Occurred ${event.time} ET · Available ${event.seen} ET</p>`);
}
function draft() {
  const incident = byId(selected);
  const result = investigate(incident,cutoff);
  if (!result.observed) {
    openDialog('Draft handoff',incident.title,'<p>No incident brief exists at this point in the replay.</p>');
    return;
  }
  const note = [
    `${incident.id} · ${incident.title} · ${incidentPriority(incident)}`,
    `Owner: ${workspace.tasks[incident.id]?.by || 'Not confirmed'}`,
    `Working hypothesis: ${result.cause}`,
    `Evidence: ${incident.causeSources.join(', ')}`,
    result.alternative && `Alternative: ${incident.alternative} [${result.alternative.id}]`,
    `Next check: ${incident.next}`,
    result.guide && `Documentation: ${result.guide.id} · ${result.guide.title}`,
    `Recovery check: ${incident.verify}`,
    'Confirmed cause and actual resolution: [Engineer to complete]'
  ].filter(Boolean).join('\n');
  const draftKey = incident.id + '/' + cutoff;
  const saved = workspace.notes?.[draftKey];
  openDialog('Draft handoff',incident.title,`<label for="draft-note">Review and add what the engineer confirmed</label><textarea id="draft-note" maxlength="2500" rows="11">${html(saved ?? note)}</textarea>
    <div class="buttons"><button class="small primary" data-save-note="${draftKey}">Save draft</button><button class="small" data-copy>Copy draft</button></div>`);
}

function showNotifications() {
  const entries = (workspace.notifications || []).map(entry=>{
    const level=levels.includes(entry.level) ? entry.level : incidentPriority(byId(entry.id));
    return `<li><div class="row"><strong>${html(entry.title)}</strong><span class="badge ${level}">${level} · ${severityNames[level]}</span></div>
    <p>${html(entry.description)}</p><button class="small" data-open-case="${html(entry.id)}">Open ${html(entry.id)}</button></li>`;
  }).join('');
  openDialog('Demo workspace','Notifications',`<p class="quiet">Simulated in-app alert and handoff activity.</p>
    <ul class="archive">${entries || '<li>Trigger a sample alert to see it here.</li>'}</ul>`);
}

async function deliveryApi(action,payload) {
  if (!location.protocol.startsWith('http')) throw Error('Start the local server to configure or preview external delivery.');
  const options=payload ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)} : {};
  const response=await fetch('/api/alerts/'+action,options);
  const data=await response.json();
  if (!response.ok) throw Error(data.error || 'Delivery service unavailable.');
  return data;
}

function deliveryLog(entries) {
  if (!entries?.length) return '<p class="quiet">No provider submissions in this server session.</p>';
  const states={accepted:'Accepted by provider',rejected:'Rejected by provider',unknown:'Outcome unknown',duplicate:'Recently submitted'};
  return `<ul class="archive">${entries.map(entry=>`<li><div class="row"><strong>${html(channelSetup[entry.channel].name)} · ${html(entry.destination)}</strong><span class="badge neutral">${states[entry.status]}</span></div>
    <small>${html(entry.incident || '')} ${html(entry.level || '')}${entry.http ? ' · HTTP ' + entry.http : ''}</small>
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
        return `<section class="panel"><div class="row"><h3>${channel.name} · ${channel.provider}</h3>
          <span class="badge neutral">${status.configured ? 'Configured' : 'Needs setup'}</span></div>
          <p><small>${status.recipients.length ? status.recipients.map(item=>html(item.destination)).join(' · ') : 'No destination configured'}</small></p>
          <div class="buttons"><button class="small" data-provider="${key}">${status.configured ? 'Update' : 'Configure'} ${channel.name}</button>
            ${status.configured ? `<button class="small" data-check-provider="${key}">Check connection</button>` : `<a class="small" target="_blank" rel="noreferrer" href="${channel.setup}">Open ${key==='telegram'?'BotFather':channel.provider}</a>`}
            ${key==='telegram'?'<button class="small" data-telegram-routing>Team routing</button>':''}</div>
          <p class="small quiet" id="check-${key}" role="status"></p></section>`;
      }).join('')}</div><h3 class="block">Recent provider submissions</h3>${deliveryLog(deliveryState.deliveries)}`);
  } catch(error) { if (target.isConnected) deliveryError(error); }
}

const routeLabels = {
  'queued-private':'Private page queued','sending-private':'Sending private page','waiting':'Waiting for private response',
  'queued-team':'Team post queued','sending-team':'Posting to team group','open-team':'Posted to team · Awaiting claim',
  accepted:'Accepted',failed:'Delivery needs review'
};
function routeDetails(route) {
  const deadline=route.stage==='waiting'&&route.deadline ? `<p>Reply by <strong>${html(new Date(route.deadline).toLocaleTimeString('en-CA',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit',second:'2-digit'}))} ET</strong></p>` : '';
  const reason={critical:'Sent directly to the group because this alert is P1 Critical.',decline:'The private responder declined.',timeout:'The private response window expired.',unavailable:'Telegram did not confirm the private page.'}[route.reason];
  return `<p><strong>${html(routeLabels[route.stage])}</strong>${route.acceptedBy?' · '+html(route.acceptedBy):''}</p>${deadline}
    ${reason?`<p>${html(reason)}</p>`:''}${route.notice?`<p>${html(route.notice)}</p>`:''}`;
}

async function showTelegramRouting() {
  openDialog('Alert delivery','Telegram routing','<p data-delivery-status role="status">Checking routing settings…</p>');
  const anchor=dialog.querySelector('[data-delivery-status]');
  try {
    const info=await deliveryApi('telegram-routing');
    setAutomaticIndicator(info.auto.enabled);
    if(!dialog.open||!anchor.isConnected)return;
    openDialog('Alert delivery','Telegram routing',`<p><strong>P1 Critical</strong> goes directly to the team group. <strong>P2 High</strong> and <strong>P3 Monitor</strong> go to a private responder first.</p>
      <div class="panel"><div class="row"><h3>Automatic Telegram alerts</h3><span class="badge ${info.auto.enabled?'P2':'neutral'}">${info.auto.enabled?'On':'Off'}</span></div>
      <p>New alert events use these settings. Opening an incident, adjusting priority, or resetting the demo does not trigger a send.</p>
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
  if(badge)badge.textContent='Telegram auto: '+(automaticTelegram?'on':'off');
  if(hint)hint.textContent=automaticTelegram?'New simulations automatically send to Telegram.':'Simulations stay in the dashboard while Telegram automation is off.';
}

function refreshAutomaticIndicator() {
  if(location.protocol.startsWith('http'))void deliveryApi('telegram-routing').then(info=>setAutomaticIndicator(info.auto.enabled)).catch(()=>{});
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
    <p>${team?'Add the existing Incident Compass bot to your Telegram team group. The pairing command identifies the group.':'Name the responder and share the generated one-time link with them. They tap Start in the private bot chat.'}</p>
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

function previewTelegramRoute(incident,preview) {
  openDialog(incident,'Preview Telegram route',`
    ${preview.messages.map(message=>`<section class="panel block"><h3>${html(message.destination)}</h3><p class="chat-answer">${html(message.body)}</p></section>`).join('')}
    ${preview.canStart?`<p>${preview.direct?`Send to <strong>${html(preview.team)}</strong> now.`:`Page <strong>${html(preview.owner)}</strong> now. Send to <strong>${html(preview.team)}</strong> if the responder declines or misses the deadline.`}</p>`:`<p><strong>${html(preview.missing)}</strong></p>`}
    <div class="buttons"><button class="small" data-route-incident="${html(incident)}">Back</button>
    ${preview.canStart?`<button class="small primary" data-start-route="${html(preview.token)}">Confirm and start live routing</button>`:'<button class="small" data-telegram-routing>Routing setup</button>'}</div><p data-delivery-status role="status"></p>`);
}

async function trackTelegramRoute(id,initial) {
  openDialog('Telegram routing','Track Telegram route',`<div data-route-tracking role="status">${initial?routeDetails(initial):'Checking route…'}</div><button class="small" data-telegram-routing>All routes</button>`);
  const slot=dialog.querySelector('[data-route-tracking]');
  try {
    while(dialog.open&&slot.isConnected){
      const state=await deliveryApi('telegram-routing');
      if(!slot.isConnected)return;
      const route=state.routes.find(item=>item.id===id);
      if(!route){slot.textContent='This route is no longer in the recent list.';return;}
      const detail=routeDetails(route);
      if(slot.innerHTML!==detail)slot.innerHTML=detail;
      if(['accepted','failed'].includes(route.stage))return;
      await new Promise(resolve=>setTimeout(resolve,3000));
    }
  }catch(error){if(slot.isConnected)slot.textContent=error.message;}
}

function providerForm(key) {
  const channel=channelSetup[key];
  if (!channel) return;
  const saved=deliveryState?.channels[key].savedFields || [];
  const guidance={
    sms:'Use a Twilio account and an SMS-capable sender that can send custom texts to Canadian numbers. Enter the sender in international format, including the +.',
    email:'Verify a domain you control in Resend, then create a sending-access API key for that domain and enter a sender address on it.',
    telegram:'Paste your BotFather token and select Pair and save my chat. Incident Compass will save and verify the connection after you tap Start in your private chat with the bot.',
  };
  openDialog(channel.provider,'Configure ' + channel.name,`<p>${guidance[key]}</p>
    <p><a target="_blank" rel="noreferrer" href="${channel.setup}">Open ${key==='telegram'?'BotFather':channel.provider}</a>
    ${key==='email'?' · <a target="_blank" rel="noreferrer" href="https://resend.com/domains">Verified domains</a>':''}</p>
    <form class="delivery-form" data-provider-form="${key}" autocomplete="off">
      ${channel.fields.map(([id,label,masked])=>`<label for="${id}">${label}${saved.includes(id) ? ' · Saved; leave blank to keep' : ''}</label>
      <input id="${id}" name="${id}" type="${masked?'password':'text'}" maxlength="180" autocomplete="off" ${saved.includes(id) ? '' : 'required'}>`).join('')}
      ${key==='telegram'?'<div class="buttons"><button class="small primary" type="button" data-pair-personal>Pair and save my chat</button><button class="small" type="button" data-find-chat>Find chat ID manually</button></div><div id="telegram-pairing"></div>':''}
      <p data-delivery-status role="status"></p>
      <div class="buttons"><button class="small primary" type="submit">Save settings</button><button class="small" type="button" data-channels>Back</button></div>
    </form>`);
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
          <p>Tap Start in your private chat with this bot. Incident Compass will finish automatically.</p></div>`;
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
    <div class="buttons">${levels.map(level=>`<button data-set-level="${level}">${level}</button>`).join('')}<button data-set-level="suggested">Use suggested priority</button></div>`);
}

function fallback(incident,result,question) {
  if (!result.observed) return 'The incident had not fired in this snapshot. Move the replay forward to see the brief.';
  const q = question.toLowerCase();
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
  assistantWindow.innerHTML = `<div class="dialog-head"><div><div class="kicker">Incident assistant / ${incident.id}</div><h2 id="assistant-title">Ask about this incident</h2></div><button data-close aria-label="Close assistant">✕</button></div><div class="dialog-body">
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
  const result = investigate(byId(selected),cutoff);
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
  const result = investigate(incident,snapshot);
  const revision = ++dialogRevision;
  let reply = fallback(incident,result,question);
  let ids = [...new Set(reply.match(/\b(?:INC|RB|DG|ALT|CHG|LOG|MET|SUP|EXT|MNT)-\d+\b/g) || [])];
  let label = 'Demo mode · Based on sample records.';
  if (connected) {
    try {
      const earlierQuestions = conversation.map(turn=>turn.question);
      const response = await fetch('/api/ask', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:incident.id,cutoff:snapshot,question,earlierQuestions})});
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
  const button = event.target.closest('button');
  if (!button) return;
  const data = button.dataset;
  if (data.case) { choose(data.case); render(); }
  else if (data.openCase) { choose(data.openCase); if (view() === 'desk') render(); else location.hash = 'desk'; }
  else if (data.tab) { activeTab = data.tab; render(); }
  else if (data.nav) location.hash = data.nav;
  else if (data.task) actionOnTask(data.task,data.id);
  else if (data.trigger) {
    const incident = byId(data.trigger);
    choose(incident.id);
    void update(state=>{
      if (!state.active.includes(incident.id)) state.active.push(incident.id);
      notification(state,incident.id,'Sample alert received',incident.title);
      if (incidentPriority(incident,state)==='P1' && !state.tasks[incident.id]) pageOnCall(state,incident);
      return `Simulated alert received: ${incident.title}.`;
    }).then(()=>relayNewAlert(incident,incidentPriority(incident)));
  } else if ('reset' in data) {
    choose('INC-121');
    void update(state=>{ Object.assign(state,initial()); return 'Demo workspace reset.'; });
  } else if (data.source) source(data.source);
  else if ('live' in data) { cutoff='23:59'; render(); }
  else if ('handoff' in data) draft();
  else if ('notifications' in data) showNotifications();
  else if (data.alertFilter) { alertFilter=data.alertFilter; render(); }
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
    void update(state=>{
      state.priorities ||= {};
      if (data.setLevel === 'suggested') delete state.priorities[incident.id];
      else state.priorities[incident.id] = data.setLevel;
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
    const matching = workspace.active.map(byId).filter(item=>[...item.confirmed,...item.possible].includes(service.name));
    openDialog(service.group, service.name, matching.length ? matching.map(item=>`<p>${html(item.title)} · ${item.confirmed.includes(service.name) ? 'Confirmed' : 'Possible'} impact</p><button class="small" data-open-case="${item.id}">Open ${item.id}</button>`).join('') : '<p>No active alerts in this sample workspace.</p>');
  }
  if (data.openCase && dialog.open) dialog.close();
});
document.addEventListener('submit',event=>{
  if (event.target.id === 'assistant-form') {
    event.preventDefault();
    void ask(document.querySelector('#question').value);
  }
  const form=event.target;
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
    fields:Object.fromEntries([...values.entries()].map(([name,value])=>[name,value.trim()]).filter(([,value])=>value)),
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
  if (event.target.id === 'cost-window') {
    const money = byId(selected).money;
    const minutes = Number(event.target.value);
    document.querySelector('#cost-minutes').textContent = `${minutes} minutes`;
    document.querySelector('#cost-projection').textContent = `${cad(money.low*money.order*minutes)}–${cad(money.high*money.order*minutes)} CAD at this duration`;
  }
  if (event.target.id === 'search') {
    query = event.target.value.trim().toLowerCase();
    const lists = {services:serviceList,history:historyList,runbooks:documentList};
    document.querySelector('#list').innerHTML = lists[view()]();
  }
  if (event.target.id === 'replay-range') {
    const incident = byId(selected);
    cutoff = times(incident)[Number(event.target.value)];
    event.target.setAttribute('aria-valuetext',cutoff + ' ET');
    document.querySelector('#replay-time').textContent = cutoff + ' ET';
    document.querySelector('#replay-details').innerHTML = replayDetails(incident,investigate(incident,cutoff));
    if (assistantWindow.open) assistantWindow.close();
  }
});
document.addEventListener('change',event=>{
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
persona.addEventListener('change',()=>{
  actor = persona.value;
  sessionStorage.setItem('ic-actor',actor);
  render();
});
night.addEventListener('click',()=>{
  const enabled = document.body.classList.toggle('night');
  night.setAttribute('aria-pressed',String(enabled));
  localStorage.setItem('ic-night',String(enabled));
});
window.addEventListener('storage',event=>{
  if (event.key !== saveKey) return;
  workspace = read();
  if (!workspace.active.includes(selected)) choose(workspace.active[0]);
  render();
});
window.addEventListener('hashchange',()=>{ query=''; render(); main.focus(); });
window.addEventListener('focus',refreshAutomaticIndicator);
refreshAutomaticIndicator();
setInterval(tick,250);
if (location.protocol.startsWith('http')) fetch('/api/status').then(response=>response.json()).then(status=>{ connected=status.gemini; }).catch(()=>{});
render();
