import { compactText } from './utils.js';
import aiRouter, { TaskTypes } from './aiRouter.js';

const defaultHardFilters = [
  'u.s. work authorization',
  'us work authorization',
  'authorized to work in the united states',
  'us citizen',
  'security clearance required'
];

const defaultSkillAliases = {
  SEO: ['seo', 'search engine optimization'],
  'Technical SEO': ['technical seo', 'site audit', 'schema markup', 'core web vitals'],
  Shopify: ['shopify'],
  WordPress: ['wordpress', 'wp'],
  'Web Development': ['web development', 'website admin', 'website administrator', 'web support', 'html', 'css'],
  JavaScript: ['javascript', 'js'],
  'Node.js': ['node.js', 'nodejs', 'node'],
  'Content Systems': ['content system', 'cms', 'content management'],
  'YouTube Automation': ['youtube', 'video workflow', 'video automation'],
  'Digital Marketing': ['digital marketing', 'email marketing', 'mailchimp', 'social media marketing'],
  'Customer Support': ['customer support', 'customer service', 'client support', 'customer success', 'support specialist', 'support clerk', 'support agent', 'support representative', 'helpdesk', 'help desk'],
  'Email Support': ['email support', 'inbox management', 'support tickets', 'ticket management', 'email handling'],
  'Live Chat Support': ['live chat', 'chat support', 'intercom', 'zendesk chat', 'chat agent', 'chat clerk'],
  'Administrative Support': ['administrative support', 'admin assistant', 'executive assistant', 'operations coordinator', 'office assistant', 'office admin', 'office manager', 'admin support', 'clerical', 'clerk', 'receptionist', 'front desk'],
  'Virtual Assistance': ['virtual assistant', 'va', 'remote assistant', 'personal assistant', 'executive assistant', 'appointment setter', 'appointment setting'],
  CRM: ['crm', 'hubspot', 'salesforce', 'zoho', 'pipedrive', 'customer relationship'],
  'Data Entry': ['data entry', 'data management', 'spreadsheets', 'data clerk', 'typist', 'typing', 'data processing', 'data input'],
  'Calendar Management': ['calendar management', 'scheduling', 'appointment setting', 'appointment setter', 'meeting coordination', 'diary management', 'booking'],
  'Google Workspace': ['google workspace', 'google sheets', 'google docs', 'gmail', 'google drive', 'g suite'],
  'Microsoft Office': ['microsoft office', 'excel', 'word', 'outlook', 'ms office', 'powerpoint'],
  Zendesk: ['zendesk', 'zendesk support', 'zendesk ticketing'],
  HubSpot: ['hubspot', 'hub spot'],
  'Social Media Management': ['social media', 'social media management', 'instagram', 'facebook', 'linkedin posting', 'content posting'],
  'Lead Generation': ['lead generation', 'lead gen', 'cold outreach', 'prospect', 'prospecting', 'outbound', 'b2b outreach'],
  'Cold Calling': ['cold calling', 'cold call', 'outbound calls', 'telemarketing', 'phone sales'],
  'Appointment Setting': ['appointment setting', 'appointment setter', 'meeting booking', 'scheduling meetings'],
  Research: ['research', 'internet research', 'market research', 'competitive research', 'web research'],
  Typing: ['typing', 'wpm', 'words per minute', 'fast typist'],
  Bookkeeping: ['bookkeeping', 'quickbooks', 'xero', 'accounting clerk', 'accounts payable', 'accounts receivable', 'invoicing'],
  'Office Management': ['office management', 'office manager', 'office coordinator', 'facilities']
};

const seniorityPatterns = [
  { level: 'executive', patterns: [/\bchief\b/i, /\bvp\b/i, /director/i, /head of/i] },
  { level: 'senior', patterns: [/\bsenior\b/i, /\b(?:team|tech|technical|engineering)\s+lead\b/i, /\blead\s+(?:engineer|developer|architect|designer)\b/i, /5\+?\s*years/i, /five\+?\s*years/i] },
  { level: 'mid', patterns: [/\bmid[-\s]?level\b/i, /2\+?\s*years/i, /3\+?\s*years/i] },
  { level: 'junior', patterns: [/\bjunior\b/i, /\bentry[-\s]?level\b/i, /1\+?\s*years/i] }
];

const remotePatterns = [/remote/i, /work from home/i, /permanent work from home/i];
const onsitePatterns = [/on[-\s]?site/i, /\bin office\b/i, /\bhybrid\b/i, /must be located in/i];
const flexiblePatterns = [/part[-\s]?time/i, /20\s*-\s*34 hours/i, /flexible schedule/i, /\bflexible\b/i];

export async function localMatchJob(job, candidateProfile, config = {}) {
  const text = buildJobText(job);
  const reasons = [];
  const matchedSkills = [];
  const missingSkills = [];
  const hardFilterReasons = findHardFilters(text, candidateProfile);

  if (hardFilterReasons.length > 0) {
    return {
      score: 0,
      recommendation: 'ignore',
      matchedSkills,
      missingSkills: candidateProfile.skills || [],
      reasons: hardFilterReasons
    };
  }

  const titleExclusionReasons = findTitleExclusions(job.title || '', candidateProfile);
  if (titleExclusionReasons.length > 0) {
    return {
      score: 0,
      recommendation: 'ignore',
      matchedSkills,
      missingSkills: candidateProfile.skills || [],
      reasons: titleExclusionReasons
    };
  }

  // Use AI for scoring instead of keyword matching
  const aiScore = await getAiScore(job, candidateProfile, config);

  return {
    score: aiScore.score,
    recommendation: recommendationForScore(aiScore.score),
    matchedSkills: aiScore.matchedSkills || [],
    missingSkills: aiScore.missingSkills || [],
    reasons: aiScore.reasons || ['AI-powered job matching']
  };
}

async function getAiScore(job, candidateProfile, config) {
  const prompt = buildScoringPrompt(job, candidateProfile, config);

  try {
    const result = await aiRouter.request({
      taskType: TaskTypes.FAST_FILTER,
      prompt,
      profile: candidateProfile,
      jobData: job,
      config
    });

    // Strip markdown code blocks if present
    let cleanResponse = result.response.trim();
    if (cleanResponse.startsWith('```json')) {
      cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanResponse.startsWith('```')) {
      cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(cleanResponse);
    const score = clampScoreInt(parsed.score);
    const matchedSkills = Array.isArray(parsed.matched_skills) ? parsed.matched_skills.slice(0, 12) : [];
    const missingSkills = Array.isArray(parsed.missing_skills) ? parsed.missing_skills.slice(0, 12) : [];
    const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 6) : ['AI scoring completed'];

    // Reject ungrounded responses — model must produce at least one matched OR missing skill
    if (matchedSkills.length === 0 && missingSkills.length === 0) {
      throw new Error('AI returned no skill grounding (matched_skills and missing_skills both empty)');
    }

    return { score, matchedSkills, missingSkills, reasons };
  } catch (error) {
    console.error('[localMatcher] AI scoring failed, using fallback:', error.message);
    return keywordBasedScore(job, candidateProfile, config);
  }
}

function clampScoreInt(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function buildScoringPrompt(job, candidateProfile, config = {}) {
  const jobText = buildJobText(job);
  const cv = config.cvData || {};

  const summary = compactText(cv.summary || candidateProfile.summary || '').slice(0, 600);
  const years = cv.yearsOfExperience ?? candidateProfile.yearsOfExperience;
  const industries = uniqueList(cv.industries, candidateProfile.industries).slice(0, 8);
  const strengths = uniqueList(cv.strengths, candidateProfile.strengths).slice(0, 12);
  const cvSkills = uniqueList(cv.skills, candidateProfile.skills).slice(0, 25);
  const workHistory = formatWorkHistory(cv.workHistory || candidateProfile.workHistory || []);
  const careerBrain = compactText(config.careerBrainPrompt || '').slice(0, 1200);

  return `You are a career-matching assistant. Score how well a real job opening matches a real candidate's CV on a 0-100 scale. Be honest and calibrated — most jobs are not a great match.

=== CANDIDATE CV ===
Name: ${cv.name || candidateProfile.name || 'Candidate'}
Headline: ${cv.jobTitle || ''}
Years of experience: ${Number.isFinite(years) ? years : 'unspecified'}
Summary: ${summary || '(none)'}

Industries: ${industries.join(', ') || '(none)'}
Core skills (from CV + profile): ${cvSkills.join(', ') || '(none)'}
Strengths: ${strengths.join(', ') || '(none)'}

Preferred roles: ${(candidateProfile.preferredRoles || []).join(', ') || '(none)'}
Secondary roles: ${(candidateProfile.secondaryRoles || []).join(', ') || '(none)'}
Target seniority: ${(candidateProfile.targetSeniorities || []).join(', ') || 'entry, junior, mid'}
Remote preference: ${candidateProfile.remotePreference || 'remote_only'}

Work history:
${workHistory || '(none listed)'}

Profile-specific guidance:
${careerBrain || '(none)'}

=== JOB OPENING ===
Title: ${job.title || 'N/A'}
Company: ${job.company || 'N/A'}
Location: ${job.location || 'N/A'}
Description (truncated): ${jobText.slice(0, 2500)}

=== SCORING RULES ===
Apply this calibrated rubric strictly:
- 95-100  Bullseye: title matches a preferred role AND the CV shows direct experience with the core requirements.
- 85-94   Strong: clear role overlap and the candidate has hands-on experience with most listed skills.
- 70-84   Good: role is adjacent (e.g. CV has SEO, job is "Digital Marketing Specialist"), most skills transferable.
- 55-69   Marginal: some shared skills but the role is not what the candidate is targeting OR a key requirement is missing.
- 30-54   Weak: very thin overlap; the candidate would be a stretch hire.
- 0-29    Wrong fit: different field, seniority mismatch, or hard requirement the candidate clearly lacks.

Hard rules — apply BEFORE rubric:
- If the job seniority (Senior, Lead, Staff, Director, VP) is above the candidate's target seniority → cap score at 25.
- If the job is in a different profession from anything in the CV (e.g. nurse, accountant, electrician for a developer) → cap at 15.
- If the job clearly requires years of experience > candidate's years of experience + 2 → cap at 35.

Be specific in "reasons" — name the role, the matching/missing skill, or the seniority mismatch. Do NOT invent skills not present in the CV.

=== OUTPUT ===
Return ONLY this JSON (no prose, no markdown):
{
  "score": <integer 0-100>,
  "matched_skills": [<skills from the CV that the job explicitly asks for, max 8>],
  "missing_skills": [<skills the job asks for but the CV does NOT show, max 6>],
  "reasons": [<2-4 short concrete reasons grounded in CV + job text>]
}`;
}

function uniqueList(...sources) {
  const out = new Set();
  for (const src of sources) {
    if (Array.isArray(src)) {
      for (const item of src) {
        const v = compactText(String(item || ''));
        if (v) out.add(v);
      }
    }
  }
  return Array.from(out);
}

function formatWorkHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return '';
  return history.slice(0, 5).map((entry) => {
    const title = compactText(entry.jobTitle || '');
    const company = compactText(entry.company || '');
    const period = [entry.startDate, entry.endDate].filter(Boolean).join(' – ');
    const responsibilities = Array.isArray(entry.responsibilities)
      ? entry.responsibilities.slice(0, 3).map((r) => `    - ${compactText(r).slice(0, 180)}`).join('\n')
      : '';
    return `  ${title}${company ? ' @ ' + company : ''}${period ? ' (' + period + ')' : ''}\n${responsibilities}`;
  }).join('\n');
}

function keywordBasedScore(job, candidateProfile, config = {}) {
  const text = buildJobText(job);
  const reasons = [];
  const matchedSkills = [];
  const missingSkills = [];
  let score = 0;

  const cv = config.cvData || {};
  const cvCorpus = buildCvCorpus(cv, candidateProfile);

  const roleMatch = scoreRoleMatch(job.title, text, candidateProfile);
  score += roleMatch.points;
  if (roleMatch.reason) reasons.push(roleMatch.reason);

  const skillMatch = scoreSkillMatch(text, candidateProfile, matchedSkills, missingSkills, cv);
  score += skillMatch.points;
  reasons.push(...skillMatch.reasons);

  const cvOverlap = scoreCvOverlap(text, cvCorpus);
  score += cvOverlap.points;
  if (cvOverlap.reason) reasons.push(cvOverlap.reason);

  const experienceMatch = scoreExperienceMatch(text, candidateProfile);
  score += experienceMatch.points;
  if (experienceMatch.reason) reasons.push(experienceMatch.reason);

  const remoteMatch = scoreRemotePreference(text, candidateProfile);
  score += remoteMatch.points;
  if (remoteMatch.reason) reasons.push(remoteMatch.reason);

  const seniorityMatch = scoreSeniority(text, candidateProfile, cv.yearsOfExperience);
  score += seniorityMatch.points;
  if (seniorityMatch.reason) reasons.push(seniorityMatch.reason);

  const exclusionMatch = scoreSoftExclusions(text, candidateProfile);
  score += exclusionMatch.points;
  reasons.push(...exclusionMatch.reasons);

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    matchedSkills,
    missingSkills,
    reasons: [...reasons, '(keyword fallback)']
  };
}

function buildCvCorpus(cv, candidateProfile) {
  const parts = [
    cv.summary,
    cv.jobTitle,
    ...(cv.jobTitles || []),
    ...(cv.industries || []),
    ...(cv.strengths || candidateProfile?.strengths || []),
    ...(cv.skills || candidateProfile?.skills || [])
  ];
  if (Array.isArray(cv.workHistory)) {
    for (const entry of cv.workHistory) {
      parts.push(entry.jobTitle, entry.company);
      if (Array.isArray(entry.responsibilities)) parts.push(...entry.responsibilities);
    }
  }
  return compactText(parts.filter(Boolean).join(' ')).toLowerCase();
}

function scoreCvOverlap(jobText, cvCorpus) {
  if (!cvCorpus) return { points: 0, reason: '' };
  const tokens = Array.from(new Set(
    compactText(jobText).toLowerCase().match(/\b[a-z][a-z0-9.+#-]{3,}\b/g) || []
  ));
  if (tokens.length === 0) return { points: 0, reason: '' };

  const stopwords = new Set([
    'with', 'will', 'this', 'that', 'have', 'from', 'your', 'their', 'them',
    'about', 'into', 'they', 'these', 'those', 'role', 'work', 'team', 'time',
    'will', 'must', 'should', 'would', 'such', 'also', 'plus', 'years', 'year',
    'remote', 'company', 'including', 'across', 'through', 'including', 'job',
    'jobs', 'position', 'opportunity', 'experience'
  ]);

  const meaningful = tokens.filter((t) => !stopwords.has(t));
  const hits = meaningful.filter((t) => cvCorpus.includes(t));
  const overlap = hits.length / Math.max(meaningful.length, 1);

  if (overlap >= 0.15) return { points: 15, reason: `CV vocabulary overlap ${(overlap * 100).toFixed(0)}% (+15)` };
  if (overlap >= 0.08) return { points: 8,  reason: `CV vocabulary overlap ${(overlap * 100).toFixed(0)}% (+8)` };
  if (overlap >= 0.04) return { points: 3,  reason: `CV vocabulary overlap ${(overlap * 100).toFixed(0)}% (+3)` };
  return { points: -5, reason: `Low CV vocabulary overlap ${(overlap * 100).toFixed(0)}% (-5)` };
}

function buildJobText(job) {
  return [
    job.title,
    job.description,
    job.requirements,
    job.responsibilities,
    job.requiredSkills,
    job.skills,
    job.tags,
    job.keywords,
    job.jobType,
    job.company,
    job.location,
    job.seniority
  ]
    .map(compactText)
    .join(' ');
}

function findHardFilters(text, profile) {
  const filters = [...defaultHardFilters, ...(profile.hardFilters || [])];
  return filters
    .filter((filter) => filter && containsKeyword(text, filter))
    .map((filter) => `Hard filter matched: ${filter}`);
}

function findTitleExclusions(title, profile) {
  const titleExclusions = profile.titleExclusions || [];
  const titleLower = compactText(title).toLowerCase();
  return titleExclusions
    .filter((kw) => kw && titleLower.includes(compactText(kw).toLowerCase()))
    .map((kw) => `Title exclusion matched: ${kw}`);
}

const titleRelevanceKeywords = [
  'assistant', 'support', 'clerk', 'coordinator', 'administrator',
  'receptionist', 'secretary', 'typist', 'operator', 'representative',
  'agent', 'associate', 'specialist', 'customer', 'admin',
  'virtual', 'helpdesk', 'data entry', 'scheduling'
];

function scoreRoleMatch(title, text, profile) {
  const primaryMatch = roleMatchStrength(title, text, profile.preferredRoles);
  if (primaryMatch >= 1.0) return { points: 30, reason: 'Primary role match (+30)' };
  if (primaryMatch >= 0.6) return { points: 20, reason: 'Partial primary role match (+20)' };

  const secondaryMatch = roleMatchStrength(title, text, profile.secondaryRoles);
  if (secondaryMatch >= 1.0) return { points: 15, reason: 'Secondary role match (+15)' };
  if (secondaryMatch >= 0.6) return { points: 10, reason: 'Partial secondary role match (+10)' };

  // Title relevance bonus for admin/support-related keywords
  const titleLower = compactText(title).toLowerCase();
  const relevanceHits = titleRelevanceKeywords.filter((kw) => titleLower.includes(kw));
  if (relevanceHits.length >= 2) return { points: 10, reason: `Title relevance: ${relevanceHits.slice(0, 3).join(', ')} (+10)` };
  if (relevanceHits.length === 1) return { points: 5, reason: `Title relevance: ${relevanceHits[0]} (+5)` };

  return { points: 0, reason: '' };
}

function roleMatchStrength(title, text, roles = []) {
  const titleLower = compactText(title).toLowerCase();
  const textLower = compactText(text).toLowerCase();
  let bestStrength = 0;

  for (const role of roles) {
    const normalized = compactText(role).toLowerCase();
    // Exact substring match in title
    if (titleLower.includes(normalized)) return 1.0;

    const words = normalized.split(/\s+/).filter((word) => word.length > 2);
    if (words.length === 0) continue;

    // Check word-by-word match in title or full text
    const titleHits = words.filter((word) => titleLower.includes(word)).length;
    const textHits = words.filter((word) => textLower.includes(word)).length;
    const titleStrength = titleHits / words.length;
    const textStrength = textHits / words.length * 0.8; // Text match weighted less
    bestStrength = Math.max(bestStrength, titleStrength, textStrength);
  }

  return bestStrength;
}

function scoreSkillMatch(text, profile, matchedSkills, missingSkills, cv = {}) {
  const profileSkills = Array.from(new Set([
    ...(Array.isArray(profile.skills) ? profile.skills : []),
    ...(Array.isArray(cv.skills) ? cv.skills : [])
  ]));
  const skillAliases = { ...defaultSkillAliases, ...(profile.skillAliases || {}) };
  let rawPoints = 0;
  const reasons = [];

  for (const skill of profileSkills) {
    const aliases = Array.from(new Set([skill, ...(skillAliases[skill] || [])]));
    if (aliases.some((alias) => containsKeyword(text, alias))) {
      const points = skillPoints(skill);
      rawPoints += points;
      matchedSkills.push(skill);
      reasons.push(`${skill} matched (+${points})`);
    } else {
      missingSkills.push(skill);
    }
  }

  const cappedPoints = Math.min(50, rawPoints);
  if (rawPoints > cappedPoints) reasons.push(`Skill match cap applied (${cappedPoints}/${rawPoints})`);
  return { points: cappedPoints, reasons };
}

function skillPoints(skill) {
  if (/seo|shopify|customer support|administrative support|crm|web development/i.test(skill)) return 12;
  if (/wordpress|email support|live chat|virtual assistance|data entry/i.test(skill)) return 10;
  return 8;
}

function scoreExperienceMatch(text, profile) {
  const keywords = [...(profile.experienceKeywords || []), ...(profile.strengths || [])].filter(Boolean);
  const matched = keywords.filter((keyword) => containsKeyword(text, keyword)).slice(0, 5);
  if (matched.length === 0) return { points: 0, reason: '' };
  const points = Math.min(20, matched.length * 5);
  return { points, reason: `Experience match: ${matched.join(', ')} (+${points})` };
}

function scoreRemotePreference(text, profile) {
  const wantsRemote = profile.remotePreference !== 'onsite_ok';
  const isRemote = remotePatterns.some((pattern) => pattern.test(text));
  const isOnsite = onsitePatterns.some((pattern) => pattern.test(text));

  if (wantsRemote && isOnsite && !isRemote) {
    return { points: -20, reason: 'On-site/hybrid mismatch (-20)' };
  }
  if (isRemote) return { points: 10, reason: 'Remote preference matched (+10)' };
  if (wantsRemote) return { points: -5, reason: 'Remote status unclear (-5)' };
  return { points: 0, reason: '' };
}

function scoreSeniority(text, profile, candidateYears) {
  const targetSeniorities = (profile.targetSeniorities || ['entry', 'junior', 'mid']).map((item) => item.toLowerCase());
  const detected = detectSeniority(text);
  const flexible = flexiblePatterns.some((pattern) => pattern.test(text));
  let points = flexible ? 5 : 0;
  const reasons = [];

  if (flexible) reasons.push('Flexible/part-time role bonus (+5)');

  // Years-of-experience gate — if job demands more than candidate has + 2, penalize hard
  const yearsRequired = extractYearsRequired(text);
  if (Number.isFinite(yearsRequired) && Number.isFinite(candidateYears) && yearsRequired > candidateYears + 2) {
    points -= 25;
    reasons.push(`Job wants ${yearsRequired}y, candidate has ${candidateYears}y (-25)`);
  }

  if (!detected) return { points, reason: reasons.join('; ') };

  if (targetSeniorities.includes(detected)) {
    points += 5;
    reasons.push(`${capitalize(detected)} seniority fit (+5)`);
  } else if (['senior', 'executive'].includes(detected)) {
    points -= detected === 'executive' ? 25 : 20;
    reasons.push(`${capitalize(detected)} seniority penalty (${detected === 'executive' ? '-25' : '-20'})`);
  }

  return { points, reason: reasons.join('; ') };
}

function extractYearsRequired(text) {
  const match = text.match(/(\d{1,2})\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)/i);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 && n < 30 ? n : null;
}

function detectSeniority(text) {
  return seniorityPatterns.find((item) => item.patterns.some((pattern) => pattern.test(text)))?.level || '';
}

function scoreSoftExclusions(text, profile) {
  const exclusions = profile.exclusions || [];
  const reasons = [];
  let points = 0;
  for (const exclusion of exclusions) {
    if (containsKeyword(text, exclusion)) {
      points -= 15;
      reasons.push(`${exclusion} exclusion penalty (-15)`);
    }
  }
  return { points, reasons };
}

function containsKeyword(text, keyword) {
  const normalized = compactText(keyword);
  if (!normalized) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s+');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function recommendationForScore(score) {
  if (score >= 95) return 'instant_apply';
  if (score >= 88) return 'auto_apply';
  if (score >= 75) return 'review';
  return 'ignore';
}
