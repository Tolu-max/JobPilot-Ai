import { BaseScraper } from './baseScraper.js';

export class PlannedScraper extends BaseScraper {
  constructor(siteName, config, siteConfig, note) {
    super(siteName, config, siteConfig);
    this.note = note;
  }

  async fetchJobs() {
    await this.log(`Adapter scaffold is ready but fetching is not enabled yet. ${this.note || ''}`.trim());
    return [];
  }
}
