import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

function inspect() {
  console.log('=== Checking SQLite job-applications.db ===');
  if (fs.existsSync('data/job-applications.db')) {
    const db = new Database('data/job-applications.db', { readonly: true });
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
    console.log('Tables:', tables.map(t => t.name));
    const rows = db.prepare(`SELECT profile_name, title, status, score, job_url, created_at FROM job_applications WHERE source_site = 'bruntwork' OR job_url LIKE '%bruntwork%' ORDER BY id DESC LIMIT 60`).all();
    console.log(`Found ${rows.length} BruntWork jobs in job_applications table:`);
    rows.forEach((r, i) => {
      console.log(`${i+1}. [${r.profile_name}] ${r.status} (${r.score}) - ${r.title} | ${r.job_url}`);
    });
  } else {
    console.log('data/job-applications.db not found');
  }

  for (const prof of ['tolu', 'sister']) {
    console.log(`\n=== Checking profiles/${prof}/processedJobs.json ===`);
    const p = path.join('profiles', prof, 'processedJobs.json');
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      const bw = Object.entries(data).filter(([url, j]) => url.includes('bruntwork') || (j.source && j.source.includes('bruntwork')));
      console.log(`Total BruntWork jobs in ${prof}/processedJobs.json: ${bw.length}`);
      bw.slice(-25).forEach(([url, j], i) => {
        console.log(`  ${i+1}. ${j.status} (${j.score || j.matchScore}) - ${j.title || url} | ${j.appliedAt || j.processedAt || j.updatedAt || ''}`);
      });
    }
  }
}

inspect();
