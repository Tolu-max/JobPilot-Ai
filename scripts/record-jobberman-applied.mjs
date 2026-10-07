import fs from 'node:fs';
import path from 'node:path';

const filePath = '/app/data/profiles/tolu/processedJobs.json';
if (fs.existsSync(filePath)) {
  const store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const jobs = Array.isArray(store.jobs) ? store.jobs : [];
  
  let target = jobs.find(j => 
    (j.url && j.url.includes('wrk87j')) || 
    (j.job_url && j.job_url.includes('wrk87j')) ||
    (j.applicationUrl && j.applicationUrl.includes('wrk87j')) ||
    (j.title && j.title.toLowerCase().includes('web and graphics'))
  );

  if (target) {
    target.status = 'applied';
    target.decision = 'apply';
    target.appliedAt = new Date().toISOString();
    target.submitted = true;
    target.source = 'jobberman';
    target.source_site = 'jobberman';
    target.title = target.title || 'Web and Graphics Designer';
    target.company = target.company || 'Grand Bezer Nigeria Limited';
    target.liveSubmitReady = true;
    target.submissionProof = '/app/debug/jobberman-direct-tolu-1789694579570/02-after-submit.png';
    console.log('Updated target job in store:', target.title, target.status);
  } else {
    const newJob = {
      title: 'Web and Graphics Designer',
      company: 'Grand Bezer Nigeria Limited',
      url: 'https://www.jobberman.com/listings/web-and-graphics-designer-wrk87j',
      job_url: 'https://www.jobberman.com/listings/web-and-graphics-designer-wrk87j',
      applicationUrl: 'https://www.jobberman.com/listings/web-and-graphics-designer-wrk87j',
      job_hash: '5975cda5fe1908b600b4c26b977958ade6d0ef32559a7edd67702b0b7e90e049',
      status: 'applied',
      decision: 'apply',
      appliedAt: new Date().toISOString(),
      submitted: true,
      source: 'jobberman',
      source_site: 'jobberman',
      score: 72,
      submissionProof: '/app/debug/jobberman-direct-tolu-1789694579570/02-after-submit.png'
    };
    jobs.push(newJob);
    console.log('Appended applied target job to store:', newJob.title);
  }

  // Also remove from review/jobs.json if present
  try {
    const reviewFile = '/app/data/review/jobs.json';
    if (fs.existsSync(reviewFile)) {
      let queue = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
      if (Array.isArray(queue)) {
        queue = queue.filter(j => !(
          (j.url && j.url.includes('wrk87j')) ||
          (j.applicationUrl && j.applicationUrl.includes('wrk87j')) ||
          (j.title && j.title.toLowerCase().includes('web and graphics'))
        ));
        fs.writeFileSync(reviewFile, JSON.stringify(queue, null, 2), 'utf8');
        console.log('Removed from review queue.');
      }
    }
  } catch (e) {
    console.warn('Could not update review queue:', e.message);
  }

  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
  console.log('Saved processedJobs.json successfully.');
} else {
  console.error('File does not exist:', filePath);
}
