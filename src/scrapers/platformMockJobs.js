import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BaseScraper } from './baseScraper.js';

const platformTemplates = [
  {
    slug: 'seo-shopify',
    title: 'Technical SEO and Shopify Specialist',
    companySuffix: 'Digital',
    location: 'Remote',
    jobType: 'Part-time',
    description:
      'Remote role improving technical SEO, Shopify product visibility, WordPress content, Core Web Vitals, HTML, CSS, JavaScript, and e-commerce performance.',
    requirements: 'SEO, Technical SEO, Shopify, WordPress, HTML, CSS, JavaScript, Google Analytics',
    responsibilities:
      'Maintain product pages, improve site speed, publish content updates, and report SEO improvements each week.',
    requiredSkills: ['SEO', 'Technical SEO', 'Shopify', 'WordPress', 'HTML', 'CSS', 'JavaScript'],
    tags: ['remote', 'seo', 'shopify', 'web']
  },
  {
    slug: 'support-crm',
    title: 'Customer Support and CRM Assistant',
    companySuffix: 'Operations',
    location: 'Remote',
    jobType: 'Full-time',
    description:
      'Remote customer support role handling email support, live chat support, CRM updates, calendar management, Google Workspace, Microsoft Office, and accurate data entry.',
    requirements: 'Customer Support, Email Support, Live Chat Support, CRM, Data Entry, Calendar Management',
    responsibilities:
      'Respond to customer inquiries, update CRM records, manage inbox follow-ups, coordinate schedules, and keep operational notes accurate.',
    requiredSkills: ['Customer Support', 'Email Support', 'Live Chat Support', 'CRM', 'Data Entry'],
    tags: ['remote', 'support', 'crm', 'admin']
  },
  {
    slug: 'hard-filter',
    title: 'Senior Sales Director with Security Clearance',
    companySuffix: 'Enterprise',
    location: 'United States',
    jobType: 'Full-time',
    description:
      'Senior director role requiring cold calling, inside sales leadership, security clearance required, and authorized to work in the United States.',
    requirements: 'US work authorization, security clearance required, 7 years sales leadership, cold calling',
    responsibilities: 'Lead enterprise sales, own quota strategy, and manage outbound teams.',
    requiredSkills: ['Sales', 'Leadership'],
    tags: ['onsite', 'senior', 'sales']
  }
];

export async function createPlatformMockJobs(site, config = {}, siteConfig = {}) {
  const limit = Math.min(resolveLimit(config, siteConfig), 3);
  const fixtureDir = path.resolve(config.rootDir || process.cwd(), 'test-artifacts', '_platform-fixtures', site);
  await fs.mkdir(fixtureDir, { recursive: true });

  const scraper = new BaseScraper(site, config, { maxJobsPerRun: 0 });
  const jobs = [];

  for (const [index, template] of platformTemplates.entries()) {
    const formPath = path.join(fixtureDir, `${String(index + 1).padStart(2, '0')}-${template.slug}.html`);
    await fs.writeFile(formPath, renderApplicationForm(site, template), 'utf8');
    jobs.push(
      scraper.normalizeJob({
        ...template,
        source: site,
        source_site: site,
        sourceJobId: `platform-${site}-${template.slug}`,
        company: `${displaySite(site)} ${template.companySuffix}`,
        applicationUrl: pathToFileURL(formPath).toString(),
        postedAt: new Date().toISOString(),
        raw: {
          platformMock: true,
          site,
          template: template.slug
        }
      })
    );
  }

  return jobs.slice(0, limit);
}

function resolveLimit(config, siteConfig) {
  const siteLimit = Number.parseInt(siteConfig.maxJobsPerRun, 10);
  if (Number.isFinite(siteLimit) && siteLimit > 0) return siteLimit;

  const globalLimit = Number.parseInt(config.maxJobsPerRun, 10);
  if (Number.isFinite(globalLimit) && globalLimit > 0) return globalLimit;

  return 3;
}

function renderApplicationForm(site, job) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(job.title)} - ${escapeHtml(displaySite(site))}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; line-height: 1.5; color: #17202a; }
    main { max-width: 760px; margin: 0 auto; }
    label { display: block; margin: 16px 0 6px; font-weight: 700; }
    input, textarea { box-sizing: border-box; width: 100%; padding: 10px; border: 1px solid #b8c2cc; border-radius: 6px; font: inherit; }
    textarea { min-height: 120px; }
    button { margin-top: 18px; padding: 10px 16px; border: 0; border-radius: 6px; background: #184e77; color: #fff; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(job.title)}</h1>
    <p>${escapeHtml(job.description)}</p>
    <form>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required />
      <label for="resume">Resume</label>
      <input id="resume" name="resume" type="file" />
      <label for="cover">Cover letter</label>
      <textarea id="cover" name="cover_letter"></textarea>
      <label for="why_fit">Why are you a good fit?</label>
      <textarea id="why_fit" name="why_fit"></textarea>
      <button type="submit">Submit Application</button>
    </form>
  </main>
</body>
</html>
`;
}

function displaySite(site) {
  return String(site || 'Platform')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
