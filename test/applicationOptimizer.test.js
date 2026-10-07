import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hashJob } from '../src/jobStore.js';
import { optimizeApplication, saveOptimizerArtifacts } from '../src/applicationOptimizer.js';

const profile = {
  name: 'Toluwalope Oyelola',
  skills: ['SEO', 'Technical SEO', 'Shopify', 'WordPress', 'Web Development', 'JavaScript', 'HTML', 'CSS'],
  strengths: ['SEO optimization', 'Shopify optimization', 'Web development'],
  preferredRoles: ['SEO Specialist', 'Shopify Specialist', 'Website Administrator'],
  targetSeniorities: ['junior', 'mid']
};

const resumeText = `
Full Stack Web Developer and Marketing Assistant.
Built and maintained e-commerce websites, improved SEO visibility, handled Shopify updates,
optimized responsive pages with HTML, CSS and JavaScript, and supported technical SEO improvements.
`;

test('optimizes a supported job without fabricating missing skills', () => {
  const job = {
    title: 'Technical SEO and Shopify Specialist',
    applicationUrl: 'https://example.com/jobs/seo-shopify',
    description:
      'Remote role improving technical SEO, Shopify product visibility, Core Web Vitals and content performance for an e-commerce store.',
    requirements: 'SEO, Shopify, HTML, CSS, JavaScript, Google Analytics',
    responsibilities: 'Optimize product pages, improve site speed, maintain content and report SEO improvements.'
  };

  const result = optimizeApplication({
    job,
    candidateProfile: profile,
    resumeText,
    localAnalysis: { score: 90, reasons: ['SEO matched'] },
    aiAnalysis: { adjusted_score: 88, confidence: 82, should_apply: true }
  });

  assert.equal(['apply', 'review'].includes(result.recommendation), true);
  assert.equal(result.ats_score >= 60, true);
  assert.equal(result.application_score >= 70, true);
  assert.equal(result.optimized_resume_keywords.matched.includes('SEO'), true);
  assert.equal(result.optimized_resume_keywords.missing.includes('Google Analytics'), true);
  assert.equal(result.optimized_cover_letter.split(/\s+/).length <= 250, true);
  assert.match(result.improved_answers.why_good_fit, /Technical SEO and Shopify Specialist/);
});

test('skips high-risk jobs with hard filters', () => {
  const result = optimizeApplication({
    job: {
      title: 'SEO Specialist',
      applicationUrl: 'https://example.com/jobs/us-only',
      description: 'Remote SEO role. Must be authorized to work in the United States.',
      requirements: 'SEO and technical SEO.'
    },
    candidateProfile: profile,
    resumeText,
    localAnalysis: { score: 80, reasons: ['Hard filter matched: authorized to work in the united states'] },
    aiAnalysis: { adjusted_score: 80, confidence: 70, should_apply: true }
  });

  assert.equal(result.recommendation, 'skip');
  assert.equal(result.risk_flags.some((flag) => flag.severity === 'high'), true);
});

test('does not treat executive assistant as executive leadership seniority', () => {
  const sisterProfile = {
    name: 'Temiloluwa Ruth Oyelola',
    skills: ['Administrative Support', 'Virtual Assistance', 'Calendar Management', 'Google Workspace', 'Microsoft Office'],
    strengths: ['calendar management', 'executive assistant', 'Microsoft Office'],
    preferredRoles: ['Executive Assistant', 'Virtual Assistant', 'Administrative Assistant'],
    targetSeniorities: ['entry', 'junior', 'mid']
  };

  const result = optimizeApplication({
    job: {
      title: 'C-suite Executive Assistant',
      applicationUrl: 'https://bruntworkcareers.co/jobs/57780783907',
      source: 'bruntwork',
      description: 'Support the CEO with calendar management, email management, administrative support, client coordination, and Google Workspace.',
      requirements: 'Executive calendar management, email management, Google Workspace, Microsoft Office, communication.'
    },
    candidateProfile: sisterProfile,
    resumeText: 'Executive assistant with calendar management, administrative support, Google Workspace and Microsoft Office experience.',
    localAnalysis: { score: 92, reasons: ['Administrative support matched'] },
    aiAnalysis: { adjusted_score: 90, confidence: 80, should_apply: true }
  });

  assert.equal(result.risk_flags.some((flag) => flag.code === 'seniority_mismatch'), false);
  assert.notEqual(result.recommendation, 'skip');
});

test('writes test-mode optimizer artifacts under profile and job hash', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'application-optimizer-'));
  const job = {
    title: 'Website Administrator',
    applicationUrl: 'https://example.com/jobs/web-admin',
    description: 'Maintain WordPress pages, improve SEO and publish content.'
  };
  const optimization = optimizeApplication({
    job,
    candidateProfile: profile,
    resumeText,
    localAnalysis: { score: 82 },
    aiAnalysis: { adjusted_score: 82, confidence: 80, should_apply: true }
  });

  await saveOptimizerArtifacts({ testMode: true, testResultsDir: path.join(dir, 'tolu') }, job, optimization);

  const target = path.join(dir, 'tolu', hashJob(job));
  assert.equal(await exists(path.join(target, 'cover-letter.txt')), true);
  assert.equal(await exists(path.join(target, 'optimized-answers.json')), true);
  assert.equal(await exists(path.join(target, 'ats-analysis-report.json')), true);
});

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
