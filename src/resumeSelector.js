/**
 * Deterministic Resume Selector
 *
 * Maps a job (title, description, requirements) to the most fitting fixed resume profile
 * for the given candidate without requiring runtime LLM tokens.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getCandidateResumeProfiles, getResumeProfile } from './resumeLibrary.js';

/**
 * Select the optimal fixed resume profile for a job.
 *
 * @param {object} config - Candidate configuration object (containing profileName, profileDir, resumePath, etc.)
 * @param {object} job - Scraped job object (containing title, description, requirements, etc.)
 * @returns {object} Selected resume details with fallback safety
 */
export function selectResumeForJob(config = {}, job = {}) {
  const candidateId = String(config.profileName || 'tolu').toLowerCase().trim();
  const defaultFallbackPath = config.resumePath
    ? (path.isAbsolute(config.resumePath) ? config.resumePath : path.resolve(process.cwd(), config.resumePath))
    : path.resolve(process.cwd(), 'profiles', candidateId, 'resume.pdf');

  const availableProfiles = getCandidateResumeProfiles(candidateId);
  if (!availableProfiles || availableProfiles.length === 0) {
    return {
      profileId: `${candidateId}-default`,
      resumePath: defaultFallbackPath,
      resumeText: '',
      selectionReason: 'No fixed resume profiles configured; using default candidate resume.',
      confidence: 1.0,
      fallbackUsed: true
    };
  }

  const jobTitle = String(job.title || '').toLowerCase();
  const jobText = `${jobTitle} ${String(job.description || '')} ${String(job.requirements || '')}`.toLowerCase();

  let bestProfile = null;
  let bestScore = -1;
  let bestMatches = [];

  for (const profile of availableProfiles) {
    let score = 0;
    const matches = [];

    // 1. Direct target role matches in job title (High weight: +30)
    for (const targetRole of profile.targetRoles || []) {
      const regex = new RegExp(`\\b${escapeRegex(targetRole)}\\b`, 'i');
      if (regex.test(jobTitle)) {
        score += 30;
        matches.push(`title:${targetRole}`);
      } else if (regex.test(jobText)) {
        score += 8;
        matches.push(`body-role:${targetRole}`);
      }
    }

    // 2. Keyword density matches in title & text (Weight: title +10, body +2)
    for (const kw of profile.targetKeywords || []) {
      const kwRegex = new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i');
      if (kwRegex.test(jobTitle)) {
        score += 10;
        matches.push(`title-kw:${kw}`);
      } else if (kwRegex.test(jobText)) {
        score += 2;
        matches.push(`kw:${kw}`);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestProfile = profile;
      bestMatches = matches;
    }
  }

  // If no keywords matched, default to the primary profile (first in list)
  if (!bestProfile || bestScore <= 0) {
    const primary = availableProfiles[0];
    const resolvedPath = resolveResumePdfPath(config.profileDir, candidateId, primary.folderName, defaultFallbackPath);
    return {
      profileId: primary.id,
      resumePath: resolvedPath.pdfPath,
      resumeText: resolvedPath.text,
      selectionReason: `Default primary role selected (${primary.title}) due to generic job listing.`,
      confidence: 0.5,
      fallbackUsed: resolvedPath.fallbackUsed
    };
  }

  const resolvedPath = resolveResumePdfPath(config.profileDir, candidateId, bestProfile.folderName, defaultFallbackPath);
  const matchedSummary = bestMatches.slice(0, 4).join(', ') || 'role alignment';

  return {
    profileId: bestProfile.id,
    resumePath: resolvedPath.pdfPath,
    resumeText: resolvedPath.text,
    selectionReason: `Matched ${bestProfile.title} via [${matchedSummary}] (score: ${bestScore}).`,
    confidence: Math.min(1.0, 0.6 + (bestScore / 50)),
    fallbackUsed: resolvedPath.fallbackUsed
  };
}

/**
 * Resolves the physical path of the resume PDF on disk, verifying its existence.
 */
function resolveResumePdfPath(profileDir, candidateId, folderName, defaultFallbackPath) {
  const baseDir = profileDir || path.resolve(process.cwd(), 'profiles', candidateId);
  const targetPdf = path.join(baseDir, 'resumes', folderName, 'resume.pdf');
  const targetTxt = path.join(baseDir, 'resumes', folderName, 'resume.txt');

  if (fs.existsSync(targetPdf)) {
    let text = '';
    try {
      if (fs.existsSync(targetTxt)) {
        text = fs.readFileSync(targetTxt, 'utf8');
      }
    } catch {
      // Ignored
    }
    return { pdfPath: targetPdf, text, fallbackUsed: false };
  }

  // Fallback to default
  let fallbackText = '';
  try {
    const txt = path.join(baseDir, 'resumes', folderName, 'resume.txt');
    if (fs.existsSync(txt)) fallbackText = fs.readFileSync(txt, 'utf8');
  } catch {}

  return {
    pdfPath: defaultFallbackPath,
    text: fallbackText,
    fallbackUsed: true
  };
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
