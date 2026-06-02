import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_EVENTS_DIR = path.resolve(process.cwd(), 'data', 'events');

export const EventTypes = Object.freeze({
  JOB_STATUS_CHANGED: 'job.status_changed',
  NOTIFICATION_SENT: 'notification.sent',
  NOTIFICATION_FAILED: 'notification.failed',
  RESUME_PARSED: 'resume.parsed',
  SYSTEM_ERROR: 'system.error'
});

export async function emitEvent(type, payload = {}, config = {}) {
  const event = normalizeEvent(type, payload, config);
  const eventsDir = config.eventsDir || DEFAULT_EVENTS_DIR;
  const writes = [
    appendJsonl(path.join(eventsDir, 'events.jsonl'), event)
  ];

  if (event.profile_id) {
    writes.push(appendJsonl(path.join(eventsDir, `${event.profile_id}.jsonl`), event));
  }

  await Promise.all(writes);
  return event;
}

export async function readRecentEvents(config = {}, limit = 50) {
  const eventsDir = config.eventsDir || DEFAULT_EVENTS_DIR;
  const filePath = config.profileName
    ? path.join(eventsDir, `${config.profileName}.jsonl`)
    : path.join(eventsDir, 'events.jsonl');

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function normalizeEvent(type, payload = {}, config = {}) {
  if (!type || typeof type !== 'string') {
    throw new Error('Event type is required');
  }

  const userId =
    payload.user_id ||
    payload.userId ||
    config.userId ||
    config.user_id ||
    config.authUserId ||
    config.profileName ||
    'local';

  const profileId =
    payload.profile_id ||
    payload.profileId ||
    config.profileName ||
    config.profile_id ||
    null;

  return {
    event_id: payload.event_id || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    type,
    user_id: userId,
    profile_id: profileId,
    timestamp: payload.timestamp || new Date().toISOString(),
    source: payload.source || config.eventSource || 'jobpilot',
    data: payload.data || stripEnvelopeFields(payload)
  };
}

async function appendJsonl(filePath, record) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

function stripEnvelopeFields(payload) {
  const {
    event_id,
    user_id,
    userId,
    profile_id,
    profileId,
    timestamp,
    source,
    data,
    ...rest
  } = payload || {};
  return rest;
}
