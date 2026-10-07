import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadAtsCatalog,
  getPlatformCompanies,
  getPlatformBoardSlugs,
  getAllTrackedPlatforms,
  getCompanyStats
} from '../src/discovery/atsCompanyCatalog.js';

test('atsCompanyCatalog: loads catalog and verifies all 7 supported platforms', () => {
  const catalog = loadAtsCatalog();
  assert.ok(catalog.platforms, 'Platforms root exists');
  const platforms = getAllTrackedPlatforms();
  const expected = ['workable', 'bamboohr', 'breezyhr', 'smartrecruiters', 'ashby', 'greenhouse', 'lever'];
  for (const plat of expected) {
    assert.ok(platforms.includes(plat), `Platform ${plat} is tracked in catalog`);
  }
});

test('atsCompanyCatalog: filters companies by target profile', () => {
  const toluGreenhouse = getPlatformCompanies('greenhouse', { targetProfile: 'tolu' });
  assert.ok(toluGreenhouse.length > 0, 'Tolu has Greenhouse companies');
  assert.ok(toluGreenhouse.some((c) => c.slug === 'pressable'), 'Pressable is in Tolu list');
  assert.ok(toluGreenhouse.some((c) => c.slug === 'fueled'), 'Fueled is in Tolu list');

  const sisterGreenhouse = getPlatformCompanies('greenhouse', { targetProfile: 'sister' });
  assert.ok(sisterGreenhouse.length > 0, 'Sister has Greenhouse companies');
  assert.ok(sisterGreenhouse.some((c) => c.slug === '5ca'), '5CA is in Sister list');
  assert.ok(sisterGreenhouse.some((c) => c.slug === 'alxafrica'), 'ALX Africa is in Sister list');
});

test('atsCompanyCatalog: getPlatformBoardSlugs returns clean slug strings', () => {
  const slugs = getPlatformBoardSlugs('workable');
  assert.ok(Array.isArray(slugs), 'Slugs is an array');
  assert.ok(slugs.includes('kobotoolbox'), 'kobotoolbox slug exists');
  assert.ok(slugs.includes('wati'), 'wati slug exists');
  assert.ok(slugs.includes('supportyourapp'), 'supportyourapp slug exists');
});

test('atsCompanyCatalog: getCompanyStats computes correct counts across all platforms', () => {
  const stats = getCompanyStats();
  assert.ok(stats.totalCompanies >= 80, `Tracked companies (${stats.totalCompanies}) >= 80`);
  assert.ok(stats.byTarget.tolu >= 50, `Tolu companies (${stats.byTarget.tolu}) >= 50`);
  assert.ok(stats.byTarget.sister >= 25, `Sister companies (${stats.byTarget.sister}) >= 25`);
});
