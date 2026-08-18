import test from 'node:test';
import assert from 'node:assert/strict';
import { localMatchJob } from '../src/localMatcher.js';
import { evaluateHistoricalCluster, ClusterTier } from '../src/matching/historicalClusterEvaluator.js';
import { selectResumeForJob } from '../src/resumeSelector.js';
import { buildConfig } from '../src/config.js';
import { loadOrBuildCandidateProfile } from '../src/profileParser.js';

test('Tolu: WordPress & Technical SEO jobs are classified as PROVEN_WINNER and score >= 86', async () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const profile = await loadOrBuildCandidateProfile(config);

  const job = {
    title: 'WordPress Website Management Specialist (SEO | Image Sourcing)',
    company: 'BruntWork',
    description: 'We are seeking an experienced WordPress specialist with strong technical SEO, speed optimization, and on-page ranking experience.',
    requirements: 'WordPress, Technical SEO, Site speed optimization, On-page SEO, HTML/CSS, Elementor'
  };

  const cluster = evaluateHistoricalCluster(job, 'tolu');
  assert.equal(cluster.tier, ClusterTier.PROVEN_WINNER);

  const match = await localMatchJob(job, profile, config);
  assert.ok(match.score >= 86, `Expected score >= 86 for proven WordPress/SEO cluster, got ${match.score}`);
  assert.ok(match.recommendation === 'auto_apply' || match.recommendation === 'instant_apply');

  const resume = selectResumeForJob(config, job);
  assert.equal(resume.profileId, 'tolu-wordpress-seo');
});

test('Tolu: PHP & Laravel Full-Stack jobs are classified as SELECTIVE_FIT and score >= 70', async () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const profile = await loadOrBuildCandidateProfile(config);

  const job = {
    title: 'Full Stack Web Developer (PHP & Laravel)',
    company: 'BruntWork',
    description: 'Looking for a PHP developer proficient in Laravel, MySQL, REST API integrations, and backend architecture.',
    requirements: 'PHP, Laravel, MySQL, JavaScript, Git, REST APIs'
  };

  const cluster = evaluateHistoricalCluster(job, 'tolu');
  assert.equal(cluster.tier, ClusterTier.SELECTIVE_FIT);

  const match = await localMatchJob(job, profile, config);
  assert.ok(match.score >= 70, `Expected score >= 70 for selective Laravel cluster, got ${match.score}`);

  const resume = selectResumeForJob(config, job);
  assert.equal(resume.profileId, 'tolu-fullstack');
});

test('Tolu: Shopify Liquid and React framework jobs are penalized into FAILED_DEAD_CLUSTER (score <= 48)', async () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const profile = await loadOrBuildCandidateProfile(config);

  const shopifyJob = {
    title: 'Shopify Liquid Theme Developer',
    company: 'BruntWork',
    description: 'Must have deep experience coding custom Shopify Liquid templates and building custom Shopify apps.',
    requirements: 'Shopify Liquid, Ruby, Shopify App CLI, GraphQL'
  };

  const shopifyCluster = evaluateHistoricalCluster(shopifyJob, 'tolu');
  assert.equal(shopifyCluster.tier, ClusterTier.FAILED_DEAD_CLUSTER);

  const shopifyMatch = await localMatchJob(shopifyJob, profile, config);
  assert.ok(shopifyMatch.score <= 48, `Expected score <= 48 for dead Shopify cluster, got ${shopifyMatch.score}`);
  assert.equal(shopifyMatch.recommendation, 'ignore');

  const reactJob = {
    title: 'Senior React.js SPA Frontend Engineer',
    company: 'BruntWork',
    description: 'Looking for a frontend specialist to build enterprise SPAs in React 19, TypeScript, and Next.js.',
    requirements: 'React.js, TypeScript, Next.js, Redux, Tailwind'
  };

  const reactCluster = evaluateHistoricalCluster(reactJob, 'tolu');
  assert.equal(reactCluster.tier, ClusterTier.FAILED_DEAD_CLUSTER);

  const reactMatch = await localMatchJob(reactJob, profile, config);
  assert.ok(reactMatch.score <= 48, `Expected score <= 48 for dead React SPA cluster, got ${reactMatch.score}`);
  assert.equal(reactMatch.recommendation, 'ignore');
});

test('Tolu: Administrative and Virtual Assistant jobs are HARD_EXCLUSION (score = 0)', async () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const profile = await loadOrBuildCandidateProfile(config);

  const adminJob = {
    title: 'Executive Virtual Assistant & Receptionist',
    company: 'BruntWork',
    description: 'Manage executive calendar, answer incoming calls, coordinate office supplies, and book travel.',
    requirements: 'Calendar management, Reception, Office administration'
  };

  const cluster = evaluateHistoricalCluster(adminJob, 'tolu');
  assert.equal(cluster.tier, ClusterTier.HARD_EXCLUSION);

  const match = await localMatchJob(adminJob, profile, config);
  assert.equal(match.score, 0);
  assert.equal(match.recommendation, 'ignore');
});

test('Sister: Real Estate VA & Appointment Setting jobs are classified as PROVEN_WINNER and score >= 86', async () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=sister']);
  const profile = await loadOrBuildCandidateProfile(config);

  const realEstateJob = {
    title: 'Virtual Assistant with Real Estate Experience',
    company: 'BruntWork',
    description: 'We are hiring a Virtual Assistant to support our US realty team with appointment setting, property listings, and client outreach.',
    requirements: 'Real estate coordination, Appointment setting, Calendar scheduling, Google Workspace, Customer communication'
  };

  const cluster = evaluateHistoricalCluster(realEstateJob, 'sister');
  assert.equal(cluster.tier, ClusterTier.PROVEN_WINNER);

  const match = await localMatchJob(realEstateJob, profile, config);
  assert.ok(match.score >= 86, `Expected score >= 86 for Sister proven Real Estate cluster, got ${match.score}`);
  assert.ok(match.recommendation === 'auto_apply' || match.recommendation === 'instant_apply');

  const resume = selectResumeForJob(config, realEstateJob);
  assert.equal(resume.profileId, 'sister-virtual-assistant');
});

test('Sister: Software Engineer and Bilingual Spanish roles are HARD_EXCLUSION (score = 0)', async () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=sister']);
  const profile = await loadOrBuildCandidateProfile(config);

  const devJob = {
    title: 'Senior Backend Software Developer',
    company: 'BruntWork',
    description: 'Develop distributed microservices in Go and Kubernetes.',
    requirements: 'Go, Kubernetes, Distributed Systems'
  };

  const devCluster = evaluateHistoricalCluster(devJob, 'sister');
  assert.equal(devCluster.tier, ClusterTier.HARD_EXCLUSION);

  const devMatch = await localMatchJob(devJob, profile, config);
  assert.equal(devMatch.score, 0);
  assert.equal(devMatch.recommendation, 'ignore');

  const spanishJob = {
    title: 'Customer Support Specialist - Bilingual Spanish',
    company: 'BruntWork',
    description: 'Fluent in both English and Spanish required to handle calls and chat.',
    requirements: 'Bilingual Spanish, Customer support'
  };

  const spanishCluster = evaluateHistoricalCluster(spanishJob, 'sister');
  assert.equal(spanishCluster.tier, ClusterTier.HARD_EXCLUSION);

  const spanishMatch = await localMatchJob(spanishJob, profile, config);
  assert.equal(spanishMatch.score, 0);
  assert.equal(spanishMatch.recommendation, 'ignore');
});
