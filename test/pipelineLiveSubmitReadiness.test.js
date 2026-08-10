import test from 'node:test';
import assert from 'node:assert/strict';
import { isRemoteEligibleForLiveSubmit, validateLiveSubmitReadiness } from '../src/pipeline.js';

test('validateLiveSubmitReadiness allows stronger reviewed jobs at configurable floor', async () => {
  const config = {
    profileName: 'sister',
    applicationReviewScoreFloor: 57,
    candidateProfile: { name: 'Temi' }
  };
  const profile = {
    skills: ['customer support', 'administrative support', 'CRM', 'operations'],
    preferredRoles: ['Administrative Coordinator', 'Customer Support Specialist'],
    secondaryRoles: ['Operations Assistant']
  };
  const job = {
    title: 'NDIS Administrative Coordinator',
    description: 'Remote customer support and admin coordination role using CRM workflows, inbox management, and scheduling.',
    requirements: 'Operations, customer support, scheduling, CRM, and administrative assistance.',
    responsibilities: 'Coordinate support requests, manage calendars, update CRM records, and handle admin follow-through.'
  };
  const existing = {
    score: 66,
    local: { score: 68 },
    optimizer: {
      application_score: 66,
      risk_flags: []
    }
  };

  const result = await validateLiveSubmitReadiness({
    job,
    profile,
    existing,
    config
  });

  assert.equal(result.ready, true);
});

test('validateLiveSubmitReadiness still blocks when below configurable floor', async () => {
  const config = {
    profileName: 'tolu',
    applicationReviewScoreFloor: 55,
    candidateProfile: { name: 'Tolu' }
  };
  const profile = {
    skills: ['SEO', 'Technical SEO', 'Shopify', 'WordPress', 'JavaScript'],
    preferredRoles: ['SEO Specialist', 'Website Administrator'],
    secondaryRoles: ['Content Specialist']
  };
  const job = {
    title: 'SEO Content Specialist',
    description: 'Remote SEO role covering technical SEO, content updates, WordPress publishing, and website optimization.',
    requirements: 'SEO, technical SEO, WordPress, content optimization, and analytics.',
    responsibilities: 'Run SEO audits, publish updates, improve rankings, and maintain website content.'
  };
  const existing = {
    score: 55,
    local: { score: 74 },
    optimizer: {
      application_score: 55,
      risk_flags: []
    }
  };

  const result = await validateLiveSubmitReadiness({
    job,
    profile,
    existing,
    config
  });

  assert.equal(result.ready, false);
  assert.match(result.reason, /not above live-submit floor/i);
});

test('validateLiveSubmitReadiness lets an explicit review approval bypass only the score floor', async () => {
  const result = await validateLiveSubmitReadiness({
    config: { profileName: 'sister', applicationReviewScoreFloor: 70 },
    profile: {
      skills: ['customer support', 'administrative support', 'CRM', 'calendar management'],
      preferredRoles: ['Administrative Assistant', 'Customer Support Specialist']
    },
    job: {
      title: 'Executive Assistant',
      description: 'Remote executive support including calendar management, customer communication, CRM updates, and administrative coordination.',
      source_site: 'bruntwork',
      raw: { remote: true }
    },
    existing: {
      score: 66,
      local: { score: 72 },
      acceptedViaTelegram: true,
      optimizer: { application_score: 66, risk_flags: [] }
    }
  });

  assert.equal(result.ready, true);
});

test('validateLiveSubmitReadiness allows restaged profile-aligned jobs above 55 despite noisy local rescore', async () => {
  const result = await validateLiveSubmitReadiness({
    config: {
      profileName: 'tolu',
      applicationReviewScoreFloor: 55
    },
    profile: {
      skills: ['SEO', 'Technical SEO', 'Shopify', 'WordPress', 'JavaScript'],
      preferredRoles: ['SEO Specialist', 'Website Administrator']
    },
    job: {
      title: 'Marketing Coordinator (Content, SEO & Growth Execution)',
      description: 'Remote BruntWork role focused on content, SEO, and growth execution.',
      requirements: '',
      source_site: 'bruntwork',
      raw: { remote: true }
    },
    existing: {
      score: 60,
      decision: 'apply',
      acceptedViaTelegram: true,
      reason: 'Restaged for live retry'
    }
  });

  assert.equal(result.ready, true);
});

test('validateLiveSubmitReadiness blocks non-remote live submissions', async () => {
  const result = await validateLiveSubmitReadiness({
    config: {
      profileName: 'tolu',
      applicationReviewScoreFloor: 55
    },
    profile: {
      skills: ['JavaScript', 'React Native', 'web development'],
      preferredRoles: ['Mobile Application Developer']
    },
    job: {
      title: 'Mobile Application Developer',
      location: 'Lagos',
      description: 'Build Android and iOS applications in the Lagos office.',
      source_site: 'jobberman'
    },
    existing: {
      score: 80,
      acceptedViaTelegram: true,
      optimizer: { application_score: 80, risk_flags: [] }
    }
  });

  assert.equal(result.ready, false);
  assert.match(result.reason, /remote-only/i);
});

test('validateLiveSubmitReadiness treats BruntWork as trusted remote source', async () => {
  const result = await validateLiveSubmitReadiness({
    config: {
      profileName: 'tolu',
      applicationReviewScoreFloor: 55
    },
    profile: {
      skills: ['SEO', 'WordPress', 'Shopify'],
      preferredRoles: ['SEO Specialist']
    },
    job: {
      title: 'SEO Specialist',
      description: 'Improve websites, content, WordPress, Shopify, and technical SEO.',
      source_site: 'bruntwork'
    },
    existing: {
      score: 80,
      acceptedViaTelegram: true,
      optimizer: { application_score: 80, risk_flags: [] }
    }
  });

  assert.equal(result.ready, true);
});

test('validateLiveSubmitReadiness trusts remote-only feed sources', async () => {
  for (const source_site of ['himalayas', 'weworkremotely', 'workingnomads', 'realworkfromanywhere']) {
    assert.equal(
      isRemoteEligibleForLiveSubmit({ source_site, title: 'Sparse stored role' }),
      true,
      `${source_site} should retain its remote policy`
    );
  }
});

test('validateLiveSubmitReadiness lets explicit approval override stale AI rejection above floor', async () => {
  const result = await validateLiveSubmitReadiness({
    config: {
      profileName: 'sister',
      applicationReviewScoreFloor: 55
    },
    profile: {
      skills: ['customer support', 'administrative support', 'CRM'],
      preferredRoles: ['Administrative Assistant', 'Customer Support Specialist']
    },
    job: {
      title: 'Administrative & Booking Coordinator',
      description: 'Remote calendar coordination, admin support, customer communication, and CRM updates.',
      source_site: 'bruntwork',
      raw: { remote: true }
    },
    existing: {
      score: 61,
      acceptedViaTelegram: true,
      gemini: { should_apply: false },
      optimizer: { application_score: 61, risk_flags: [] }
    }
  });

  assert.equal(result.ready, true);
});
