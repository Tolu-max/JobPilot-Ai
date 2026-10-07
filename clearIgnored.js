import { readFileSync, writeFileSync, existsSync } from 'fs';

const profiles = ['tolu', 'sister'];

profiles.forEach((profile) => {
  const candidatePaths = [
    `/app/data/profiles/${profile}/processedJobs.json`,
    `profiles/${profile}/processedJobs.json`
  ];

  for (const path of candidatePaths) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, 'utf8');
        const d = JSON.parse(raw);
        if (Array.isArray(d.jobs)) {
          const before = d.jobs.length;
          d.jobs = d.jobs.filter((j) => j.status === 'applied');
          const kept = d.jobs.length;
          writeFileSync(path, JSON.stringify(d, null, 2));
          console.log(`[clearAll] ${profile} (${path}): kept ${kept} confirmed applied jobs, cleared ${before - kept} unapplied jobs.`);
        }
      } catch (e) {
        console.error(`[clearAll] Error on ${path}: ${e.message}`);
      }
    }
  }

  const globalPath = '/app/data/globalProcessedJobs.json';
  if (existsSync(globalPath)) {
    try {
      const raw = readFileSync(globalPath, 'utf8');
      const d = JSON.parse(raw);
      if (Array.isArray(d.jobs)) {
        d.jobs = d.jobs.filter((j) => j.status === 'applied');
        writeFileSync(globalPath, JSON.stringify(d, null, 2));
        console.log(`[clearAll] Cleared unapplied jobs from globalProcessedJobs.json`);
      }
    } catch (e) {
      console.error(`[clearAll] Error on global: ${e.message}`);
    }
  }

  const statePaths = [
    `/app/data/profiles/${profile}/siteRunState.json`,
    `profiles/${profile}/siteRunState.json`
  ];
  for (const path of statePaths) {
    if (existsSync(path)) {
      try {
        writeFileSync(path, JSON.stringify({}, null, 2));
        console.log(`[clearAll] ${profile} reset siteRunState.json`);
      } catch (e) {
        console.error(`[clearAll] Error resetting ${path}: ${e.message}`);
      }
    }
  }
});
