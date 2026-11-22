import assert from 'node:assert/strict';
import test from 'node:test';
import {pitchAlertAnswer} from '../public/pitch-alert-answers.mjs';

const checkout = {id:'INC-121', title:'Checkout payments failing', service:'Payments API', priority:'P1', status:'Needs review',
  occurredAt:1_200, summary:'The authorization monitor reported payment timeouts.', hypothesis:'The release lowered the timeout.'};
const signIn = {id:'INC-122', title:'Sign-ins rejected', service:'Identity Gateway', priority:'P2', status:'Investigating',
  occurredAt:1_300, summary:'One gateway node rejected sign-ins.', assignee:'Sam Rivera'};
const inventory = {id:'INC-123', title:'Inventory database stalls', service:'Inventory Database', priority:'P3', status:'Reported',
  occurredAt:1_400, summary:'Some inventory writes stalled during commit.'};
const newEvent = {id:'SIM-NEW', title:'Shipping webhook timeout', service:'Shipping', priority:'P2', status:'Reported',
  occurredAt:2_000, summary:'Webhook delivery timed out.', fingerprint:'WEBHOOK_TIMEOUT'};
const archived = {id:'INC-104', title:'Login errors after key rotation', service:'Identity Gateway', priority:'P2', status:'Archived',
  occurredAt:500, cause:'Cached signing keys were stale.', resolution:'The engineer refreshed the signing-key cache.'};
const incomplete = {id:'INC-109', title:'Provider rate limit during peak hours', service:'Payments API', priority:'P1',
  status:'Archived', occurredAt:700, cause:'The provider throttled authorization requests.'};
const recovered = {...newEvent, status:'Resolved', cause:'The webhook worker stopped processing requests.',
  resolution:'Restarted the webhook worker.', closedAt:3000, closedBy:'Maya Chen', verification:'A test delivery completed.'};
const current = {open:[checkout, signIn, inventory, newEvent], closed:[archived, incomplete]};

test('answers the requested live alert question with current titles, evidence, and statuses', () => {
  const answer = pitchAlertAnswer('Tell me what right now alerts we have and what happened with them', current);
  assert.match(answer, /4 open alerts/);
  assert.match(answer, /INC-121.*needs review/);
  assert.match(answer, /SIM-NEW.*Shipping webhook timeout.*reported.*Webhook delivery timed out/);
  assert.doesNotMatch(answer, /INC-104|closed or archived/);
  assert.ok(answer.length <= 560);
  assert.match(pitchAlertAnswer('What are our alerts?', current), /4 open alerts/);
  assert.match(pitchAlertAnswer('What happened to the new alert?', current), /SIM-NEW/);
  assert.match(pitchAlertAnswer('What is our most recent alert?', current), /SIM-NEW/);
  const backdated = {...newEvent, occurredAt:100, receivedAt:2_000};
  assert.match(pitchAlertAnswer('What is our most recent alert?', {...current, open:[checkout, backdated]}), /SIM-NEW/);
  assert.match(pitchAlertAnswer('How many open P1 alerts are there?', current), /^1 P1 open alert/);
  assert.match(pitchAlertAnswer('Which alerts were recently resolved?', current), /2 closed or archived alerts/);
});

test('details separate unconfirmed hypotheses from resolution and recovery records', () => {
  const answer = pitchAlertAnswer('What happened to Checkout?', current);
  assert.match(answer, /INC-121.*payment timeouts.*Unconfirmed hypothesis.*lowered the timeout.*No fix is recorded yet/);
  assert.match(pitchAlertAnswer('What happened to webhook_timeout?', current), /SIM-NEW/);
  assert.match(pitchAlertAnswer('What happened with WEBHOOK_TIMEOUT?', current), /SIM-NEW.*Webhook delivery timed out/);
  assert.match(pitchAlertAnswer('How did we fix INC 104?', current), /is archived.*Cached signing keys were stale.*refreshed/);
  assert.match(pitchAlertAnswer('How did we fix INC-109?', current), /No fix is recorded/);
  const snapshot = {open:[], closed:[recovered]};
  assert.match(pitchAlertAnswer('What was resolved?', snapshot), /SIM-NEW.*resolved.*Maya Chen.*Restarted.*test delivery/);
  assert.match(pitchAlertAnswer('Which alerts are open?', snapshot), /There are no open alerts/);
});

test('resolves references against the latest snapshot and does not count grouped alerts twice', () => {
  const grouped = {...newEvent, id:'SIM-SPOT', title:'Grouped webhook monitor', status:'Grouped', groupedUnder:'SIM-NEW'};
  const old = [{question:'What happened to SIM-NEW?', answer:pitchAlertAnswer('What happened to SIM-NEW?', current)}];
  const changed = {open:[checkout], closed:[recovered, archived], grouped:[grouped]};
  const answer = pitchAlertAnswer('What happened to it?', changed, old);
  assert.match(answer, /SIM-NEW.*resolved.*Restarted/);
  assert.doesNotMatch(answer, /reported|No fix is recorded/);
  assert.match(pitchAlertAnswer('Why?', changed, old), /SIM-NEW.*resolved.*Restarted/);
  assert.match(pitchAlertAnswer('What happened to this incident?', {...changed, selectedId:'INC-121'}), /INC-121/);
  assert.match(pitchAlertAnswer('What happened to SIM-SPOT?', changed), /grouped under SIM-NEW/);
  assert.match(pitchAlertAnswer('How many open alerts do we have?', changed), /^1 open alert/);
  assert.match(pitchAlertAnswer('How many were resolved?', changed, old), /^2 closed or archived alerts/);
  assert.match(pitchAlertAnswer('And the older ones?', changed, old), /^2 closed or archived alerts/);
  const closedQuestion = 'Which alerts were recently resolved?';
  const closedTurns = [{question:closedQuestion, answer:pitchAlertAnswer(closedQuestion, changed)}];
  assert.match(pitchAlertAnswer('Tell me what right now alerts we have and what happened with them', current, closedTurns), /^4 open alerts/);
  assert.match(pitchAlertAnswer('What alerts do we have and what happened to them?', current, closedTurns), /^4 open alerts/);
  assert.match(pitchAlertAnswer('Who fixed Shipping?', changed), /Maya Chen handled it/);
  assert.match(pitchAlertAnswer('What happened to SIM-GONE?', changed), /could not find SIM-GONE/);
  assert.equal(pitchAlertAnswer('How do alerts reach the on-call engineer?', changed), null);
  assert.equal(pitchAlertAnswer('How do users submit new alerts?', changed), null);
  assert.equal(pitchAlertAnswer('How many historical incidents will you use in the pilot?', changed), null);
  assert.equal(pitchAlertAnswer('How many historical incidents will the pilot use?', changed), null);
  assert.equal(pitchAlertAnswer('Do you use test data?', changed), null);
  assert.equal(pitchAlertAnswer('How do you measure impact?', changed), null);
});
