import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probeAtsBoard,
  discoverActiveBoards,
  findMatchingJobsAcrossAts
} from '../src/discovery/atsBoardDiscovery.js';

test('probeAtsBoard rejects invalid slugs and unsupported platforms', async () => {
  const badSlug = await probeAtsBoard('greenhouse', '');
  assert.equal(badSlug.exists, false);
  assert.equal(badSlug.error, 'Invalid slug');

  const badPlatform = await probeAtsBoard('unknown_ats', 'acme');
  assert.equal(badPlatform.exists, false);
  assert.match(badPlatform.error, /Unsupported platform/);
});

test('discoverActiveBoards handles empty slug list gracefully', async () => {
  const boards = await discoverActiveBoards('greenhouse', []);
  assert.deepEqual(boards, []);
});

test('discoverActiveBoards deduplicates candidate slugs', async () => {
  // Test with non-existent slugs that return exists: false
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 404
  });

  try {
    const results = await discoverActiveBoards('ashby', ['test-company', 'test-company', 'TEST-COMPANY']);
    assert.equal(results.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('probeAtsBoard parses greenhouse payload correctly', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs/);
    return {
      ok: true,
      json: async () => ({
        jobs: [
          { title: 'Full Stack Engineer', location: { name: 'Remote' } },
          { title: 'Customer Support Lead', location: { name: 'New York' } }
        ]
      })
    };
  };

  try {
    const res = await probeAtsBoard('greenhouse', 'acme');
    assert.equal(res.exists, true);
    assert.equal(res.platform, 'greenhouse');
    assert.equal(res.jobCount, 2);
    assert.equal(res.remoteJobCount, 1);
    assert.deepEqual(res.sampleTitles, ['Full Stack Engineer', 'Customer Support Lead']);
    assert.equal(res.boardUrl, 'https://job-boards.greenhouse.io/acme');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('probeAtsBoard parses ashby payload correctly', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /api\.ashbyhq\.com\/posting-api\/job-board\/linear/);
    return {
      ok: true,
      json: async () => ({
        jobs: [
          { title: 'Frontend Developer', isRemote: true },
          { title: 'Product Designer', isRemote: false, location: 'San Francisco' }
        ]
      })
    };
  };

  try {
    const res = await probeAtsBoard('ashby', 'linear');
    assert.equal(res.exists, true);
    assert.equal(res.platform, 'ashby');
    assert.equal(res.jobCount, 2);
    assert.equal(res.remoteJobCount, 1);
    assert.deepEqual(res.sampleTitles, ['Frontend Developer', 'Product Designer']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('findMatchingJobsAcrossAts matches titles using regex', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('greenhouse')) {
      return {
        ok: true,
        json: async () => ({
          jobs: [{ title: 'Staff Frontend Engineer', location: { name: 'Remote' } }]
        })
      };
    }
    return { ok: false };
  };

  try {
    const findings = await findMatchingJobsAcrossAts(['greenhouse'], ['stripe'], /frontend/i);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].hasMatchingJobs, true);
    assert.deepEqual(findings[0].matchingTitles, ['Staff Frontend Engineer']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
