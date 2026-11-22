import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createIncidentAi} from '../incident-ai.mjs';
import {investigationTemplates} from '../public/simulations.mjs';

const origin = 'http://127.0.0.1:4173';
const analysis = {
  summary:'The sign-in errors match the signing-key cache incident in the archive.',
  uncertainty:'The affected gateway node’s current cached key IDs need to be confirmed.',
  nextCheck:'Compare the active issuer key ID with the affected node’s cached key IDs.',
  sources:['INC-104','RB-008','INC-999'],
};
const repeat = {id:'SIM-REPEAT',report:investigationTemplates[0]};

function setup(generated = analysis,{status = 200,key = 'test-key'} = {}) {
  const sent = [];
  const handler = createIncidentAi({
    key,model:'gemini-test',localOrigin:origin,
    json:(_response,status,body)=>({status,body}),
    requestUpstream:async (_url,request)=>{
      sent.push(JSON.parse(request.body));
      return {ok:status===200,status,json:async()=>({candidates:[
        {content:{parts:[{thought:true,text:'hidden'},{text:JSON.stringify(generated)}]}}
      ]})};
    },
  });
  const post = (input,automatic = true,headers = {})=>{
    const request = Readable.from([Buffer.from(JSON.stringify(input))]);
    request.headers = {host:new URL(origin).host,origin,'content-type':'application/json',...headers};
    return handler(request,{},automatic);
  };
  return {post,sent};
}

test('automatic analysis builds a grounded brief from a newly submitted alert',async()=>{
  const {post,sent} = setup();
  const response = await post(repeat);
  assert.equal(response.status,200);
  assert.deepEqual(response.body,{...analysis,sources:['INC-104','RB-008']});
  const {context,question} = JSON.parse(sent[0].contents[0].parts[0].text);
  assert.equal(question,undefined);
  assert.equal(context.incident.errorSignature,'JWKS_CACHE_MISS');
  assert.ok(context.incident.knownFix);
  assert.equal(context.documentation.verifiedPriorFixDocument,'RB-008');
  assert.ok(context.availableEvidence.some(event=>event.id==='LOG-44'));
});

test('uncited or rate-limited model output leaves the deterministic brief available',async()=>{
  const uncited = setup({...analysis,sources:['INC-999']});
  assert.equal((await uncited.post(repeat)).status,502);
  const quota = setup(analysis,{status:429});
  assert.equal((await quota.post(repeat)).status,429);
});

test('the same route adapter supports custom follow-ups at the selected replay time',async()=>{
  const {post,sent} = setup({answer:'The alert had not arrived in this snapshot.',sources:['LOG-44','INC-104']});
  const response = await post({...repeat,question:'What did we know?',cutoff:repeat.report.occurredAt-60_000},false);
  assert.equal(response.status,200);
  assert.deepEqual(response.body.sources,['LOG-44']);
  const {context} = JSON.parse(sent[0].contents[0].parts[0].text);
  assert.equal(context.incident.status,'The incident had not fired yet.');
  assert.ok(context.availableEvidence.every(record=>record.seenAt<repeat.report.occurredAt));
});

test('the provider only receives historical records reviewed by the selected snapshot',async()=>{
  const report = {...investigationTemplates[2],serviceVersion:'4.2.0'};
  const previous = {id:'SIM-PREVIOUS',company:report.company,service:report.service,fingerprint:'INV_COMMIT_STALL',version:'4.2.0',
    title:'Earlier commit stall',cause:'Import blocked a write.',fix:'Moved the import.',verification:'Writes returned to baseline.',
    responder:'Test responder',resolvedAt:report.occurredAt-120_000,reviewedAt:report.occurredAt-60_000};
  const late = {...previous,id:'SIM-LATE',reviewedAt:report.occurredAt+60_000};
  const differentVersion = {...previous,id:'SIM-OLDER',version:'4.1.0'};
  const otherCompany = {...previous,id:'SIM-OTHER',company:'Another Workspace'};
  const {post,sent} = setup({answer:'Review the earlier write stall.',sources:[previous.id,late.id,differentVersion.id,otherCompany.id]});
  const requested = {id:'SIM-REVIEW',report,question:'What did we know?',cutoff:report.occurredAt,
    archive:[late,differentVersion,previous,otherCompany]};
  const response = await post(requested,false);
  assert.equal(response.status,200);
  assert.deepEqual(response.body.sources,[previous.id,differentVersion.id]);
  const {context} = JSON.parse(sent[0].contents[0].parts[0].text);
  assert.deepEqual(context.applicableHistory,[previous.id]);
  assert.equal(context.incident.knownFixSource,previous.id);
  assert.ok(context.historicalComparison.every(record=>![late.id,otherCompany.id].includes(record.id)));
});

test('missing configuration, cross-origin requests, and invalid reports do not call Gemini',async()=>{
  const offline = setup(analysis,{key:''});
  assert.equal((await offline.post(repeat)).status,503);
  assert.equal(offline.sent.length,0);
  const guarded = setup();
  assert.equal((await guarded.post(repeat,true,{origin:'https://elsewhere.example'})).status,403);
  assert.equal((await guarded.post({...repeat,report:{...repeat.report,service:'Unregistered service'}})).status,400);
  assert.equal(guarded.sent.length,0);
});

test('resolution formatting returns editable fields and allows missing recovery evidence',async()=>{
  const draft = {cause:'The signing cache was stale.',fix:'Refreshed the signing cache.',verification:''};
  const {post,sent} = setup(draft);
  const response = await post({...repeat,notes:'Cache stale. Refreshed it.'},'resolution');
  assert.equal(response.status,200);
  assert.deepEqual(response.body,draft);
  const submitted = JSON.parse(sent[0].contents[0].parts[0].text);
  assert.deepEqual(submitted,{notes:'Cache stale. Refreshed it.',service:'Identity Gateway'});
});

test('report analysis uses aggregate metrics and refuses malformed data without a provider call',async()=>{
  const analysis={overview:'Cedar Market opened two incidents.',patterns:'The payment timeout appeared twice.',
    nextStep:'Review the previous payment timeout fix.'};
  const {post,sent}=setup(analysis);
  const report={period:'Nov 16 – Nov 22, 2026',company:'Cedar Market',opened:2,resolved:1,sampleIncidents:1,
    companies:[{name:'Cedar Market',opened:2,resolved:1}],
    repeated:[{company:'Cedar Market',service:'Payments API',fingerprint:'PAY_AUTH_TIMEOUT',count:2}],
    trend:[{name:'Fri',opened:2,resolved:1}],timed:1,averageMinutes:22,privateNotes:'Do not send this'};
  assert.equal((await post({...report,opened:'invalid'},'report')).status,400);
  assert.equal(sent.length,0);
  assert.deepEqual((await post(report,'report')).body,analysis);
  const context=JSON.parse(sent[0].contents[0].parts[0].text);
  assert.equal(context.opened,2);
  assert.equal(context.repeated[0].fingerprint,'PAY_AUTH_TIMEOUT');
  assert.equal(context.privateNotes,undefined);
});
