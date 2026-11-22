export const teammates = ['Maya Chen', 'Sam Rivera', 'Alex Morgan', 'Priya Shah'];

export const services = [
  ['Payments API', 'Commerce'], ['Checkout', 'Commerce'], ['Order confirmation', 'Commerce'],
  ['Identity Gateway', 'Identity'], ['Customer Portal', 'Identity'], ['Session Store', 'Identity'],
  ['Inventory Database', 'Data'], ['Stock Sync', 'Data'], ['Analytics Warehouse', 'Data'],
  ['Reporting', 'Operations'], ['Email Relay', 'Operations'], ['Support Inbox', 'Operations'],
  ['Catalog API', 'Commerce'], ['Search Index', 'Commerce'], ['Pricing Engine', 'Commerce'],
  ['Shipping API', 'Commerce'], ['Returns Portal', 'Commerce'], ['Tax Calculator', 'Commerce'],
  ['Image CDN', 'Edge'], ['Public Website', 'Edge'], ['API Gateway', 'Edge'],
  ['Feature Flags', 'Platform'], ['Config Registry', 'Platform'], ['Secrets Vault', 'Platform'],
  ['Audit Logs', 'Platform'], ['Build Runner', 'Platform'], ['Message Queue', 'Platform'],
  ['Object Storage', 'Data'], ['Backups', 'Data'], ['Billing Reports', 'Operations'],
].map(([name, group]) => ({name, group}));

const sampleCompanyGroups = {
  Commerce:'Cedar Market',Identity:'Northstar Labs',Data:'Overlook Supply',
  Operations:'Harborline Services',Edge:'Cedar Market',Platform:'Northstar Labs',
};
export const sampleCompanies = [...new Set(Object.values(sampleCompanyGroups))];
export const sampleCompanyFor = service=>sampleCompanyGroups[services.find(item=>item.name===service)?.group] || '';
export const companyLabel = company=>typeof company==='string'
  ? company.normalize('NFKC').trim().replace(/\s+/g,' ').slice(0,80) : '';
export const companyKey = company=>companyLabel(company).toLowerCase();

export const history = [
  {id:'INC-096', date:'Oct 29', service:'Payments API', fingerprint:'PAY_CONN_RESET', title:'Timeouts after a configuration update', priority:'P2', responder:'Maya Chen', cause:'A checkout timeout was set too low.', fix:'Restored the previously validated timeout and verified checkout success.', runbook:'RB-013 · Validate payment recovery'},
  {id:'INC-104', date:'Nov 06', service:'Identity Gateway', version:'2.4.2', fingerprint:'JWKS_CACHE_MISS', title:'Login errors after key rotation', priority:'P2', responder:'Sam Rivera', cause:'The identity gateway cache held stale signing keys.', fix:'Refreshed the signing-key cache and confirmed successful sign-ins.', runbook:'RB-008 · Refresh identity cache'},
  {id:'INC-109', date:'Nov 09', service:'Payments API', fingerprint:'PAY_PROVIDER_429', title:'Provider rate limit during peak hours', priority:'P1', responder:'Priya Shah', cause:'The external provider throttled authorization requests.', fix:null, runbook:null},
  {id:'INC-087', date:'Oct 22', service:'Inventory Database', fingerprint:'POOL_EXHAUSTED', title:'Too many inventory connections', priority:'P2', responder:'Alex Morgan', cause:'A scheduled export filled the connection pool.', fix:'Rescheduled the export and verified the connection pool recovered.', runbook:'RB-017 · Check inventory connections'},
  {id:'INC-081', date:'Oct 16', service:'Image CDN', fingerprint:'CDN_CACHE_MISS', title:'Image requests taking longer', priority:'P3', responder:'Priya Shah', cause:'Cache warmup was incomplete.', fix:'Warmed the cache before shifting traffic.'},
  {id:'INC-079', date:'Oct 12', service:'Search Index', fingerprint:'INDEX_LAG', title:'Search results behind catalog', priority:'P3', responder:'Maya Chen', cause:'The indexer fell behind a bulk import.', fix:'Paused the import and let the indexer catch up.'},
  {id:'INC-073', date:'Oct 08', service:'Email Relay', fingerprint:'MAIL_QUEUE', title:'Receipts delayed', priority:'P3', responder:'Sam Rivera', cause:'A relay worker stopped processing messages.', fix:'Restored the worker and verified the queue drained.'},
  {id:'INC-070', date:'Oct 03', service:'Reporting', fingerprint:'REPORT_LATE', title:'Daily reports unavailable', priority:'P3', responder:'Alex Morgan', cause:'A scheduled warehouse job ran late.', fix:null},
  {id:'INC-064', date:'Sep 26', service:'Stock Sync', fingerprint:'SYNC_LAG', title:'Stock levels stopped updating', priority:'P2', responder:'Priya Shah', cause:'The inventory consumer fell behind.', fix:'Recovered the consumer and checked item counts.'},
  {id:'INC-061', date:'Sep 21', service:'Object Storage', fingerprint:'STORAGE_LATENCY', title:'Slow file uploads', priority:'P3', responder:'Maya Chen', cause:'A maintenance test temporarily limited throughput.', fix:'Verified upload latency returned to baseline after maintenance.'}
];

export const documents = [
  {
    id:'RB-008', title:'Refresh the identity signing-key cache', service:'Identity Gateway', owner:'Identity Operations', updated:'Nov 8, 2026',
    kind:'Recovery runbook', incident:'INC-104',
    useWhen:'Sign-ins fail with JWKS_CACHE_MISS after key rotation, and the affected gateway still has the old key set.',
    stopWhen:'The issuer cannot be reached, the new key is absent from the issuer, or the affected node already has the correct keys. Investigate those conditions before refreshing anything.',
    steps:[
      ['Confirm the signature', 'Compare failed and successful sign-ins on different gateway nodes. Record the key ID presented by the failing request and the key IDs loaded on the failing node.'],
      ['Check the issuer', 'Confirm that the active key ID is published by the expected issuer. Check that the affected node can fetch the published key set.'],
      ['Refresh the affected node', 'After an engineer confirms the mismatch, use the approved cache refresh operation on that node. Leave healthy gateway nodes and the issuer configuration in place.'],
      ['Test a fresh sign-in', 'Verify the node loads the active key and accepts a newly issued token. Compare sign-in failure rates with the healthy nodes.'],
    ],
    verify:'A fresh sign-in succeeds on the affected node and JWKS_CACHE_MISS stops appearing during a five-minute observation window.',
  },
  {
    id:'RB-013', title:'Triage payment timeouts after a deployment', service:'Payments API', owner:'Commerce Operations', updated:'Nov 10, 2026',
    kind:'Conditional recovery runbook', incident:'INC-096', releaseSignature:'PAY_AUTH_TIMEOUT',
    useWhen:'Payment requests start timing out around a release that changed the authorization timeout.',
    stopWhen:'If both versions fail at similar rates during the same provider window, or if provider errors are increasing across unaffected versions, investigate the provider before treating the release as the sole cause.',
    steps:[
      ['Confirm the exact change', 'Compare the previous release and the active rollout. Check the timeout value and the time at which the new version began serving traffic.'],
      ['Compare equal traffic windows', 'Compare errors and latency for both versions over the same time window and provider route. A cluster at the new cutoff on the new version supports the release hypothesis.'],
      ['Check the provider independently', 'Compare failed requests with the provider’s incident window and affected routes. Keep the time of the outage separate from the time it was reported.'],
      ['Use the approved change process if supported', 'If the engineer confirms the new timeout is the differentiating factor, review the approved rollback or previous timeout configuration. If the evidence points to the provider, follow the provider response procedure instead.'],
    ],
    verify:'Compare completed checkouts and successful authorizations with the pre-alert baseline. Check that customer retries do not create duplicate orders.',
  },
  {
    id:'RB-017', title:'Recover an exhausted inventory connection pool', service:'Inventory Database', owner:'Data Platform', updated:'Oct 23, 2026',
    kind:'Recovery runbook', incident:'INC-087',
    useWhen:'The error signature is POOL_EXHAUSTED and an overlapping job is consuming available connections.',
    stopWhen:'If a connection is accepted and the stall starts during commit, this procedure does not apply.',
    steps:[
      ['Check pool saturation', 'Compare active connections, waiting clients, and checkout timeouts with baseline.'],
      ['Identify the job', 'Compare scheduled exports with the increase in open connections. Confirm that the job can be rescheduled with its owner.'],
      ['Reschedule and verify', 'An engineer reschedules the competing export, then checks that connection wait time and inventory writes return to baseline.'],
    ],
    verify:'Connection wait time falls and representative stock updates complete during the next workload window.',
  },
  {
    id:'DG-023', title:'Diagnose inventory commit stalls', service:'Inventory Database', owner:'Data Platform', updated:'Nov 20, 2026',
    kind:'Investigation guide', signature:'INV_COMMIT_STALL',
    useWhen:'Inventory writes accept a connection but stall during commit, with no matching fix in history.',
    stopWhen:'A recent deployment or scheduled job is a lead. Avoid recommending a change until the affected write path and a measurable cause are established.',
    steps:[
      ['Measure the scope', 'Compare stalled and successful writes by operation, database node, and time window. Determine whether the stalls began at the same time as the import.'],
      ['Inspect the write path', 'Check read-only lock wait and transaction latency metrics for the stalled operations. Confirm whether the resized reporting replica is involved in that path.'],
      ['Distinguish two explanations', 'If the issue is isolated to the import, check its transaction overlap with affected writes. If unrelated writes stall too, compare primary transaction latency and shared dependencies.'],
      ['Record what remains unknown', 'Capture the affected operations, supporting observations, and the next owner. Escalate to the database owner if the investigation does not establish a cause.'],
    ],
    verify:'Check commit latency and completed stock updates during the following batch window. This guide provides diagnostics only.',
  },
  {
    id:'DG-007', title:'Triage reports delayed during maintenance', service:'Reporting', owner:'Reporting Operations', updated:'Nov 18, 2026',
    kind:'Investigation guide',
    useWhen:'A reporting alert falls inside a documented warehouse maintenance window.',
    stopWhen:'If the affected report is outside the maintenance scope, or misses its next expected refresh after maintenance, investigate it as a separate incident.',
    steps:[
      ['Validate the planned overlap', 'Check the maintenance ticket, affected warehouse jobs, and expected report refresh timing.'],
      ['Check freshness and backlog', 'Record the last successful refresh. Check job status and whether stale reports are isolated to the planned scope.'],
      ['Check after the window', 'For this case, check the next scheduled job after 10:45 ET. If it fails or the delay extends outside the expected window, hand the evidence to Reporting Operations.'],
    ],
    verify:'Confirm the next expected jobs complete and dependent reports show fresh timestamps.',
  },
  {
    id:'RB-011', title:'Recover an incomplete Image CDN warmup', service:'Image CDN', owner:'Edge Operations', updated:'Oct 17, 2026',
    kind:'Recovery runbook', incident:'INC-081',
    useWhen:'Elevated image latency coincides with a low cache hit rate following a change.',
    stopWhen:'If origin latency is also elevated, investigate the origin before shifting traffic.',
    steps:[['Confirm the cache signal','Compare hit rates and origin latency by region.'],['Warm before shifting','Follow the approved warmup checklist for popular objects and compare a sample of requests.'],['Verify regional recovery','Confirm hit rates and image response times are back near baseline.']],
    verify:'Representative image requests are served within baseline latency across affected regions.',
  },
  {
    id:'RB-012', title:'Drain search indexing lag after a bulk import', service:'Search Index', owner:'Commerce Operations', updated:'Oct 13, 2026',
    kind:'Recovery runbook', incident:'INC-079',
    useWhen:'Indexing lag begins during a bulk catalog import and queued changes continue to grow.',
    stopWhen:'Check dataset integrity and indexer health before resuming an import that produced processing errors.',
    steps:[['Check backlog age','Compare queue depth and oldest unindexed changes with the start of the import.'],['Pause import with its owner','Give the indexer time to drain queued changes before resuming at an approved rate.'],['Sample search results','Confirm recent catalog edits appear in representative searches.']],
    verify:'Backlog age returns to baseline and recent catalog edits appear in search.',
  },
  {
    id:'RB-015', title:'Restore receipt delivery after a worker stall', service:'Email Relay', owner:'Operations', updated:'Oct 9, 2026',
    kind:'Recovery runbook', incident:'INC-073',
    useWhen:'Receipts accumulate in the relay queue and the worker heartbeat is missing.',
    stopWhen:'Investigate downstream mail-provider errors first if the worker continues processing normally.',
    steps:[['Check the receipt queue','Compare queue age, worker heartbeat, and delivery errors.'],['Recover the worker','An engineer uses the approved worker recovery process once the stall is confirmed.'],['Check a sample delivery','Confirm queue age decreases and a representative receipt arrives once.']],
    verify:'Receipt queue age returns to baseline without duplicate receipt delivery.',
  },
  {
    id:'RB-021', title:'Recover stock synchronization lag', service:'Stock Sync', owner:'Data Platform', updated:'Sep 27, 2026',
    kind:'Recovery runbook', incident:'INC-064',
    useWhen:'The stock consumer is behind and product counts drift from the inventory source.',
    stopWhen:'Investigate data integrity before restarting a consumer with repeated message-processing errors.',
    steps:[['Identify where lag starts','Compare the oldest pending update with the last successful consumer checkpoint.'],['Recover the consumer','Follow the owner-approved recovery procedure and let the queue drain from a verified checkpoint.'],['Reconcile counts','Compare a representative item sample with the upstream inventory source.']],
    verify:'Consumer lag returns to baseline and representative counts match the source.',
  },
  {
    id:'RB-026', title:'Verify uploads after storage maintenance', service:'Object Storage', owner:'Data Platform', updated:'Sep 22, 2026',
    kind:'Recovery runbook', incident:'INC-061',
    useWhen:'Upload latency increases during a scheduled storage throughput test.',
    stopWhen:'Open a separate investigation if upload errors occur outside the expected test window.',
    steps:[['Confirm the maintenance scope','Compare the affected bucket groups and regions with the maintenance record.'],['Measure after maintenance','Compare representative uploads with the pre-window baseline.'],['Check completeness','Confirm uploads complete and the stored objects are readable for the test cases.']],
    verify:'Upload completion rate and latency return to baseline in the affected groups.',
  },
];

export const scenarios = [
  {
    id:'INC-121', variant:'After a release', service:'Payments API', title:'Checkout payments failing', owner:'Maya Chen', fingerprint:'PAY_AUTH_TIMEOUT', alert:'10:02',
    affectedPct:38, core:true, confirmed:['Payments API','Checkout'], possible:['Order confirmation'], document:'RB-013', serviceVersion:'2.8.0',
    findings:[
      {text:'The error rate rose from a 0.4% authorization baseline to 38% checkout failures after a release changed the authorization timeout from 3 s to 1 s.', ids:['MET-21','CHG-78','ALT-23']},
      {text:'Failures concentrate on v2.8.0 at the new 1 s cutoff. That makes the release a stronger lead than timing alone.', ids:['CHG-78','LOG-41']},
      {text:'ClearPay estimated its latency began at 10:01. It published the bulletin at 10:07, after the team had already received the alert.', ids:['EXT-09']},
    ],
    unknowns:['Whether older app versions time out on the same provider route.', 'Whether customers eventually complete orders after retrying.', 'Whether order confirmation is affected.'],
    money:{low:4,high:7,order:65},
    events:[
      {id:'MET-21', time:'09:43', seen:'09:43', kind:'Metric', title:'Payment baseline', detail:'Authorization errors at 0.4%; checkout success normal.'},
      {id:'CHG-78', time:'09:54', seen:'09:54', kind:'Change', version:'2.8.0', title:'Payments API v2.8.0 deployed', detail:'The release lowered the authorization timeout from 3 s to 1 s.'},
      {id:'LOG-41', time:'10:02', seen:'10:02', kind:'Log', signature:'PAY_AUTH_TIMEOUT', affectedVersion:'2.8.0', title:'PAY_AUTH_TIMEOUT starts', detail:'Failed requests cluster on v2.8.0; most fail at the new 1 s cutoff.'},
      {id:'ALT-22', time:'10:02', seen:'10:02', kind:'Alert', service:'Payments API', signature:'PAY_AUTH_TIMEOUT', title:'Payment authorization failures rise', detail:'The Payments API monitor reports failures tagged PAY_AUTH_TIMEOUT.'},
      {id:'ALT-23', time:'10:02', seen:'10:02', kind:'Alert', service:'Checkout', signature:'PAY_AUTH_TIMEOUT', title:'Checkout failure rate reaches 38%', detail:'Checkout depends on Payments API. Its failures report the same upstream authorization timeout.'},
      {id:'SUP-16', time:'10:04', seen:'10:04', kind:'Ticket', title:'Customers report payment failures', detail:'Support records 12 checkout reports. Order confirmation impact remains unverified.'},
      {id:'EXT-09', time:'10:01', seen:'10:07', kind:'Provider', title:'ClearPay reports elevated latency', detail:'Bulletin published at 10:07. The provider estimates its latency started at 10:01.'},
    ],
    cause:'The new 1-second payment timeout is the leading clue.', causeSources:['CHG-78','LOG-41'],
    alternative:'ClearPay latency may also explain the timeouts. Both factors could be contributing.', alternativeSource:'EXT-09',
    next:'Compare old and new app versions against the same provider and time window.',
    verify:'Verify successful authorizations and completed checkouts return to baseline across both versions.',
  },
  {
    id:'INC-122', variant:'Repeat incident', service:'Identity Gateway', title:'Sign-ins rejected after key rotation', owner:'Sam Rivera', fingerprint:'JWKS_CACHE_MISS', alert:'10:09',
    affectedPct:9, core:true, confirmed:['Identity Gateway'], possible:['Customer Portal','Session Store'], document:'RB-008', serviceVersion:'2.4.2',
    findings:[
      {text:'The identity issuer completed scheduled signing-key rotation at 10:00. At 10:08, one node rejected requests signed by the new active key.', ids:['CHG-81','LOG-44']},
      {text:'The monitoring alert recorded 9% sign-in failures at 10:09, concentrated on one node. Compare its cached keys with the keys on a healthy node.', ids:['ALT-25','LOG-44']},
      {text:'INC-104 had the same service and JWKS_CACHE_MISS signature. Sam Rivera restored sign-ins by refreshing the stale cache.', ids:['INC-104','LOG-44']},
    ],
    unknowns:['Whether the affected node can reach the issuer now.', 'Whether the current cache actually lacks the active key.', 'Whether any downstream portal or session checks failed.'],
    events:[
      {id:'CHG-81', time:'10:00', seen:'10:00', kind:'Change', title:'Signing keys rotated', detail:'Scheduled identity key rotation completed.'},
      {id:'LOG-44', time:'10:08', seen:'10:08', kind:'Log', signature:'JWKS_CACHE_MISS', affectedVersion:'2.4.2', title:'JWKS_CACHE_MISS', detail:'A gateway node rejects requests signed with the newly active key.'},
      {id:'ALT-25', time:'10:09', seen:'10:09', kind:'Alert', title:'Sign-in error rate reaches 9%', detail:'Failures cluster on one gateway node.'},
    ],
    cause:'A stale signing-key cache is likely on one gateway node.', causeSources:['LOG-44','INC-104'],
    next:'Compare the active signing-key ID with the key IDs cached on the affected gateway node.',
    verify:'Confirm new sign-ins pass on the affected node and remain at baseline.',
  },
  {
    id:'INC-123', variant:'Unknown issue', service:'Inventory Database', title:'Unfamiliar database stalls', owner:'Alex Morgan', fingerprint:'INV_COMMIT_STALL', alert:'10:12',
    affectedPct:5, core:false, confirmed:['Inventory Database'], possible:['Stock Sync'], document:'DG-023',
    findings:[
      {text:'The reporting replica was resized at 09:48. Stock import started at 10:04. Both are recent changes; neither establishes the cause.', ids:['CHG-82','CHG-83']},
      {text:'Affected writes accept a connection and then stall. No pool timeout appeared in the logs, unlike archived incident INC-087.', ids:['LOG-48','INC-087']},
      {text:'Five percent of stock updates exceeded the monitor threshold. A sample of completed and stalled writes would help isolate the affected path.', ids:['ALT-27']},
    ],
    unknowns:['Whether the import caused overlapping writes or lock waits.', 'Whether the resized read replica participates in this write path.', 'Whether delays have propagated to Stock Sync.'],
    events:[
      {id:'CHG-82', time:'09:48', seen:'09:48', kind:'Change', title:'Inventory read replica resized', detail:'Capacity changed on the reporting replica.'},
      {id:'CHG-83', time:'10:04', seen:'10:04', kind:'Change', title:'Stock import enabled', detail:'A scheduled inventory write batch started.'},
      {id:'LOG-48', time:'10:11', seen:'10:11', kind:'Log', signature:'INV_COMMIT_STALL', title:'INV_COMMIT_STALL', detail:'Some writes stall after accepting a connection. No connection-pool errors are present.'},
      {id:'ALT-27', time:'10:12', seen:'10:12', kind:'Alert', title:'Inventory writes slow down', detail:'5% of stock-update operations exceed the latency threshold.'},
    ],
    cause:'Cause unknown. The sample history has no matching error signature.', causeSources:['LOG-48'],
    next:'Compare stalled writes before and after the stock import. Check whether the resized replica is on that request path.',
    verify:'Watch write latency and stock-update completion through the next batch window.',
  },
  {
    id:'INC-124', variant:'Planned work', service:'Reporting', title:'Scheduled reports delayed', owner:'Priya Shah', fingerprint:'REPORT_LATE', alert:'10:20',
    affectedPct:4, core:false, confirmed:['Reporting'], possible:['Billing Reports'], document:'DG-007',
    findings:[
      {text:'Warehouse maintenance was scheduled from 10:15 to 10:45 ET. The reporting alert fired at 10:20 when a scheduled refresh missed its expected time.', ids:['MNT-07','ALT-29']},
      {text:'Alex Morgan handled a previous reporting delay with the same error signature. The archive records the cause but has no resolution steps.', ids:['INC-070']},
    ],
    unknowns:['Whether this particular report is listed in the maintenance scope.', 'Whether the next refresh completes after 10:45.', 'Whether billing reports are stale as well.'],
    events:[
      {id:'MNT-07', time:'10:15', seen:'10:15', kind:'Maintenance', title:'Reporting maintenance window', detail:'Scheduled warehouse maintenance runs 10:15–10:45.'},
      {id:'ALT-29', time:'10:20', seen:'10:20', kind:'Alert', title:'Scheduled reports delayed', detail:'An internal report missed its expected refresh time.'},
    ],
    cause:'The delay overlaps planned warehouse maintenance. Causation remains unconfirmed.', causeSources:['MNT-07','ALT-29'],
    next:'Check the maintenance ticket for expected impact and compare report freshness after 10:45.',
    verify:'Confirm the scheduled jobs run successfully after the maintenance window.',
  },
];

export const upcoming = [
  {date:'Nov 22', time:'14:00', kind:'Maintenance', service:'Object Storage', title:'Planned storage maintenance'},
  {date:'Nov 23', time:'09:30', kind:'Change', service:'Search Index', title:'Scheduled index refresh'},
  {date:'Nov 25', time:'18:00', kind:'Change', service:'Customer Portal', title:'Scheduled portal release'},
];

export const sampleMonitoringDate = '2026-11-20';
export const sampleMonitoringTime = time => Date.parse(`${sampleMonitoringDate}T${time}:00-05:00`);
const sampleTelemetry = scenarios.flatMap(({service,events})=>events
  .filter(event=>event.kind==='Change' || event.kind==='Maintenance' || event.kind==='Log')
  .map(event=>({...event, service, timeAt:sampleMonitoringTime(event.time), seenAt:sampleMonitoringTime(event.seen)})));

export function extractErrorSignature(title,description) {
  const codes = [...new Set(`${title} ${description}`.toUpperCase().match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) || [])];
  return codes.length === 1 ? codes[0] : null;
}

export function sampleAlertContext({title,description,service,occurredAt,company}) {
  const fingerprint = extractErrorSignature(title,description);
  const scope = companyKey(company);
  if (!scope || scope !== companyKey(sampleCompanyFor(service))) return {fingerprint,events:[]};
  const windowStart = occurredAt - 2 * 60 * 60_000;
  const events = sampleTelemetry.filter(event=>event.service===service && event.seenAt<=occurredAt &&
    event.timeAt>=windowStart && (event.kind!=='Log' || event.signature===fingerprint));
  return {fingerprint,events};
}

const runbookChecks = {
  'RB-008':{verifiedAt:Date.parse('2026-11-06T17:00:00Z'),reviewer:'Sam Rivera',version:'2.4.2'},
  'RB-013':{verifiedAt:Date.parse('2026-10-29T17:00:00Z'),reviewer:'Maya Chen',version:'2.7.4'},
  'RB-017':{verifiedAt:Date.parse('2026-10-22T17:00:00Z'),reviewer:'Alex Morgan',version:'4.2.0'},
};

function reviewedAt(record) {
  const timestamps = [record.resolvedAt, record.reviewedAt ?? record.resolvedAt, record.verifiedAt ?? record.resolvedAt];
  return timestamps.every(Number.isFinite) ? Math.max(...timestamps) : Infinity;
}

export function runbookFreshness(document, archive, currentVersion, now = Date.now(), company = sampleCompanyFor(document.service)) {
  const scope = companyKey(company);
  const sampleScope = companyKey(sampleCompanyFor(document.service));
  const checks = scope ? archive.filter(record=>record.runbook===document.id && record.service===document.service && companyKey(record.company)===scope && reviewedAt(record)<=now)
    .map(record=>({verifiedAt:reviewedAt(record),reviewer:record.responder,version:record.version})) : [];
  const sampleCheck = runbookChecks[document.id];
  if (scope && scope===sampleScope && sampleCheck?.verifiedAt<=now) checks.push(sampleCheck);
  const check = checks.sort((a,b)=>Number(Boolean(currentVersion && b.version===currentVersion))-
    Number(Boolean(currentVersion && a.version===currentVersion)) || b.verifiedAt-a.verifiedAt)[0];
  const reasons = [];
  if (!check) reasons.push('No successful use recorded.');
  if (check && !check.version) reasons.push('Verified service version unknown.');
  if (currentVersion==='') reasons.push('Current service version unknown.');
  if (check?.version && currentVersion && check.version!==currentVersion) reasons.push(`Current version ${currentVersion} differs from verified version ${check.version}.`);
  if (check && now-check.verifiedAt>90*86_400_000) reasons.push('Last verified more than 90 days ago.');
  return {check,reasons};
}

const upstreamServices = {'Checkout':'Payments API','Order confirmation':'Payments API','Customer Portal':'Identity Gateway','Stock Sync':'Inventory Database'};

export function groupDuplicate(incident,candidates) {
  const scope = companyKey(incident.company);
  if (!scope || !incident.fingerprint) return undefined;
  return candidates.find(candidate=>candidate.id!==incident.id && !candidate.groupedUnder &&
    companyKey(candidate.company)===scope &&
    candidate.fingerprint===incident.fingerprint &&
    Math.abs(candidate.occurredAt-incident.occurredAt)<=5*60_000 &&
    (candidate.service===incident.service || upstreamServices[candidate.service]===incident.service ||
      upstreamServices[incident.service]===candidate.service));
}

export function investigate(incident, cutoff = '23:59', archive = []) {
  const sample = incident.sampleAlert;
  const evidence = sample
    ? incident.events.filter(event=>cutoff==='23:59' || event.seenAt<=cutoff).sort((a,b)=>a.seenAt-b.seenAt)
    : incident.events.filter(event=>event.seen<=cutoff).sort((a,b)=>a.seen.localeCompare(b.seen));
  const observed = sample ? incident.triggeredAt!==null && (cutoff==='23:59' || cutoff>=incident.occurredAt)
    : cutoff >= incident.alert;
  const company = companyKey(incident.company ?? (sample ? '' : sampleCompanyFor(incident.service)));
  const alertAt = sample ? incident.triggeredAt ?? incident.occurredAt : sampleMonitoringTime(incident.alert);
  const snapshotAt = cutoff==='23:59' ? alertAt : typeof cutoff==='number' ? cutoff : sampleMonitoringTime(cutoff);
  const archiveCutoff = Math.min(alertAt,snapshotAt);
  const learned = company ? archive.filter(record=>record.id!==incident.id && companyKey(record.company)===company &&
    reviewedAt(record)<=archiveCutoff).sort((a,b)=>reviewedAt(b)-reviewedAt(a)) : [];
  const sampleHistory = company ? history.filter(record=>companyKey(sampleCompanyFor(record.service))===company &&
    (runbookChecks[documents.find(document=>document.incident===record.id)?.id]?.verifiedAt ?? Date.parse(`${record.date} 2026 12:00 UTC`))<=archiveCutoff) : [];
  const comparable = observed ? [...learned,...sampleHistory].filter(record=>record.service===incident.service ||
    (incident.fingerprint && record.fingerprint===incident.fingerprint)) : [];
  const nearby = comparable.filter(record=>record.service===incident.service);
  const exact = nearby.filter(record=>incident.fingerprint && record.fingerprint===incident.fingerprint);
  const applicable = exact.filter(record=>incident.serviceVersion && record.version===incident.serviceVersion);
  const reusableFixes = applicable.filter(record=>record.fix);
  const previous = applicable.find(record=>record.cause);
  const changes = evidence.filter(event => ['Change','Maintenance'].includes(event.kind));
  const logs = evidence.filter(event => ['Log','Metric'].includes(event.kind));
  const signals = evidence.filter(event => ['Alert','Ticket','Provider'].includes(event.kind));
  const relatedAlerts = evidence.filter(event=>event.kind==='Alert' && incident.fingerprint && event.signature===incident.fingerprint);
  const alternative = evidence.find(event => event.id === incident.alternativeSource);
  const ready = observed && incident.causeSources.every(id =>
    evidence.some(event => event.id === id) || nearby.some(record => record.id === id));
  const availableIds = new Set([...evidence,...nearby].map(item=>item.id));
  const findings = incident.findings.filter(finding=>finding.ids.every(id=>availableIds.has(id)));
  const known = reusableFixes[0];
  const verifiedDocument = known && documents.find(document=>document.incident===known.id || document.id===known.runbook);
  const release = sample && observed && changes.find(change=>change.version && (!incident.serviceVersion || change.version===incident.serviceVersion) && logs.some(log=>
    log.signature===incident.fingerprint && log.affectedVersion===change.version && log.timeAt>=change.timeAt));
  const releaseLog = release && logs.find(log=>log.signature===incident.fingerprint &&
    log.affectedVersion===release.version && log.timeAt>=release.timeAt);
  const guide = observed ? (sample
    ? verifiedDocument || documents.find(document=>document.service===incident.service &&
      (document.signature===incident.fingerprint || (release && document.releaseSignature===incident.fingerprint)))
    : documents.find(document=>document.id===incident.document)) : undefined;
  const relatedDocuments = documents.filter(document=>document !== guide && nearby.some(record=>record.id===document.incident));
  const activity = [
    {action:'Read monitoring records', result:`${logs.length} log or metric records available`, query:incident.fingerprint || 'No single error signature found', ids:logs.map(item=>item.id)},
    {action:'Cross-check changes', result:`${changes.length} relevant change or maintenance records`, query:sample ? `${incident.service} · 2 hours before the alert` : incident.service, ids:changes.map(item=>item.id)},
    {action:'Search incident history', result:`${nearby.length} on the same service · ${exact.length} exact signature matches`, query:incident.fingerprint || incident.service, ids:nearby.map(item=>item.id)},
    {action:'Check alerts and reports', result:`${signals.length} monitoring, support, or provider signals`, query:sample ? 'Submitted alert and sample records' : `Available through ${cutoff === '23:59' ? 'latest snapshot' : cutoff}`, ids:signals.map(item=>item.id)},
    {action:'Look up procedures', result:verifiedDocument ? 'Found a procedure linked to a matching documented fix' : guide ? 'Found investigation guidance; no matching documented fix' : 'No incident procedure selected yet', query:incident.service, ids:[guide,...relatedDocuments].filter(Boolean).map(document=>document.id)},
  ];
  let cause = ready ? incident.cause : 'No incident brief was available at this point.';
  let causeSources = ready ? incident.causeSources : [];
  let next = incident.next;
  if (sample && observed) {
    if (release) {
      cause = `The recent release ${release.version} is the leading cause. ${release.detail} ${releaseLog.detail}`;
      causeSources = [release.id,releaseLog.id];
      next = guide?.steps[0]?.[1] || 'Compare the same operation on the previous and current versions.';
    } else if (previous) {
      cause = `Likely repeat of ${previous.id}. Prior cause: ${previous.cause} Confirm it against the current alert.`;
      causeSources = [...incident.causeSources,previous.id,...logs.map(log=>log.id)];
      next = guide?.steps[0]?.[1] || 'Confirm that the conditions of the previous incident match this alert.';
    } else {
      cause = 'The available evidence does not establish a likely cause.';
      causeSources = [...incident.causeSources,...logs.map(log=>log.id)];
      if (changes.length) next = 'Compare the first errors with the recent changes below and check which touched the affected operation.';
    }
  }
  const comparisons = comparable.map(record=>{
    const sameService = record.service===incident.service;
    const sameSignature = Boolean(incident.fingerprint && record.fingerprint===incident.fingerprint);
    const versionDiffers = Boolean(record.version && incident.serviceVersion && record.version!==incident.serviceVersion);
    return {record,match:sameService && sameSignature,reasons:[
      sameService ? 'Same service' : `Different service · ${record.service}`,
      sameSignature ? 'Same error signature' : incident.fingerprint ? 'Different error signature' : 'Current error signature unknown',
      record.fix ? 'Fix documented' : 'Fix missing',
      versionDiffers && `Version ${record.version} differs from ${incident.serviceVersion}`,
      sameService && sameSignature && !record.version && 'Prior version unknown',
      sameService && sameSignature && !incident.serviceVersion && 'Current version unknown',
    ].filter(Boolean)};
  });
  const challenger = release || alternative
    ? {claim:alternative ? incident.alternative : 'A shared upstream fault could also explain errors across versions.',
      check:'Compare the same operation and upstream route on both versions. Similar failures on the older version would weaken the release hypothesis.',
      sources:[alternative?.id,release?.id,releaseLog?.id].filter(Boolean)}
    : previous
      ? {claim:'The same error code can appear even when the previous cause is absent.',
        check:guide?.stopWhen || 'Check whether the confirmed cause from the previous record is present in the current logs. Its absence weakens the match.',
        sources:[previous.id,...logs.map(event=>event.id)].slice(0,3)}
      : {claim:'The alert may coincide with a change while the affected operation fails elsewhere.',
        check:guide?.steps.find(([title])=>title.startsWith('Distinguish'))?.[1] ||
          'Compare a failing and a successful operation. If both use the changed component, check their other differences before attributing the failure.',
        sources:[...changes,...logs].slice(0,3).map(event=>event.id)};
  const certainty = !ready || (sample && !release && !previous) || incident.variant==='Unknown issue'
    ? 'Unknown' : 'Likely';
  return {evidence, observed, nearby, exact, applicable, reusableFixes, archiveCutoff, changes, alternative, ready, activity, relatedAlerts,
    known, guide, relatedDocuments, verifiedDocument, findings, cause, causeSources, next, comparisons, challenger, certainty,
    verify:known?.verification || (sample && guide ? guide.verify : incident.verify)};
}

export function priority(incident) {
  if (incident.core && incident.affectedPct >= 25) return 'P1';
  if (incident.core || incident.affectedPct >= 5) return 'P2';
  return 'P3';
}
