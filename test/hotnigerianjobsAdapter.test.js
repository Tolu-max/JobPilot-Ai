import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotnigerianjobsAdapter } from '../src/adapters/hotnigerianjobs.js';
import { getAdapter } from '../src/adapters/index.js';
import { classifyApplyUrl } from '../src/adapters/atsResolver.js';
import { FormStep } from '../src/adapters/types.js';

test('HotNigerianJobs Adapter: matches HNJ job URLs', () => {
  const validUrl = 'https://www.hotnigerianjobs.com/hotjobs/959123/spectrum-books-limited.html';
  assert.equal(hotnigerianjobsAdapter.matches(validUrl), true);
  assert.equal(hotnigerianjobsAdapter.matches('https://www.jobberman.com/jobs/123'), false);
});

test('HotNigerianJobs Adapter: getAdapter resolves hotnigerianjobs for HNJ URLs', () => {
  const resolved = getAdapter('https://www.hotnigerianjobs.com/hotjobs/959123/sample.html');
  assert.equal(resolved.name, 'hotnigerianjobs');
});

test('HotNigerianJobs Adapter: classifyApplyUrl recognizes HNJ as audited gateway', () => {
  const result = classifyApplyUrl('https://www.hotnigerianjobs.com/hotjobs/959123/sample.html');
  assert.equal(result.adapter, 'hotnigerianjobs');
  assert.equal(result.supported, true);
  assert.equal(result.audited, true);
  assert.equal(result.kind, 'gateway');
});

test('HotNigerianJobs Adapter: advance handles email application in testMode without live dispatch', async () => {
  const fakePage = {
    url: () => 'https://www.hotnigerianjobs.com/hotjobs/959123/sample.html',
    content: async () => '<html><body>Sample</body></html>',
    locator: () => ({
      innerText: async () => 'How to apply: Send CV to careers@example.com'
    })
  };

  const ctx = {
    config: { testMode: true },
    candidate: { name: 'Temiloluwa Ruth Oyelola', email: 'temmy152000@gmail.com' },
    job: {
      title: 'Customer Service Officer',
      raw: {
        decodedEmail: 'careers@example.com',
        applySubject: 'Customer Service Officer Application'
      }
    }
  };

  const result = await hotnigerianjobsAdapter.advance(fakePage, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, true);
  assert.equal(result.step, FormStep.REVIEW);
  assert.ok(result.reason.includes('TEST_MODE'));
  assert.equal(result.meta.recipientEmail, 'careers@example.com');
  assert.equal(result.meta.subject, 'Customer Service Officer Application');
});

test('HotNigerianJobs Adapter: advance resolves external ATS URL in testMode', async () => {
  const fakePage = {
    url: () => 'https://www.hotnigerianjobs.com/hotjobs/959123/sample.html',
    content: async () => '<html><body>Sample</body></html>',
    locator: () => ({
      innerText: async () => 'How to apply: Apply online'
    })
  };

  const ctx = {
    config: { testMode: true, allowGatewayAutoSubmit: true, allowGatewayLiveHandoff: true },
    candidate: { name: 'Toluwalope Samuel Oyelola' },
    job: {
      title: 'Full-Stack Developer',
      raw: {
        externalApplyUrl: 'https://boards.greenhouse.io/samplecompany/jobs/12345'
      }
    }
  };

  const result = await hotnigerianjobsAdapter.advance(fakePage, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, true);
  assert.equal(result.step, FormStep.REVIEW);
  assert.equal(result.meta.downstreamAdapter, 'greenhouse');
});
