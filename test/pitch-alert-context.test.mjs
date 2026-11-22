import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPitchAlertContext} from '../public/pitch-alert-context.mjs';

test('workspace snapshot keeps reopened incidents and old resolutions separate', () => {
  const id = 'SIM-REOPENED';
  const incident = {id, title:'Checkout unavailable', service:'Checkout', occurredAt:20, triggeredAt:30};
  const update = {status:'Reported', note:'Priority reviewed.'};
  const state = {
    arrivals:{[id]:30},
    priorities:{},
    tasks:{},
    custom:{
      [id]:{...incident, level:'P1', status:'reported', description:'The checkout probe failed.',
        responder:'Maya Chen', activity:[update]},
      'SIM-GROUPED':{id:'SIM-GROUPED', groupedUnder:id, status:'reported', triggeredAt:31},
    },
    resolutions:{[id]:{resolvedAt:15, cause:'A previous cache expired.', fix:'Refreshed the cache.', verification:'The probe passed.'}},
  };
  const reportRows = [
    {incident:id, openedAt:10, closedAt:15, title:incident.title, service:incident.service, level:'P1'},
    {incident:id, openedAt:30, title:incident.title, service:incident.service, level:'P1'},
  ];
  const args = {state, openIncidents:[incident], reportRows, investigate:()=>({findings:[], certainty:'Unknown'})};

  const snapshot = buildPitchAlertContext(args);
  assert.equal(snapshot.openCount, 1);
  assert.equal(snapshot.open[0].status, 'Reported');
  assert.equal(snapshot.open[0].receivedAt, 30);
  assert.equal(snapshot.open[0].assignee, undefined);
  assert.equal(snapshot.open[0].resolution, undefined);
  assert.equal(snapshot.closed.find(record => record.id === id).resolution, 'Refreshed the cache.');
  assert.equal(snapshot.grouped[0].groupedUnder, id);

  reportRows[1].acceptedBy = 'Sam Rivera';
  const acknowledged = buildPitchAlertContext(args).open[0];
  assert.equal(acknowledged.status, 'Acknowledged');
  assert.equal(acknowledged.assignee, 'Sam Rivera');
});
