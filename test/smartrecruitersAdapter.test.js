import test from 'node:test';
import assert from 'node:assert/strict';
import { smartRecruitersAdapter } from '../src/adapters/smartrecruiters.js';
import { getAdapter } from '../src/adapters/index.js';
import { classifyApplyUrl } from '../src/adapters/atsResolver.js';
import { FormStep } from '../src/adapters/types.js';

test('smartrecruiters adapter matches smartrecruiters job and apply URLs', () => {
  assert.equal(smartRecruitersAdapter.matches('https://jobs.smartrecruiters.com/smartrecruiters/744000148454651-data-operations-consultant-?oga=true'), true);
  assert.equal(smartRecruitersAdapter.matches('https://careers.smartrecruiters.com/DeliveryHero/jobs/12345'), true);
  assert.equal(smartRecruitersAdapter.matches('https://www.smartrecruiters.com/company/jobs/789'), true);
  assert.equal(smartRecruitersAdapter.matches('https://jobs.lever.co/hotjar/123'), false);
  assert.equal(smartRecruitersAdapter.matches('https://boards.greenhouse.io/hotjar/jobs/456'), false);
  assert.equal(smartRecruitersAdapter.matches(''), false);
});

test('getAdapter selects smartrecruiters for smartrecruiters URLs', () => {
  assert.equal(getAdapter('https://jobs.smartrecruiters.com/smartrecruiters/744000148454651').name, 'smartrecruiters');
});

test('smartrecruiters is classified as audited ats in atsResolver', () => {
  const c = classifyApplyUrl('https://jobs.smartrecruiters.com/smartrecruiters/744000148454651');
  assert.equal(c.supported, true);
  assert.equal(c.adapter, 'smartrecruiters');
  assert.equal(c.audited, true);
  assert.equal(c.kind, 'ats');
});

test('smartrecruiters getCurrentStep detects apply form and submission states', async () => {
  const submittedPage = {
    url: () => 'https://jobs.smartrecruiters.com/thank-you',
    locator: () => ({
      innerText: async () => 'Thank you for your application! Your application has been submitted.'
    })
  };
  assert.equal(await smartRecruitersAdapter.getCurrentStep(submittedPage), FormStep.SUBMITTED);

  const applyFormPage = {
    url: () => 'https://jobs.smartrecruiters.com/smartrecruiters/744000148454651',
    locator: (sel) => ({
      innerText: async () => 'Apply for position',
      first: () => ({
        isVisible: async () => sel.includes('firstName') || sel.includes('email')
      })
    })
  };
  assert.equal(await smartRecruitersAdapter.getCurrentStep(applyFormPage), FormStep.DETAILS);
});

test('smartrecruiters advance stops before submit in testMode', async () => {
  function locatorProxy(selector) {
    const self = {
      first: () => self,
      nth: () => self,
      isVisible: async () => true,
      isDisabled: async () => false,
      click: async () => {},
      setInputFiles: async () => {},
      evaluate: async () => {
        if (selector === 'body') {
          return { ok: true, reason: 'ok', missing: [] };
        }
        return '';
      },
      count: async () => 1,
      innerText: async () => 'First Name Last Name Email Phone Resume Submit Application'
    };
    return self;
  }

  const mockPage = {
    url: () => 'https://jobs.smartrecruiters.com/smartrecruiters/744000148454651',
    locator: (selector) => locatorProxy(selector),
    waitForTimeout: async () => {}
  };

  const result = await smartRecruitersAdapter.advance(mockPage, FormStep.DETAILS, {
    config: { testMode: true }
  });
  assert.equal(result.step, FormStep.REVIEW);
  assert.equal(result.advanced, false);
  assert.match(result.reason, /TEST_MODE/);
});

test('smartrecruiters isSubmitted returns false for form pages', async () => {
  const formPage = {
    url: () => 'https://jobs.smartrecruiters.com/smartrecruiters/744000148454651',
    locator: () => ({
      innerText: async () => 'Please fill out your first name and email to apply.'
    })
  };
  const sub = await smartRecruitersAdapter.isSubmitted(formPage);
  assert.equal(sub.submitted, false);
});
