import Database from 'better-sqlite3';

const db = new Database('data/job-applications.db', { readonly: true });
const hashes = ['1e45a7a7ec16550f', '9dbf3637bca6d436'];

console.log('=== Hash Matches ===');
for (const h of hashes) {
  const rows = db.prepare('SELECT profile_name, title, company, source_site, status, score, applied_at, job_url FROM job_applications WHERE job_hash LIKE ?').all(`%${h}%`);
  console.log(`Hash ${h}:`, rows);
}

console.log('\n=== Pending Apply Jobs (in DB) ===');
const pending = db.prepare("SELECT profile_name, title, company, source_site, status, score FROM job_applications WHERE status IN ('pending_apply', 'accepted', 'approved')").all();
console.log(pending);
