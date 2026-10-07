import fs from 'node:fs/promises';
import path from 'node:path';

export async function applyRuntimeRetention(config = {}, logger = console) {
  if (config.retentionEnabled === false) return { skipped: true, reason: 'disabled' };

  const results = {
    debug: await pruneDirectory(config.debugRootDir, {
      maxAgeDays: config.debugRetentionDays,
      maxEntries: config.debugRetentionMaxDirs
    }),
    testResults: await pruneDirectory(config.testResultsDir, {
      maxAgeDays: config.debugRetentionDays,
      maxEntries: config.debugRetentionMaxDirs
    }),
    logs: await compactJsonlDirectory(path.dirname(config.logPath || ''), config.logRetentionMaxBytes),
    events: await compactJsonlDirectory(config.eventsDir, config.eventRetentionMaxBytes)
  };

  logger.log?.(`[retention] ${summarizeRetention(results)}`);
  return results;
}

async function pruneDirectory(dir, { maxAgeDays = 14, maxEntries = 250 } = {}) {
  if (!dir) return { skipped: true, reason: 'missing_dir' };

  const entries = await readDirEntries(dir);
  const directories = entries
    .filter((entry) => entry.isDirectory)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const cutoffMs = Date.now() - Math.max(0, maxAgeDays) * 24 * 60 * 60 * 1000;
  const keep = new Set(directories.slice(0, Math.max(0, maxEntries)).map((entry) => entry.path));
  let removed = 0;

  for (const entry of directories) {
    if (keep.has(entry.path) && entry.mtimeMs >= cutoffMs) continue;
    await fs.rm(entry.path, { recursive: true, force: true }).catch(() => {});
    removed += 1;
  }

  return { checked: directories.length, removed };
}

async function compactJsonlDirectory(dir, maxBytes = 0) {
  if (!dir || maxBytes <= 0) return { skipped: true, reason: 'missing_or_unbounded' };

  const entries = await readDirEntries(dir);
  const files = entries.filter((entry) => entry.isFile && /\.(jsonl|log)$/i.test(entry.name));
  let compacted = 0;

  for (const file of files) {
    if (file.size <= maxBytes) continue;
    await keepFileTail(file.path, maxBytes);
    compacted += 1;
  }

  return { checked: files.length, compacted };
}

async function readDirEntries(dir) {
  try {
    const items = await fs.readdir(dir, { withFileTypes: true });
    const entries = [];
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) continue;
      entries.push({
        name: item.name,
        path: fullPath,
        isDirectory: item.isDirectory(),
        isFile: item.isFile(),
        size: stat.size,
        mtimeMs: stat.mtimeMs
      });
    }
    return entries;
  } catch {
    return [];
  }
}

async function keepFileTail(filePath, maxBytes) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const keepBytes = Math.max(1, maxBytes);
    const offset = Math.max(0, stat.size - keepBytes);
    const buffer = Buffer.alloc(stat.size - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    const text = buffer.toString('utf8');
    const firstNewline = text.indexOf('\n');
    const tail = (firstNewline >= 0 ? text.slice(firstNewline + 1) : text).slice(-keepBytes);
    await fs.writeFile(filePath, tail, 'utf8');
  } finally {
    await handle.close();
  }
}

function summarizeRetention(results) {
  const debugRemoved = results.debug?.removed || 0;
  const testRemoved = results.testResults?.removed || 0;
  const logsCompacted = results.logs?.compacted || 0;
  const eventsCompacted = results.events?.compacted || 0;
  return `removed ${debugRemoved} debug dirs, ${testRemoved} test-result dirs; compacted ${logsCompacted} log files, ${eventsCompacted} event files.`;
}
