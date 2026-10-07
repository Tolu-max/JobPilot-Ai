import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseScraper } from './baseScraper.js';
import { classifyApplyUrl } from '../adapters/atsResolver.js';

// Glassdoor's public site is not crawled here. This local import adapter lets
// the user supply a role record they are entitled to use, then hands only an
// audited employer ATS URL into JobPilot's existing matching/apply pipeline.
export class GlassdoorImportScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('glassdoor', config, siteConfig);
  }

  async fetchJobs() {
    const configuredPath = this.siteConfig.importPath || 'glassdoor-import.json';
    const importPath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(this.config.profileDir || process.cwd(), configuredPath);
    let payload;
    try {
      payload = JSON.parse(await fs.readFile(importPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') await this.log(`Local role import could not be read: ${error.message}`);
      return [];
    }

    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.jobs) ? payload.jobs : [];
    const accepted = [];
    for (const [index, row] of rows.entries()) {
      if (!row || typeof row !== 'object') continue;
      const applicationUrl = String(row.applicationUrl || row.applyUrl || '').trim();
      const classification = classifyApplyUrl(applicationUrl, { source: 'glassdoor' });
      if (!row.title || !classification.supported || !classification.audited || classification.kind === 'gateway') {
        await this.log(`Import row ${index + 1} skipped: provide a title and direct audited ATS applicationUrl.`);
        continue;
      }
      accepted.push({
        ...row,
        source: 'glassdoor',
        source_site: 'glassdoor',
        sourceJobId: row.sourceJobId || row.glassdoorUrl || applicationUrl,
        applicationUrl,
        raw: { ...row, source: 'glassdoor-local-import', downstreamAdapter: classification.adapter }
      });
    }
    return accepted;
  }
}

export async function scrapeGlassdoorJobs(config, siteConfig = {}) {
  return new GlassdoorImportScraper(config, siteConfig).scrape();
}
