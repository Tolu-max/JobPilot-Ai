import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matches,
  unwrapLinkedinRedirect,
  resolveLinkedinDestination,
  advance,
  getCurrentStep,
  isSubmitted,
  verifySubmission
} from '../src/adapters/linkedin.js';
import { getAdapter } from '../src/adapters/index.js';
import { FormStep } from '../src/adapters/types.js';

test('LinkedIn Adapter: matches LinkedIn job URLs across domains', () => {
  assert.equal(matches('https://www.linkedin.com/jobs/view/4472449774'), true);
  assert.equal(matches('https://ng.linkedin.com/jobs/view/4442257918?refId=123'), true);
  assert.equal(matches('https://in.linkedin.com/jobs/view/4407279833'), true);
  assert.equal(matches('https://www.indeed.com/viewjob?jk=123'), false);
  assert.equal(matches('https://jobs.lever.co/company/123'), false);
});

test('LinkedIn Adapter: getAdapter resolves linkedin for LinkedIn URLs', () => {
  const adapter = getAdapter('https://www.linkedin.com/jobs/view/4472449774');
  assert.equal(adapter.name, 'linkedin');
});

test('LinkedIn Adapter: unwrapLinkedinRedirect extracts external destination URL', () => {
  const wrapped = 'https://www.linkedin.com/jobs/view/123?targetUrl=https%3A%2F%2Fboards.greenhouse.io%2Ftech%2Fjobs%2F456';
  assert.equal(unwrapLinkedinRedirect(wrapped), 'https://boards.greenhouse.io/tech/jobs/456');
  assert.equal(unwrapLinkedinRedirect('https://www.linkedin.com/jobs/view/123'), '');
});

test('LinkedIn Adapter: advance resolves external ATS URL in testMode and prepares handoff', async () => {
  const ctx = {
    config: { testMode: true, allowGatewayAutoSubmit: true },
    job: {
      title: 'Senior WordPress Developer',
      externalApplyUrl: 'https://boards.greenhouse.io/automattic/jobs/12345'
    },
    candidate: { name: 'Tolu Oyelola' }
  };

  const result = await advance(null, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, true);
  assert.equal(result.step, FormStep.REVIEW);
  assert.ok(result.reason.includes('greenhouse'));
  assert.equal(result.meta.downstreamAdapter, 'greenhouse');
});

test('LinkedIn Adapter: advance prepares handoff to company website when allowed', async () => {
  const ctx = {
    config: { testMode: true, allowCompanyWebsites: true },
    job: {
      title: 'Full Stack Engineer',
      externalApplyUrl: 'https://careers.blacksmithagency.com/jobs/apply'
    },
    candidate: { name: 'Tolu Oyelola' }
  };

  const result = await advance(null, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, true);
  assert.equal(result.step, FormStep.REVIEW);
  assert.equal(result.meta.downstreamAdapter, 'generic');
});

test('LinkedIn Adapter: advance handles native Easy Apply in testMode', async () => {
  const ctx = {
    config: { testMode: true },
    job: {
      title: 'Customer Support Specialist',
      hasEasyApply: true
    },
    candidate: { name: 'Sister Oyelola' }
  };

  const result = await advance(null, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, true);
  assert.equal(result.step, FormStep.REVIEW);
  assert.ok(result.reason.includes('TEST_MODE: LinkedIn Easy Apply prepared'));
});

test('LinkedIn Adapter: advance identifies expired listings and halts immediately without timeout', async () => {
  const mockPage = {
    evaluate: async () => true // Page body matches expired text
  };

  const result = await advance(mockPage, FormStep.DETAILS, {});
  assert.equal(result.advanced, false);
  assert.equal(result.meta?.expired, true);
  assert.ok(result.reason.includes('expired'));
});

test('LinkedIn Adapter: getCurrentStep detects submitted status correctly', async () => {
  const mockPageActive = {
    evaluate: async () => false
  };
  assert.equal(await getCurrentStep(mockPageActive), FormStep.DETAILS);

  const mockPageSubmitted = {
    evaluate: async () => true
  };
  assert.equal(await getCurrentStep(mockPageSubmitted), FormStep.SUBMITTED);
});

test('LinkedIn Adapter: isSubmitted and verifySubmission detect in-page proof', async () => {
  const mockPageSuccess = {
    evaluate: async () => 'Thank you! Your application was sent to Acme Corp.'
  };

  const check = await isSubmitted(mockPageSuccess);
  assert.equal(check.submitted, true);
  assert.ok(check.markers.includes('Your application was sent'));

  const verified = await verifySubmission(mockPageSuccess);
  assert.equal(verified.submitted, true);
});
