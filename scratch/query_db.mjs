import Database from 'better-sqlite3';
import fs from 'node:fs';

const dbPaths = ['/app/data/jobpilot.db', './data/jobpilot.db', './jobpilot.db'];
for (const p of dbPaths) {
  if (fs.existsSync(p)) {
    console.log(`Found DB at ${p}`);
    const db = new Database(p);
    const rows = db.prepare(`SELECT profile, title, company, source, status, failure_reason FROM applications WHERE source = 'indeed' OR source = 'bruntwork' ORDER BY id DESC LIMIT 20`).all();
    console.log(JSON.stringify(rows, null, 2));
    break;
  }
}
