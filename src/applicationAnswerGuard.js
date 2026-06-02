import { compactText } from './utils.js';

const EXACT_EXPERIENCE_PATTERNS = [
  /\b(do you have|have you|did you|are you|can you|could you)\b/i,
  /\b(experience|experienced|proficient|proficiency|familiar|familiarity|knowledge|worked with|used|using|managed|handled)\b/i
];

const UNSUPPORTED_PREAMBLE_PATTERN =
  /^(here is (an|my)?\s*answer|as an ai|as a language model|based on (my|the) resume|my answer is)[\s:.-]*/i;

const AFFIRMATIVE_CLAIM_PATTERN =
  /\b(yes|i have|i've|i am|i'm|i can|i possess|my experience includes|my background includes|i have worked|i have used|i am experienced|i am proficient)\b/i;

const TOPIC_STOP_WORDS = new Set([
  'about',
  'additional',
  'also',
  'answer',
  'application',
  'apply',
  'background',
  'candidate',
  'company',
  'describe',
  'details',
  'experience',
  'familiar',
  'familiarity',
  'have',
  'knowledge',
  'level',
  'please',
  'position',
  'proficient',
  'proficiency',
  'question',
  'required',
  'requirement',
  'requirements',
  'role',
  'skill',
  'skills',
  'team',
  'tell',
  'this',
  'using',
  'with',
  'work',
  'worked',
  'working',
  'years',
  'your'
]);

export function cleanApplicationAnswer(value) {
  let answer = extractTextFromPossibleJson(value);

  answer = answer
    .replace(/```(?:json|text)?/gi, '')
    .replace(/```/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/^\s*[-*\u2022]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(UNSUPPORTED_PREAMBLE_PATTERN, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\s+[\u2013\u2014-]\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return answer;
}

export function validateApplicationAnswer({ question, answer, config = {}, candidate = {}, fallback = '' }) {
  const cleaned = cleanApplicationAnswer(answer);
  if (!cleaned) {
    return { ok: false, answer: '', reason: 'empty-answer' };
  }

  const questionText = compactText(question || '');
  const source = buildEvidenceSource(config, candidate);
  const unsupported = findUnsupportedClaim(questionText, cleaned, source);
  if (unsupported) {
    return {
      ok: false,
      answer: buildTransferableFallback(unsupported.topic, source, fallback),
      reason: unsupported.reason,
      topic: unsupported.topic
    };
  }

  return { ok: true, answer: cleaned, reason: '' };
}

export function buildGroundedFallbackAnswer(question, applicationAnswers = {}, config = {}, candidate = {}) {
  const normalizedPrompt = String(question || '').toLowerCase();
  const source = buildEvidenceSource(config, candidate);
  const fallback =
    applicationAnswers.general ||
    applicationAnswers.relevant_skills ||
    applicationAnswers.describe_experience ||
    '';

  if (isExactExperienceQuestion(normalizedPrompt)) {
    const topic = extractTopicFromQuestion(normalizedPrompt);
    if (topic && !topicSupported(topic, source)) {
      return buildTransferableFallback(topic, source, fallback);
    }
  }

  if (fallback) return cleanApplicationAnswer(fallback);
  return buildTransferableFallback('', source, '');
}

export function extractTextFromPossibleJson(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';

  raw = raw.replace(/^```(?:json|text)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const direct = parseJsonObject(raw);
  if (direct) return pickTextFromObject(direct);

  const firstObject = raw.match(/\{[\s\S]*\}/);
  if (firstObject) {
    const parsed = parseJsonObject(firstObject[0]);
    if (parsed) return pickTextFromObject(parsed);
  }

  return raw;
}

export function findUnsupportedClaim(question, answer, source) {
  const normalizedQuestion = String(question || '').toLowerCase();
  const cleanedAnswer = cleanApplicationAnswer(answer);
  if (!isExactExperienceQuestion(normalizedQuestion)) return null;
  if (!AFFIRMATIVE_CLAIM_PATTERN.test(cleanedAnswer)) return null;

  const topic = extractTopicFromQuestion(normalizedQuestion);
  if (!topic) return null;
  if (topicSupported(topic, source)) return null;

  return {
    topic,
    reason: `unsupported affirmative claim for "${topic}"`
  };
}

export function topicSupported(topic, source) {
  const evidence = normalizeComparable(source.evidenceText);
  if (!evidence) return false;

  const terms = significantTerms(topic);
  if (terms.length === 0) return true;

  const exactTopic = normalizeComparable(topic);
  if (exactTopic.length >= 4 && evidence.includes(exactTopic)) return true;

  const supportedCount = terms.filter((term) => evidence.includes(term)).length;
  return supportedCount >= Math.min(terms.length, 2);
}

export function buildEvidenceSource(config = {}, candidate = {}) {
  const profile = config.candidateProfile || {};
  const cv = config.cvData || candidate || {};
  const values = [
    profile.name,
    cv.name,
    profile.resumeTextPreview,
    cv.rawTextPreview,
    cv.summary,
    cv.jobTitle,
    ...(cv.jobTitles || []),
    ...(profile.skills || []),
    ...(cv.skills || []),
    ...(profile.strengths || []),
    ...(cv.strengths || []),
    ...(profile.preferredRoles || []),
    ...(profile.secondaryRoles || []),
    ...(profile.experienceKeywords || []),
    ...(cv.industries || []),
    ...(cv.languages || []),
    stringifyWorkHistory(cv.workHistory),
    stringifyEducation(cv.education),
    stringifyEducation(cv.certifications),
    profile.remotePreference,
    config.remotePreference
  ];

  const skills = [
    ...(profile.skills || []),
    ...(cv.skills || []),
    ...(profile.strengths || []),
    ...(cv.strengths || [])
  ].map(compactText).filter(Boolean);

  return {
    evidenceText: compactText(values.flat().filter(Boolean).join(' ')),
    skills: Array.from(new Set(skills)).slice(0, 5)
  };
}

function parseJsonObject(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pickTextFromObject(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';

  for (const key of ['answer', 'response', 'text', 'content', 'message']) {
    if (typeof value[key] === 'string') return value[key];
  }

  for (const key of ['application_answers', 'applicationAnswers', 'improved_answers']) {
    const nested = value[key];
    if (nested && typeof nested === 'object') {
      const first = Object.values(nested).find((item) => typeof item === 'string' && item.trim().length > 0);
      if (first) return first;
    }
  }

  return '';
}

function isExactExperienceQuestion(question) {
  const normalized = String(question || '').toLowerCase();
  return EXACT_EXPERIENCE_PATTERNS.every((pattern) => pattern.test(normalized));
}

function extractTopicFromQuestion(question) {
  const normalized = String(question || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    /\b(?:experience|proficiency|familiarity|knowledge)\s+(?:with|in|of|using)?\s+(.+?)(?:[?.]|$)/i,
    /\b(?:worked with|used|managed|handled|proficient in|familiar with)\s+(.+?)(?:[?.]|$)/i,
    /\b(?:do you have|have you|did you|can you|could you)\s+(?:any\s+)?(?:experience\s+)?(?:with|in|using|working with)?\s+(.+?)(?:[?.]|$)/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return cleanTopic(match[1]);
  }

  return '';
}

function cleanTopic(topic) {
  return String(topic || '')
    .replace(/\b(please|tell us|share|describe|required|required field|optional|yes or no)\b/gi, ' ')
    .replace(/\b(do you|have you|did you|can you|could you|would you|are you)\b/gi, ' ')
    .replace(/[^a-z0-9+#.\s-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function significantTerms(topic) {
  return normalizeComparable(topic)
    .split(' ')
    .filter((term) => term.length >= 3)
    .filter((term) => !TOPIC_STOP_WORDS.has(term));
}

function normalizeComparable(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bc\+\+\b/g, 'cpp')
    .replace(/\bc#\b/g, 'csharp')
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTransferableFallback(topic, source, fallback) {
  const skills = source.skills.slice(0, 3);
  const skillPhrase = skills.length > 0 ? skills.join(', ') : 'communication, organization, and careful execution';
  const topicText = compactText(topic || '');

  if (fallback && !AFFIRMATIVE_CLAIM_PATTERN.test(fallback)) {
    return cleanApplicationAnswer(fallback);
  }

  if (topicText) {
    return `I do not have that exact ${topicText} experience documented in my CV. My strongest relevant background is in ${skillPhrase}, and I can apply those skills while learning the specific workflow required for this role.`;
  }

  return `My strongest relevant background is in ${skillPhrase}. I can apply those skills carefully to the role and learn any specific workflow required.`;
}

function stringifyWorkHistory(items) {
  if (!Array.isArray(items)) return '';
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return String(item || '');
      return [item.title, item.company, item.description, ...(item.responsibilities || [])]
        .filter(Boolean)
        .join(' ');
    })
    .join(' ');
}

function stringifyEducation(value) {
  if (!Array.isArray(value)) return String(value || '');
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return String(item || '');
      return Object.values(item).flat().filter(Boolean).join(' ');
    })
    .join(' ');
}
