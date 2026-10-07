import fs from 'node:fs/promises';
import path from 'node:path';
import { scraperRegistry } from '../src/scrapers/index.js';

const rootDir = process.cwd();
const configPath = path.join(rootDir, 'config', 'sites.json');
const rawConfig = await fs.readFile(configPath, 'utf8');
const siteConfig = JSON.parse(rawConfig);

const registrySites = Object.keys(scraperRegistry).sort();
const configuredSites = Object.keys(siteConfig).sort();
const duplicateConfigKeys = findDuplicateTopLevelKeys(rawConfig);
const missingConfig = registrySites.filter((site) => !configuredSites.includes(site));
const unknownConfig = configuredSites.filter((site) => !registrySites.includes(site));
const enabledUnimplemented = configuredSites.filter((site) =>
  siteConfig[site]?.enabled && scraperRegistry[site]?.implemented !== true
);
const enabledSites = configuredSites.filter((site) => siteConfig[site]?.enabled);

const rows = registrySites.map((site) => ({
  site,
  configured: configuredSites.includes(site),
  enabled: Boolean(siteConfig[site]?.enabled),
  implemented: Boolean(scraperRegistry[site]?.implemented),
  autoApply: Boolean(siteConfig[site]?.autoApplyEnabled),
  priority: siteConfig[site]?.priority ?? ''
}));

console.log('JobPilot scraper readiness');
console.log(`Registered: ${registrySites.length}`);
console.log(`Configured: ${configuredSites.length}`);
console.log(`Enabled:    ${enabledSites.length}`);
console.log();

for (const row of rows) {
  const status = row.implemented ? 'implemented' : 'planned';
  const enabled = row.enabled ? 'enabled' : 'disabled';
  const configured = row.configured ? 'configured' : 'missing-config';
  console.log(`${row.site.padEnd(16)} ${status.padEnd(12)} ${enabled.padEnd(9)} ${configured.padEnd(15)} priority=${row.priority}`);
}

const failures = [];
if (duplicateConfigKeys.length) failures.push(`Duplicate config keys: ${duplicateConfigKeys.join(', ')}`);
if (missingConfig.length) failures.push(`Missing site config: ${missingConfig.join(', ')}`);
if (unknownConfig.length) failures.push(`Unknown configured sites: ${unknownConfig.join(', ')}`);
if (enabledUnimplemented.length) failures.push(`Enabled but unimplemented: ${enabledUnimplemented.join(', ')}`);

if (failures.length > 0) {
  console.log();
  console.error('Scraper readiness failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log();
  console.log('Scraper readiness passed.');
}

function findDuplicateTopLevelKeys(raw) {
  const counts = new Map();
  const matches = raw.matchAll(/^  "([^"]+)":\s*\{/gm);
  for (const match of matches) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
}
