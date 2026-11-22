import {sampleMonitoringTime} from './data.mjs';

function buildIncident({id, title, company, service, owner, description, alert, fingerprint, serviceVersion, affectedPct, events}) {
  const occurredAt = sampleMonitoringTime(alert);
  const alertSource = `${id}-ALT`;
  const sources = [...events, {id:alertSource, kind:'Alert', time:alert, title, detail:description, signature:fingerprint}];
  return {
    id, title, company, service, owner, description, alert, fingerprint, serviceVersion, affectedPct,
    core:true, variant:'Impact comparison', sampleAlert:true, occurredAt, triggeredAt:occurredAt,
    confirmed:[service], possible:[],
    events:sources.map(source => ({...source, service, seen:source.time,
      timeAt:sampleMonitoringTime(source.time), seenAt:sampleMonitoringTime(source.time)})),
    causeSources:[alertSource], findings:[{text:description, ids:[alertSource]}],
    unknowns:['Do the failed and healthy requests follow the same upstream route with comparable inputs?'],
    next:'Compare the same operation on the previous and current versions.',
    verify:'Check that HTTP 503 rates return to baseline on the same operation in both revision groups.',
  };
}

const checkout = buildIncident({
  id:'IMPACT-CHK-503', title:'Checkout HTTP 503 spike', company:'Bramble Market Lab', service:'Checkout', owner:'Maya Chen',
  description:'The production checkout probe reports ORDER_SUBMIT_503 on new order submissions.',
  alert:'09:55', fingerprint:'ORDER_SUBMIT_503', serviceVersion:'4.17.0', affectedPct:18.4,
  events:[
    {id:'IMPACT-CHK-DEP', kind:'Change', time:'09:44', title:'Checkout rollout', version:'4.17.0',
      detail:'v4.17.0 began serving 50% of traffic. The release updated the time budget for payment routing.'},
    {id:'IMPACT-CHK-LOG-1', kind:'Log', time:'09:49', title:'Checkout gateway request', signature:'ORDER_SUBMIT_503', affectedVersion:'4.17.0',
      detail:'request=c-214 operation=POST /checkout/submit revision=4.17.0 status=503 duration_ms=1802 downstream=payment-router'},
    {id:'IMPACT-CHK-LOG-2', kind:'Log', time:'09:49', title:'Checkout gateway request',
      detail:'request=c-215 operation=POST /checkout/submit revision=4.16.2 status=201 duration_ms=215 downstream=payment-router'},
    {id:'IMPACT-CHK-COPY', kind:'Change', time:'09:51', title:'Checkout help article published',
      detail:'The publishing job updated the text on the public help article. No checkout configuration was changed.'},
    {id:'IMPACT-CHK-PROBE', kind:'Metric', time:'09:53', title:'Inventory reservation probe',
      detail:'100 of 100 reservation probes succeeded. p95 was 47 ms against a 50 ms baseline.'},
    {id:'IMPACT-CHK-MET', kind:'Metric', time:'09:54', title:'HTTP 503 rates by deployed revision',
      detail:'09:49–09:54 ET, POST /checkout/submit. v4.17.0: 92 of 500 (18.4%). v4.16.2: 2 of 500 (0.4%).'},
  ],
});

const login = buildIncident({
  id:'IMPACT-LGN-503', title:'Login HTTP 503 spike', company:'Tern Accounts Lab', service:'Identity Gateway', owner:'Sam Rivera',
  description:'The production login probe reports SESSION_CREATE_503 while opening new sessions.',
  alert:'11:45', fingerprint:'SESSION_CREATE_503', serviceVersion:'7.25.0', affectedPct:17.8,
  events:[
    {id:'IMPACT-LGN-DEP', kind:'Change', time:'11:34', title:'Identity Gateway rollout', version:'7.25.0',
      detail:'v7.25.0 began serving 50% of traffic. The release updated the time budget for session signing.'},
    {id:'IMPACT-LGN-LOG-1', kind:'Log', time:'11:39', title:'Login gateway request', signature:'SESSION_CREATE_503', affectedVersion:'7.25.0',
      detail:'request=l-312 operation=POST /sessions revision=7.25.0 status=503 duration_ms=1757 downstream=session-signer'},
    {id:'IMPACT-LGN-LOG-2', kind:'Log', time:'11:39', title:'Login gateway request',
      detail:'request=l-313 operation=POST /sessions revision=7.24.1 status=201 duration_ms=207 downstream=session-signer'},
    {id:'IMPACT-LGN-COPY', kind:'Change', time:'11:41', title:'Sign-in help article published',
      detail:'The publishing job updated the text on the public help article. No sign-in configuration was changed.'},
    {id:'IMPACT-LGN-PROBE', kind:'Metric', time:'11:43', title:'Identity directory probe',
      detail:'100 of 100 directory lookup probes succeeded. p95 was 46 ms against a 50 ms baseline.'},
    {id:'IMPACT-LGN-MET', kind:'Metric', time:'11:44', title:'HTTP 503 rates by deployed revision',
      detail:'11:39–11:44 ET, POST /sessions. v7.25.0: 89 of 500 (17.8%). v7.24.1: 3 of 500 (0.6%).'},
  ],
});

export const impactCases = [
  {
    id:'checkout', incident:checkout,
    archive:[{
      id:'IMPACT-CHK-PAST', company:checkout.company, service:checkout.service, fingerprint:'RESERVATION_WAIT',
      title:'Checkout returned 503 during inventory contention', date:'Nov 17', resolvedAt:Date.parse('2026-11-17T15:11:00Z'),
      version:'4.12.8', responder:'Maya Chen', cause:'Inventory writes waited behind a long-running reservation.',
      fix:'Cleared the blocked reservation and verified new orders completed.',
    }],
    causes:[
      {id:'inventory', label:'Inventory reservation contention'},
      {id:'checkout-copy', label:'Checkout help article publish'},
      {id:'checkout-rollout', label:'Checkout v4.17.0 rollout'},
    ],
    checks:[
      {id:'check-reservations', label:'Check inventory for blocked reservations'},
      {id:'compare-checkout', label:'Compare checkout traces across revisions'},
      {id:'review-checkout-copy', label:'Compare both checkout help articles'},
    ],
    correctCause:'checkout-rollout', correctCheck:'compare-checkout',
  },
  {
    id:'login', incident:login,
    archive:[{
      id:'IMPACT-LGN-PAST', company:login.company, service:login.service, fingerprint:'DIRECTORY_WAIT',
      title:'Login returned 503 during identity directory contention', date:'Nov 17', resolvedAt:Date.parse('2026-11-17T17:01:00Z'),
      version:'7.19.3', responder:'Sam Rivera', cause:'Identity lookups waited behind a stalled directory replica.',
      fix:'Redirected lookups to the healthy replica and verified new sessions opened.',
    }],
    causes:[
      {id:'login-rollout', label:'Identity Gateway v7.25.0 rollout'},
      {id:'directory', label:'Identity directory contention'},
      {id:'login-copy', label:'Sign-in help article publish'},
    ],
    checks:[
      {id:'review-login-copy', label:'Compare both sign-in help articles'},
      {id:'check-directory', label:'Check identity directory replica health'},
      {id:'compare-login', label:'Compare sign-in traces across revisions'},
    ],
    correctCause:'login-rollout', correctCheck:'compare-login',
  },
];
