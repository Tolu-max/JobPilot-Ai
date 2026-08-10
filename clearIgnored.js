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
          d.jobs = []; // Clear ALL jobs for a complete clean slate catch-up
          writeFileSync(path, JSON.stringify(d, null, 2));
          console.log(`[clearAll] ${profile} (${path}): cleared all ${before} jobs.`);
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
        d.jobs = [];
        writeFileSync(globalPath, JSON.stringify(d, null, 2));
        console.log(`[clearAll] Cleared globalProcessedJobs.json`);
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
