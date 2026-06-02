import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Reads the user's base resume and the scraped job description,
 * then uses Gemini AI to output a highly tailored Markdown version of the resume
 * and a custom Cover Letter emphasizing the exact keywords the employer wants.
 */
export async function tailorResumeAndCoverLetter(jobId, jobTitle, jobDescription, baseResumeText, profileDir, apiKey) {
  try {
    console.log(`[ResumeTailor] Generating tailored materials for ${jobTitle}...`);
    
    if (!apiKey) {
      console.warn('[ResumeTailor] No Gemini API key provided. Skipping tailoring.');
      return null;
    }

    const ai = new GoogleGenAI({ apiKey });
    
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

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json'
      }
    });

    const outputText = response.text || '';
    const result = JSON.parse(outputText);

    // Save them to the profile directory inside a 'tailored' folder
    const tailoredDir = path.join(profileDir, 'tailored');
    await fs.mkdir(tailoredDir, { recursive: true });

    const safeJobTitle = jobTitle.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    const resumePath = path.join(tailoredDir, `resume_${safeJobTitle}_${jobId}.md`);
    const coverLetterPath = path.join(tailoredDir, `cover_${safeJobTitle}_${jobId}.txt`);

    await fs.writeFile(resumePath, result.tailoredResumeMarkdown, 'utf-8');
    await fs.writeFile(coverLetterPath, result.coverLetterText, 'utf-8');

    console.log(`[ResumeTailor] Success. Saved to ${resumePath}`);

    return {
      resumePath,
      coverLetterPath,
      coverLetterText: result.coverLetterText
    };
  } catch (err) {
    console.error(`[ResumeTailor] Failed to tailor resume: ${err.message}`);
    return null;
  }
}
