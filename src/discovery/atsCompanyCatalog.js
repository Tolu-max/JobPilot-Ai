import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CATALOG_PATH = path.resolve(__dirname, '../../data/ats_companies_catalog.json');

export function loadAtsCatalog() {
  try {
    if (!fs.existsSync(CATALOG_PATH)) {
      return { version: '1.0.0', platforms: {} };
    }
    const raw = fs.readFileSync(CATALOG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { version: '1.0.0', platforms: {} };
  }
}

export function getPlatformCompanies(platform, options = {}) {
  const catalog = loadAtsCatalog();
  const platKey = String(platform || '').toLowerCase().trim();
  const entry = catalog.platforms?.[platKey];
  if (!entry || !Array.isArray(entry.companies)) {
    return [];
  }

  let list = entry.companies;
  if (options.targetProfile) {
    const target = String(options.targetProfile).toLowerCase().trim();
    list = list.filter((c) => Array.isArray(c.target) && c.target.includes(target));
  }

  if (options.tag) {
    const tag = String(options.tag).toLowerCase().trim();
    list = list.filter((c) => Array.isArray(c.tags) && c.tags.includes(tag));
  }

  return list;
}

export function getPlatformBoardSlugs(platform, options = {}) {
  const companies = getPlatformCompanies(platform, options);
  return companies.map((c) => c.slug).filter(Boolean);
}

export function getAllTrackedPlatforms() {
  const catalog = loadAtsCatalog();
  return Object.keys(catalog.platforms || {});
}

export function getCompanyStats() {
  const catalog = loadAtsCatalog();
  const stats = { totalCompanies: 0, byPlatform: {}, byTarget: { tolu: 0, sister: 0 } };
  for (const [key, plat] of Object.entries(catalog.platforms || {})) {
    const count = plat.companies?.length || 0;
    stats.byPlatform[key] = count;
    stats.totalCompanies += count;
    for (const comp of plat.companies || []) {
      if (comp.target?.includes('tolu')) stats.byTarget.tolu += 1;
      if (comp.target?.includes('sister')) stats.byTarget.sister += 1;
    }
  }
  return stats;
}
