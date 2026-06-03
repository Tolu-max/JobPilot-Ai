import fs from 'node:fs/promises';
import path from 'node:path';
import aiRouter, { TaskTypes, hasAvailableAiProvider } from './aiRouter.js';

/**
 * Reads the user's base resume and the scraped job description,
 * then uses the configured AI router to output tailored application materials.
 */
export async function tailorResumeAndCoverLetter(jobId, jobTitle, jobDescription, baseResumeText, profileDir, configOrApiKey = {}) {
  try {
    console.log(`[ResumeTailor] Generating tailored materials for ${jobTitle}...`);

    const config = normalizeTailorConfig(configOrApiKey);
    if (!hasAvailableAiProvider(config)) {
      console.warn('[ResumeTailor] No available AI provider configured. Skipping tailoring.');
      return null;
    }

    const prompt = `
You are an expert technical recruiter and resume writer.
I will provide you with a Job Description and a Base Resume.
Your task is to tailor the resume and write a cover letter that specifically targets the requirements of the job.

JOB DESCRIPTION:
${jobDescription.substring(0, 3000)}

BASE RESUME:
${baseResumeText.substring(0, 4000)}

DIRECTIONS:
1. Do NOT lie or invent experience that is not in the Base Resume.
2. Reorder or emphasize bullet points in the resume that match the job description keywords.
3. Write a concise, enthusiastic Cover Letter (max 3 paragraphs) addressing the company/role.
4. Output the result strictly in JSON format as follows:
{
  "tailoredResumeMarkdown": "...",
  "coverLetterText": "..."
}
`;

    const routed = await aiRouter.request({
      taskType: TaskTypes.APPLICATION_WRITING,
      prompt,
      profile: { profileName: config.profileName || 'default', name: config.displayName },
      jobData: { title: jobTitle, localScore: 95 },
      fallbackLevel: 'resume-tailor',
      config
    });

    const result = parseJson(routed.response);
    const tailoredResumeMarkdown = String(result.tailoredResumeMarkdown || result.tailored_resume_markdown || '').trim();
    const coverLetterText = String(result.coverLetterText || result.cover_letter_text || result.cover_letter || '').trim();

    if (!tailoredResumeMarkdown && !coverLetterText) {
      throw new Error(`AI router returned no tailored materials via ${routed.modelUsed}`);
    }

    // Save them to the profile directory inside a 'tailored' folder
    const tailoredDir = path.join(profileDir, 'tailored');
    await fs.mkdir(tailoredDir, { recursive: true });

    const safeJobTitle = jobTitle.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    const resumePath = path.join(tailoredDir, `resume_${safeJobTitle}_${jobId}.md`);
    const coverLetterPath = path.join(tailoredDir, `cover_${safeJobTitle}_${jobId}.txt`);

    await fs.writeFile(resumePath, tailoredResumeMarkdown || baseResumeText, 'utf-8');
    await fs.writeFile(coverLetterPath, coverLetterText, 'utf-8');

    console.log(`[ResumeTailor] Success via ${routed.modelUsed}. Saved to ${resumePath}`);

    return {
      resumePath,
      coverLetterPath,
      coverLetterText
    };
  } catch (err) {
    console.error(`[ResumeTailor] Failed to tailor resume: ${err.message}`);
    return null;
  }
}

function normalizeTailorConfig(configOrApiKey) {
  if (typeof configOrApiKey === 'string') {
    return {
      geminiApiKey: configOrApiKey,
      geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      groqApiKey: process.env.GROQ_API_KEY || '',
      groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
      openRouterModel: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct',
      openRouterSiteUrl: process.env.OPENROUTER_SITE_URL || 'http://localhost',
      openRouterAppName: process.env.OPENROUTER_APP_NAME || 'JobPilot',
      aiProvider: process.env.AI_PROVIDER || process.env.AI_LAYER || 'gemini',
      aiDisabledProviders: process.env.AI_DISABLED_PROVIDERS || process.env.DISABLED_AI_PROVIDERS || ''
    };
  }
  return configOrApiKey || {};
}

function parseJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(fenced); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new Error('No valid JSON found in tailored-materials response');
}
