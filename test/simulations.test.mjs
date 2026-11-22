import test from 'node:test';
import assert from 'node:assert/strict';
import {documents, groupDuplicate, investigate, runbookFreshness, sampleMonitoringTime, scenarios, services} from '../public/data.mjs';
import {
  asInvestigation, createSimulation, investigationTemplates, releaseSimulation, simulationTemplates,
  updateSimulation, validateReviewedResolution, validateSimulation,
} from '../public/simulations.mjs';

const now = Date.parse('2026-11-21T15:00:00Z');
const allowed = services.map(service=>service.name);
const values = {...simulationTemplates[0],trigger:'immediate',status:'reported'};
const normalized = patch => validateSimulation({...values,...patch},allowed,now);

test('four valid templates exercise all four priorities',()=>{
  const severities = simulationTemplates.map(template=>normalized(template).level);
  assert.deepEqual(severities,['P1','P2','P3','P4']);
});

test('invalid status, service, severity, description and schedule are rejected',()=>{
  for (const invalid of [
    {status:'closed'},{service:'Unlisted service'},{level:'urgent'},{title:'   '},
    {description:'x'.repeat(1601)},{occurred:'2026-11-22T14:00:00Z'},
    {trigger:'scheduled',scheduled:''},{trigger:'scheduled',scheduled:'2026-11-21T14:00:00Z'},
    {trigger:'scheduled',scheduled:'2026-11-21T16:00:00Z',occurred:'2026-11-21T17:00:00Z'},
  ]) assert.throws(()=>normalized(invalid));
});

test('a scheduled test survives serialization, stays pending until due, and releases once',()=>{
  const input = normalized({trigger:'scheduled',scheduled:'2026-11-21T15:02:00Z'});
  const record = JSON.parse(JSON.stringify(createSimulation(input,'Maya Chen',now,'SIM-SCHEDULED')));
  assert.equal(record.createdAt,now);
  assert.equal(record.occurredAt,input.scheduledAt);
  assert.equal(releaseSimulation(record,input.scheduledAt-1),false);
  assert.throws(()=>updateSimulation(record,{status:'acknowledged',level:'P1'},'Sam Rivera',now));
  assert.equal(releaseSimulation(record,input.scheduledAt+1000),true);
  assert.equal(releaseSimulation(record,input.scheduledAt+2000),false);
  assert.deepEqual(record.activity.map(event=>event.status),['Scheduled','Reported']);
});

test('acknowledgement, status changes, and recovery preserve responder history',()=>{
  const record = createSimulation(normalized({}),'Maya Chen',now,'SIM-LIFECYCLE');
  assert.equal(releaseSimulation(record,now),true);
  assert.equal(updateSimulation(record,{status:'reported',level:'P1'},'Sam Rivera',now),false);
  assert.equal(updateSimulation(record,{status:'acknowledged',level:'P1'},'Sam Rivera',now+1000),true);
  assert.equal(updateSimulation(record,{status:'investigating',level:'P2',note:'  Synthetic probe rerun  '},'Sam Rivera',now+2000),true);
  assert.equal(updateSimulation(record,{status:'resolved',level:'P2',note:'Probe recovered'},'Priya Shah',now+3000),true);
  assert.equal(record.activity.at(-2).note,'Synthetic probe rerun');
  assert.equal(record.responder,'Priya Shah');
  assert.equal(record.activity.at(-1).note,'Probe recovered');
});

test('test reports provide synthetic evidence without claiming a historical fix',()=>{
  const record = createSimulation(normalized({service:'Identity Gateway',company:''}),'Maya Chen',now,'SIM-EVIDENCE');
  releaseSimulation(record,now);
  const adapted = asInvestigation(record);
  const report = investigate(adapted);
  assert.ok(report.observed);
  assert.ok(report.nearby.length);
  assert.equal(report.exact.length,0);
  assert.equal(report.known,undefined);
  assert.equal(report.evidence[0].detail,record.description);
  assert.ok(investigate(scenarios.find(incident=>incident.id==='INC-122')).verifiedDocument);
});

function incomingAlert({occurredAt,...input},fire = true) {
  const record = createSimulation(normalized({...input,occurred:new Date(occurredAt).toISOString()}),'Sam Rivera',now,'SIM-LOOKUP');
  if (fire) releaseSimulation(record,now);
  return asInvestigation(record);
}

test('a fresh repeat alert retrieves the documented fix and linked runbook',()=>{
  const alert = incomingAlert({...investigationTemplates[0],title:'Different alert title',description:'Auth failed: jwks_cache_miss.'});
  const result = investigate(alert);
  assert.equal(alert.fingerprint,'JWKS_CACHE_MISS');
  assert.deepEqual(result.exact.map(record=>record.id),['INC-104']);
  assert.equal(result.verifiedDocument.id,'RB-008');
  assert.match(result.known.fix,/signing-key cache/);
  assert.ok(result.causeSources.includes('LOG-44'));
});

test('a release is a likely cause only when the same service and version have corroborating error evidence',()=>{
  const template = investigationTemplates[1];
  const result = investigate(incomingAlert(template));
  assert.match(result.cause,/recent release 2\.8\.0 is the leading cause/);
  assert.deepEqual(result.causeSources,['CHG-78','LOG-41']);
  assert.equal(result.guide.id,'RB-013');
  assert.equal(result.known,undefined);

  const beforeLog = investigate(incomingAlert({...template,occurredAt:sampleMonitoringTime('10:01')}));
  assert.deepEqual(beforeLog.changes.map(change=>change.id),['CHG-78']);
  assert.match(beforeLog.cause,/does not establish/);
  const wrongError = investigate(incomingAlert({...template,description:'New error: PAY_UNKNOWN_FAILURE'}));
  assert.match(wrongError.cause,/does not establish/);
  const otherService = investigate(incomingAlert({...template,service:'Checkout'}));
  assert.equal(otherService.changes.length,0);
  assert.match(otherService.cause,/does not establish/);
});

test('a new error shows recent changes without borrowing a fix from the same service',()=>{
  const template = investigationTemplates[2];
  const alert = incomingAlert(template);
  const result = investigate(alert);
  assert.deepEqual(result.changes.map(change=>change.id),['CHG-82','CHG-83']);
  assert.deepEqual(result.nearby.map(record=>record.id),['INC-087']);
  assert.equal(result.known,undefined);
  assert.equal(result.guide.id,'DG-023');
  assert.match(result.cause,/does not establish/);
  assert.equal(investigate(alert,sampleMonitoringTime('10:11')).observed,false);
  assert.equal(investigate(incomingAlert(template,false)).observed,false);
  const later = investigate(incomingAlert({...template,occurredAt:now}));
  assert.equal(later.changes.length,0);
});

test('a reviewed fix is reusable for a later matching alert and checked against the service version',()=>{
  const alert = incomingAlert({...investigationTemplates[2],serviceVersion:'4.2.0'});
  const reviewed = validateReviewedResolution({cause:'Import held an inventory lock.',fix:'Moved the import to a separate window.',
    verification:'Commit latency returned to baseline.',version:'4.2.0',runbook:'DG-023'});
  const archive = [{...reviewed,id:'SIM-VERIFIED',title:'Prior write stall',service:alert.service,company:alert.company,fingerprint:alert.fingerprint,
    responder:'Alex Morgan',resolvedAt:now-5_000}];
  const result = investigate(alert,'23:59',archive);
  assert.equal(result.known.id,'SIM-VERIFIED');
  assert.equal(result.verify,reviewed.verification);
  assert.equal(investigate({...alert,serviceVersion:'4.3.0'},'23:59',archive).known,undefined);
  assert.ok(investigate({...alert,serviceVersion:'4.3.0'},'23:59',archive).comparisons[0].reasons.some(reason=>reason.includes('differs')));
  assert.equal(investigate(alert,alert.occurredAt,archive).known,undefined);
  assert.equal(investigate({...alert,company:'Another sample company'},'23:59',archive).known,undefined);
  assert.throws(()=>validateReviewedResolution({cause:reviewed.cause,fix:reviewed.fix}),/recovery verification/);
});

test('duplicate matching requires the same error, a shared service path and a nearby timestamp',()=>{
  const original = {id:'SIM-ROOT',service:'Payments API',fingerprint:'PAY_AUTH_TIMEOUT',occurredAt:now};
  const downstream = {id:'SIM-SECOND',service:'Checkout',fingerprint:original.fingerprint,occurredAt:now+60_000};
  assert.equal(groupDuplicate(downstream,[original]),original);
  assert.equal(groupDuplicate({...downstream,service:'Reporting'},[original]),undefined);
  assert.equal(groupDuplicate({...downstream,company:'Another sample company'},[original]),undefined);
  assert.equal(groupDuplicate({...downstream,fingerprint:null},[original]),undefined);
  assert.equal(groupDuplicate({...downstream,occurredAt:now+360_000},[original]),undefined);
});

test('runbook freshness reports a version difference and adopts newly reviewed use',()=>{
  const guide = documents.find(document=>document.id==='RB-008');
  const before = runbookFreshness(guide,[],'2.4.2',now);
  assert.ok(before.reasons.some(reason=>reason.includes('differs')));
  const after = runbookFreshness(guide,[{runbook:guide.id,resolvedAt:now-10_000,responder:'Priya Shah',version:'2.4.2'}],'2.4.2',now);
  assert.equal(after.check.reviewer,'Priya Shah');
  assert.deepEqual(after.reasons,[]);
});
