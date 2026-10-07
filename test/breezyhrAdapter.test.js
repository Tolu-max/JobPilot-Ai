import test from 'node:test';
import assert from 'node:assert/strict';
import { breezyHrAdapter } from '../src/adapters/breezyhr.js';
import { getAdapter } from '../src/adapters/index.js';
import { classifyApplyUrl } from '../src/adapters/atsResolver.js';
import { FormStep, Proof } from '../src/adapters/types.js';

test('breezyhr adapter matches breezy.hr job and apply URLs', () => {
  assert.equal(breezyHrAdapter.matches('https://pairty.breezy.hr/p/03145c08182d-autonomous-systems-apprentice/apply'), true);
  assert.equal(breezyHrAdapter.matches('https://cortex.breezy.hr/p/371bad41881b-remote-rn-inbound-agent'), true);
  assert.equal(breezyHrAdapter.matches('https://jobs.lever.co/hotjar/123'), false);
  assert.equal(breezyHrAdapter.matches('https://boards.greenhouse.io/hotjar/jobs/456'), false);
  assert.equal(breezyHrAdapter.matches(''), false);
});

test('getAdapter selects breezyhr for breezy.hr URLs', () => {
  assert.equal(getAdapter('https://pairty.breezy.hr/p/03145c08182d-autonomous-systems-apprentice/apply').name, 'breezyhr');
});

test('breezyhr is classified as audited ats in atsResolver', () => {
  const c = classifyApplyUrl('https://pairty.breezy.hr/p/03145c08182d-autonomous-systems-apprentice/apply');
  assert.equal(c.supported, true);
  assert.equal(c.adapter, 'breezyhr');
  assert.equal(c.audited, true);
  assert.equal(c.kind, 'ats');
});

test('breezyhr getCurrentStep detects apply form and submission states', async () => {
  const submittedPage = {
    locator: () => ({
      innerText: async () => 'Thank you for applying! Your application has been submitted.'
    })
  };
  assert.equal(await breezyHrAdapter.getCurrentStep(submittedPage), FormStep.SUBMITTED);

  const applyFormPage = {
    locator: (sel) => ({
      innerText: async () => 'Apply for position',
      first: () => ({
        isVisible: async () => sel.includes('cName') || sel.includes('cEmail')
      })
    })
  };
  assert.equal(await breezyHrAdapter.getCurrentStep(applyFormPage), FormStep.DETAILS);
});

test('breezyhr advance stops before submit in testMode', async () => {
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
      innerText: async () => 'Full Name Email Phone Resume Submit Application'
    };
    return self;
  }

  const mockPage = {
    url: () => 'https://pairty.breezy.hr/p/03145c08182d/apply',
    locator: (selector) => locatorProxy(selector),
    waitForTimeout: async () => {}
  };

  const result = await breezyHrAdapter.advance(mockPage, FormStep.DETAILS, {
    config: { testMode: true }
  });
  assert.equal(result.step, FormStep.REVIEW);
  assert.equal(result.advanced, false);
  assert.match(result.reason, /TEST_MODE/);
});

test('breezyhr isSubmitted returns false for form pages', async () => {
  const formPage = {
    locator: () => ({
      innerText: async () => 'Please fill out your name and email to apply.'
    })
  };
  const sub = await breezyHrAdapter.isSubmitted(formPage);
  assert.equal(sub.submitted, false);
});
