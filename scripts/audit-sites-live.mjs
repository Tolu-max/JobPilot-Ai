// Audit: per-source x status matrix across stores + recent apply outcomes.
import fs from 'node:fs';

function matrix(label, file) {
  let store;
  try { store = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.log(`${label}: ERR ${e.message}`); return; }
  const rows = Array.isArray(store.jobs) ? store.jobs : [];
  const m = {};
  for (const j of rows) {
    const src = j.source_site || j.source || '?';
    const st = j.status || '?';
    m[src] = m[src] || {};
    m[src][st] = (m[src][st] || 0) + 1;
  }
  console.log(`\n===== ${label} (${rows.length}) =====`);
  for (const src of Object.keys(m).sort()) console.log(`  ${src.padEnd(16)} ${JSON.stringify(m[src])}`);
}

matrix('GLOBAL', '/app/data/globalProcessedJobs.json');
matrix('tolu', '/app/data/profiles/tolu/processedJobs.json');
matrix('sister', '/app/data/profiles/sister/processedJobs.json');

// Most recent apply attempts (status applied/manual_review/failed) with reason, any source
const g = JSON.parse(fs.readFileSync('/app/data/globalProcessedJobs.json', 'utf8'));
const rows = (g.jobs || []).filter((j) => ['applied', 'manual_review', 'failed'].includes(j.status) && j.updatedAt);
rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
console.log('\n===== last 14 apply-stage outcomes =====');
for (const j of rows.slice(0, 14)) {
  console.log(`  ${j.updatedAt} [${j.status}] ${(j.source_site || j.source)} | ${(j.title || '').slice(0, 32)} | ${String(j.reason || '').slice(0, 80)}`);
}
