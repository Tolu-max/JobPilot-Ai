import aiRouter, { TaskTypes } from './aiRouter.js';

const fallbackAnalysis = {
  score: 0,
  decision: 'ignore',
  reasons: ['AI router was not configured or returned an invalid response.'],
  missing_skills: [],
  cover_letter: ''
};

export async function analyzeJobFit(job, config) {
  const prompt = buildPrompt(job, config);

  try {
    const routed = await aiRouter.request({
      taskType: TaskTypes.FAST_FILTER,
      prompt,
      profile: { profileName: config.profileName, name: config.displayName },
      jobData: job,
      fallbackLevel: 'analysis',
      config
    });

    const parsed = parseJson(routed.response);
    return normalizeAnalysis(parsed);
  } catch (error) {
    return {
      ...fallbackAnalysis,
      reasons: [`AI router analysis failed: ${error.message}`]
    };
  }
}

export async function verifyJobFit(job, candidateProfile, localAnalysis, config) {
  const prompt = buildVerificationPrompt(job, candidateProfile, localAnalysis, config);
  const taskType = Number.parseInt(localAnalysis.score, 10) >= 90
    ? TaskTypes.HIGH_VALUE_APPLICATION
    : TaskTypes.JOB_VERIFICATION;

  try {
    const routed = await aiRouter.request({
      taskType,
      prompt,
      profile: { ...candidateProfile, profileName: config.profileName },
      jobData: { ...job, localScore: localAnalysis.score },
      fallbackLevel: 'verification',
      config
    });

    const result = normalizeVerification(parseJson(routed.response), localAnalysis.score);
    return {
      ...result,
      model_used: routed.modelUsed,
      mock: Boolean(routed.mock),
      ai_router: {
        modelUsed: routed.modelUsed,
        confidence: routed.confidence,
        costLevel: routed.costLevel,
        fallbackUsed: routed.fallbackUsed,
        mock: Boolean(routed.mock)
      }
    };
  } catch (error) {
    return {
      adjusted_score: localAnalysis.score,
      confidence: 0,
      should_apply: localAnalysis.score >= 88,
      reasoning: `AI router verification failed: ${error.message}`,
      ats_risk: 'unknown',
      improved_cover_letter: '',
      application_answers: {},
      verification_failed: true
    };
  }
}

export function isMockAiMode(config = {}) {
  return String(config.aiMode || process.env.AI_MODE || '').trim().toUpperCase() === 'MOCK';
}

function buildPrompt(job, config) {
  return `Compare this job description with the user's profile and return JSON:
{
  "score": 0-100,
  "decision": "auto_apply" | "review" | "ignore",
  "reasons": string[],
  "missing_skills": string[],
  "cover_letter": string
}

Decision thresholds:
- score >= 90: auto_apply
- score 70-89: review
- score < 70: ignore

CAREER BRAIN INSTRUCTIONS:
${config.careerBrainPrompt || 'Use the candidate profile and avoid exaggeration.'}

USER PROFILE:
- ${config.userProfile}

JOB:
Title: ${job.title}
Application URL: ${job.applicationUrl}
Description: ${job.description}
Requirements: ${job.requirements}
Responsibilities: ${job.responsibilities}`;
}

function buildVerificationPrompt(job, candidateProfile, localAnalysis, config) {
  return `Verify whether this candidate is truly a good fit for this role.

Return JSON only:
{
  "adjusted_score": 0-100,
  "confidence": 0-100,
  "should_apply": boolean,
  "reasoning": string,
  "ats_risk": string,
  "improved_cover_letter": string,
  "application_answers": object
}

Do NOT over-penalize transferable skills.
Do NOT invent credentials, employers, certifications, degrees, locations, or years of experience.
If the local score is strong but the role conflicts with hard filters, set should_apply=false.

CAREER BRAIN INSTRUCTIONS:
${config.careerBrainPrompt || 'Use the candidate profile and keep the application honest, specific, and concise.'}

CANDIDATE PROFILE:
Name: ${candidateProfile.name || 'Candidate'}
Skills: ${(candidateProfile.skills || []).join(', ')}
Preferred Roles: ${(candidateProfile.preferredRoles || []).join(', ')}
Strengths: ${(candidateProfile.strengths || []).slice(0, 5).join(', ')}
Summary: ${candidateProfile.userProfileSummary || ''}

LOCAL SCREENING RESULT:
${JSON.stringify(localAnalysis, null, 2)}

JOB:
Title: ${job.title}
Application URL: ${job.applicationUrl}
Description: ${job.description}
Requirements: ${job.requirements}
Responsibilities: ${job.responsibilities}`;
}

function parseJson(text) {
  const raw = String(text || '').trim();
  // Try direct parse first (fastest path)
  try { return JSON.parse(raw); } catch { /* fall through */ }
  // Strip markdown code fences
  const fenceStripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(fenceStripped); } catch { /* fall through */ }
  // Extract first {...} or [...] block from prose
  const match = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (match) return JSON.parse(match[1]);
  throw new Error('No valid JSON found in AI response');
}

function normalizeAnalysis(value) {
  const score = Math.max(0, Math.min(100, Number.parseInt(value.score, 10) || 0));
  return {
    score,
    decision: ['auto_apply', 'review', 'ignore'].includes(value.decision) ? value.decision : 'ignore',
    reasons: Array.isArray(value.reasons) ? value.reasons.map(String) : [],
    missing_skills: Array.isArray(value.missing_skills) ? value.missing_skills.map(String) : [],
    cover_letter: String(value.cover_letter || '')
  };
}

function normalizeVerification(value, fallbackScore) {
  const adjustedScore = Math.max(0, Math.min(100, Number.parseInt(value.adjusted_score, 10) || fallbackScore));
  return {
    adjusted_score: adjustedScore,
    confidence: Math.max(0, Math.min(100, Number.parseInt(value.confidence, 10) || 0)),
    should_apply: Boolean(value.should_apply),
    reasoning: String(value.reasoning || ''),
    ats_risk: String(value.ats_risk || ''),
    improved_cover_letter: String(value.improved_cover_letter || ''),
    application_answers: value.application_answers && typeof value.application_answers === 'object' ? value.application_answers : {},
    verification_failed: false
  };
}
