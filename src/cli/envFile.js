import fs from 'node:fs/promises';

/**
 * Append-only env file editor.
 * - If key exists (uncommented), leaves it alone unless overwrite=true.
 * - If key is missing, appends `KEY=value` at end (newline-safe).
 * - Never reorders or rewrites unrelated lines.
 */
export async function upsertEnvVar(filePath, key, value, { overwrite = false } = {}) {
  if (!key || typeof key !== 'string') throw new Error('upsertEnvVar: key is required');

  let contents = '';
  try {
    contents = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const lines = contents.split(/\r?\n/);
  const keyRegex = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`);
  const idx = lines.findIndex((line) => keyRegex.test(line));

  const formatted = `${key}=${value ?? ''}`;

  if (idx === -1) {
    if (contents.length > 0 && !contents.endsWith('\n')) lines.push('');
    lines.push(formatted);
  } else if (overwrite) {
    lines[idx] = formatted;
  } else {
    return { changed: false, action: 'kept' };
  }

  await fs.writeFile(filePath, lines.join('\n'), 'utf8');
  return { changed: true, action: idx === -1 ? 'appended' : 'overwrote' };
}

/**
 * Convenience: apply many key/value pairs in one shot.
 * Pairs with falsy values are skipped (so empty wizard answers don't blank existing keys).
 */
export async function upsertEnvVars(filePath, pairs, opts = {}) {
  const results = {};
  for (const [key, value] of Object.entries(pairs)) {
    if (value === undefined || value === null || value === '') continue;
    results[key] = await upsertEnvVar(filePath, key, value, opts);
  }
  return results;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
