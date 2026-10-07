import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  sendAutoApplyNotification,
  sendReviewNotification,
  sendLifecycleNotification
} from '../src/telegramBot.js';
import { buildConfig } from '../src/config.js';
import { classifyDeterministic, EmailEventType } from '../src/gmail/gmailClassifier.js';
import { selectResumeForJob } from '../src/resumeSelector.js';
import { localMatchJob } from '../src/localMatcher.js';

function createMockTelegramConfig(profile = 'tolu') {
  const sentMessages = [];
  const config = buildConfig(['node', 'jobpilot', `--profile=${profile}`]);
  config.telegramBotToken = '123456:MOCK_TOKEN';
  config.telegramChatId = profile === 'sister' ? '987654' : '123456';
  config.applicantEmail = profile === 'sister' ? 'temmy152000@gmail.com' : 'toluoyelola066@gmail.com';
  // sendReviewNotification persists dedupe state to <profileDir>/telegramState.json.
  // Point it at a throwaway directory so tests never read or write the real
  // profiles/<name> data on disk.
  const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), `jobpilot-telegram-test-${crypto.randomUUID()}-`));
  config.profileDir = tempProfileDir;
  config.jobStorePath = path.join(tempProfileDir, 'processedJobs.json');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('api.telegram.org')) {
      const payload = JSON.parse(options.body || '{}');
      sentMessages.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 101 } }),
        text: async () => JSON.stringify({ ok: true })
      };
    }
    return originalFetch(url, options);
  };

  return {
    config,
    sentMessages,
    restore: () => {
      globalThis.fetch = originalFetch;
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    }
  };
}

test('1. Auto-applied notification format (Score >= 85, Type 1)', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const job = {
      title: 'WordPress & SEO Specialist',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10428'
    };
    const analysis = {
      score: 92,
      matchedSkills: ['WordPress', 'Technical SEO', 'On-page SEO'],
      cluster: { clusterName: 'WordPress & Technical SEO (Proven Winner)', tier: 'PROVEN_WINNER' }
    };

    await sendAutoApplyNotification(job, analysis, config, 'success');
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('JOBPILOT • APPLIED'), 'Must have APPLIED header');
    assert.ok(msg.includes('🟢'), 'Must have green indicator');
    assert.ok(msg.includes('👤 Tolu'), 'Must show Tolu candidate');
    assert.ok(msg.includes('WordPress') && msg.includes('SEO Specialist'), 'Must show role title');
    assert.ok(msg.includes('🏢 BruntWork'), 'Must show company');
    assert.ok(msg.includes('📊 92/100'), 'Must show score');
    assert.ok(msg.includes('WordPress') && msg.includes('Technical SEO'), 'Must show short friendly resume name');
    assert.ok(msg.includes('✅ Submitted'), 'Must show submitted status');
    assert.ok(msg.includes('🔗 https://apply.bruntworkcareers.co/jobs/10428'), 'Must show job URL');
  } finally {
    restore();
  }
});

test('2. Review notification format for score 70-84 (Type 2)', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const job = {
      job_hash: 'hash_tolu_dev_001',
      title: 'Full-Stack Web Developer (PHP & Laravel)',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10430',
      cluster: { clusterName: 'PHP & Laravel Full-Stack (Selective Winner)', tier: 'SELECTIVE_FIT' },
      matchedSkills: ['PHP', 'Laravel', 'MySQL'],
      missingSkills: ['Vue.js']
    };

    await sendReviewNotification(job, 78, config);
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('JOBPILOT • REVIEW'), 'Must have REVIEW header');
    assert.ok(msg.includes('🟡'), 'Must have yellow indicator');
    assert.ok(msg.includes('👤 Tolu'), 'Must show candidate');
    assert.ok(msg.includes('📊 78/100'), 'Must show score');
    assert.ok(msg.includes('📄 Full Stack Web Developer'), 'Must show short resume name');
    assert.ok(msg.includes('🔎'), 'Must show reasons indicator');
    assert.ok(msg.includes('PHP') || msg.includes('Laravel'), 'Must list strongest reasons');
    
    // Check buttons layout
    const buttons = sentMessages[0].reply_markup?.inline_keyboard;
    assert.equal(buttons.length, 2, 'Must have Apply/Skip row plus Full Description row');
    assert.equal(buttons[0][0].text, 'APPLY');
    assert.equal(buttons[0][1].text, 'SKIP');
    assert.equal(buttons[1][0].text, 'Full Description');
  } finally {
    restore();
  }
});

test('3. Review notification format for score 50-69 (Type 3)', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const job = {
      job_hash: 'hash_tolu_review_low_001',
      title: 'Junior Web Assistant',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10435',
      cluster: { clusterName: 'General Web & Technical Support', tier: 'SELECTIVE_FIT' }
    };

    await sendReviewNotification(job, 62, config);
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('JOBPILOT • REVIEW'), 'Must have REVIEW header');
    assert.ok(msg.includes('🔵'), 'Must have blue indicator');
    assert.ok(msg.includes('👤 Tolu'), 'Must show candidate');
    assert.ok(msg.includes('📊 62/100 • Possible Fit'), 'Must show Possible Fit tier');
    assert.ok(msg.includes('⚠️ Weak historical fit'), 'Must show weak historical fit note');
    
    const buttons = sentMessages[0].reply_markup?.inline_keyboard;
    assert.equal(buttons.length, 2, 'Must have Apply/Skip row plus Full Description row');
    assert.equal(buttons[0][0].text, 'APPLY');
    assert.equal(buttons[0][1].text, 'SKIP');
    assert.equal(buttons[1][0].text, 'Full Description');
  } finally {
    restore();
  }
});

test('4. Application failed notification format (Type 4)', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const job = {
      title: 'WordPress & SEO Specialist',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10428',
      cluster: { clusterName: 'WordPress & Technical SEO', tier: 'PROVEN_WINNER' }
    };
    const analysis = { score: 92, cluster: job.cluster };

    await sendAutoApplyNotification(job, analysis, config, 'failed', 'Timeout waiting for submit button');
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('JOBPILOT • FAILED'), 'Must have FAILED header');
    assert.ok(msg.includes('🔴'), 'Must have red indicator');
    assert.ok(msg.includes('👤 Tolu'), 'Must show candidate');
    assert.ok(msg.includes('❌ Application not submitted'), 'Must show not submitted');
    assert.ok(msg.includes('⚠️ Application request timed out.'), 'Must show clean human-readable failure reason');
  } finally {
    restore();
  }
});

test('5. Review notification idempotency: Same job is not sent twice', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const job = {
      job_hash: 'hash_tolu_dedup_001',
      title: 'PHP Developer',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10431'
    };

    await sendReviewNotification(job, 75, config);
    assert.equal(sentMessages.length, 1);

    // Second call for same job
    await sendReviewNotification(job, 75, config);
    assert.equal(sentMessages.length, 1, 'Duplicate review notification must be suppressed');
  } finally {
    restore();
  }
});

test('5b. Review notification idempotency: Jobs with status reviewed, manual_review, or pending_apply in jobStore are not sent on restart', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('sister');
  try {
    const job = {
      title: 'Appointment Setter / Sales Setter Project Based',
      company: 'BruntWork',
      applicationUrl: 'https://bruntworkcareers.co/jobs/61649671012',
      source_site: 'bruntwork'
    };

    // Pre-populate jobStore with 'reviewed' as if sent in a previous cycle before restart
    const storePath = path.join(config.profileDir, 'processedJobs.json');
    config.jobStorePath = storePath;
    fs.writeFileSync(storePath, JSON.stringify({
      jobs: [
        {
          title: job.title,
          company: job.company,
          job_url: job.applicationUrl,
          applicationUrl: job.applicationUrl,
          status: 'reviewed',
          score: 75
        }
      ]
    }));

    // Bot restarts and scraper re-scrapes the job:
    await sendReviewNotification(job, 75, config);
    assert.equal(sentMessages.length, 0, 'Job with status "reviewed" in jobStore must not be re-notified on restart');

    // Test with status 'manual_review'
    job.applicationUrl = 'https://bruntworkcareers.co/jobs/61649607788';
    fs.writeFileSync(storePath, JSON.stringify({
      jobs: [
        {
          title: job.title,
          company: job.company,
          job_url: job.applicationUrl,
          applicationUrl: job.applicationUrl,
          status: 'manual_review',
          score: 73
        }
      ]
    }));
    await sendReviewNotification(job, 73, config);
    assert.equal(sentMessages.length, 0, 'Job with status "manual_review" in jobStore must not be re-notified on restart');
  } finally {
    restore();
  }
});

test('6. Low-score jobs (<50) are silent archives and do not send Telegram notifications', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const job = {
      job_hash: 'hash_tolu_low_001',
      title: 'Senior DevOps Architect',
      company: 'BruntWork'
    };

    await sendReviewNotification(job, 35, config);
    assert.equal(sentMessages.length, 0, 'Score < 50 must never trigger Telegram notification');
  } finally {
    restore();
  }
});

test('7. Candidate isolation: Sister gets Sister identity and Sister resume', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('sister');
  try {
    const job = {
      job_hash: 'hash_sister_va_001',
      title: 'Virtual Assistant with Real Estate Experience',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10512'
    };
    const analysis = {
      score: 90,
      matchedSkills: ['Real Estate', 'Appointment Setting', 'Outreach'],
      cluster: { clusterName: 'Real Estate VA & Appointment Setting', tier: 'PROVEN_WINNER' }
    };

    await sendAutoApplyNotification(job, analysis, config, 'success');
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('👤 Sister'), 'Must show Sister identity');
    assert.ok(!msg.includes('Tolu'), 'Must NOT contain Tolu');
    assert.ok(msg.includes('Real Estate VA'), 'Must show sister resume name');
  } finally {
    restore();
  }
});

test('8. Recruiter interview notification format', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const event = {
      classification: 'recruiter_interview',
      matchedJobTitle: 'WordPress Developer & SEO Specialist',
      company: 'BruntWork',
      matchedResumeProfile: 'tolu-wordpress-seo',
      interviewDetails: {
        interviewer: 'Agatha Mbugua',
        scheduledAt: '2026-08-20 14:00 GMT+1',
        meetingUrl: 'https://meet.google.com/abc-defg-hij'
      }
    };

    await sendLifecycleNotification(event, config);
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('RECRUITER INTERVIEW'));
    assert.ok(msg.includes('Agatha Mbugua'));
    assert.ok(msg.includes('2026-08-20 14:00 GMT+1'));
    assert.ok(msg.includes('tolu-wordpress-seo'));
  } finally {
    restore();
  }
});

test('9. Client interview notification format', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const event = {
      classification: 'client_interview',
      matchedJobTitle: 'WordPress & SEO Specialist',
      company: 'DIQ SEO',
      matchedResumeProfile: 'tolu-wordpress-seo',
      interviewDetails: {
        scheduledAt: '2026-07-07 16:00 GMT+1',
        meetingUrl: 'https://meet.google.com/diq-interview'
      }
    };

    await sendLifecycleNotification(event, config);
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('CLIENT INTERVIEW'));
    assert.ok(msg.includes('DIQ SEO'));
    assert.ok(msg.includes('2026-07-07 16:00 GMT+1'));
  } finally {
    restore();
  }
});

test('10. Rejection notification format', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const event = {
      classification: 'rejection',
      matchedJobTitle: 'Commerce Specialist | Shopify',
      company: 'BruntWork',
      matchedResumeProfile: 'tolu-ecommerce',
      excerpt: 'Thank you for your interest, but we are not moving forward with your application.'
    };

    await sendLifecycleNotification(event, config);
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('JOBPILOT • REJECTED') || msg.includes('REJECTED'));
    assert.ok(msg.includes('Commerce Specialist'));
    assert.ok(msg.includes('tolu-ecommerce'));
  } finally {
    restore();
  }
});

test('11. Security hygiene: No OAuth tokens or secrets are leaked', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const event = {
      classification: 'recruiter_response',
      matchedJobTitle: 'Web Developer',
      company: 'BruntWork',
      matchedResumeProfile: 'tolu-fullstack',
      excerpt: 'Your application is under review by the hiring manager.'
    };

    await sendLifecycleNotification(event, config);
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(!msg.includes('MOCK_TOKEN'), 'Must not leak mock bot token');
    assert.ok(!msg.includes('refresh_token'), 'Must not leak refresh_token');
    assert.ok(!msg.includes('client_secret'), 'Must not leak client_secret');
  } finally {
    restore();
  }
});

test('12. Boilerplate "What happens next" email does not trigger interview alert', () => {
  const email = {
    subject: 'Application Received - What happens next?',
    from: 'careers@bruntwork.co',
    bodyText: 'Thank you for applying. Here is what happens next: We will review your application and if selected, schedule a recruiter interview.'
  };

  const res = classifyDeterministic(email);
  assert.equal(res.classification, EmailEventType.APPLICATION_CONFIRMATION);
  assert.notEqual(res.classification, EmailEventType.RECRUITER_INTERVIEW);
  assert.notEqual(res.classification, EmailEventType.CLIENT_INTERVIEW);
});

test('13. Rejection email mentioning "interview" does not become an interview', () => {
  const email = {
    subject: 'Update on your BruntWork Application',
    from: 'careers@bruntwork.co',
    bodyText: 'We appreciate the time you took to interview and apply with us. Unfortunately, we have chosen another candidate for this role.'
  };

  const res = classifyDeterministic(email);
  assert.equal(res.classification, EmailEventType.REJECTION);
  assert.notEqual(res.classification, EmailEventType.RECRUITER_INTERVIEW);
});

test('14. Resume displayed in Telegram matches the exact ATS resume selected', () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const job = {
    title: 'WordPress & SEO Specialist',
    company: 'BruntWork'
  };

  const selected = selectResumeForJob(config, job);
  assert.equal(selected.profileId, 'tolu-wordpress-seo');
});

test('15. Sister resume routing is isolated and never selects Tolu resume', () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=sister']);
  const job = {
    title: 'Realty Appointment Setter',
    company: 'BruntWork'
  };

  const selected = selectResumeForJob(config, job);
  assert.equal(selected.profileId, 'sister-customer-support');
  assert.ok(!selected.profileId.includes('tolu'));
});
