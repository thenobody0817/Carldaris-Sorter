import test from 'node:test';
import assert from 'node:assert/strict';
import { activeSession, applyAction, createState } from '../src/model.js';
import { syncPayload } from '../src/cloud.js';

test('sync payload lists the active session with named non-spacer items', () => {
  let state = createState();
  const first = activeSession(state).items[0];
  state = applyAction(state, { type: 'count', id: first.id, delta: 3 });
  const payload = syncPayload(state);
  const session = activeSession(state);
  assert.equal(payload.date, session.date);
  assert.equal(payload.items.length, session.items.filter(item => !item.spacer).length);
  const counted = payload.items.find(item => item.qty === 3);
  assert.ok(counted);
  assert.equal(typeof counted.name, 'string');
  assert.ok(counted.name.length > 0);
});
