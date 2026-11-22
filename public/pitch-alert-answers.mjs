import {pitchAnswerLimit} from './pitch-qa.mjs';

const pitchAlertId = /\b(?:INC[ -]\d+|(?:SIM|TEST|TST)-[A-Z0-9-]+)\b/gi;
const pitchAlertNouns = /\b(?:alerts?|incidents?|outages?)\b/i;
const pitchAlertOpen = /\b(?:right now|current(?:ly)?|active|open|ongoing|unresolved|still (?:open|active)|new(?:ly)? (?:alerts?|incidents?)|what(?:'s| is) happening)\b/i;
const pitchAlertClosed = /\b(?:closed|resolved|archived|historical|history of|past|previous|older|old|fixed|recovered)\b/i;
const pitchAlertRecent = /\b(?:latest|newest|most recent|last|most recently|recently|new(?:ly added)? (?:alerts?|incidents?))\b/i;
const pitchAlertList = /\b(?:list|show|which|how many|we (?:have|had)|do we (?:have|know)|our alerts|any alerts|what happened|what is happening|what alerts|what incidents|what outages|tell me (?:the|about (?:the|our|any)))\b/i;
const pitchAlertFollowUp = /\b(?:what happened|what changed|what did we do|why|fixed|fix|resolved|closed|cause|assigned|who|when|which|status|first|second|third|fourth|next)\b/i;
const pitchAlertReference = /\b(?:it|them|that one|these|those|this alert|this incident|that alert|that incident|the (?:first|second|third|fourth|most recent|newest|oldest) one)\b/i;
const pitchAlertOrdinals = ['first', 'second', 'third', 'fourth'];
const pitchAlertDate = new Intl.DateTimeFormat('en-CA', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto',
});

const pitchAlertNormalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const pitchAlertIncludes = (text, term) => term && ` ${text} `.includes(` ${term} `);
const pitchAlertIds = question => [...new Set([...question.matchAll(pitchAlertId)].map(([id])=>id.toUpperCase().replace(' ', '-')))];
const pitchAlertTime = (record, closed) => Number(record[closed ? 'closedAt' : 'occurredAt'] || record.occurredAt) || 0;
const pitchAlertRecency = record => Number(!record.closed && record.receivedAt) || pitchAlertTime(record, record.closed);

function pitchAlertClip(value, limit) {
  const line = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (line.length <= limit) return line;
  if (limit < 2) return '';
  const prefix = line.slice(0, limit - 1);
  const lastSpace = prefix.lastIndexOf(' ');
  return (lastSpace > prefix.length * 0.66 ? prefix.slice(0, lastSpace) : prefix).trimEnd() + '…';
}

function pitchAlertSentence(value) {
  return /[.!?…]$/.test(value) ? value : value + '.';
}

function pitchAlertStatus(record, closed) {
  const status = pitchAlertClip(record.status, 44).toLowerCase();
  if (closed) {
    if (status === 'archived') return 'archived';
    if (status.includes('complete') && !record.resolution) return 'marked complete';
    return 'resolved';
  }
  if (record.groupedUnder) return `grouped under ${record.groupedUnder}`;
  if (status.startsWith('accepted by ')) return 'accepted';
  if (status === 'claimed') return 'accepted';
  if (status === 'pending') return 'waiting for acknowledgement';
  if (status === 'open') return 'open';
  return status || 'open';
}

const pitchAlertRecord = record => record && typeof record.id === 'string';

function pitchAlertTitle(record, limit) {
  const title = pitchAlertClip(record.title || record.service || 'Untitled alert', limit);
  const priority = /^P[1-4]$/.test(record.priority) ? ` (${record.priority})` : '';
  return `${record.id}${priority}, ${title}`;
}

function pitchAlertDetail(record, closed, question) {
  const asksTime = /\b(?:when|what (?:day|time)|how long)\b/i.test(question);
  const closedAt = closed && Number(record.closedAt);
  const at = asksTime ? pitchAlertTime(record, closed) : 0;
  const status = pitchAlertStatus(record, closed);
  const result = [pitchAlertSentence(`${pitchAlertTitle(record, 90)}. Status is ${status}`)];
  const who = closed ? record.closedBy : record.assignee;
  if (who) result.push(pitchAlertSentence(`${pitchAlertClip(who, 60)} ${closed ? 'handled it' : 'is assigned'}`));
  else if (/\b(?:who|assigned|owner)\b/i.test(question)) {
    result.push(closed ? 'There is no closing responder recorded.' : 'There is no assignee recorded.');
  }
  if (at) result.push(`${closedAt ? 'Closed' : 'Occurred'} ${pitchAlertDate.format(at)} Eastern time.`);
  const details = closed
    ? [record.cause, record.resolution || 'No fix is recorded.', record.verification]
    : [record.summary, record.latestUpdate, record.cause || (record.hypothesis ? `Unconfirmed hypothesis. ${record.hypothesis}` : ''),
      record.resolution || (record.latestUpdate ? '' : 'No fix is recorded yet.'), record.nextCheck && `Suggested first check. ${record.nextCheck}`];
  for (const detail of new Set(details.filter(Boolean))) {
    const room = Math.min(185, pitchAnswerLimit - result.join(' ').length - 2);
    if (room < 25) break;
    result.push(pitchAlertSentence(pitchAlertClip(detail, room)));
  }
  return result.join(' ');
}

function pitchAlertListAnswer(records, closed, count, {onlyCount = false, related = false, priority = '', mixed = false} = {}) {
  const scope = mixed ? 'matching' : closed ? 'closed or archived' : 'open';
  const label = `${priority ? priority + ' ' : ''}${scope}`;
  if (!count) return `There are no ${label} alerts ${related ? 'matching that request' : 'in this workspace'}.`;
  const top = records.slice(0, 4);
  const header = `${count} ${label} ${count === 1 ? 'alert' : 'alerts'}${related ? ' match' : ' in this workspace'}.`;
  if (onlyCount || !top.length) return header;
  const extra = count - top.length;
  const footer = extra > 0 ? ` ${extra} more in the ${mixed ? 'incident records' : closed ? 'history' : 'alert inbox'}.` : '';
  const budget = Math.floor((pitchAnswerLimit - header.length - footer.length - 4) / top.length) - 1;
  const rows = top.map(record=>{
    const isClosed = mixed ? Boolean(record.closed) : closed;
    const status = pitchAlertStatus(record, isClosed);
    const intro = `${pitchAlertTitle(record, Math.min(64, budget - status.length - 22))}, ${status}.`;
    const happened = isClosed ? record.resolution || record.cause || 'No fix recorded.' : record.summary;
    const room = budget - intro.length - 2;
    return happened && room >= 22 ? `${intro} ${pitchAlertSentence(pitchAlertClip(happened, room))}` : intro;
  });
  return [header, ...rows].join(' ') + footer;
}

function pitchAlertMatches(question, records) {
  const query = pitchAlertNormalize(question);
  const exact = records.filter(record => [record.title, record.fingerprint]
    .some(term => pitchAlertIncludes(query, pitchAlertNormalize(term))));
  if (exact.length) return exact;
  const services = records.filter(record => pitchAlertIncludes(query, pitchAlertNormalize(record.service)));
  if (services.length) return services;
  const subject = question.match(/\b(?:what happened (?:with|to|on|for)|what caused|(?:what|who) fixed|status of|what about|tell me about)\s+(?:the\s+)?([^?.]+)/i)?.[1] ?? '';
  const meaningful = pitchAlertNormalize(subject).split(' ').filter(word => word.length >= 4 &&
    !/^(?:alerts?|incidents?|outage|then|today|right|yesterday|happened|recently|that|this|them|some|those|these)$/.test(word));
  if (!meaningful.length) return [];
  return records.filter(record => meaningful.every(word => pitchAlertIncludes(pitchAlertNormalize(`${record.title} ${record.service}`), word)));
}

export function pitchAlertAnswer(question, snapshot, history = []) {
  if (!snapshot || !Array.isArray(snapshot.open) || !Array.isArray(snapshot.closed)) return null;
  const open = snapshot.open.filter(record=>pitchAlertRecord(record) && !record.groupedUnder);
  const closed = snapshot.closed.filter(record=>pitchAlertRecord(record) && !record.groupedUnder);
  const ids = pitchAlertIds(question);
  const wantsOpen = pitchAlertOpen.test(question);
  const wantsClosed = pitchAlertClosed.test(question);
  const wantsRecent = pitchAlertRecent.test(question);
  const asksCount = /\bhow many\b/i.test(question);
  const previous = history.at(-1);
  const previousIds = pitchAlertIds(previous?.answer || '');
  const clearList = (pitchAlertNouns.test(question) && (wantsOpen || wantsClosed || wantsRecent || pitchAlertList.test(question))) ||
    /\b(?:what (?:was|got|is) (?:resolved|fixed|closed)|what (?:is|are) currently open|(?:which|how many) (?:ones )?(?:were|are|are still|got) (?:open|resolved|closed|fixed))\b/i.test(question) ||
    (previousIds.length > 0 && (wantsOpen || wantsClosed) && /\b(?:ones?|cases)\b/i.test(question));
  const subjectQuestion = /\b(?:what happened|what caused|what fixed|status of|what about|tell me about)\b/i.test(question) ||
    /\b(?:why|how|which|who|when)\b.*\b(?:affected|failed|fixed|recovered|resolved|happened|alert|incident|closed|assigned)\b/i.test(question);
  const snapshots = [[open, false], [closed, true]];
  const withScope = (records, isClosed) => records.map(record => ({...record, closed: isClosed}));
  const all = snapshots.flatMap(([records, isClosed])=>withScope(records, isClosed));
  const groups = Array.isArray(snapshot.grouped) ? snapshot.grouped.filter(pitchAlertRecord) : [];
  const includeGroups = [...withScope(snapshot.open.filter(pitchAlertRecord), false), ...withScope(snapshot.closed.filter(pitchAlertRecord), true),
    ...withScope(groups, false)];
  const recent = (a,b)=>pitchAlertRecency(b) - pitchAlertRecency(a);
  const urgency = (a,b)=>(a.priority || 'P9').localeCompare(b.priority || 'P9') || recent(a,b);
  const priority = question.match(/\bP[1-4]\b/i)?.[0].toUpperCase() || (/\b(?:critical|highest priority)\b/i.test(question) ? 'P1' : '');
  const matchesPriority = record => !priority || record.priority === priority;
  const fromScope = records => records.filter(record => !(wantsOpen && !wantsClosed && record.closed) &&
    !(wantsClosed && !wantsOpen && !record.closed) && matchesPriority(record));

  function answerRecords(records, onlyCount = asksCount) {
    const sorted = [...records].sort(wantsRecent ? recent : urgency);
    if (sorted.length === 1 && !onlyCount) return pitchAlertDetail(sorted[0], sorted[0].closed, question);
    const allClosed = sorted.every(record=>record.closed);
    return pitchAlertListAnswer(sorted, allClosed, sorted.length, {onlyCount,related:true,priority,mixed:!allClosed && sorted.some(record=>record.closed)});
  }

  if (ids.length) {
    const scoped = fromScope(includeGroups);
    const selected = ids.flatMap(id => {
      const match = scoped.find(record=>record.id.toUpperCase() === id);
      return match ? [match] : [];
    });
    if (!selected.length) return `I could not find ${ids.join(' or ')} ${wantsClosed ? 'in the closed history' : 'in this workspace'}.`;
    return answerRecords(selected);
  }

  if (/\b(?:in|for|during|will|would|should|does) (?:the |a |your |our )?pilot\b/i.test(question) ||
      /\bhow (?:do|does|would|should|can|will)\b.*\b(?:submit|detect|receive|send|route|create|generate|trigger)\b.*\b(?:alerts?|incidents?)\b/i.test(question)) return null;

  if (subjectQuestion || clearList) {
    const matched = pitchAlertMatches(question, fromScope(all));
    if (matched.length) {
      const current = matched.filter(record=>!record.closed);
      return answerRecords(!wantsClosed && !wantsRecent && current.length ? current : matched);
    }
  }

  const shortFollowUp = /^(?:and )?(?:why|what changed|what did we do)[?.! ]*$/i.test(question.trim());
  const refersToSelection = /\bthis (?:alert|incident)\b/i.test(question) && snapshot.selectedId;
  if (!clearList && (shortFollowUp || (pitchAlertReference.test(question) && pitchAlertFollowUp.test(question)))) {
    const relevantIds = previousIds.length ? previousIds : refersToSelection ? [snapshot.selectedId] : [];
    const referred = relevantIds.flatMap(id => {
      const record = includeGroups.find(item => item.id.toUpperCase() === id);
      return record ? [record] : [];
    });
    if (referred.length) {
      const ordinal = pitchAlertOrdinals.findIndex(word => new RegExp(`\\b${word}\\b`, 'i').test(question));
      const selected = ordinal >= 0 ? referred.slice(ordinal, ordinal + 1) : referred;
      if (selected.length) return answerRecords(selected);
    }
  }

  if (!clearList && !(subjectQuestion && wantsOpen && pitchAlertNouns.test(question))) return null;
  const plural = /\b(?:alerts|incidents|outages)\b/i.test(question);
  if (wantsRecent && !wantsClosed && !wantsOpen && !plural && !asksCount) {
    const newest = all.filter(matchesPriority).sort(recent)[0];
    if (newest) return pitchAlertDetail(newest, newest.closed, question);
  }
  if (wantsOpen && wantsClosed) {
    const both = all.filter(matchesPriority).sort(wantsRecent ? recent : urgency);
    return pitchAlertListAnswer(both, false, both.length, {onlyCount:asksCount,priority,mixed:true});
  }
  const list = (wantsClosed ? closed : open).filter(matchesPriority).sort(wantsRecent ? recent : urgency);
  const count = priority ? list.length : (wantsClosed ? snapshot.closedCount : snapshot.openCount) ?? list.length;
  if (list.length && !asksCount && ((wantsRecent && !plural) || count === 1)) return pitchAlertDetail(list[0], wantsClosed, question);
  return pitchAlertListAnswer(list, wantsClosed, count, {onlyCount:asksCount,priority});
}
