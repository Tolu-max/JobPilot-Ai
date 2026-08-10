import fs from 'node:fs/promises';
import path from 'node:path';
import * as pdfParseModule from 'pdf-parse';
import { compactText } from './utils.js';

const PDFParse = pdfParseModule.PDFParse
  || pdfParseModule.default
  || pdfParseModule.pdfParse;

if (typeof PDFParse !== 'function') {
  throw new TypeError('pdf-parse did not expose a usable PDFParse constructor.');
}

const knownSkills = [
  'SEO',
  'Technical SEO',
  'Shopify',
  'WordPress',
  'Web Development',
  'JavaScript',
  'Node.js',
  'Content Systems',
  'YouTube Automation',
  'Digital Marketing',
  'HTML',
  'CSS',
  'Google Analytics',
  'E-Commerce',
  'Customer Support',
  'Email Support',
  'Live Chat Support',
  'Administrative Support',
  'Virtual Assistance',
  'CRM',
  'Data Entry',
  'Calendar Management',
  'Google Workspace',
  'Microsoft Office'
];

export async function loadOrBuildCandidateProfile(config) {
  await fs.mkdir(path.dirname(config.candidateProfilePath), { recursive: true });

  let profile = await readJson(config.candidateProfilePath, null);
  if (!profile) {
    profile = defaultProfile(config.profileName);
  }

  profile = mergeProfilePreferences(profile, config.preferences);

  const resumeText = config.resumePlaceholder ? '' : await readResumeText(config.resumePath);
  if (resumeText) {
    profile = mergeProfileWithResume(profile, resumeText, config.resumePath);
    await saveCandidateProfile(config, profile);
  }

  return profile;
}

export async function saveCandidateProfile(config, profile) {
  const next = {
    ...profile,
    lastUpdated: new Date().toISOString()
  };
  await fs.writeFile(config.candidateProfilePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export async function updateProfileLearning(config, outcome) {
  const profile = await loadOrBuildCandidateProfile(config);
  const key = outcome.job?.applicationUrl;
  if (!key) return;

  if (outcome.status === 'ignored') {
    profile.rejectedJobs = upsertLearning(profile.rejectedJobs, outcome);
  }
  if (['applied', 'reviewed'].includes(outcome.status)) {
    profile.successfulMatches = upsertLearning(profile.successfulMatches, outcome);
  }

  await saveCandidateProfile(config, profile);
}

export async function readResumeText(resumePath) {
  try {
    const parser = new PDFParse({ data: await fs.readFile(resumePath) });
    const parsed = await parser.getText();
    await parser.destroy();
    return compactText(parsed.text);
  } catch {
    return '';
  }
}

function mergeProfileWithResume(profile, resumeText, resumePath) {
  const foundSkills = knownSkills.filter((skill) => skillInText(skill, resumeText));
  const skills = Array.from(new Set([...(profile.skills || []), ...foundSkills]));
  const preferredRoles = Array.from(new Set([...(profile.preferredRoles || []), ...detectPreferredRoles(resumeText)]));

  return {
    ...profile,
    sourceResume: path.basename(resumePath),
    resumeTextPreview: resumeText.slice(0, 1200),
    skills,
    preferredRoles,
    strengths: Array.from(new Set([...(profile.strengths || []), ...foundSkills]))
  };
}

function detectPreferredRoles(text) {
  const roles = [];
  if (/seo/i.test(text)) roles.push('SEO Specialist', 'Technical SEO Specialist');
  if (/shopify|e-?commerce/i.test(text)) roles.push('Shopify Specialist', 'E-Commerce Specialist');
  if (/web|javascript|node/i.test(text)) roles.push('Web Developer', 'Website Administrator');
  if (/youtube|content/i.test(text)) roles.push('Content Systems Specialist', 'YouTube Automation Specialist');
  if (/customer support|customer service|client support/i.test(text)) roles.push('Customer Support Specialist');
  if (/admin|administrative|virtual assistant|executive assistant/i.test(text)) roles.push('Administrative Assistant', 'Virtual Assistant');
  if (/crm|hubspot|salesforce|zoho/i.test(text)) roles.push('CRM Assistant');
  return roles;
}

function skillInText(skill, text) {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/\\ /g, '\\s+'), 'i').test(text);
}

function upsertLearning(items = [], outcome) {
  const next = items.filter((item) => item.jobUrl !== outcome.job.applicationUrl);
  next.push({
    jobUrl: outcome.job.applicationUrl,
    title: outcome.job.title,
    status: outcome.status,
    score: outcome.score,
    updatedAt: new Date().toISOString()
  });
  return next.slice(-100);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function mergeProfilePreferences(profile, preferences = {}) {
  return {
    ...profile,
    remotePreference: profile.remotePreference || preferences.remotePreference || 'prefer_remote',
    targetSeniorities: union(profile.targetSeniorities, preferences.targetSeniorities),
    hardFilters: union(profile.hardFilters, preferences.hardFilters),
    exclusions: union(profile.exclusions, preferences.exclusions),
    titleExclusions: union(profile.titleExclusions, preferences.titleExclusions)
  };
}

function union(left = [], right = []) {
  return Array.from(new Set([...(left || []), ...(right || [])].filter(Boolean)));
}

function defaultProfile(profileName = 'tolu') {
  if (profileName === 'sister') {
    return {
      name: 'Sister',
      portfolioLinks: [],
      skills: [
        'Customer Support',
        'Email Support',
        'Live Chat Support',
        'Administrative Support',
        'Virtual Assistance',
        'CRM',
        'Data Entry',
        'Calendar Management',
        'Google Workspace',
        'Microsoft Office'
      ],
      strengths: ['Clear communication', 'Organized admin support', 'Customer care', 'CRM updates'],
      weaknesses: [],
      preferredRoles: ['Customer Support Specialist', 'Virtual Assistant', 'Administrative Assistant', 'CRM Assistant'],
      secondaryRoles: ['Data Entry Specialist', 'Operations Assistant', 'Client Success Assistant'],
      experienceKeywords: ['customer support', 'admin support', 'crm', 'email support', 'data entry'],
      remotePreference: 'prefer_remote',
      targetSeniorities: ['entry', 'junior', 'mid'],
      rejectedJobs: [],
      successfulMatches: []
    };
  }

  return {
    name: 'Toluwalope Oyelola',
    portfolioLinks: [],
    skills: knownSkills.slice(0, 10),
    strengths: ['Web development', 'SEO optimization', 'Shopify optimization'],
    weaknesses: [],
    preferredRoles: ['SEO Specialist', 'Shopify Specialist', 'Web Developer'],
    secondaryRoles: ['Content Manager', 'Marketplace Listing Specialist'],
    experienceKeywords: ['web development', 'technical seo', 'shopify', 'automation', 'content systems'],
    remotePreference: 'prefer_remote',
    targetSeniorities: ['entry', 'junior', 'mid'],
    rejectedJobs: [],
    successfulMatches: []
  };
}
