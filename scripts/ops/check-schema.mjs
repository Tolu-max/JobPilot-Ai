import Database from 'better-sqlite3';

const db = new Database('data/job-applications.db', { readonly: true });
const cols = db.prepare('PRAGMA table_info(job_applications)').all();
console.log('Columns:', cols.map(c => c.name).join(', '));

const sample = db.prepare('SELECT * FROM job_applications LIMIT 1').get();
console.log('Sample row:', sample);
