import fs from 'node:fs';
import Database from 'better-sqlite3';

console.log('=== Checking review queues ===');
for (const p of ['/app/data/profiles/tolu/reviewQueue.json', '/app/data/profiles/sister/reviewQueue.json']) {
  if (fs.existsSync(p)) {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    console.log(p, 'type:', Array.isArray(data) ? 'array' : typeof data, 'count:', Array.isArray(data) ? data.length : Object.keys(data).length);
    const items = Array.isArray(data) ? data : Object.values(data);
    const indeedItems = items.filter(i => (i.source_site === 'indeed' || i.source === 'indeed' || (i.job_url && i.job_url.includes('indeed'))));
    console.log(`Indeed items in ${p}: ${indeedItems.length}`);
    for (const item of indeedItems.slice(0, 5)) {
      console.log(`- [${item.status}] "${item.title}" at "${item.company}" | accepted: ${item.acceptedViaTelegram}`);
    }
  } else {
    console.log(`Not found: ${p}`);
  }
}

console.log('=== Checking jobStore processedJobs.json ===');
for (const p of ['/app/data/profiles/tolu/processedJobs.json', '/app/data/profiles/sister/processedJobs.json']) {
  if (fs.existsSync(p)) {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const jobs = data.jobs || [];
    const indeedJobs = jobs.filter(j => j.source_site === 'indeed' || j.source === 'indeed' || (j.applicationUrl && j.applicationUrl.includes('indeed')));
    console.log(`Indeed jobs in ${p}: ${indeedJobs.length} (total jobs: ${jobs.length})`);
    for (const j of indeedJobs.slice(0, 10)) {
      console.log(`- [${j.status}] "${j.title}" at "${j.company}" | reason: ${j.reason || j.failureReason || 'none'}`);
    }
  }
}

console.log('=== Checking database job_applications ===');
if (fs.existsSync('/app/data/job-applications.db')) {
  const db = new Database('/app/data/job-applications.db');
  const rows = db.prepare("SELECT profile_name, title, company, status, job_url FROM job_applications WHERE source_site = 'indeed' OR job_url LIKE '%indeed%' ORDER BY id DESC LIMIT 15").all();
  console.log('DB Indeed rows:', JSON.stringify(rows, null, 2));
}
