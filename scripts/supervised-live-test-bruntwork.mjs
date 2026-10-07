// SUPERVISED LIVE TEST: one real BruntWork application with the new adapter + re-verification.
// This script temporarily disables the kill switch for ONE job only.
// IMPORTANT: watch the output closely. If the adapter reports CONFIRMED after re-verification,
// the new pipeline is working. If it reports NOT_SUBMITTED, we caught a false positive.

import { attemptApplication } from '../src/automation.js';
import { readFileSync } from 'fs';
import { config as loadEnv } from 'dotenv';

// Load .env file
loadEnv();

// Force visible browser for debugging
process.env.HEADLESS = 'false';

// Temporarily disable kill switch for this one run
process.env.KILL_SWITCH_DISABLE_AUTO_APPLY = 'false';

const SISTER_PROFILE = 'profiles/sister';
const config = JSON.parse(readFileSync(`${SISTER_PROFILE}/preferences.json`, 'utf8'));
const cvData = JSON.parse(readFileSync(`${SISTER_PROFILE}/cv-data.json`, 'utf8'));

// Pick a fresh BruntWork job that hasn't been applied to yet
const job = {
  title: 'Fresh BruntWork Job #3 (SUPERVISED LIVE TEST)',
  applicationUrl: 'https://apply.bruntworkcareers.co/jobs/59668693005',
  source_site: 'bruntwork',
  company: 'BruntWork'
};

const coverLetter = {
  coverLetterText: cvData.coverLetter || 'I am excited to apply for this position.',
  applicationAnswers: {
    general: 'I bring relevant experience that directly applies to this role.',
    describe_experience: cvData.experience || 'Relevant professional experience.',
    relevant_skills: (cvData.skills || []).join(', ') || 'Communication, problem-solving, attention to detail.'
  }
};

const testConfig = {
  ...config,
  cvData,
  applicantEmail: cvData.email || config.applicantEmail,
  resumePath: `${SISTER_PROFILE}/resume.pdf`,
  browserProfileDir: 'browser-profiles/sister',
  noRealSubmission: false, // REAL SUBMISSION
  testMode: false,
  captchaSolver: config.captchaSolver || 'capsolver',
  captchaApiKey: process.env.CAPSOLVER_API_KEY || config.captchaApiKey,
  // AI provider keys for job question answers
  geminiApiKey: process.env.GEMINI_API_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  profileName: 'sister'
};

console.log('='.repeat(80));
console.log('SUPERVISED LIVE TEST — ONE REAL BRUNTWORK APPLICATION');
console.log('='.repeat(80));
console.log(`Job: ${job.title}`);
console.log(`URL: ${job.applicationUrl}`);
console.log(`Email: ${testConfig.applicantEmail}`);
console.log(`Kill switch: DISABLED for this run only`);
console.log('='.repeat(80));
console.log('');

attemptApplication(job, coverLetter, testConfig)
  .then((result) => {
    console.log('\n' + '='.repeat(80));
    console.log('SUPERVISED LIVE TEST RESULT');
    console.log('='.repeat(80));
    console.log(`Outcome: ${result.outcome}`);
    console.log(`Reason: ${result.reason}`);
    console.log(`Final state: ${result.lifecycle?.currentState}`);
    console.log(`Debug dir: ${result.debugDir}`);
    console.log('='.repeat(80));

    if (result.outcome === 'applied_successfully' && result.lifecycle?.currentState === 'CONFIRMED_SUCCESS') {
      console.log('\n✓ SUCCESS: Application submitted AND re-verification CONFIRMED.');
      console.log('  The new pipeline is working correctly.');
      console.log('  Check your email for BruntWork confirmation (not "continue your application").');
    } else if (result.outcome === 'requires_manual_review' && result.reason.includes('NOT_SUBMITTED')) {
      console.log('\n✓ FALSE POSITIVE CAUGHT: Adapter detected submission but re-verification proved it did NOT stick.');
      console.log('  This is the safety net working as designed.');
    } else if (result.outcome === 'requires_manual_review' && result.reason.includes('inconclusive')) {
      console.log('\n⚠ INCONCLUSIVE: In-page proof was positive but re-verification could not confirm.');
      console.log('  Check the debug artifacts and your email to determine ground truth.');
    } else {
      console.log('\n⚠ UNEXPECTED OUTCOME: review the debug artifacts and lifecycle.');
    }

    console.log('\nNext steps:');
    console.log('  1. Check your email for BruntWork messages');
    console.log('  2. Review debug artifacts in ' + result.debugDir);
    console.log('  3. If CONFIRMED, the pipeline is ready — remove KILL_SWITCH from pipeline.js');
    console.log('  4. If NOT_SUBMITTED or INCONCLUSIVE, investigate before re-enabling auto-apply');
  })
  .catch((err) => {
    console.error('\n' + '='.repeat(80));
    console.error('SUPERVISED LIVE TEST FATAL ERROR');
    console.error('='.repeat(80));
    console.error(err.message);
    console.error(err.stack);
    process.exit(1);
  });
