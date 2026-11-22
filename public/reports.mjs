import {companyKey, companyLabel, sampleCompanyFor} from './data.mjs';

const reportDayMs = 86_400_000;
const reportDayFormatter = new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',
});
const reportDateLabel = new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',month:'short',day:'numeric'});
const reportWeekday = new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',weekday:'short'});
const reportMonth = new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',month:'short'});
const reportDay = time=>Date.parse(reportDayFormatter.format(time)+'T00:00:00Z');
const hasTime = value=>Number.isFinite(value) && value>=0;
const reportMean = values=>values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null;

export function reportPeriod(range, offset, now = Date.now()) {
  const day = reportDay(now);
  const date = new Date(day);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  let start,end,buckets=[];
  if (range==='week') {
    start = day - ((date.getUTCDay()+6)%7-offset*7)*reportDayMs;
    end = start+7*reportDayMs;
    buckets = Array.from({length:7},(_,index)=>{
      const from = start+index*reportDayMs;
      return {from,to:from+reportDayMs,label:reportWeekday.format(from)};
    });
  } else if (range==='year') {
    start = Date.UTC(year+offset,0,1);
    end = Date.UTC(year+offset+1,0,1);
    buckets = Array.from({length:12},(_,index)=>{
      const from = Date.UTC(year+offset,index,1);
      return {from,to:Date.UTC(year+offset,index+1,1),label:reportMonth.format(from)};
    });
  } else {
    start = Date.UTC(year,month+offset,1);
    end = Date.UTC(year,month+offset+1,1);
    for (let from=start;from<end;from+=7*reportDayMs) {
      buckets.push({from,to:Math.min(from+7*reportDayMs,end),label:reportDateLabel.format(from)});
    }
  }
  return {start,end,buckets,label:range==='year' ? String(new Date(start).getUTCFullYear())
    : `${reportDateLabel.format(start)} – ${reportDateLabel.format(end-reportDayMs)}, ${new Date(end-reportDayMs).getUTCFullYear()}`};
}

export function mergeIncidentWork(local,telegram) {
  const rows = local.map(entry=>({...entry}));
  for (const route of [...telegram].sort((a,b)=>a.created-b.created)) {
    let match = rows.filter(row=>row.incident===route.incident && row.openedAt<=route.created)
      .sort((a,b)=>b.openedAt-a.openedAt)[0];
    if (!match || (hasTime(match.closedAt) && route.created>match.closedAt)) {
      match = {key:route.id,incident:route.incident,title:route.title,service:route.service,level:route.level,
        company:route.company,fingerprint:route.fingerprint,openedAt:route.created};
      rows.push(match);
    }
    match.company ||= route.company;
    match.fingerprint ||= route.fingerprint;
    if (hasTime(route.completedAt) && (!hasTime(match.closedAt) || route.completedAt<match.closedAt)) {
      Object.assign(match,{closedAt:route.completedAt,closedBy:route.completedBy,via:route.completedVia});
    }
    const matchingResponder=Boolean(match.closedBy && route.acceptedBy?.toLowerCase()===match.closedBy.toLowerCase());
    const alreadyMatches=Boolean(match.closedBy && match.acceptedBy?.toLowerCase()===match.closedBy.toLowerCase());
    if (hasTime(route.acceptedAt) && (!hasTime(match.acceptedAt) || (matchingResponder && !alreadyMatches) ||
        (matchingResponder===alreadyMatches && route.acceptedAt<match.acceptedAt))) {
      match.acceptedAt=route.acceptedAt;
      match.acceptedBy=route.acceptedBy;
    }
  }
  return rows;
}

export function reportSummary(entries,period) {
  const within=(time,from=period.start,to=period.end)=>hasTime(time) && reportDay(time)>=from && reportDay(time)<to;
  const opened=entries.filter(row=>within(row.openedAt));
  const resolved=entries.filter(row=>within(row.closedAt)).sort((a,b)=>b.closedAt-a.closedAt);
  const durations=resolved.flatMap(row=>hasTime(row.openedAt) && row.closedAt>=row.openedAt ? [row.closedAt-row.openedAt] : []);
  const responders=new Map();
  for (const row of resolved) {
    if (!row.closedBy) continue;
    const key=row.closedBy.toLowerCase();
    const person=responders.get(key) || {name:row.closedBy,count:0,work:[]};
    person.count++;
    if (hasTime(row.acceptedAt) && row.acceptedAt>=row.openedAt && row.acceptedAt<=row.closedAt &&
        row.acceptedBy?.toLowerCase()===key) person.work.push(row.closedAt-row.acceptedAt);
    responders.set(key,person);
  }
  const people=[...responders.values()].map(({name,count,work})=>({name,count,timed:work.length,average:reportMean(work)}))
    .sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name));
  const buckets=period.buckets.map(bucket=>({...bucket,
    opened:opened.filter(row=>within(row.openedAt,bucket.from,bucket.to)).length,
    resolved:resolved.filter(row=>within(row.closedAt,bucket.from,bucket.to)).length}));
  const companyCounts = new Map();
  for (const [field,rows] of [['opened',opened],['resolved',resolved]]) for (const row of rows) {
    const company=companyKey(row.company);
    const item=companyCounts.get(company) || {key:company,name:companyLabel(row.company) || 'Unassigned',opened:0,resolved:0};
    item[field]++;
    companyCounts.set(company,item);
  }
  const companies=[...companyCounts.values()].sort((a,b)=>b.opened-a.opened || b.resolved-a.resolved || a.name.localeCompare(b.name));
  const signatures=new Map();
  for (const row of opened) {
    const company=companyKey(row.company);
    const fingerprint=row.fingerprint?.trim().toUpperCase();
    if (!company || !fingerprint || !row.service) continue;
    const key=JSON.stringify([company,row.service,fingerprint]);
    const match=signatures.get(key) || {company:companyLabel(row.company),service:row.service,fingerprint,count:0};
    match.count++;
    signatures.set(key,match);
  }
  const repeated=[...signatures.values()].filter(item=>item.count>1).sort((a,b)=>b.count-a.count || a.fingerprint.localeCompare(b.fingerprint));
  return {opened,resolved,people,buckets,mttr:reportMean(durations),timed:durations.length,companies,repeated};
}

export function durationLabel(milliseconds) {
  if (!hasTime(milliseconds)) return '—';
  if (milliseconds<60_000) return `${Math.floor(milliseconds/1000)}s`;
  const minutes=Math.floor(milliseconds/60_000);
  const hours=Math.floor(minutes/60);
  const days=Math.floor(hours/24);
  if (days) return `${days}d ${hours%24}h`;
  return hours ? `${hours}h ${minutes%60}m` : `${minutes}m`;
}

export const demoReportEvents = [
  ['2026-11-16',9,42,'Checkout','Payment confirmation lag','Maya Chen','P2','CHECKOUT_CONFIRM_LAG'],
  ['2026-11-17',11,25,'Identity Gateway','Signing-key cache drift','Sam Rivera','P2','JWKS_CACHE_MISS'],
  ['2026-11-17',14,18,'Stock Sync','Stock sync delay','Alex Morgan','P3','SYNC_LAG'],
  ['2026-11-18',10,64,'Payments API','Provider authorization delay','Maya Chen','P1','PAY_AUTH_TIMEOUT'],
  ['2026-11-19',12,36,'Inventory Database','Slow inventory import','Alex Morgan','P2','INV_COMMIT_STALL'],
  ['2026-11-20',14,48,'Reporting','Morning reports delayed','Priya Shah','P3','REPORT_LATE'],
  ['2026-10-29',11,71,'Payments API','Payment timeout after configuration change','Maya Chen','P2','PAY_CONN_RESET'],
  ['2026-09-21',9,31,'Object Storage','Slow uploads during maintenance','Maya Chen','P3','STORAGE_LATENCY'],
].map(([day,hour,minutes,service,title,closedBy,level,fingerprint],index)=>{
  const openedAt=Date.parse(day+'T00:00:00Z')+hour*3_600_000;
  return {key:'sample-'+index,incident:'SAMPLE-'+(index+1),service,title,level,openedAt,fingerprint,company:sampleCompanyFor(service),
    acceptedAt:openedAt+3*60_000,acceptedBy:closedBy,closedAt:openedAt+minutes*60_000,closedBy,via:'sample'};
});

const sampleExposure = {
  Commerce:{low:1,high:4,order:55},Identity:{low:2,high:6,order:8},Data:{low:1,high:4,order:14},
  Operations:{low:.5,high:2,order:18},Edge:{low:3,high:10,order:4},Platform:{low:1,high:3,order:12},
};
export function exposureAssumptions(incident,group,override) {
  return override || incident.money || sampleExposure[group] || sampleExposure.Operations;
}

export function exposureAt({low,high,order},minutes) {
  return {low:low*order*minutes,high:high*order*minutes};
}

