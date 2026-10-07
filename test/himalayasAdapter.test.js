import test from 'node:test';
import assert from 'node:assert/strict';
import { himalayasAdapter, resolveHimalayasApplyUrl } from '../src/adapters/himalayas.js';
import { getAdapter } from '../src/adapters/index.js';
import { classifyApplyUrl, shouldAllowGatewayHandoff } from '../src/adapters/atsResolver.js';
import { FormStep, Proof } from '../src/adapters/types.js';

test('himalayas adapter matches himalayas.app job URLs', () => {
  assert.equal(himalayasAdapter.matches('https://himalayas.app/companies/hotjar/jobs/seo-manager'), true);
  assert.equal(himalayasAdapter.matches('https://himalayas.app/jobs/customer-support-specialist'), true);
  assert.equal(himalayasAdapter.matches('https://jobs.lever.co/hotjar/123'), false);
  assert.equal(himalayasAdapter.matches('https://boards.greenhouse.io/hotjar/jobs/456'), false);
  assert.equal(himalayasAdapter.matches(''), false);
  assert.equal(himalayasAdapter.matches(null), false);
});

test('getAdapter selects himalayas for himalayas.app job URLs', () => {
  assert.equal(getAdapter('https://himalayas.app/companies/hotjar/jobs/seo-manager').name, 'himalayas');
  assert.equal(getAdapter('https://himalayas.app/jobs/full-stack-engineer').name, 'himalayas');
});

test('himalayas is classified as gateway and audited in atsResolver', () => {
  const c = classifyApplyUrl('https://himalayas.app/companies/hotjar/jobs/seo-manager');
  assert.equal(c.supported, true);
  assert.equal(c.adapter, 'himalayas');
  assert.equal(c.audited, true);
  assert.equal(c.kind, 'gateway');
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: true }), true);
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: false }), false);
});

test('himalayas getCurrentStep detects Cloudflare challenge and application form', async () => {
  // Cloudflare check
  const cfPage = {
    locator: () => ({
      innerText: async () => 'Security verification required. Performance and security by Cloudflare'
    })
  };
  assert.equal(await himalayasAdapter.getCurrentStep(cfPage), FormStep.CAPTCHA);

  // Normal job page
  const normalPage = {
    locator: () => ({
      innerText: async () => 'Apply for this job on company website'
    })
  };
  assert.equal(await himalayasAdapter.getCurrentStep(normalPage), FormStep.DETAILS);

  // Unknown page
  const unknownPage = {
    locator: () => ({
      innerText: async () => 'Page not found'
    })
  };
  assert.equal(await himalayasAdapter.getCurrentStep(unknownPage), FormStep.UNKNOWN);
});

test('himalayas isSubmitted and verifySubmission return no proof (gateway only)', async () => {
  const sub = await himalayasAdapter.isSubmitted({});
  assert.equal(sub.submitted, false);
  const ver = await himalayasAdapter.verifySubmission();
  assert.equal(ver.proof, Proof.NOT_SUBMITTED);
});

test('resolveHimalayasApplyUrl extracts from job context when available', async () => {
  const ctx = {
    job: {
      raw: {
        externalApplyUrl: 'https://boards.greenhouse.io/hotjar/jobs/123'
      }
    }
  };
  const resolved = await resolveHimalayasApplyUrl({}, ctx);
  assert.equal(resolved, 'https://boards.greenhouse.io/hotjar/jobs/123');
});

test('himalayas advance blocks handoff when allowGatewayAutoSubmit is false', async () => {
  const page = {
    url: () => 'https://himalayas.app/companies/hotjar/jobs/seo-manager',
    evaluate: async () => ''
  };
  const ctx = {
    job: {
      raw: { externalApplyUrl: 'https://boards.greenhouse.io/hotjar/jobs/123' }
    },
    config: { allowGatewayAutoSubmit: false }
  };
  const result = await himalayasAdapter.advance(page, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, false);
  assert.match(result.reason, /live gateway handoff is disabled/i);
});

test('himalayas advance hands off to audited ATS when allowGatewayAutoSubmit is true', async () => {
  let navigatedTo = '';
  let currentUrl = 'https://himalayas.app/companies/hotjar/jobs/seo-manager';
  const page = {
    url: () => currentUrl,
    goto: async (url) => {
      navigatedTo = url;
      currentUrl = url;
    },
    evaluate: async () => ''
  };
  const ctx = {
    job: {
      raw: { externalApplyUrl: 'https://boards.greenhouse.io/hotjar/jobs/123' }
    },
    config: { allowGatewayAutoSubmit: true }
  };
  const result = await himalayasAdapter.advance(page, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, true);
  assert.equal(navigatedTo, 'https://boards.greenhouse.io/hotjar/jobs/123');
  assert.equal(result.meta.downstreamAdapter, 'greenhouse');
});
