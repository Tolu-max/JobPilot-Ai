import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyRuntimeRetention } from '../src/retention.js';

test('runtime retention prunes old generated debug dirs and compacts logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-retention-'));
  const debugRootDir = path.join(root, 'debug');
  const testResultsDir = path.join(root, 'test-results');
  const logDir = path.join(root, 'logs');
  const eventsDir = path.join(root, 'events');

  await fs.mkdir(path.join(debugRootDir, 'old-a'), { recursive: true });
  await fs.mkdir(path.join(debugRootDir, 'old-b'), { recursive: true });
  await fs.mkdir(path.join(debugRootDir, 'new-c'), { recursive: true });
  await fs.writeFile(path.join(debugRootDir, 'new-c', 'application_lifecycle.json'), '{}');
  await fs.mkdir(path.join(testResultsDir, 'old-result'), { recursive: true });
  await fs.mkdir(logDir, { recursive: true });
  await fs.mkdir(eventsDir, { recursive: true });
  await fs.writeFile(path.join(logDir, 'tolu.log'), `${'x'.repeat(200)}\n${'y'.repeat(200)}\n`, 'utf8');
  await fs.writeFile(path.join(eventsDir, 'events.jsonl'), `${'{"a":"'.repeat(50)}"}\n{"keep":true}\n`, 'utf8');

  const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await fs.utimes(path.join(debugRootDir, 'old-a'), oldTime, oldTime);
  await fs.utimes(path.join(debugRootDir, 'old-b'), oldTime, oldTime);
  await fs.utimes(path.join(testResultsDir, 'old-result'), oldTime, oldTime);

  const result = await applyRuntimeRetention({
    retentionEnabled: true,
    debugRootDir,
    testResultsDir,
    logPath: path.join(logDir, 'tolu.log'),
    eventsDir,
    debugRetentionDays: 3,
    debugRetentionMaxDirs: 1,
    logRetentionMaxBytes: 128,
    eventRetentionMaxBytes: 128
  }, { log() {} });

  assert.equal(result.debug.removed, 2);
  assert.equal(result.testResults.removed, 1);
  assert.equal(await exists(path.join(debugRootDir, 'new-c')), true);
  assert.equal(await exists(path.join(debugRootDir, 'old-a')), false);
  assert.ok((await fs.stat(path.join(logDir, 'tolu.log'))).size <= 128);
  assert.ok((await fs.stat(path.join(eventsDir, 'events.jsonl'))).size <= 128);
});

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
