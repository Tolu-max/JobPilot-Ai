import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import mammoth from 'mammoth';
import * as pdfParseModule from 'pdf-parse';

const PDFParse = pdfParseModule.PDFParse
  || pdfParseModule.default
  || pdfParseModule.pdfParse;

if (typeof PDFParse !== 'function') {
  throw new TypeError('pdf-parse did not expose a usable PDFParse constructor.');
}

const SKILL_CATALOG = [
  'JavaScript', 'TypeScript', 'React', 'Next.js', 'Node.js', 'Express',
  'HTML', 'CSS', 'Tailwind', 'SEO', 'Technical SEO', 'Shopify', 'WordPress',
  'Google Analytics', 'Content Marketing', 'Email Support', 'Customer Support',
  'Live Chat', 'CRM', 'HubSpot', 'Salesforce', 'Data Entry', 'Microsoft Office',
  'Google Workspace', 'Project Management', 'Virtual Assistance'
];

export async function extractResumeIntelligence(resumePath, config = {}) {
  const absolutePath = path.isAbsolute(resumePath)
    ? resumePath
    : path.resolve(process.cwd(), resumePath);

  const buffer = await fs.readFile(absolutePath);
  const sourceHash = createHash('sha256').update(buffer).digest('hex');
  const ext = path.extname(absolutePath).toLowerCase();
  const extraction = await extractResumeText(buffer, ext);
  const localProfile = structureResumeLocally(extraction.text);

  let aiProfile = null;
  if (shouldUseAi(config, extraction.text)) {
    aiProfile = await structureResumeWithGemini(extraction.text, config).catch(() => null);
  }

  return {
    ...mergeProfiles(localProfile, aiProfile),
    source: {
      path: absolutePath,
      filename: path.basename(absolutePath),
      hash: sourceHash,
      type: ext.replace('.', '') || 'unknown',
      extractionMethod: extraction.method,
      textLength: extraction.text.length,
      needsOcr: extraction.needsOcr
    },
    rawTextPreview: extraction.text.slice(0, 2000),
    parsedAt: new Date().toISOString()
  };
}

export async function extractResumeText(buffer, ext = '') {
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText().finally(() => parser.destroy());
    const text = cleanText(parsed.text || '');
    return {
      text,
      method: text.length < 200 ? 'pdf-local-low-text' : 'pdf-local',
      needsOcr: text.length < 200
    };
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: cleanText(result.value || ''),
      method: 'docx-local',
      needsOcr: false
    };
  }

  const text = cleanText(buffer.toString('utf8'));
  return {
    text,
    method: 'txt-local',
    needsOcr: text.length < 50
  };
}

export function structureResumeLocally(text = '') {
  const compact = cleanText(text);
  const lines = compact.split('\n').map((line) => line.trim()).filter(Boolean);
  const email = compact.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null;
  const phone = compact.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() || null;
  const linkedin = compact.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i)?.[0] || null;
  const github = compact.match(/https?:\/\/(?:www\.)?github\.com\/[^\s)]+/i)?.[0] || null;
  const skills = SKILL_CATALOG.filter((skill) => hasPhrase(compact, skill));
  const jobTitles = extractJobTitles(compact);

  return {
    name: inferName(lines, email),
    email,
    phone,
    location: inferLocation(lines),
    linkedin,
    github,
    website: inferWebsite(compact, linkedin, github),
    jobTitle: jobTitles[0] || null,
    jobTitles,
    summary: inferSummary(lines),
    yearsOfExperience: inferYearsOfExperience(compact),
    skills,
    industries: inferIndustries(compact),
    strengths: skills.slice(0, 8),
    weaknesses: [],
    workHistory: [],
    education: [],
    certifications: [],
    languages: inferLanguages(compact),
    extractionConfidence: compact.length > 500 ? 'medium' : 'low'
  };
}

function shouldUseAi(config, text) {
  if (config.aiMode === 'MOCK') return false;
  if (!text || text.length < 200) return false;
  return Boolean(config.geminiApiKey || process.env.GEMINI_API_KEY);
}

async function structureResumeWithGemini(text, config) {
  const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
  const model = config.geminiModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  const prompt = `Return only valid JSON. Structure this resume text into candidate data with keys: name, email, phone, location, linkedin, github, website, jobTitle, summary, yearsOfExperience, skills, industries, strengths, weaknesses, workHistory, education, certifications, languages.\n\nResume:\n${text.slice(0, 18000)}`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1800 }
    })
  });

  if (!res.ok) throw new Error(`Gemini resume structure HTTP ${res.status}`);
  const data = await res.json();
  const output = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  return parseJsonFromText(output);
}

function mergeProfiles(localProfile, aiProfile) {
  if (!aiProfile) return localProfile;
  return {
    ...localProfile,
    ...aiProfile,
    skills: union(localProfile.skills, aiProfile.skills),
    strengths: union(localProfile.strengths, aiProfile.strengths),
    weaknesses: union(localProfile.weaknesses, aiProfile.weaknesses),
    jobTitles: union(localProfile.jobTitles, aiProfile.jobTitles),
    industries: union(localProfile.industries, aiProfile.industries),
    extractionConfidence: 'high'
  };
}

function parseJsonFromText(text) {
  try { return JSON.parse(text); } catch {}
  const fenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(fenced); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new Error('No JSON object found in AI resume response');
}

function cleanText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasPhrase(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s+');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function inferName(lines, email) {
  const candidate = lines.find((line) =>
    line.length >= 3 &&
    line.length <= 80 &&
    !line.includes('@') &&
    !/resume|curriculum|phone|email|linkedin/i.test(line)
  );
  if (candidate) return candidate.replace(/[|]/g, '').trim();
  return email ? email.split('@')[0].replace(/[._-]+/g, ' ') : null;
}

function inferLocation(lines) {
  return lines.find((line) => /lagos|abuja|nigeria|remote|london|usa|united states|canada|uk/i.test(line)) || null;
}

function inferSummary(lines) {
  return lines.find((line) => line.length > 80 && line.length < 300) || '';
}

function inferWebsite(text, linkedin, github) {
  const urls = text.match(/https?:\/\/[^\s)]+/gi) || [];
  return urls.find((url) => url !== linkedin && url !== github) || null;
}

function inferYearsOfExperience(text) {
  const explicit = text.match(/(\d+)\+?\s+years?(?:\s+of)?\s+experience/i);
  if (explicit) return Number.parseInt(explicit[1], 10);
  return null;
}

function extractJobTitles(text) {
  const titles = [
    'SEO Specialist', 'Technical SEO Specialist', 'Frontend Developer',
    'Full Stack Developer', 'Web Developer', 'Shopify Specialist',
    'Customer Support Specialist', 'Virtual Assistant', 'Administrative Assistant',
    'Content Manager', 'Digital Marketer', 'CRM Assistant'
  ];
  return titles.filter((title) => hasPhrase(text, title));
}

function inferIndustries(text) {
  const industries = [];
  if (/seo|content|analytics|marketing/i.test(text)) industries.push('Marketing');
  if (/shopify|e-?commerce|woocommerce/i.test(text)) industries.push('E-Commerce');
  if (/customer support|client success|crm/i.test(text)) industries.push('Customer Operations');
  if (/javascript|react|node|web development/i.test(text)) industries.push('Software/Web');
  return industries;
}

function inferLanguages(text) {
  const languages = [];
  if (/english/i.test(text)) languages.push('English');
  if (/yoruba/i.test(text)) languages.push('Yoruba');
  return languages;
}

function union(left = [], right = []) {
  return Array.from(new Set([...(left || []), ...(right || [])].filter(Boolean)));
}
