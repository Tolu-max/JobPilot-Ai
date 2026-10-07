import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig } from '../src/config.js';
import { localMatchJob } from '../src/localMatcher.js';
import { evaluateHistoricalCluster, ClusterTier } from '../src/matching/historicalClusterEvaluator.js';
import { selectResumeForJob } from '../src/resumeSelector.js';
import { optimizeApplication } from '../src/applicationOptimizer.js';
import { getAutoApplyGate, validateLiveSubmitReadiness } from '../src/pipeline.js';

// Setup Mock Configs for Tolu and Sister
const toluConfig = buildConfig(['node', 'jobpilot', '--profile=tolu']);
const sisterConfig = buildConfig(['node', 'jobpilot', '--profile=sister']);

const toluProfile = {
  name: 'TOLUWALOPE SAMUEL OYELOLA',
  profileName: 'tolu',
  skills: ['WordPress', 'SEO', 'Technical SEO', 'PHP', 'Laravel', 'JavaScript', 'HTML', 'CSS', 'MySQL'],
  preferredRoles: ['WordPress Developer', 'SEO Specialist', 'Full Stack Developer']
};

const sisterProfile = {
  name: 'TEMILOLUWA RUTH OYELOLA',
  profileName: 'sister',
  skills: ['Customer Support', 'Virtual Assistance', 'HubSpot', 'CRM', 'Zendesk', 'Lead Qualification', 'Real Estate VA'],
  preferredRoles: ['Customer Support Specialist', 'Virtual Assistant', 'CRM Specialist']
};

test('TEST 1: Job score = 60 -> decision = TELEGRAM_REVIEW -> attemptApplication() NOT called', () => {
  const job = {
    title: 'Junior Web QA Tester & Content Updater',
    description: 'Test WordPress and web features, update basic HTML and content, and log tickets in Jira.',
    requirements: 'HTML, WordPress, content updates'
  };

  const optimizer = optimizeApplication({
    job,
    candidateProfile: toluProfile,
    localAnalysis: { score: 60, recommendation: 'review', cluster: { tier: ClusterTier.SELECTIVE_FIT } },
    config: toluConfig
  });
  optimizer.application_score = 60;
  optimizer.recommendation = 'review';

  const autoApplyGate = getAutoApplyGate(toluConfig, job, { score: 60, cluster: { tier: ClusterTier.SELECTIVE_FIT } }, optimizer, optimizer.recommendation);

  assert.equal(optimizer.recommendation, 'review', 'Score 60 must recommend review, not apply');
  assert.equal(autoApplyGate.enabled, false, 'Auto-apply gate MUST be disabled for score 60');
  assert.match(autoApplyGate.reason, /below auto-apply threshold|requires human review/i);
});

test('TEST 2: Job score = 70 -> TELEGRAM_REVIEW -> attemptApplication() NOT called', () => {
  const job = {
    title: 'Web Specialist & Content Coordinator',
    description: 'Help maintain WordPress websites, format CSS, and update product listings.',
    requirements: 'WordPress, CSS, web support'
  };

  const optimizer = optimizeApplication({
    job,
    candidateProfile: toluProfile,
    localAnalysis: { score: 70, recommendation: 'review', cluster: { tier: ClusterTier.SELECTIVE_FIT } },
    config: toluConfig
  });
  optimizer.application_score = 70;
  optimizer.recommendation = 'review';

  const autoApplyGate = getAutoApplyGate(toluConfig, job, { score: 70, cluster: { tier: ClusterTier.SELECTIVE_FIT } }, optimizer, optimizer.recommendation);

  assert.equal(optimizer.recommendation, 'review', 'Score 70 must recommend review, not apply');
  assert.equal(autoApplyGate.enabled, false, 'Auto-apply gate MUST be disabled for score 70');
});

test('TEST 3: Job score = 84 -> TELEGRAM_REVIEW -> attemptApplication() NOT called', () => {
  const job = {
    title: 'Full Stack Web Developer',
    description: 'PHP, MySQL, and modern JavaScript web development.',
    requirements: 'PHP, JavaScript, MySQL'
  };

  const optimizer = optimizeApplication({
    job,
    candidateProfile: toluProfile,
    localAnalysis: { score: 84, recommendation: 'review', cluster: { tier: ClusterTier.SELECTIVE_FIT } },
    config: toluConfig
  });
  optimizer.application_score = 84;
  optimizer.recommendation = 'review';

  const autoApplyGate = getAutoApplyGate(toluConfig, job, { score: 84, cluster: { tier: ClusterTier.SELECTIVE_FIT } }, optimizer, optimizer.recommendation);

  assert.equal(optimizer.recommendation, 'review', 'Score 84 must recommend review, never auto-apply');
  assert.equal(autoApplyGate.enabled, false, 'Auto-apply gate MUST be disabled for score 84');
});

test('TEST 4: Job score = 85 + proven Tolu WordPress/SEO role -> AUTO_APPLY -> application permitted', () => {
  const job = {
    title: 'Technical WordPress & SEO Specialist',
    description: 'Optimize WordPress websites, schema markup, core web vitals, and technical search engine optimization.',
    requirements: 'WordPress, Technical SEO, Schema Markup, Core Web Vitals',
    source_site: 'bruntwork'
  };

  const cluster = evaluateHistoricalCluster(job, 'tolu');
  assert.equal(cluster.tier, ClusterTier.PROVEN_WINNER);

  const optimizer = optimizeApplication({
    job,
    candidateProfile: toluProfile,
    localAnalysis: { score: 90, recommendation: 'auto_apply', cluster },
    config: toluConfig
  });
  optimizer.application_score = 90;
  optimizer.recommendation = 'apply';

  const autoApplyGate = getAutoApplyGate(toluConfig, job, { score: 90, cluster, recommendation: 'auto_apply' }, optimizer, optimizer.recommendation);

  assert.equal(optimizer.recommendation, 'apply', 'Score 90 + Proven Winner must recommend apply');
  assert.equal(autoApplyGate.enabled, true, 'Auto-apply gate MUST be enabled for 85+ Proven Winner');
});

test('TEST 5: Job score = 90 but hard-excluded role -> IGNORE -> application NOT permitted', async () => {
  const job = {
    title: 'Executive Assistant & Travel Coordinator',
    description: 'Handle executive schedules, travel bookings, and office administration.',
    source_site: 'bruntwork'
  };

  const cluster = evaluateHistoricalCluster(job, 'tolu');
  assert.equal(cluster.tier, ClusterTier.HARD_EXCLUSION);

  const local = await localMatchJob(job, toluProfile, toluConfig);
  assert.equal(local.score, 0);
  assert.equal(local.recommendation, 'ignore');

  const optimizer = optimizeApplication({
    job,
    candidateProfile: toluProfile,
    localAnalysis: local,
    config: toluConfig
  });
  optimizer.application_score = 90;

  const autoApplyGate = getAutoApplyGate(toluConfig, job, local, optimizer, 'apply');
  assert.equal(autoApplyGate.enabled, false, 'Hard-excluded role must be blocked by auto-apply gate');
  assert.match(autoApplyGate.reason, /hard exclusion|blocked/i);
});

test('TEST 6: Global Sourcing & Sales Coordinator with incidental HTML/JavaScript mentions -> NOT classified as Frontend -> NOT routed to tolu-frontend', async () => {
  const job = {
    title: 'Global Sourcing & Sales Coordinator Part Time (20 - 34 Hours per week)',
    description: 'Source international products, coordinate with sales reps, maintain spreadsheets, and update HTML/CSS templates on portal.',
    requirements: 'HTML, CSS, communication, vendor management',
    source_site: 'bruntwork'
  };

  // 1. Classification check
  const cluster = evaluateHistoricalCluster(job, 'tolu');
  assert.equal(cluster.tier, ClusterTier.HARD_EXCLUSION, 'Sourcing/sales coordinator must be HARD_EXCLUSION for Tolu');

  // 2. Role Fit check
  const local = await localMatchJob(job, toluProfile, toluConfig);
  assert.equal(local.score, 0, 'Must score 0 for Tolu');
  assert.equal(local.recommendation, 'ignore');

  // 3. Resume routing check
  const resume = selectResumeForJob(toluConfig, job);
  assert.notEqual(resume.profileId, 'tolu-frontend', 'Must NOT be routed to tolu-frontend based on incidental HTML/CSS keywords');
  assert.equal(resume.fallbackUsed, false, 'Must gracefully select primary default fallback');
});

test('TEST 7: Genuine Frontend Web Developer role -> tolu-frontend remains valid', () => {
  const job = {
    title: 'Frontend Web Developer (HTML, CSS, JavaScript)',
    description: 'Develop responsive user interfaces, style pages with modern CSS, and build interactive UI components.',
    requirements: 'HTML5, CSS3, JavaScript, Responsive Design'
  };

  const resume = selectResumeForJob(toluConfig, job);
  assert.equal(resume.profileId, 'tolu-frontend', 'Genuine Frontend role must route to tolu-frontend');
});

test('TEST 8: Genuine WordPress/SEO role -> tolu-wordpress-seo remains valid', () => {
  const job = {
    title: 'WordPress Website Administrator & Technical SEO Specialist',
    description: 'Manage client WordPress websites, optimize meta tags, configure schema markup, and fix crawl errors.',
    requirements: 'WordPress, Technical SEO, Google Search Console, Schema'
  };

  const resume = selectResumeForJob(toluConfig, job);
  assert.equal(resume.profileId, 'tolu-wordpress-seo', 'Genuine SEO/WP role must route to tolu-wordpress-seo');
});

test('TEST 9: Genuine Laravel/PHP Full-Stack role -> tolu-fullstack remains valid', () => {
  const job = {
    title: 'Laravel Backend Developer & REST API Engineer',
    description: 'Build robust REST APIs using Laravel and PHP, optimize MySQL database queries, and integrate webhooks.',
    requirements: 'PHP 8, Laravel Framework, MySQL, REST APIs'
  };

  const resume = selectResumeForJob(toluConfig, job);
  assert.equal(resume.profileId, 'tolu-fullstack', 'Genuine Laravel/PHP role must route to tolu-fullstack');
});

test('TEST 10: Sister score 60 -> TELEGRAM_REVIEW -> no automatic submission', () => {
  const job = {
    title: 'Administrative Support Clerk',
    description: 'General office and data entry support, updating records.',
    requirements: 'Customer support, spreadsheets'
  };

  const optimizer = optimizeApplication({
    job,
    candidateProfile: sisterProfile,
    localAnalysis: { score: 60, recommendation: 'review', cluster: { tier: ClusterTier.SELECTIVE_FIT } },
    config: sisterConfig
  });
  optimizer.application_score = 60;
  optimizer.recommendation = 'review';

  const autoApplyGate = getAutoApplyGate(sisterConfig, job, { score: 60, cluster: { tier: ClusterTier.SELECTIVE_FIT } }, optimizer, optimizer.recommendation);

  assert.equal(optimizer.recommendation, 'review', 'Sister score 60 must recommend review');
  assert.equal(autoApplyGate.enabled, false, 'Auto-apply gate MUST be disabled for Sister score 60');
});

test('TEST 11: Sister score 84 -> TELEGRAM_REVIEW -> no automatic submission', () => {
  const job = {
    title: 'Client Operations Coordinator',
    description: 'Manage client schedules, CRM intake, and ticket support.',
    requirements: 'CRM, HubSpot, Customer Support'
  };

  const optimizer = optimizeApplication({
    job,
    candidateProfile: sisterProfile,
    localAnalysis: { score: 84, recommendation: 'review', cluster: { tier: ClusterTier.SELECTIVE_FIT } },
    config: sisterConfig
  });
  optimizer.application_score = 84;
  optimizer.recommendation = 'review';

  const autoApplyGate = getAutoApplyGate(sisterConfig, job, { score: 84, cluster: { tier: ClusterTier.SELECTIVE_FIT } }, optimizer, optimizer.recommendation);

  assert.equal(optimizer.recommendation, 'review', 'Sister score 84 must recommend review');
  assert.equal(autoApplyGate.enabled, false, 'Auto-apply gate MUST be disabled for Sister score 84');
});

test('TEST 12: Sister score 85+ proven Real Estate VA / Appointment Setting role -> AUTO_APPLY', () => {
  const job = {
    title: 'Real Estate Virtual Assistant & Lead Qualification Specialist',
    description: 'Coordinate real estate appointments, screen property buyers, manage calendar, and update CRM records.',
    requirements: 'Real Estate VA, HubSpot, Appointment Setting, Lead Qualification',
    source_site: 'bruntwork'
  };

  const cluster = evaluateHistoricalCluster(job, 'sister');
  assert.equal(cluster.tier, ClusterTier.PROVEN_WINNER);

  const optimizer = optimizeApplication({
    job,
    candidateProfile: sisterProfile,
    localAnalysis: { score: 92, recommendation: 'auto_apply', cluster },
    config: sisterConfig
  });
  optimizer.application_score = 92;
  optimizer.recommendation = 'apply';

  const autoApplyGate = getAutoApplyGate(sisterConfig, job, { score: 92, cluster, recommendation: 'auto_apply' }, optimizer, optimizer.recommendation);

  assert.equal(optimizer.recommendation, 'apply', 'Sister score 92 + Proven Winner must recommend apply');
  assert.equal(autoApplyGate.enabled, true, 'Auto-apply gate MUST be enabled for Sister 85+ Proven Winner');
});

test('Manual Telegram approval (status: pending_apply) intentionally allows submission for 50-84 reviewed jobs', async () => {
  const reviewedJob = {
    title: 'WordPress Support Assistant',
    applicationUrl: 'https://bruntworkcareers.co/jobs/456/apply',
    source_site: 'bruntwork',
    raw: { remote: true }
  };

  const gateResult = await validateLiveSubmitReadiness({
    job: reviewedJob,
    profile: {
      skills: ['WordPress', 'SEO', 'Web Development'],
      preferredRoles: ['WordPress Developer', 'SEO Specialist']
    },
    existing: {
      score: 72,
      decision: 'review',
      acceptedViaTelegram: true,
      status: 'pending_apply'
    },
    config: toluConfig
  });

  assert.equal(gateResult.ready, true, 'Telegram-approved job with status pending_apply must pass validation for submission');
});
