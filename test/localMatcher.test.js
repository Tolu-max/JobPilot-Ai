import test from 'node:test';
import assert from 'node:assert/strict';
import { localMatchJob, recommendationForScore } from '../src/localMatcher.js';

const profile = {
  skills: ['SEO', 'Technical SEO', 'Shopify', 'WordPress', 'Web Development', 'JavaScript', 'Node.js'],
  preferredRoles: ['SEO Specialist', 'Shopify Specialist', 'Website Administrator'],
  secondaryRoles: ['Content Manager']
};

test('scores strong SEO/web roles for review or better without Gemini', async () => {
  const result = await localMatchJob(
    {
      title: 'Website Administrator',
      description: 'Remote part-time website administrator role with SEO, WordPress, web development, JavaScript and content updates.',
      requirements: 'SEO, WordPress, HTML, CSS, JavaScript',
      responsibilities: 'Maintain website, improve SEO and publish content.'
    },
    profile
  );

  assert.equal(result.recommendation !== 'ignore', true);
  assert.equal(result.matchedSkills.includes('SEO'), true);
  assert.equal(result.score >= 75, true);
});

test('applies hard penalty for US work authorization', async () => {
  const result = await localMatchJob(
    {
      title: 'SEO Specialist',
      description: 'Remote SEO role. Must be authorized to work in the United States.',
      requirements: 'SEO and technical SEO.',
      responsibilities: 'SEO audits.'
    },
    profile
  );

  assert.equal(result.recommendation, 'ignore');
  assert.equal(result.score < 75, true);
});

test('recommendation thresholds match requirements', () => {
  assert.equal(recommendationForScore(95), 'instant_apply');
  assert.equal(recommendationForScore(88), 'auto_apply');
  assert.equal(recommendationForScore(75), 'review');
  assert.equal(recommendationForScore(74), 'ignore');
});
