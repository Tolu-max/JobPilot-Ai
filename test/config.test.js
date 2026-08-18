import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildConfig, parseSiteList, resolveStoredProfilePath } from '../src/config.js';

test('site list parser splits profile array entries before normalizing names', () => {
  assert.deepEqual(
    parseSiteList(['bruntwork, jobberman, himalayas, remotive, remotejobsorg, remoteok']),
    ['bruntwork', 'jobberman', 'himalayas', 'remotive', 'remotejobsorg', 'remoteok']
  );
});

test('site list parser accepts alternate separators used in env or dashboard inputs', () => {
  assert.deepEqual(
    parseSiteList(['remoteok|remotive;remotejobsorg jobberman']),
    ['remoteok', 'remotive', 'remotejobsorg', 'jobberman']
  );
});

test('profile-scoped site env overrides configure greenhouse safely', () => {
  const snapshot = {
    SISTER_ENABLED_SITES: process.env.SISTER_ENABLED_SITES,
    SISTER_GREENHOUSE_BOARDS: process.env.SISTER_GREENHOUSE_BOARDS,
    SISTER_GREENHOUSE_INCLUDE_TITLE_KEYWORDS: process.env.SISTER_GREENHOUSE_INCLUDE_TITLE_KEYWORDS,
    SISTER_GREENHOUSE_EXCLUDE_KEYWORDS: process.env.SISTER_GREENHOUSE_EXCLUDE_KEYWORDS,
    SISTER_GREENHOUSE_REMOTE_ONLY: process.env.SISTER_GREENHOUSE_REMOTE_ONLY,
    SISTER_GREENHOUSE_AUTO_APPLY_ENABLED: process.env.SISTER_GREENHOUSE_AUTO_APPLY_ENABLED
  };

  try {
    process.env.SISTER_ENABLED_SITES = 'greenhouse';
    process.env.SISTER_GREENHOUSE_BOARDS = 'typeform,asana';
    process.env.SISTER_GREENHOUSE_INCLUDE_TITLE_KEYWORDS = 'support, assistant, customer';
    process.env.SISTER_GREENHOUSE_EXCLUDE_KEYWORDS = 'engineer, developer';
    process.env.SISTER_GREENHOUSE_REMOTE_ONLY = 'true';
    process.env.SISTER_GREENHOUSE_AUTO_APPLY_ENABLED = 'false';

    const config = buildConfig(['node', 'jobpilot', '--profile=sister']);

    assert.deepEqual(config.enabledSites, ['greenhouse']);
    assert.deepEqual(config.sites.greenhouse.boards, ['typeform', 'asana']);
    assert.deepEqual(config.sites.greenhouse.includeTitleKeywords, ['support', 'assistant', 'customer']);
    assert.deepEqual(config.sites.greenhouse.excludeKeywords, ['engineer', 'developer']);
    assert.equal(config.sites.greenhouse.remoteOnly, true);
    assert.equal(config.sites.greenhouse.autoApplyEnabled, false);
  } finally {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('new sources stay disabled by default and only audited feeds may auto-apply', () => {
  const config = buildConfig(['node', 'jobpilot']);

  for (const site of ['jobicy', 'themuse', 'arbeitnow', 'dailyremote', 'workingnomads', 'realworkfromanywhere']) {
    assert.equal(config.sites[site].enabled, false, `${site} should be disabled by default in active source policy`);
    assert.equal(config.sites[site].maxAgeDays, 14, `${site} should default to a 14 day age limit`);
  }
});

test('railway runtime defaults to bounded generated artifacts', () => {
  const snapshot = {
    RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT,
    DEBUG_ARTIFACTS_ENABLED: process.env.DEBUG_ARTIFACTS_ENABLED,
    JOBPILOT_RETENTION_ENABLED: process.env.JOBPILOT_RETENTION_ENABLED
  };

  try {
    process.env.RAILWAY_ENVIRONMENT = 'production';
    delete process.env.DEBUG_ARTIFACTS_ENABLED;
    delete process.env.JOBPILOT_RETENTION_ENABLED;

    const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);

    assert.equal(config.railwayLike, true);
    assert.equal(config.debugArtifactsEnabled, false);
    assert.equal(config.retentionEnabled, true);
    assert.equal(config.debugRetentionMaxDirs, 25);
    assert.match(config.eventsDir, /events$/);
  } finally {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('stored profile paths stay relative when the target lives inside the profile folder', () => {
  const profileDir = path.join(process.cwd(), 'profiles', 'portable');
  const absoluteResume = path.join(profileDir, 'resume.pdf');
  const stored = resolveStoredProfilePath(process.cwd(), profileDir, absoluteResume);

  assert.equal(stored.storedValue, 'resume.pdf');
  assert.equal(stored.absolutePath, absoluteResume);
  assert.equal(stored.isPortable, true);
});

test('stored profile paths remain flagged when they point outside the profile folder', () => {
  const profileDir = path.join(process.cwd(), 'profiles', 'portable');
  const externalResume = path.join(process.cwd(), 'TEMILOLUWA RUTH OYELOLA (CV) - COMPLETE.pdf');
  const stored = resolveStoredProfilePath(process.cwd(), profileDir, externalResume);

  assert.equal(stored.storedValue, externalResume);
  assert.equal(stored.absolutePath, externalResume);
  assert.equal(stored.isPortable, false);
});
