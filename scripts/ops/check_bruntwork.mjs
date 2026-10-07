import Database from 'better-sqlite3';

const db = new Database('./data/job-applications.db');
console.log('=== BRUNTWORK APPLIED JOBS ===');
const applied = db.prepare("SELECT profile_name, title, status, score, applied_at, job_url FROM job_applications WHERE source_site='bruntwork' AND status='applied' ORDER BY applied_at DESC LIMIT 15").all();
console.table(applied);

console.log('\n=== BRUNTWORK STATUS BREAKDOWN ===');
const breakdown = db.prepare("SELECT profile_name, status, count(*) as count FROM job_applications WHERE source_site='bruntwork' GROUP BY profile_name, status").all();
console.table(breakdown);

console.log('\n=== RECENT ACTIONS (LAST 15 IN DB) ===');
const recent = db.prepare("SELECT profile_name, title, company, source_site, status, score, updated_at FROM job_applications ORDER BY updated_at DESC LIMIT 15").all();
console.table(recent);
