import fs from 'node:fs/promises';
import path from 'node:path';

export async function appendLog(message, targetConfigOrPath = null) {
  const target = resolveLogPath(targetConfigOrPath);
  const prefix = resolveLogPrefix(targetConfigOrPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const line = `[${new Date().toISOString()}] ${prefix}${message}\n`;
  await fs.appendFile(target, line, 'utf8');

  // Also write structured JSON log alongside plain text log
  if (typeof targetConfigOrPath === 'object' && targetConfigOrPath?.logPath) {
    await appendStructuredLog({ message, profile: targetConfigOrPath.profileName }, targetConfigOrPath).catch(() => {});
  }
}

/**
 * Write a structured JSON entry to the .jsonl log file.
 * Can be queried easily: e.g. grep "APPLIED" logs/tolu.jsonl | jq .
 */
export async function appendStructuredLog(entry = {}, config = null) {
  const basePath = config?.logPath
    ? config.logPath.replace(/\.log$/, '.jsonl')
    : path.resolve(process.cwd(), 'logs', 'applications.jsonl');

  await fs.mkdir(path.dirname(basePath), { recursive: true });
  const record = {
    ts: new Date().toISOString(),
    profile: config?.profileName || 'unknown',
    ...entry
  };
  await fs.appendFile(basePath, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Read the last N lines from a log file (used by the dashboard).
 */
export async function readLastLogLines(logPath, n = 100) {
  try {
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

function resolveLogPath(targetConfigOrPath) {
  if (typeof targetConfigOrPath === 'string') return targetConfigOrPath;
  if (targetConfigOrPath?.logPath) return targetConfigOrPath.logPath;
  return path.resolve(process.cwd(), 'logs', 'applications.log');
}

function resolveLogPrefix(targetConfigOrPath) {
  if (typeof targetConfigOrPath === 'object' && targetConfigOrPath?.profileName) {
    return `[${targetConfigOrPath.profileName}] `;
  }
  return '';
}
