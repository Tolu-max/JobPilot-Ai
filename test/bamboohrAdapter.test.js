import test from 'node:test';
import assert from 'node:assert/strict';
import { bamboohrAdapter } from '../src/adapters/bamboohr.js';
import { getAdapter } from '../src/adapters/index.js';
import { classifyApplyUrl, shouldAllowGatewayHandoff } from '../src/adapters/atsResolver.js';
import { FormStep } from '../src/adapters/types.js';

test('bamboohr adapter matches bamboohr careers URLs', () => {
  assert.equal(bamboohrAdapter.matches('https://lemonio.bamboohr.com/careers/49'), true);
  assert.equal(bamboohrAdapter.matches('https://lemonio.bamboohr.com/careers/'), true);
  assert.equal(bamboohrAdapter.matches('https://jobs.lever.co/acme/123'), false);
});

test('getAdapter selects bamboohr for bamboohr careers URLs', () => {
  assert.equal(getAdapter('https://lemonio.bamboohr.com/careers/49').name, 'bamboohr');
});

test('bamboohr is classified as audited and supported in atsResolver after adapter support', () => {
  const c = classifyApplyUrl('https://lemonio.bamboohr.com/careers/49');
  assert.equal(c.supported, true);
  assert.equal(c.adapter, 'bamboohr');
  assert.equal(c.audited, true);
  assert.equal(c.reason, 'supported-audited-adapter');
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: true }), true);
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: false }), false);
});

test('bamboohr getCurrentStep detects detail and submitted states', async () => {
  const applyPage = {
    url: () => 'https://lemonio.bamboohr.com/careers/49',
    locator: () => ({
      innerText: async () => 'First Name Last Name Resume Submit Application',
      first: function () { return this; },
      isVisible: async () => true
    })
  };
  assert.equal(await bamboohrAdapter.getCurrentStep(applyPage), FormStep.DETAILS);

  const subPage = {
    url: () => 'https://lemonio.bamboohr.com/careers/49',
    locator: () => ({
      innerText: async () => 'Thank you for applying. Your application has been submitted.',
      first: function () { return this; },
      isVisible: async () => true
    })
  };
  assert.equal(await bamboohrAdapter.getCurrentStep(subPage), FormStep.SUBMITTED);
});

test('bamboohr adapter returns isSubmitted false for non-confirmation pages', async () => {
  const page = {
    locator: () => ({ innerText: async () => 'Please complete the application form.' })
  };
  const result = await bamboohrAdapter.isSubmitted(page);
  assert.equal(result.submitted, false);
});

test('bamboohr adapter fillStep + advance stops before submit in testMode', async () => {
  let clickedApply = false;
  const page = {
    locator: (selector) => locatorProxy(selector),
    getByRole: () => locatorProxy('button'),
    locatorBody: { evaluate: async () => ({ ok: true, reason: 'ok', missing: [] }) },
    waitForTimeout: async () => {}
  };

  function locatorProxy(selector) {
    const self = {
      first: () => self,
      nth: () => self,
      isVisible: async () => {
        if (selector.includes('firstName') || selector.includes('input[type="file"]')) return clickedApply;
        return true;
      },
      isDisabled: async () => false,
      click: async () => { clickedApply = true; },
      setInputFiles: async () => {},
      waitFor: async () => {},
      inputValue: async () => '',
      evaluate: async (fn) => {
        if (selector === 'body') {
          return { ok: true, reason: 'ok', missing: [] };
        }
        if (selector.includes('select')) {
          return [
            { value: '', label: 'Select' },
            { value: 'Nigeria', label: 'Nigeria' }
          ];
        }
        return '';
      },
      selectOption: async () => {},
      scrollIntoViewIfNeeded: async () => {},
      getAttribute: async () => '',
      count: async () => 1,
      innerText: async () => clickedApply ? 'First Name Last Name Resume Submit Application' : 'Apply for This Job'
    };
    return self;
  }

  const ctx = {
    candidate: { name: 'Test Candidate', email: 'test@test.com', phone: '+23412345678', linkedin: 'https://linkedin.com/in/test' },
    config: { applicantEmail: 'test@test.com', applicationDefaults: { country: 'Nigeria' }, testMode: true },
    resumePath: '/tmp/fake.pdf',
    answers: { why_good_fit: 'I am a strong fit for this role because of my product design and remote collaboration experience.' }
  };

  await bamboohrAdapter.fillStep(page, FormStep.UNKNOWN, ctx);
  const result = await bamboohrAdapter.advance(page, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, false);
  assert.match(result.reason, /TEST_MODE/);
});
