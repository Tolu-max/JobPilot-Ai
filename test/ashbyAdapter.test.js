import test from 'node:test';
import assert from 'node:assert/strict';
import { ashbyAdapter } from '../src/adapters/ashby.js';
import { getAdapter } from '../src/adapters/index.js';
import { classifyApplyUrl, shouldAllowGatewayHandoff } from '../src/adapters/atsResolver.js';
import { FormStep } from '../src/adapters/types.js';

test('ashby adapter matches ashbyhq.com job URLs', () => {
  assert.equal(ashbyAdapter.matches('https://jobs.ashbyhq.com/acme/abc-123/application'), true);
  assert.equal(ashbyAdapter.matches('https://app.ashbyhq.com/acme/abc-123'), true);
  assert.equal(ashbyAdapter.matches('https://jobs.lever.co/acme/123'), false);
  assert.equal(ashbyAdapter.matches('https://apply.workable.com/acme/j/123'), false);
});

test('getAdapter selects ashby for ashbyhq.com URLs', () => {
  assert.equal(getAdapter('https://jobs.ashbyhq.com/acme/abc-123/application').name, 'ashby');
  assert.equal(getAdapter('https://jobs.ashbyhq.com/notion/def-456').name, 'ashby');
});

test('ashby is classified as audited and supported in atsResolver', () => {
  const c = classifyApplyUrl('https://jobs.ashbyhq.com/example/job123/application');
  assert.equal(c.supported, true);
  assert.equal(c.adapter, 'ashby');
  assert.equal(c.audited, true);
  assert.equal(c.reason, 'supported-audited-adapter');
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: true }), true);
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: false }), false);
});

test('ashby getCurrentStep detects the apply form and submission confirmation', async () => {
  // Apply form page (/application)
  const formPage = { url: () => 'https://jobs.ashbyhq.com/acme/123/application', locator: () => ({ innerText: async () => 'Full name Email Resume' }) };
  assert.equal(await ashbyAdapter.getCurrentStep(formPage), FormStep.DETAILS);

  // Submitted
  const subPage = { url: () => 'https://jobs.ashbyhq.com/acme/123/application', locator: () => ({ innerText: async () => 'Application submitted! We will be in touch.' }) };
  assert.equal(await ashbyAdapter.getCurrentStep(subPage), FormStep.SUBMITTED);

  // Listing page (no /application)
  const listPage = { url: () => 'https://jobs.ashbyhq.com/acme/123', locator: () => ({ innerText: async () => 'Apply for this job' }) };
  assert.equal(await ashbyAdapter.getCurrentStep(listPage), FormStep.UNKNOWN);
});

test('ashby adapter returns isSubmitted false for non-confirmation pages', async () => {
  const page = { url: () => 'https://jobs.ashbyhq.com/acme/123/application', locator: () => ({ innerText: async () => 'Please fill out the form below.' }) };
  const r = await ashbyAdapter.isSubmitted(page);
  assert.equal(r.submitted, false);
});

test('ashby adapter fillStep + advance stops before submit in testMode', async () => {
  const currentUrl = 'https://jobs.ashbyhq.com/acme/123/application';
  const page = {
    url: () => currentUrl,
    locator: () => locatorProxy(),
    getByRole: () => locatorProxy(),
    getByLabel: () => locatorProxy(),
    waitForLoadState: async () => {},
    waitForTimeout: async () => {}
  };

  function locatorProxy() {
    const self = {
      first: () => self,
      waitFor: async () => {},
      isVisible: async () => true,
      isDisabled: async () => false,
      or: () => self,
      click: async () => {},
      setInputFiles: async () => {},
      inputValue: async () => '',
      evaluate: async () => {},
      scrollIntoViewIfNeeded: async () => {},
      check: async () => {},
      getAttribute: async () => '',
      count: async () => 1,
      all: async () => [],
      innerText: async () => 'Full name Email Resume'
    };
    return self;
  }

  const ctx = {
    candidate: { name: 'Test Candidate', email: 'test@test.com', linkedin: 'https://linkedin.com/in/test' },
    config: { applicantEmail: 'test@test.com', applicationDefaults: {}, testMode: true },
    resumePath: '/tmp/fake.pdf'
  };

  await ashbyAdapter.fillStep(page, FormStep.DETAILS, ctx);

  const result = await ashbyAdapter.advance(page, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, false);
  assert.match(result.reason, /TEST_MODE/);
});
