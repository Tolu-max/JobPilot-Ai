import Database from 'better-sqlite3';

const db = new Database('data/job-applications.db', { readonly: true });

console.log('=== Job Applications DB Stats ===');

const total = db.prepare('SELECT count(*) as count FROM job_applications').get();
console.log(`Total records in DB: ${total.count}`);

const profiles = db.prepare('SELECT DISTINCT profile_name FROM job_applications').all();
for (const { profile_name } of profiles) {
  console.log(`\n--- Profile: ${profile_name} ---`);
  const counts = db.prepare('SELECT status, count(*) as count FROM job_applications WHERE profile_name = ? GROUP BY status').all(profile_name);
  for (const row of counts) {
    console.log(`  ${row.status}: ${row.count}`);
  }
  
  console.log('  By Source:');
  const sources = db.prepare('SELECT source_site, status, count(*) as count FROM job_applications WHERE profile_name = ? GROUP BY source_site, status ORDER BY source_site').all(profile_name);
  let curSource = '';
  for (const s of sources) {
    if (s.source_site !== curSource) {
      if (curSource) console.log();
      curSource = s.source_site;
      process.stdout.write(`    ${curSource}: `);
    }
    process.stdout.write(`${s.status}=${s.count} `);
  }
  console.log();
}

console.log('\n=== Most Recent Applications (applied, reviewed, manual_review) ===');
const recent = db.prepare(`SELECT profile_name, title, company, source_site, status, score, applied_at, created_at FROM job_applications WHERE status IN ('applied', 'reviewed', 'manual_review') ORDER BY id DESC LIMIT 20`).all();
for (const r of recent) {
  console.log(`[${r.profile_name}] ${r.status.toUpperCase()} (${r.score ?? 'N/A'}): ${r.title} @ ${r.company || 'N/A'} [${r.source_site}] - ${r.applied_at || r.created_at}`);
}
