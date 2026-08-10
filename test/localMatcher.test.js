import test from 'node:test';
import assert from 'node:assert/strict';
import { localMatchJob, parseAiScoringResponse, recommendationForScore } from '../src/localMatcher.js';

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
  assert.equal(recommendationForScore(69), 'ignore');
  assert.equal(recommendationForScore(40, { profileName: 'sister', preferredRoles: ['Administrative Assistant'] }), 'review');
  assert.equal(recommendationForScore(39, { profileName: 'sister', preferredRoles: ['Administrative Assistant'] }), 'ignore');
});

test('Sister admin and CRM titles receive transferable role credit', async () => {
  const result = await localMatchJob({
    title: 'Administrative Assistant - Property Management',
    description: 'Remote role handling calendars, records, customer follow-up, CRM updates, and scheduling.'
  }, {
    profileName: 'sister',
    skills: ['Administrative Support', 'CRM', 'Customer Operations', 'Calendar Management'],
    preferredRoles: ['Administrative Assistant', 'Customer Operations Specialist']
  }, { profileName: 'sister', preferences: {} });

  assert.equal(result.recommendation, 'review');
  assert.ok(result.score >= 60);
});

test('first-pass matching is deterministic and does not require an AI provider', async () => {
  const result = await localMatchJob(
    {
      title: 'Customer Support and CRM Assistant',
      description: 'Remote customer support, CRM updates, email support and administrative coordination.',
      requirements: 'Customer support, CRM, Google Workspace and data entry.'
    },
    {
      skills: ['Customer Support', 'CRM', 'Administrative Support', 'Data Entry'],
      preferredRoles: ['Customer Support', 'Virtual Assistant'],
      secondaryRoles: ['CRM Assistant']
    },
    { profileName: 'sister', aiDisabledProviders: 'deepseek,gemini,groq,openrouter' }
  );

  assert.equal(result.score > 0, true);
  assert.match(result.reasons.join(' '), /keyword fallback/i);
});

test('parses strict AI score JSON', () => {
  const result = parseAiScoringResponse('{"score":82,"matched_skills":["SEO"],"missing_skills":[],"reasons":["SEO match"]}');

  assert.equal(result.score, 82);
  assert.deepEqual(result.matched_skills, ['SEO']);
});

test('parses fenced and prose-wrapped AI score JSON', () => {
  const fenced = parseAiScoringResponse('```json\n{"score":"82/100","matched_skills":[],"missing_skills":[],"reasons":["Good fit"]}\n```');
  const prose = parseAiScoringResponse('Here is the result:\n{"score":"Score: 76","matched_skills":[],"missing_skills":[],"reasons":["Transferable skills"]}\nThanks');

  assert.equal(fenced.score, 82);
  assert.equal(prose.score, 76);
});

test('rejects AI score responses with no usable score', () => {
  assert.throws(
    () => parseAiScoringResponse('{"score":"strong fit","matched_skills":[],"missing_skills":[],"reasons":["Good"]}'),
    /invalid score format/
  );
});

test('sister scoring guidance explicitly values transferable admin and CRM experience', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/localMatcher.js', import.meta.url), 'utf8'));
  assert.match(source, /Give full credit for TRANSFERABLE experience/);
  assert.match(source, /Property\/Airbnb Assistant/);
  assert.match(source, /do NOT score below 60 merely because the exact industry is absent/);
  assert.match(source, /Only penalize availability when the CV\/profile explicitly says she is unavailable/);
});

test('sister accepts transferable operations and bookkeeping-admin roles', async () => {
  const profile = {
    profileName: 'sister',
    skills: ['Administrative Support', 'Bookkeeping', 'CRM', 'Customer Operations'],
    preferredRoles: ['Customer Support Specialist', 'Administrative Assistant'],
    secondaryRoles: ['Bookkeeping Assistant']
  };

  const operations = await localMatchJob({
    title: 'Client Operations Coordinator',
    description: 'Coordinate onboarding, customer records, scheduling, and CRM updates.'
  }, profile, { profileName: 'sister', preferences: {} });
  assert.notEqual(operations.score, 0);

  const bookkeeping = await localMatchJob({
    title: 'Bookkeeper and Administrative Support Assistant',
    description: 'Maintain invoices, financial records, spreadsheets, and customer follow-up.'
  }, profile, { profileName: 'sister', preferences: {} });
  assert.notEqual(bookkeeping.score, 0);
});

test('sister accepts adjacent customer experience and onboarding titles', async () => {
  const profile = {
    profileName: 'sister',
    skills: ['Customer Support', 'CRM', 'Administrative Support', 'Program Coordination'],
    preferredRoles: ['Customer Support Specialist', 'Virtual Assistant'],
    secondaryRoles: ['Community Manager']
  };

  const customerExperience = await localMatchJob({
    title: 'Customer Experience Specialist',
    description: 'Support customers, update CRM records, resolve requests, and coordinate follow-up.'
  }, profile, { profileName: 'sister', preferences: {} });
  const onboarding = await localMatchJob({
    title: 'Client Onboarding Coordinator',
    description: 'Coordinate onboarding steps, scheduling, records, and customer communication.'
  }, profile, { profileName: 'sister', preferences: {} });

  assert.notEqual(customerExperience.score, 0);
  assert.notEqual(onboarding.score, 0);
});
