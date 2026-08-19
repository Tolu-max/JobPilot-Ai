import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  flushPendingApplyQueue,
  getAiConsiderationFloor,
  getReviewPromotion,
  isTerminalApplicationResult,
  isProfileAlignedRole,
  validateLiveSubmitReadiness
} from '../src/pipeline.js';
import { getJobRecord, upsertJobRecord } from '../src/jobStore.js';

test('flushPendingApplyQueue respects a zero auto-apply budget', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-safety-'));
  const config = {
    profileName: 'sister',
    jobStorePath: path.join(dir, 'processedJobs.json'),
    logPath: path.join(dir, 'sister.log'),
    maxAutoApplyPerRun: 0
  };
  const job = {
    title: 'Queued BruntWork Role',
    applicationUrl: 'https://bruntworkcareers.co/jobs/123/apply',
    source_site: 'bruntwork'
  };

  await upsertJobRecord(config, job, 'pending_apply', { score: 90, decision: 'apply' });
  await flushPendingApplyQueue(config);

  const record = await getJobRecord(config, job);
  assert.equal(record.status, 'pending_apply');
  // New records initialize retryCount to 0; a held (zero-budget) job must not increment it.
  assert.equal(record.retryCount, 0);
});

test('terminal application outcomes stop automatic retries', () => {
  assert.equal(isTerminalApplicationResult({
    outcome: 'requires_manual_review',
    reason: 'Unknown ATS requires manual review.'
  }), true);
  assert.equal(isTerminalApplicationResult({
    outcome: 'application_failed',
    reason: 'Adapter flow failed: Job is no longer accepting applications.'
  }), true);
  assert.equal(isTerminalApplicationResult({
    outcome: 'application_failed',
    reason: 'Browser launch failed: temporary process error.'
  }), false);
});

test('AI consideration floor defaults to 70', () => {
  assert.equal(getAiConsiderationFloor({}), 70);
  assert.equal(getAiConsiderationFloor({ aiConsiderationFloor: 45 }), 45);
});

test('Tolu aligned SEO review roles can promote at 65 when verifier approves', () => {
  const job = {
    source_site: 'bruntwork',
    title: 'Digital Marketing Specialist SEO',
    description: 'Own SEO, Google Business Profile updates, content optimization, and website performance.'
  };

  assert.equal(isProfileAlignedRole({ profileName: 'tolu' }, job), true);
  assert.deepEqual(
    getReviewPromotion(
      { profileName: 'tolu' },
      job,
      { score: 40 },
      { adjusted_score: 65, should_apply: true },
      { application_score: 65, risk_flags: [] },
      'review'
    ).promoted,
    true
  );
});

test('Sister aligned support review roles can promote at 65 when verifier approves', () => {
  const job = {
    source_site: 'bruntwork',
    title: 'Customer Success Assistant',
    description: 'Use HubSpot, Zendesk, calendar coordination, and customer support workflows.'
  };

  assert.equal(isProfileAlignedRole({ profileName: 'sister' }, job), true);
  assert.equal(
    getReviewPromotion(
      { profileName: 'sister' },
      job,
      { score: 48 },
      { adjusted_score: 66, should_apply: true },
      { application_score: 68, risk_flags: [] },
      'review'
    ).promoted,
    true
  );
});

test('Sister profile alignment recognizes VA assistant and sales-pipeline titles', () => {
  const job = {
    source_site: 'bruntwork',
    title: 'GoHighLevel Sales Pipeline VA Assistant',
    description: 'Maintain a CRM pipeline, follow up with warm leads, and provide virtual assistance.'
  };

  assert.equal(isProfileAlignedRole({ profileName: 'sister' }, job), true);
});

test('Sister profile alignment recognizes transferable operations families', () => {
  assert.equal(isProfileAlignedRole({ profileName: 'sister' }, {
    title: 'Client Operations and Onboarding Coordinator',
    description: 'Manage CRM records, scheduling, customer onboarding, and follow-up.'
  }), true);
  assert.equal(isProfileAlignedRole({ profileName: 'sister' }, {
    title: 'Bookkeeping and Administrative Support Assistant',
    description: 'Handle invoices, spreadsheets, financial records, and customer communication.'
  }), true);
});

test('wrong-family review roles do not promote even when verifier approves', () => {
  const job = {
    source_site: 'bruntwork',
    title: 'Bookkeeper',
    description: 'QuickBooks, account reconciliation, accounts payable, and monthly close.'
  };

  assert.equal(isProfileAlignedRole({ profileName: 'tolu' }, job), false);
  assert.equal(
    getReviewPromotion(
      { profileName: 'tolu' },
      job,
      { score: 65 },
      { adjusted_score: 80, should_apply: true },
      { application_score: 80, risk_flags: [] },
      'review'
    ).promoted,
    false
  );
});

test('live submit gate blocks wrong-family Telegram approvals after score approval', async () => {
  const result = await validateLiveSubmitReadiness({
    config: { profileName: 'tolu' },
    profile: {
      skills: ['SEO', 'Shopify', 'WordPress', 'Web Development'],
      preferredRoles: ['SEO Specialist', 'Shopify Specialist', 'Website Administrator']
    },
    job: {
      title: 'Pest Control Service Coordinator (ServiceM8 & Xero)',
      description: 'Remote role scheduling pest control technicians, using ServiceM8, Xero bookkeeping, invoices, and customer calls.',
      source_site: 'bruntwork',
      raw: { remote: true }
    },
    existing: {
      score: 56,
      decision: 'apply',
      acceptedViaTelegram: true
    }
  });

  assert.equal(result.ready, false);
  assert.match(result.reason, /Current profile QA blocks live submit/);
});

test('live submit gate blocks verifier-rejected applications below floor', async () => {
  const result = await validateLiveSubmitReadiness({
    config: { profileName: 'tolu' },
    profile: {
      skills: ['SEO', 'Shopify', 'WordPress', 'Web Development', 'E-Commerce'],
      preferredRoles: ['SEO Specialist', 'Shopify Specialist', 'Website Administrator']
    },
    job: {
      title: 'E-commerce Assistant',
      description: 'Remote support for Shopify and Amazon order processing, customer support, and e-commerce operations.',
      source_site: 'bruntwork',
      raw: { remote: true }
    },
    existing: {
      score: 68,
      gemini: { should_apply: false },
      optimizer: { application_score: 68, risk_flags: [] }
    }
  });

  assert.equal(result.ready, false);
  assert.equal(result.reason, 'AI verification previously rejected live submission.');
});
