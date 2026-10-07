const fs = require('fs');

for (const profile of ['tolu', 'sister']) {
  const p = `profiles/${profile}/processedJobs.json`;
  if (!fs.existsSync(p)) {
    console.log(`No processedJobs.json for ${profile}`);
    continue;
  }
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const jobs = data.jobs || (Array.isArray(data) ? data : []);
  const counts = {};
  const failureReasons = {};
  let emailRejections = 0;
  let clientCanceled = 0;
  const appliedJobs = [];

  for (const j of jobs) {
    counts[j.status] = (counts[j.status] || 0) + 1;
    if (j.lifecycleStatus === 'rejected') {
      emailRejections++;
      const events = j.lifecycleEvents || [];
      for (const ev of events) {
        if (ev.excerpt && ev.excerpt.toLowerCase().includes('canceled by the client')) {
          clientCanceled++;
        }
      }
    }
    if (j.status === 'applied') {
      appliedJobs.push({ title: j.title, date: j.updatedAt || j.createdAt, lifecycle: j.lifecycleStatus });
    }
    if (j.reason) {
      const r = j.reason.slice(0, 80);
      failureReasons[r] = (failureReasons[r] || 0) + 1;
    }
  }

  console.log(`\n========================================`);
  console.log(`PROFILE: ${profile.toUpperCase()}`);
  console.log(`========================================`);
  console.log(`Total jobs tracked in history: ${jobs.length}`);
  console.log(`Status breakdown:`, counts);
  console.log(`Total applied: ${appliedJobs.length}`);
  console.log(`Email rejections received: ${emailRejections} (including ${clientCanceled} client-canceled openings)`);
  console.log(`\nApplied Jobs sample:`);
  console.log(appliedJobs.slice(0, 10));
  console.log(`\nTop failure / manual review reasons:`);
  console.log(Object.entries(failureReasons).slice(0, 10));
}
