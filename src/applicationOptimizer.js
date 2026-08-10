import fs from 'node:fs/promises';
import path from 'node:path';
import { hashJob } from './jobStore.js';
import { compactText } from './utils.js';

const technicalKeywords = [
  'SEO',
  'Technical SEO',
  'Search Engine Optimization',
  'Shopify',
  'WordPress',
  'Web Development',
  'JavaScript',
  'Node.js',
  'HTML',
  'CSS',
  'Laravel',
  'PHP',
  'MySQL',
  'API Integration',
  'Responsive Design',
  'Google Analytics',
  'Google Search Console',
  'Core Web Vitals',
  'Schema Markup',
  'E-Commerce',
  'WooCommerce',
  'Content Management',
  'CMS',
  'Digital Marketing',
  'Email Marketing',
  'Copywriting',
  'Customer Support',
  'Administrative Support',
  'Virtual Assistance',
  'Data Entry',
  'Lead Generation',
  'Research',
  'Calendar Management',
  'Project Management'
];

const toolKeywords = [
  'Canva',
  'Mailchimp',
  'HubSpot',
  'Salesforce',
  'Zoho',
  'Pipedrive',
  'Zendesk',
  'Intercom',
  'Google Workspace',
  'Google Sheets',
  'Google Docs',
  'Microsoft Office',
  'Excel',
  'QuickBooks',
  'YouTube',
  'Meta Ads',
  'Google Ads'
];

const softSkillKeywords = [
  'Communication',
  'Attention to detail',
  'Organization',
  'Problem solving',
  'Time management',
  'Collaboration',
  'Reliability',
  'Adaptability',
  'Analytical thinking',
  'Customer service'
];

const keywordAliases = {
  SEO: ['seo', 'search engine optimization'],
  'Technical SEO': ['technical seo', 'site audit', 'schema markup', 'core web vitals'],
  'Search Engine Optimization': ['seo', 'search engine optimization'],
  Shopify: ['shopify'],
  WordPress: ['wordpress', 'wp'],
  'Web Development': ['web development', 'website development', 'website administrator', 'website admin'],
  JavaScript: ['javascript', 'js'],
  'Node.js': ['node.js', 'nodejs', 'node js'],
  HTML: ['html', 'html5'],
  CSS: ['css', 'css3'],
  'API Integration': ['api integration', 'api integrations', 'integrations'],
  'Responsive Design': ['responsive design', 'mobile responsive'],
  'Google Analytics': ['google analytics', 'ga4'],
  'Google Search Console': ['google search console', 'search console', 'gsc'],
  'Core Web Vitals': ['core web vitals', 'page speed', 'site speed'],
  'Schema Markup': ['schema markup', 'structured data'],
  'E-Commerce': ['e-commerce', 'ecommerce', 'online store', 'marketplace'],
  'Content Management': ['content management', 'content updates'],
  CMS: ['cms', 'content management system'],
  CRM: ['crm', 'customer relationship management'],
  'Digital Marketing': ['digital marketing', 'online marketing'],
  'Email Marketing': ['email marketing', 'mailchimp'],
  'Customer Support': ['customer support', 'customer service', 'client support'],
  'Administrative Support': ['administrative support', 'admin assistant', 'operations coordinator'],
  'Virtual Assistance': ['virtual assistant', 'va', 'remote assistant'],
  'Data Entry': ['data entry', 'data management'],
  'Lead Generation': ['lead generation', 'prospecting'],
  'Calendar Management': ['calendar management', 'scheduling', 'appointment setting'],
  'Google Workspace': ['google workspace', 'google sheets', 'google docs', 'gmail'],
  'Microsoft Office': ['microsoft office', 'excel', 'word', 'outlook']
};

const highRiskSignals = [
  'u.s. work authorization',
  'us work authorization',
  'authorized to work in the united states',
  'us citizen',
  'security clearance required'
];

const stopWords = new Set([
  'and',
  'the',
  'with',
  'for',
  'that',
  'this',
  'from',
  'your',
  'you',
  'our',
  'are',
  'will',
  'job',
  'role',
  'work',
  'have',
  'has',
  'about',
  'into',
  'their',
  'more',
  'than',
  'per',
  'week',
  'full',
  'part',
  'time'
]);

export function optimizeApplication({
  job,
  candidateProfile,
  resumeText = '',
  localAnalysis = {},
  aiAnalysis = {},
  config = {}
}) {
  const jobText = buildJobText(job);
  const candidateText = buildCandidateText(candidateProfile, resumeText);
  const keywordAnalysis = analyzeAtsKeywords(job, candidateProfile, resumeText);
  const seniority = analyzeSeniority(jobText, candidateProfile);
  const company = estimateCompanyContext(jobText, job);
  const competition = estimateCompetitionLevel(jobText, job);
  const profileStrength = scoreProfileStrength(keywordAnalysis, candidateProfile);
  const riskFlags = buildRiskFlags({
    jobText,
    localAnalysis,
    aiAnalysis,
    keywordAnalysis,
    seniority,
    resumeText
  });
  const atsScore = scoreAts(keywordAnalysis, resumeText);
  const jobMatchScore = scoreJobMatch(localAnalysis, aiAnalysis);
  const applicationScore = clampScore(
    Math.round(jobMatchScore * 0.45 + atsScore * 0.35 + profileStrength * 0.2)
  );
  const interviewProbability = scoreInterviewProbability({
    jobMatchScore,
    atsScore,
    seniorityScore: seniority.score,
    companyScore: company.score,
    competitionScore: competition.score,
    profileStrength
  });
  const recommendation = recommendAction({
    applicationScore,
    atsScore,
    interviewProbability,
    riskFlags,
    localAnalysis,
    keywordAnalysis,
    config
  });
  const optimizedResumeKeywords = buildOptimizedResumeKeywords(keywordAnalysis, resumeText);
  const optimizedCoverLetter = generateCoverLetter({
    job,
    candidateProfile,
    keywordAnalysis,
    seniority,
    company,
    candidateText
  });
  const improvedAnswers = generateImprovedAnswers({
    job,
    candidateProfile,
    keywordAnalysis,
    seniority,
    company
  });

  return {
    application_score: applicationScore,
    ats_score: atsScore,
    interview_probability: interviewProbability,
    optimized_resume_keywords: optimizedResumeKeywords,
    optimized_cover_letter: optimizedCoverLetter,
    improved_answers: improvedAnswers,
    risk_flags: riskFlags,
    recommendation,
    ats_analysis: {
      keywords: keywordAnalysis.keywords,
      required_skills: keywordAnalysis.required_skills,
      soft_skills: keywordAnalysis.soft_skills,
      tools: keywordAnalysis.tools,
      experience_level: keywordAnalysis.experience_level,
      matched_keywords: keywordAnalysis.matched_keywords,
      missing_keywords: keywordAnalysis.missing_keywords,
      missing_required_skills: keywordAnalysis.missing_required_skills,
      keyword_density_suggestions: keywordAnalysis.keyword_density_suggestions,
      resume_optimization_suggestions: keywordAnalysis.resume_optimization_suggestions
    },
    scoring_breakdown: {
      job_match_score: jobMatchScore,
      ats_keyword_alignment: atsScore,
      role_seniority_match: seniority.score,
      company_size_realism: company.score,
      competition_level: competition.level,
      competition_score: competition.score,
      profile_strength_alignment: profileStrength
    }
  };
}

export async function saveOptimizerArtifacts(config, job, optimization) {
  if (!config?.testMode) return '';
  const targetDir = getTestJobResultDir(config, job);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'cover-letter.txt'), `${optimization.optimized_cover_letter}\n`, 'utf8');
  await fs.writeFile(
    path.join(targetDir, 'optimized-answers.json'),
    `${JSON.stringify(optimization.improved_answers, null, 2)}\n`,
    'utf8'
  );
  await fs.writeFile(
    path.join(targetDir, 'ats-analysis-report.json'),
    `${JSON.stringify(
      {
        application_score: optimization.application_score,
        ats_score: optimization.ats_score,
        interview_probability: optimization.interview_probability,
        recommendation: optimization.recommendation,
        optimized_resume_keywords: optimization.optimized_resume_keywords,
        risk_flags: optimization.risk_flags,
        ats_analysis: optimization.ats_analysis,
        scoring_breakdown: optimization.scoring_breakdown
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  return targetDir;
}

export function getTestJobResultDir(config, job) {
  return path.join(config.testResultsDir, hashJob(job));
}

export function analyzeAtsKeywords(job, candidateProfile = {}, resumeText = '') {
  const jobText = buildJobText(job);
  const requirementsText = compactText([job.requirements, extractLikelyRequirementText(job.description)].join(' '));
  const candidateText = buildCandidateText(candidateProfile, resumeText);
  const skills = extractKnownTerms(jobText, technicalKeywords);
  const tools = extractKnownTerms(jobText, toolKeywords);
  const softSkills = extractKnownTerms(jobText, softSkillKeywords);
  const requiredSkills = Array.from(
    new Set([...extractKnownTerms(requirementsText || jobText, technicalKeywords), ...extractKnownTerms(requirementsText, toolKeywords)])
  );
  const roleKeywords = extractRoleKeywords(job.title, jobText);
  const keywords = Array.from(new Set([...skills, ...tools, ...softSkills, ...roleKeywords]));
  const matchedKeywords = keywords.filter((keyword) => keywordSupported(keyword, candidateText, candidateProfile));
  const missingKeywords = keywords.filter((keyword) => !matchedKeywords.includes(keyword));
  const matchedRequiredSkills = requiredSkills.filter((keyword) => matchedKeywords.includes(keyword));
  const missingRequiredSkills = requiredSkills.filter((keyword) => !matchedRequiredSkills.includes(keyword));
  const experienceLevel = detectExperienceLevel(jobText);
  const keywordDensitySuggestions = buildKeywordDensitySuggestions(matchedKeywords, resumeText);
  const resumeOptimizationSuggestions = buildResumeOptimizationSuggestions({
    job,
    matchedKeywords,
    missingKeywords,
    missingRequiredSkills,
    roleKeywords
  });

  return {
    keywords,
    required_skills: requiredSkills,
    matched_required_skills: matchedRequiredSkills,
    missing_required_skills: missingRequiredSkills,
    soft_skills: softSkills,
    tools,
    experience_level: experienceLevel,
    matched_keywords: matchedKeywords,
    missing_keywords: missingKeywords,
    keyword_density_suggestions: keywordDensitySuggestions,
    resume_optimization_suggestions: resumeOptimizationSuggestions
  };
}

function scoreAts(keywordAnalysis, resumeText) {
  const requiredTotal = keywordAnalysis.required_skills.length;
  const keywordTotal = keywordAnalysis.keywords.length;
  const softTotal = keywordAnalysis.soft_skills.length || 1;
  const requiredAlignment = requiredTotal === 0 ? 0.8 : keywordAnalysis.matched_required_skills.length / requiredTotal;
  const keywordAlignment = keywordTotal === 0 ? 0.6 : keywordAnalysis.matched_keywords.length / keywordTotal;
  const softAlignment =
    keywordAnalysis.soft_skills.length === 0
      ? 0.8
      : keywordAnalysis.soft_skills.filter((skill) => keywordAnalysis.matched_keywords.includes(skill)).length / softTotal;
  const resumePenalty = resumeText ? 0 : 8;
  return clampScore(Math.round(requiredAlignment * 55 + keywordAlignment * 35 + softAlignment * 10 - resumePenalty));
}

function scoreJobMatch(localAnalysis, aiAnalysis) {
  const localScore = asScore(localAnalysis?.score);
  const aiScore = asScore(aiAnalysis?.adjusted_score ?? aiAnalysis?.score);
  if (Number.isFinite(aiScore)) {
    return clampScore(Math.round(localScore * 0.7 + aiScore * 0.3));
  }
  return clampScore(localScore);
}

function scoreProfileStrength(keywordAnalysis, candidateProfile = {}) {
  const strengths = [...(candidateProfile.strengths || []), ...(candidateProfile.skills || [])];
  if (keywordAnalysis.keywords.length === 0) return 65;
  const matchedStrengths = keywordAnalysis.matched_keywords.filter((keyword) =>
    strengths.some((strength) => keywordSupported(keyword, strength, candidateProfile))
  );
  const base = (keywordAnalysis.matched_keywords.length / keywordAnalysis.keywords.length) * 70;
  const strengthBonus = Math.min(30, matchedStrengths.length * 8);
  return clampScore(Math.round(base + strengthBonus));
}

function scoreInterviewProbability({
  jobMatchScore,
  atsScore,
  seniorityScore,
  companyScore,
  competitionScore,
  profileStrength
}) {
  return clampScore(
    Math.round(
      jobMatchScore * 0.35 +
        atsScore * 0.25 +
        seniorityScore * 0.15 +
        companyScore * 0.1 +
        competitionScore * 0.05 +
        profileStrength * 0.1
    )
  );
}

function recommendAction({ applicationScore, atsScore, interviewProbability, riskFlags, localAnalysis, keywordAnalysis, config = {} }) {
  const highRisk = riskFlags.some((flag) => flag.severity === 'high');
  const threshold = Number.isFinite(config.autoApplyScoreThreshold) ? config.autoApplyScoreThreshold : 55;

  if (highRisk) {
    return 'skip';
  }

  if (applicationScore >= threshold) {
    return 'apply';
  }

  if (applicationScore >= threshold - 15) {
    return 'review';
  }

  return 'skip';
}

function buildRiskFlags({ jobText, localAnalysis, aiAnalysis, keywordAnalysis, seniority, resumeText }) {
  const flags = [];
  const lowerJob = normalizeComparable(jobText);

  for (const signal of highRiskSignals) {
    if (containsKeyword(lowerJob, signal)) {
      flags.push({
        severity: 'high',
        code: 'hard_filter',
        message: `Job contains a hard filter: ${signal}.`
      });
    }
  }

  for (const reason of localAnalysis?.reasons || []) {
    if (/hard filter|authorization|security clearance|title exclusion/i.test(reason)) {
      flags.push({
        severity: 'high',
        code: 'local_matcher_hard_filter',
        message: String(reason)
      });
    }
  }

  if (seniority.score <= 35) {
    flags.push({
      severity: 'high',
      code: 'seniority_mismatch',
      message: `Detected ${seniority.detected || 'advanced'} seniority does not match this profile's target range.`
    });
  } else if (seniority.score <= 55) {
    flags.push({
      severity: 'medium',
      code: 'seniority_review',
      message: `Detected ${seniority.detected} seniority should be reviewed before applying.`
    });
  }

  if (keywordAnalysis.missing_required_skills.length >= 3) {
    flags.push({
      severity: 'medium',
      code: 'missing_required_keywords',
      message: `Missing required keywords: ${keywordAnalysis.missing_required_skills.slice(0, 5).join(', ')}.`
    });
  }

  if (keywordAnalysis.matched_keywords.length === 0) {
    flags.push({
      severity: 'high',
      code: 'no_keyword_alignment',
      message: 'No ATS keywords from the job are supported by the candidate profile or resume.'
    });
  }

  if (!resumeText) {
    flags.push({
      severity: 'medium',
      code: 'resume_text_unavailable',
      message: 'Resume text could not be read, so ATS suggestions are based on profile data only.'
    });
  }

  if (aiAnalysis?.verification_failed) {
    flags.push({
      severity: 'medium',
      code: 'ai_verification_unavailable',
      message: 'AI verification was unavailable; decision uses local and deterministic optimization signals.'
    });
  }

  if (aiAnalysis?.confidence !== undefined && asScore(aiAnalysis.confidence) < 40) {
    flags.push({
      severity: 'low',
      code: 'low_ai_confidence',
      message: 'AI verification confidence is low.'
    });
  }

  return dedupeFlags(flags);
}

function buildOptimizedResumeKeywords(keywordAnalysis, resumeText) {
  const recommended = keywordAnalysis.matched_keywords.slice(0, 10);
  const exactPhraseGaps = recommended.filter((keyword) => countKeyword(resumeText, keyword) === 0);

  return {
    recommended,
    matched: keywordAnalysis.matched_keywords,
    missing: keywordAnalysis.missing_keywords,
    missing_required: keywordAnalysis.missing_required_skills,
    exact_phrase_gaps: exactPhraseGaps,
    density_suggestions: keywordAnalysis.keyword_density_suggestions,
    resume_suggestions: keywordAnalysis.resume_optimization_suggestions,
    truthfulness_rule: 'Use only keywords supported by the existing resume, profile skills, or real experience.'
  };
}

function generateCoverLetter({ job, candidateProfile, keywordAnalysis, seniority, company }) {
  const title = compactText(job.title || 'this role');
  const roleFocus = summarizeRoleFocus(job, keywordAnalysis);
  const skills = pickSupportedSkills(keywordAnalysis, candidateProfile, 3);
  const skillPhrase = toPhrase(skills);
  const expectations = extractExpectations(job).slice(0, 2);
  const expectationPhrase = expectations.length > 0 ? expectations.join(' and ') : roleFocus;
  const candidateName = compactText(candidateProfile?.name || '');
  const openerName = candidateName ? `My name is ${candidateName}, and I am` : 'I am';

  const paragraphs = [
    `Dear Hiring Team,`,
    `${openerName} applying for the ${title} role because its focus on ${roleFocus} aligns with my background in ${skillPhrase}.`,
    `My experience and profile show practical work across ${skillPhrase}, with a careful approach to clear communication, execution, and measurable improvement. For this role, I would focus on ${expectationPhrase}, while keeping the work organized and easy for the team to review.`,
    `I am especially interested in contributing to a ${company.type} environment where the right mix of accuracy, ownership, and continuous improvement matters. Thank you for considering my application.`
  ];

  return trimToWordLimit(paragraphs.join('\n\n'), 245);
}

function generateImprovedAnswers({ job, candidateProfile, keywordAnalysis, company }) {
  const title = compactText(job.title || 'this role');
  const roleFocus = summarizeRoleFocus(job, keywordAnalysis);
  const skills = pickSupportedSkills(keywordAnalysis, candidateProfile, 3);
  const skillsPhrase = toPhrase(skills);
  const expectations = extractExpectations(job);
  const topExpectation = expectations[0] || roleFocus;
  const conciseSkills = skills.slice(0, 3).join(', ');

  return {
    why_good_fit: trimToWordLimit(
      `I am a strong fit for the ${title} role because it matches my existing strengths in ${skillsPhrase}. I can bring a practical, detail-oriented approach to ${topExpectation}, communicate clearly with the team, and focus on work that improves quality and consistency without overstating my background.`,
      120
    ),
    describe_experience: trimToWordLimit(
      `My experience is centered on ${skillsPhrase}. I have worked on tasks that require structured execution, careful review, and improving digital or operational workflows. For this role, I would apply that experience to ${roleFocus}, using the exact tools and keywords from the job only where they reflect my real background.`,
      130
    ),
    why_this_role: trimToWordLimit(
      `I am interested in this role because it is focused on ${roleFocus}, which connects well with the work I already do best. The ${company.type} setting also appeals to me because it rewards reliability, clear communication, and steady improvement.`,
      110
    ),
    relevant_skills: trimToWordLimit(
      `The most relevant skills I would bring are ${conciseSkills || 'structured execution, communication, and problem solving'}. I would use them to support ${topExpectation} while keeping the work accurate and easy for the hiring team or client to trust.`,
      100
    ),
    remote_work: trimToWordLimit(
      `I am comfortable working remotely with clear communication, regular updates, and ownership of assigned tasks. I stay organized, ask focused questions when needed, and keep work visible so the team can move quickly.`,
      90
    ),
    general: trimToWordLimit(
      `My background aligns with this role through ${skillsPhrase}. I would bring reliable execution, clear communication, and a job-specific focus on ${roleFocus}.`,
      80
    )
  };
}

function buildKeywordDensitySuggestions(matchedKeywords, resumeText) {
  if (!resumeText) {
    return ['Resume text was unavailable; confirm exact keyword placement manually before applying.'];
  }

  const suggestions = [];
  for (const keyword of matchedKeywords.slice(0, 8)) {
    const count = countKeyword(resumeText, keyword);
    if (count === 0) {
      suggestions.push(`Add the exact phrase "${keyword}" once where the existing experience already supports it.`);
    } else if (count === 1) {
      suggestions.push(`Consider surfacing "${keyword}" in one additional relevant bullet if it reads naturally.`);
    }
  }

  return suggestions.length > 0
    ? suggestions
    : ['Keyword coverage is already visible; prioritize clarity and recruiter readability over repetition.'];
}

function buildResumeOptimizationSuggestions({ job, matchedKeywords, missingKeywords, missingRequiredSkills, roleKeywords }) {
  const suggestions = [];
  const title = compactText(job.title || 'target role');
  const supported = matchedKeywords.slice(0, 4);

  if (supported.length > 0) {
    suggestions.push(`Lead with supported ${title} keywords: ${supported.join(', ')}.`);
    suggestions.push(`Reframe existing bullets around outcomes connected to ${supported.slice(0, 3).join(', ')}.`);
  }

  if (roleKeywords.length > 0) {
    suggestions.push(`Mirror role language naturally in the summary, especially ${roleKeywords.slice(0, 3).join(', ')}.`);
  }

  if (missingRequiredSkills.length > 0) {
    suggestions.push(
      `Do not add unsupported required terms (${missingRequiredSkills.slice(0, 4).join(', ')}); mention only related truthful exposure if it exists.`
    );
  } else if (missingKeywords.length > 0) {
    suggestions.push(`Leave unsupported keywords out unless the candidate can truthfully evidence them: ${missingKeywords.slice(0, 4).join(', ')}.`);
  }

  return suggestions.slice(0, 5);
}

function analyzeSeniority(jobText, candidateProfile = {}) {
  const detected = detectExperienceLevel(jobText);
  const targets = (candidateProfile.targetSeniorities || ['entry', 'junior', 'mid']).map((item) => normalizeComparable(item));

  if (!detected || detected === 'unspecified') return { detected: 'unspecified', score: 72 };
  if (targets.includes(detected)) return { detected, score: 90 };
  if (detected === 'mid' && targets.includes('junior')) return { detected, score: 72 };
  if (detected === 'senior') return { detected, score: targets.includes('senior') ? 88 : 48 };
  if (detected === 'executive') return { detected, score: targets.includes('executive') ? 85 : 25 };
  return { detected, score: 65 };
}

function estimateCompanyContext(jobText, job) {
  const text = normalizeComparable(jobText);
  if (/enterprise|global|fortune|large team/.test(text)) return { type: 'larger-company', score: 64 };
  if (/startup|small business|boutique|agency|client/.test(text)) return { type: 'small-team', score: 76 };
  if (job?.source === 'bruntwork') return { type: 'remote client-service', score: 72 };
  return { type: 'professional', score: 70 };
}

function estimateCompetitionLevel(jobText, job) {
  const text = normalizeComparable(`${job?.title || ''} ${jobText}`);
  if (/entry level|virtual assistant|data entry|general assistant|remote/.test(text)) {
    return { level: 'high', score: 55 };
  }
  if (/specialist|technical|shopify|seo|developer|e-commerce/.test(text)) {
    return { level: 'medium', score: 70 };
  }
  if (/niche|bilingual|certified|licensed|senior/.test(text)) {
    return { level: 'lower', score: 78 };
  }
  return { level: 'medium', score: 68 };
}

function extractKnownTerms(text, terms) {
  return terms.filter((term) => aliasesFor(term).some((alias) => containsKeyword(text, alias)));
}

function extractRoleKeywords(title, jobText) {
  const titleWords = normalizeComparable(title)
    .split(' ')
    .filter((word) => word.length > 3 && !stopWords.has(word));
  const frequentWords = wordFrequency(jobText)
    .filter(([word, count]) => count >= 2 && word.length > 4 && !stopWords.has(word))
    .slice(0, 5)
    .map(([word]) => titleCase(word));
  return Array.from(new Set([...titleWords.map(titleCase), ...frequentWords])).slice(0, 8);
}

function extractLikelyRequirementText(description = '') {
  const lines = String(description || '')
    .split(/\n|\.|;/)
    .map(compactText)
    .filter(Boolean);
  return lines
    .filter((line) => /require|qualification|must|need|proficient|experience|skill/i.test(line))
    .slice(0, 10)
    .join(' ');
}

function extractExpectations(job) {
  const source = compactText([job.responsibilities, job.requirements, job.description].join(' '));
  const sentences = source
    .split(/(?<=[.!?])\s+|;/)
    .map(compactText)
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 180)
    .filter((sentence) => /manage|create|maintain|support|optimi[sz]e|coordinate|research|develop|improve|assist|handle/i.test(sentence));
  return sentences.slice(0, 3).map((sentence) => sentence.replace(/\.$/, '').toLowerCase());
}

function summarizeRoleFocus(job, keywordAnalysis) {
  const title = normalizeComparable(job.title);
  const matched = keywordAnalysis.matched_keywords.slice(0, 3);

  if (/seo/.test(title) || matched.some((skill) => /seo|search/i.test(skill))) {
    return 'improving search visibility, technical quality, and content performance';
  }
  if (/shopify|e commerce|ecommerce|marketplace/.test(title) || matched.some((skill) => /shopify|commerce|marketplace/i.test(skill))) {
    return 'supporting e-commerce operations, storefront quality, and product visibility';
  }
  if (/web|developer|website/.test(title) || matched.some((skill) => /web|javascript|html|css|wordpress/i.test(skill))) {
    return 'maintaining reliable web experiences and improving site performance';
  }
  if (/support|assistant|admin|operations/.test(title)) {
    return 'keeping operations organized, responsive, and accurate';
  }
  if (matched.length > 0) {
    return `delivering strong work across ${toPhrase(matched)}`;
  }
  return 'delivering accurate, organized, and useful work for the team';
}

function pickSupportedSkills(keywordAnalysis, candidateProfile = {}, limit = 3) {
  const matched = keywordAnalysis.matched_keywords.filter((keyword) => !softSkillKeywords.includes(keyword));
  const profileSkills = candidateProfile.skills || [];
  const fallback = profileSkills.length > 0 ? profileSkills : candidateProfile.strengths || [];
  return Array.from(new Set([...matched, ...fallback])).slice(0, limit);
}

function buildJobText(job = {}) {
  return [job.title, job.description, job.requirements, job.responsibilities, job.company, job.location]
    .map(compactText)
    .filter(Boolean)
    .join(' ');
}

function buildCandidateText(candidateProfile = {}, resumeText = '') {
  return [
    candidateProfile.name,
    ...(candidateProfile.skills || []),
    ...(candidateProfile.strengths || []),
    ...(candidateProfile.preferredRoles || []),
    ...(candidateProfile.secondaryRoles || []),
    candidateProfile.resumeTextPreview,
    resumeText
  ]
    .map(compactText)
    .filter(Boolean)
    .join(' ');
}

function keywordSupported(keyword, candidateText, candidateProfile = {}) {
  const aliases = aliasesFor(keyword);
  const profileAliases = candidateProfile.skillAliases || {};
  const customAliases = Array.isArray(profileAliases[keyword]) ? profileAliases[keyword] : [];
  return [...aliases, ...customAliases].some((alias) => containsKeyword(candidateText, alias));
}

function aliasesFor(keyword) {
  return Array.from(new Set([keyword, ...(keywordAliases[keyword] || [])]));
}

function countKeyword(text, keyword) {
  const normalizedText = ` ${normalizeComparable(text)} `;
  const normalizedKeyword = normalizeComparable(keyword);
  if (!normalizedText.trim() || !normalizedKeyword) return 0;
  return normalizedText.split(` ${normalizedKeyword} `).length - 1;
}

function containsKeyword(text, keyword) {
  const normalizedText = ` ${normalizeComparable(text)} `;
  const normalizedKeyword = normalizeComparable(keyword);
  if (!normalizedKeyword) return false;
  return normalizedText.includes(` ${normalizedKeyword} `);
}

function normalizeComparable(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectExperienceLevel(text) {
  const normalized = normalizeComparable(text);
  if (isAssistantRole(normalized)) return /\b(senior|lead)\b/.test(normalized) ? 'senior' : 'junior';
  if (/\b(chief|vp|director|head of|c suite|c level)\b/.test(normalized)) return 'executive';
  if (/\bexecutive\b/.test(normalized) && !/\bexecutive\s+(assistant|support|coordinator|administrator)\b/.test(normalized)) return 'executive';
  if (/\b(senior|lead|5 years|five years|7 years|seven years)\b/.test(normalized)) return 'senior';
  if (/\b(mid level|intermediate|2 years|two years|3 years|three years|4 years|four years)\b/.test(normalized)) return 'mid';
  if (/\b(junior|entry level|1 year|one year|assistant)\b/.test(normalized)) return 'junior';
  return 'unspecified';
}

function isAssistantRole(normalizedText) {
  return /\b(executive assistant|c suite executive assistant|c level executive assistant|admin assistant|administrative assistant|virtual assistant|personal assistant|office assistant)\b/.test(normalizedText);
}

function wordFrequency(text) {
  const counts = new Map();
  for (const word of normalizeComparable(text).split(' ')) {
    if (!word || stopWords.has(word) || /^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function toPhrase(items) {
  const cleanItems = items.map(compactText).filter(Boolean);
  if (cleanItems.length === 0) return 'the relevant skills in my profile';
  if (cleanItems.length === 1) return cleanItems[0];
  if (cleanItems.length === 2) return `${cleanItems[0]} and ${cleanItems[1]}`;
  return `${cleanItems.slice(0, -1).join(', ')}, and ${cleanItems.at(-1)}`;
}

function trimToWordLimit(text, limit) {
  const words = compactText(text).split(/\s+/).filter(Boolean);
  if (words.length <= limit) return text;
  return `${words.slice(0, limit).join(' ')}.`;
}

function asScore(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? clampScore(parsed) : NaN;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number.parseInt(value, 10) || 0));
}

function dedupeFlags(flags) {
  const seen = new Set();
  return flags.filter((flag) => {
    const key = `${flag.code}:${flag.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleCase(value) {
  return String(value || '')
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}
