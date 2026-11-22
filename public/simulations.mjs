import {companyLabel, sampleAlertContext, sampleCompanyFor, sampleMonitoringTime} from './data.mjs';

export const simulationSeverities = {
  P1: 'Critical', P2: 'High', P3: 'Medium', P4: 'Low'
};
export const simulationStatuses = {
  reported: 'Reported', acknowledged: 'Acknowledged', investigating: 'Investigating',
  monitoring: 'Monitoring', resolved: 'Resolved'
};
export const simulationCategories = ['Availability', 'Performance', 'Data', 'Security', 'Operations'];

export const simulationTemplates = [
  {title:'Checkout outage', description:'The synthetic checkout probe failed in two regions. Test orders cannot complete.', service:'Checkout', category:'Availability', type:'Service outage', level:'P1', location:'Canada Central', area:'Synthetic checkout requests', actions:'Compare the checkout probe with upstream payment health. Record a recovery signal before resolving.'},
  {title:'Sign-in latency spike', description:'Synthetic sign-ins are taking longer than the normal baseline after a configuration drill.', service:'Identity Gateway', category:'Performance', type:'Latency regression', level:'P2', location:'Canada Central', area:'Test sign-in flow', actions:'Compare latency percentiles and check whether the delay is isolated to one identity dependency.'},
  {title:'Inventory sync delay', description:'The sample stock queue is growing while the test catalog still serves older inventory.', service:'Stock Sync', category:'Data', type:'Processing backlog', level:'P3', location:'', area:'Demo catalog', actions:'Check the age of the oldest queued update and record when processing catches up.'},
  {title:'Delayed morning report', description:'The demonstration report missed its scheduled start, with no observed impact on other sample services.', service:'Reporting', category:'Operations', type:'Delayed scheduled job', level:'P4', location:'', area:'Internal reports', actions:'Review the job schedule and confirm the next run produces the expected output.'},
].map(item=>({...item,company:sampleCompanyFor(item.service)}));

export const investigationTemplates = [
  {title:'Repeat alert', description:'Sign-ins fail with JWKS_CACHE_MISS on one gateway node.', service:'Identity Gateway',
    category:'Availability', type:'Sign-in failures', level:'P2', occurredAt:sampleMonitoringTime('10:09')},
  {title:'Alert after a release', description:'The authorization monitor started reporting PAY_AUTH_TIMEOUT.', service:'Payments API',
    category:'Availability', type:'Authorization failures', level:'P1', occurredAt:sampleMonitoringTime('10:02')},
  {title:'New error with no match', description:'Inventory writes accept a connection but report INV_COMMIT_STALL during commit.', service:'Inventory Database',
    category:'Data', type:'Write stalls', level:'P3', occurredAt:sampleMonitoringTime('10:12')},
].map(item=>({...item,company:sampleCompanyFor(item.service)}));

export const simulationTime = new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
});
const timestamp = new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Toronto',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'
});
export const formatIncidentTime = time => timestamp.format(time);

export function validateSimulation(values, allowedServices, now = Date.now()) {
  const fields = [
    ['title',100,true], ['description',1600,true], ['type',70,true],
    ['location',100,false], ['area',120,false], ['actions',1000,false], ['serviceVersion',40,false], ['company',80,false]
  ];
  const clean = {};
  for (const [key,max,required] of fields) {
    const value = String(values[key] ?? '').trim();
    if ((required && !value) || value.length > max) throw Error(`Enter a valid ${key} (up to ${max} characters).`);
    clean[key] = value;
  }
  const {level,status,category,service,trigger} = values;
  if (!Object.hasOwn(simulationSeverities,level) || !Object.hasOwn(simulationStatuses,status) ||
      !simulationCategories.includes(category) || !allowedServices.includes(service) ||
      !['immediate','scheduled'].includes(trigger)) throw Error('Choose a valid severity, status, category, service, and trigger.');
  const occurredAt = values.occurred ? new Date(values.occurred).getTime() : null;
  const scheduledAt = trigger === 'scheduled' ? new Date(values.scheduled || '').getTime() : null;
  if ((occurredAt !== null && !Number.isFinite(occurredAt)) ||
      (trigger === 'scheduled' && (!Number.isFinite(scheduledAt) || scheduledAt <= now))) {
    throw Error('Enter a valid incident time and schedule delivery for a time in the future.');
  }
  if (occurredAt !== null && occurredAt > (scheduledAt ?? now)) throw Error('The incident timestamp must be on or before the trigger time.');
  return {...clean,company:companyLabel(clean.company),level,status,category,service,occurredAt,scheduledAt};
}

export function createSimulation(input, owner, now, id) {
  return {...input,id,owner,createdAt:now,occurredAt:input.occurredAt ?? input.scheduledAt ?? now,
    triggeredAt:null,updatedAt:now,responder:null,activity:[{status:input.scheduledAt ? 'Scheduled' : 'Created',who:owner,time:now}]};
}

export function releaseSimulation(incident, now) {
  if (incident.triggeredAt !== null || (incident.scheduledAt ?? now) > now) return false;
  incident.triggeredAt = now;
  incident.updatedAt = now;
  incident.activity.push({status:simulationStatuses[incident.status],who:incident.owner,time:now});
  return true;
}

export function updateSimulation(incident, patch, actor, now) {
  if (incident.triggeredAt === null) throw Error('This simulation is still scheduled.');
  if (!Object.hasOwn(simulationSeverities,patch.level) || !Object.hasOwn(simulationStatuses,patch.status)) {
    throw Error('Choose a valid severity and status.');
  }
  const note = String(patch.note ?? '').trim();
  if (note.length > 500) throw Error('Use up to 500 characters for the update note.');
  if (incident.status === patch.status && incident.level === patch.level && !note) return false;
  Object.assign(incident,{status:patch.status,level:patch.level,updatedAt:now,responder:actor});
  incident.activity.push({status:simulationStatuses[patch.status],level:patch.level,who:actor,time:now,note});
  return true;
}

export function validateReviewedResolution(fields) {
  const reviewed = Object.fromEntries(['cause','fix','verification'].map(name=>[name,String(fields[name] ?? '').trim()]));
  if (Object.values(reviewed).some(value=>!value || value.length>500)) {
    throw Error('Enter the confirmed cause, fix, and recovery verification. Each field allows up to 500 characters.');
  }
  const version = String(fields.version ?? '').trim();
  if (version.length>40) throw Error('Use up to 40 characters for the service version.');
  return {...reviewed,version,runbook:String(fields.runbook ?? '').trim()};
}

export function asInvestigation(record, grouped = []) {
  const occurredAt = record.occurredAt ?? record.scheduledAt ?? record.createdAt;
  const alert = simulationTime.format(occurredAt);
  const source = record.id + '-alert';
  const {fingerprint,events} = sampleAlertContext({...record,occurredAt});
  const alertEvent = {id:source,kind:'Alert',title:record.title,detail:record.description,
    time:alert,seen:alert,timeAt:occurredAt,seenAt:occurredAt,service:record.service,signature:fingerprint};
  const serviceVersion = record.serviceVersion || events.find(event=>event.affectedVersion)?.affectedVersion || '';
  return {...record,occurredAt,alert,variant:'Test event',sampleAlert:true,fingerprint,serviceVersion,
    confirmed:[...new Set([record.service,...grouped.map(event=>event.service)])],possible:[],
    causeSources:[source],next:record.actions || 'Reproduce the reported symptom in the test environment and record what you observe.',
    verify:'Compare the test signal before and after the change, then record the outcome.',
    unknowns:['Whether the same symptoms persist now and how much of the service is affected.'],
    findings:[{text:record.description,ids:[source]}],
    events:[...events,alertEvent,...grouped]
  };
}
