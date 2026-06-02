import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emitEvent, EventTypes, readRecentEvents } from '../src/eventBus.js';

test('event bus writes global and profile scoped events', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-events-'));
  const config = { eventsDir: dir, profileName: 'tolu' };

  const event = await emitEvent(EventTypes.JOB_STATUS_CHANGED, {
    title: 'SEO Specialist',
    status: 'applied'
  }, config);

  assert.equal(event.type, EventTypes.JOB_STATUS_CHANGED);
  assert.equal(event.profile_id, 'tolu');

  const profileEvents = await readRecentEvents(config, 5);
  assert.equal(profileEvents.length, 1);
  assert.equal(profileEvents[0].data.title, 'SEO Specialist');

  const globalEvents = await readRecentEvents({ eventsDir: dir }, 5);
  assert.equal(globalEvents.length, 1);
});
