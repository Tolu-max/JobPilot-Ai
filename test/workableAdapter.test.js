import test from 'node:test';
import assert from 'node:assert/strict';
import { workableAdapter } from '../src/adapters/workable.js';
import { getAdapter } from '../src/adapters/index.js';
import { classifyApplyUrl, shouldAllowGatewayHandoff } from '../src/adapters/atsResolver.js';
import { FormStep } from '../src/adapters/types.js';

test('workable adapter matches apply.workable.com job URLs', () => {
  assert.equal(workableAdapter.matches('https://apply.workable.com/acme/j/ABC123'), true);
  assert.equal(workableAdapter.matches('https://apply.workable.com/acme/j/ABC123/apply/'), true);
  assert.equal(workableAdapter.matches('https://jobs.lever.co/acme/123'), false);
  assert.equal(workableAdapter.matches('https://boards.greenhouse.io/acme'), false);
});

test('getAdapter selects workable for apply.workable.com URLs', () => {
  assert.equal(getAdapter('https://apply.workable.com/acme/j/ABC123').name, 'workable');
  assert.equal(getAdapter('https://apply.workable.com/notion/j/DEF456/apply/').name, 'workable');
});

test('workable is classified as audited and supported in atsResolver', () => {
  const c = classifyApplyUrl('https://apply.workable.com/example/j/job123');
  assert.equal(c.supported, true);
  assert.equal(c.adapter, 'workable');
  assert.equal(c.audited, true);
  assert.equal(c.reason, 'supported-audited-adapter');
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: true }), true);
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: false }), false);
});

test('workable getCurrentStep detects the apply form and submission confirmation', async () => {
  // Apply form page (/apply/)
  const formPage = { url: () => 'https://apply.workable.com/acme/j/123/apply/', locator: () => ({ innerText: async () => 'First name Last name' }) };
  assert.equal(await workableAdapter.getCurrentStep(formPage), FormStep.DETAILS);

  // Submitted
  const subPage = { url: () => 'https://apply.workable.com/acme/j/123/apply/', locator: () => ({ innerText: async () => 'Your application has been submitted. Thank you!' }) };
  assert.equal(await workableAdapter.getCurrentStep(subPage), FormStep.SUBMITTED);

  // Listing page (no /apply)
  const listPage = { url: () => 'https://apply.workable.com/acme/j/123', locator: () => ({ innerText: async () => 'Apply for this job' }) };
  assert.equal(await workableAdapter.getCurrentStep(listPage), FormStep.UNKNOWN);
});

test('workable adapter returns isSubmitted false for non-confirmation pages', async () => {
  const page = { url: () => 'https://apply.workable.com/acme/j/123/apply/', locator: () => ({ innerText: async () => 'Please fill out the form below.' }) };
  const r = await workableAdapter.isSubmitted(page);
  assert.equal(r.submitted, false);
});

test('workable adapter fillStep + advance stops before submit in testMode', async () => {
  let currentUrl = 'https://apply.workable.com/acme/j/123';
  const page = {
    url: () => currentUrl,
    locator: (sel) => locatorProxy(sel, () => currentUrl, (u) => { currentUrl = u; }),
    getByRole: () => locatorProxy('link', () => currentUrl, (u) => { currentUrl = u; }),
    goto: async (u) => { currentUrl = u; },
    waitForLoadState: async () => {},
    waitForTimeout: async () => {}
  };

  function locatorProxy(sel, getUrl, setUrl) {
    const onFormPage = getUrl().includes('/apply');
    const self = {
      first: () => self,
      waitFor: async () => {},
      isVisible: async () => {
        if (sel.includes('link') || sel.includes('button')) return !onFormPage;
        return onFormPage;
      },
      isDisabled: async () => false,
      or: () => self,
      click: async () => { setUrl('https://apply.workable.com/acme/j/123/apply/'); },
      setInputFiles: async () => {},
      inputValue: async () => '',
      evaluate: async () => {},
      scrollIntoViewIfNeeded: async () => {},
      check: async () => {},
      getAttribute: async () => '',
      count: async () => 1,
      all: async () => [],
      innerText: async () => onFormPage ? 'First name Last name' : 'Apply for this job'
    };
    return self;
  }

  const ctx = {
    candidate: { name: 'Test Candidate', email: 'test@test.com', linkedin: 'https://linkedin.com/in/test' },
    config: { applicantEmail: 'test@test.com', applicationDefaults: {}, testMode: true },
    resumePath: '/tmp/fake.pdf'
  };

  await workableAdapter.fillStep(page, FormStep.UNKNOWN, ctx);
  assert.ok(currentUrl.includes('/apply'), 'should navigate to the /apply/ form');

  const result = await workableAdapter.advance(page, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, false);
  assert.match(result.reason, /TEST_MODE/);
});
