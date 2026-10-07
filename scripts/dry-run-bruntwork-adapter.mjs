// Dry-run test: walk the BruntWork adapter flow with NO_REAL_SUBMISSION=true.
// Confirms the adapter navigates EMAIL → DETAILS without actually clicking Submit Application.

import { attemptApplication } from '../src/automation.js';
import { readFileSync } from 'fs';

const SISTER_PROFILE = 'profiles/sister';
const config = JSON.parse(readFileSync(`${SISTER_PROFILE}/preferences.json`, 'utf8'));
const cvData = JSON.parse(readFileSync(`${SISTER_PROFILE}/cv-data.json`, 'utf8'));

const job = {
  title: 'Underwriter - Financial Debt Relief (DRY RUN)',
  applicationUrl: 'https://bruntworkcareers.co/jobs/55974797230/apply',
  source_site: 'bruntwork',
  company: 'BruntWork'
};

const coverLetter = {
  coverLetterText: 'Dry-run cover letter. Not a real application.',
  applicationAnswers: {
    general: 'Dry-run answer. Not a real application.',
    describe_experience: 'Dry-run experience. Not a real application.',
    relevant_skills: 'Dry-run skills. Not a real application.'
  }
};

const testConfig = {
  ...config,
  cvData,
  applicantEmail: cvData.email || config.applicantEmail,
  resumePath: `${SISTER_PROFILE}/resume.pdf`,
  browserProfileDir: 'browser-profiles/sister',
  noRealSubmission: true, // CRITICAL: do not click final submit
  testMode: false,
  captchaSolver: config.captchaSolver || 'capsolver',
  captchaApiKey: process.env.CAPSOLVER_API_KEY || config.captchaApiKey
};

console.log('[dry-run] Starting BruntWork adapter dry-run with NO_REAL_SUBMISSION=true');
console.log(`[dry-run] Job: ${job.title}`);
console.log(`[dry-run] URL: ${job.applicationUrl}`);

attemptApplication(job, coverLetter, testConfig)
  .then((result) => {
    console.log('\n[dry-run] === RESULT ===');
    console.log(`outcome: ${result.outcome}`);
    console.log(`reason: ${result.reason}`);
    console.log(`lifecycle final state: ${result.lifecycle?.currentState}`);
    console.log(`debug dir: ${result.debugDir}`);

    if (result.outcome === 'requires_manual_review' && result.reason.includes('NO_REAL_SUBMISSION')) {
      console.log('\n✓ DRY RUN PASSED: adapter walked the flow and stopped before final submit.');
      process.exit(0);
    } else {
      console.log('\n✗ DRY RUN UNEXPECTED: expected NEEDS_MANUAL_REVIEW with NO_REAL_SUBMISSION guard.');
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('\n[dry-run] FATAL:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
