import test from 'node:test';
import assert from 'node:assert/strict';
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

  return { config, sentMessages, restore: () => { globalThis.fetch = originalFetch; } };
}

test('1. Auto-apply starting notification format', async () => {
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

    await sendAutoApplyNotification(job, analysis, config, 'starting');
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('AUTO-APPLYING'), 'Must have AUTO-APPLYING header');
    assert.ok(msg.includes('TOLU'), 'Must show TOLU candidate');
    assert.ok(msg.includes('WordPress') && msg.includes('SEO Specialist'), 'Must show role title');
    assert.ok(msg.includes('92/100'), 'Must show score');
    assert.ok(msg.includes('tolu-wordpress-seo'), 'Must show correct resume');
    assert.ok(msg.includes('being submitted'), 'Must indicate in-progress status');
  } finally {
    restore();
  }
});

test('2. Auto-apply success notification format', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const job = {
      title: 'WordPress & SEO Specialist',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10428'
    };
    const analysis = { score: 92, cluster: { clusterName: 'WordPress & SEO', tier: 'PROVEN_WINNER' } };

    await sendAutoApplyNotification(job, analysis, config, 'success');
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('APPLICATION SUBMITTED'), 'Must show submitted status');
    assert.ok(msg.includes('Status:</b> Submitted'));
  } finally {
    restore();
  }
});

test('3. Auto-apply failure notification format', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const job = {
      title: 'WordPress & SEO Specialist',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10428'
    };
    const analysis = { score: 92 };

    await sendAutoApplyNotification(job, analysis, config, 'failed', 'Timeout waiting for submit button');
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('APPLICATION FAILED'));
    assert.ok(msg.includes('Timeout waiting for submit button'));
  } finally {
    restore();
  }
});

test('4. Review required notification format with strengths, concerns, and buttons', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const job = {
      title: 'Full-Stack Web Developer (PHP & Laravel)',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10430',
      cluster: { clusterName: 'PHP & Laravel Full-Stack (Selective Winner)', tier: 'SELECTIVE_FIT' },
      matchedSkills: ['PHP', 'Laravel', 'MySQL', 'REST APIs'],
      missingSkills: ['Vue.js'],
      reviewReason: 'Selective fit requiring manual verification of Vue.js requirement.'
    };

    await sendReviewNotification(job, 78, config);
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('REVIEW REQUIRED'));
    assert.ok(msg.includes('TOLU'));
    assert.ok(msg.includes('78/100'));
    assert.ok(msg.includes('tolu-fullstack'));
    assert.ok(msg.includes('PHP') && msg.includes('Laravel'));
    assert.ok(sentMessages[0].reply_markup?.inline_keyboard?.length > 0, 'Must have inline action buttons');
  } finally {
    restore();
  }
});

test('5. Recruiter interview notification format', async () => {
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

test('6. Client interview notification format', async () => {
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

test('7. Interview prep notification format', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const event = {
      classification: 'interview_prep',
      matchedJobTitle: 'WordPress & SEO Specialist',
      company: 'DIQ SEO',
      matchedResumeProfile: 'tolu-wordpress-seo',
      interviewDetails: {
        scheduledAt: '2026-07-06 15:00 GMT+1',
        meetingUrl: 'https://meet.google.com/prep-link'
      }
    };

    await sendLifecycleNotification(event, config);
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('INTERVIEW PREP'));
    assert.ok(msg.includes('DIQ SEO'));
  } finally {
    restore();
  }
});

test('8. Rejection notification format', async () => {
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
    assert.ok(msg.includes('APPLICATION REJECTED'));
    assert.ok(msg.includes('Commerce Specialist'));
    assert.ok(msg.includes('tolu-ecommerce'));
  } finally {
    restore();
  }
});

test('9. Recruiter response notification format', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const event = {
      classification: 'recruiter_response',
      matchedJobTitle: 'Power Platform Developer',
      company: 'BruntWork',
      matchedResumeProfile: 'tolu-fullstack'
    };

    await sendLifecycleNotification(event, config);
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('APPLICATION UPDATE'));
    assert.ok(msg.includes('Power Platform Developer'));
  } finally {
    restore();
  }
});

test('10. Job offer notification format', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const event = {
      classification: 'offer',
      matchedJobTitle: 'SEO Specialist',
      company: 'Trusted Marketing LLC',
      matchedResumeProfile: 'tolu-wordpress-seo'
    };

    await sendLifecycleNotification(event, config);
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('JOB OFFER RECEIVED'));
    assert.ok(msg.includes('Trusted Marketing LLC'));
  } finally {
    restore();
  }
});

test('11. Candidate isolation: Sister gets Sister identity and Sister resume', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('sister');
  try {
    const job = {
      title: 'Virtual Assistant with Real Estate Experience',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10512'
    };
    const analysis = {
      score: 90,
      matchedSkills: ['Real Estate', 'Appointment Setting', 'Outreach'],
      cluster: { clusterName: 'Real Estate VA & Appointment Setting', tier: 'PROVEN_WINNER' }
    };

    await sendAutoApplyNotification(job, analysis, config, 'starting');
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('SISTER'), 'Must show SISTER identity');
    assert.ok(!msg.includes('TOLU'), 'Must NOT contain TOLU');
    assert.ok(msg.includes('sister-virtual-assistant'), 'Must show sister resume profile');
  } finally {
    restore();
  }
});

test('12. Security hygiene: No OAuth tokens or secrets are leaked', async () => {
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

test('13. Boilerplate "What happens next" email does not trigger interview alert', () => {
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

test('14. Rejection email mentioning "interview" does not become an interview', () => {
  const email = {
    subject: 'Update on your BruntWork Application',
    from: 'careers@bruntwork.co',
    bodyText: 'We appreciate the time you took to interview and apply with us. Unfortunately, we have chosen another candidate for this role.'
  };

  const res = classifyDeterministic(email);
  assert.equal(res.classification, EmailEventType.REJECTION);
  assert.notEqual(res.classification, EmailEventType.RECRUITER_INTERVIEW);
});

test('15. Resume displayed in Telegram matches the exact ATS resume selected', () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const job = {
    title: 'WordPress & SEO Specialist',
    company: 'BruntWork'
  };

  const selected = selectResumeForJob(config, job);
  assert.equal(selected.profileId, 'tolu-wordpress-seo');
});

test('16. Sister resume routing is isolated and never selects Tolu resume', () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=sister']);
  const job = {
    title: 'Realty Appointment Setter',
    company: 'BruntWork'
  };

  const selected = selectResumeForJob(config, job);
  assert.equal(selected.profileId, 'sister-customer-support');
  assert.ok(!selected.profileId.includes('tolu'));
});
