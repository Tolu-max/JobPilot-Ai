import test from 'node:test';
import assert from 'node:assert/strict';
import { leverAdapter } from '../src/adapters/lever.js';
import { getAdapter } from '../src/adapters/index.js';
import { classifyApplyUrl, shouldAllowGatewayHandoff } from '../src/adapters/atsResolver.js';
import { FormStep } from '../src/adapters/types.js';

test('lever adapter matches lever.co job URLs', () => {
  assert.equal(leverAdapter.matches('https://jobs.lever.co/stripe/abc123'), true);
  assert.equal(leverAdapter.matches('https://jobs.lever.co/gusto/apply'), true);
  assert.equal(leverAdapter.matches('https://boards.greenhouse.io/acme'), false);
  assert.equal(leverAdapter.matches('https://remoteok.com/remote-jobs/dev'), false);
});

test('getAdapter selects lever for lever.co URLs', () => {
  assert.equal(getAdapter('https://jobs.lever.co/stripe/abc123').name, 'lever');
  assert.equal(getAdapter('https://jobs.lever.co/notion/def456').name, 'lever');
});

test('lever is classified as audited and supported in atsResolver', () => {
  const c = classifyApplyUrl('https://jobs.lever.co/example/job123');
  assert.equal(c.supported, true);
  assert.equal(c.adapter, 'lever');
  assert.equal(c.audited, true);
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: true }), true);
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: false }), false);
});

test('lever getCurrentStep detects the apply form and submission confirmation', async () => {
  // Apply page
  const applyPage = { url: () => 'https://jobs.lever.co/acme/123/apply', locator: () => ({ innerText: async () => 'Submit application' }) };
  assert.equal(await leverAdapter.getCurrentStep(applyPage), FormStep.DETAILS);

  // Submitted
  const subPage = { url: () => 'https://jobs.lever.co/acme/123/apply', locator: () => ({ innerText: async () => 'Thank you for your application! We have received it.' }) };
  assert.equal(await leverAdapter.getCurrentStep(subPage), FormStep.SUBMITTED);

  // Listing page (no /apply)
  const listPage = { url: () => 'https://jobs.lever.co/acme/123', locator: () => ({ innerText: async () => 'Apply for this job' }) };
  assert.equal(await leverAdapter.getCurrentStep(listPage), FormStep.UNKNOWN);
});

test('lever adapter returns isSubmitted false for non-confirmation pages', async () => {
  const page = { url: () => 'https://jobs.lever.co/acme/123/apply', locator: () => ({ innerText: async () => 'Please fill out the form below.' }) };
  const r = await leverAdapter.isSubmitted(page);
  assert.equal(r.submitted, false);
});

test('lever adapter fillStep + advance stops before submit in testMode', async () => {
  let currentUrl = 'https://jobs.lever.co/acme/123';
  const page = {
    url: () => currentUrl,
    locator: (sel) => locatorProxy(sel, currentUrl, () => currentUrl, (u) => { currentUrl = u; }),
    getByRole: () => locatorProxy('link', currentUrl, () => currentUrl, (u) => { currentUrl = u; }),
    waitForLoadState: async () => {},
    waitForTimeout: async () => {}
  };

  function locatorProxy(sel, urlRef, getUrl, setUrl) {
    const onApplyPage = getUrl().includes('/apply');
    const self = {
      first: () => self,
      isVisible: async () => {
        if (sel.includes('link') || sel.includes('button')) return !onApplyPage;
        return onApplyPage;
      },
      isDisabled: async () => false,
      or: (other) => self, // chain .or() returns same proxy
      click: async () => { setUrl('https://jobs.lever.co/acme/123/apply'); },
      setInputFiles: async () => {},
      inputValue: async () => '',
      evaluate: async (fn, val) => {},
      scrollIntoViewIfNeeded: async () => {},
      count: async () => 1,
      all: async () => [],
      innerText: async () => onApplyPage ? 'Submit application' : 'Apply for this job'
    };
    return self;
  }

  const ctx = {
    candidate: { name: 'Test Candidate', email: 'test@test.com', linkedin: 'https://linkedin.com/in/test' },
    config: { applicantEmail: 'test@test.com', applicationDefaults: {}, testMode: true },
    resumePath: '/tmp/fake.pdf'
  };

  await leverAdapter.fillStep(page, FormStep.DETAILS, ctx);
  assert.ok(currentUrl.includes('/apply'), 'should navigate to /apply');

  const result = await leverAdapter.advance(page, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, false);
  assert.match(result.reason, /TEST_MODE/);
});
