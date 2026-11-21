import test from 'node:test';
import assert from 'node:assert/strict';
import {investigate, scenarios, services} from '../public/data.mjs';
import {
  asInvestigation, createSimulation, releaseSimulation, simulationTemplates,
  updateSimulation, validateSimulation,
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
  const record = createSimulation(normalized({service:'Identity Gateway'}),'Maya Chen',now,'SIM-EVIDENCE');
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
