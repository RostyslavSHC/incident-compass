import test from 'node:test';
import assert from 'node:assert/strict';
import {exposureAssumptions,exposureAt,mergeIncidentWork,reportPeriod,reportSummary} from '../public/reports.mjs';

const now = Date.parse('2026-11-22T02:00:00Z');
const openedAt = Date.parse('2026-11-21T23:00:00Z');
const acceptedAt = openedAt+7*60_000;
const closedAt = openedAt+27*60_000;
const website = {incident:'INC-121',key:'INC-121/'+openedAt,openedAt,acceptedAt,acceptedBy:'Maya Chen',
  closedAt,closedBy:'Maya Chen',via:'website',verified:true};

test('calendar reports use Eastern dates and count openings and closings in the selected period',()=>{
  const week=reportPeriod('week',0,now);
  assert.match(week.label,/Nov 16 – Nov 22, 2026/);
  const report=reportSummary([website],week);
  assert.equal(report.opened.length,1);
  assert.equal(report.resolved.length,1);
  assert.equal(report.mttr,27*60_000);
  assert.equal(report.people[0].average,20*60_000);
  assert.equal(report.buckets.find(bucket=>bucket.label==='Sat').resolved,1);
  assert.equal(reportPeriod('month',0,now).buckets.length,5);
  assert.equal(reportPeriod('year',0,now).buckets.length,12);
});

test('Telegram and website evidence share one completion and a re-opened case retains a separate timer',()=>{
  const route={id:'route',incident:website.incident,created:openedAt+10_000,acceptedAt,
    acceptedBy:'Maya Chen',completedAt:closedAt-60_000,completedBy:'Maya Chen',completedVia:'telegram'};
  const next={...website,key:'next',openedAt:closedAt+60_000,acceptedAt:null,closedAt:null};
  const combined=mergeIncidentWork([website,next],[route]);
  assert.equal(combined.length,2);
  assert.equal(combined[0].via,'telegram');
  assert.equal(combined[0].closedAt,route.completedAt);
  assert.equal(combined[0].verified,true);
  assert.equal(combined[1].closedAt,null);
  for (const secondTap of [closedAt,closedAt+60_000]) {
    const duplicate={...route,completedAt:secondTap,completedBy:'Telegram responder'};
    const [merged]=mergeIncidentWork([website],[duplicate]);
    assert.equal(merged.closedAt,website.closedAt);
    assert.equal(merged.closedBy,website.closedBy);
    assert.equal(merged.via,website.via);
  }
  const unmatched=reportSummary([{...website,acceptedBy:'Sam Rivera'}],reportPeriod('week',0,now));
  assert.equal(unmatched.people[0].timed,0);
});

test('exposure assumptions are adjustable and exposure scales with the duration slider',()=>{
  const assumptions=exposureAssumptions({},'Commerce',{low:2,high:4,order:25});
  assert.deepEqual(exposureAt(assumptions,30),{low:1500,high:3000});
  assert.deepEqual(exposureAt(assumptions,60),{low:3000,high:6000});
  assert.ok(exposureAssumptions({},'Operations').order>0);
});

test('companies combine normalized names and repeats stay within their company and service',()=>{
  const first={...website,company:'Cedar Market',service:'Payments API',fingerprint:'PAY_AUTH_TIMEOUT'};
  const second={...first,incident:'INC-129',company:' cedar   MARKET ',openedAt:openedAt+60_000};
  const unrelated={...first,incident:'INC-130',company:'Harborline Services'};
  const otherService={...first,incident:'INC-131',service:'Checkout'};
  const noCompany={...first,incident:'INC-132',company:''};
  const summary=reportSummary([first,second,unrelated,otherService,noCompany],reportPeriod('week',0,now));
  assert.deepEqual(summary.companies.find(company=>company.key==='cedar market'),
    {key:'cedar market',name:'Cedar Market',opened:3,resolved:3});
  assert.equal(summary.companies.find(company=>company.key==='').name,'Unassigned');
  assert.deepEqual(summary.repeated,[{company:'Cedar Market',service:'Payments API',fingerprint:'PAY_AUTH_TIMEOUT',count:2}]);
});
