/**
 * Gmail Application Matcher
 *
 * Associating incoming emails with specific applied job records in candidate jobStore.
 * Never silently attaches ambiguous emails.
 */

import { loadJobStore } from '../jobStore.js';
import { compactText } from '../utils.js';

export const MatchConfidenceLevel = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  UNMATCHED: 'UNMATCHED'
});

export async function matchEmailToApplication(parsedEmail = {}, config = {}) {
  const store = await loadJobStore(config);
  const allJobs = store.jobs || [];

  const extractedRole = parsedEmail.extractedRoleTitle || '';
  const extractedJobId = parsedEmail.extractedJobId || '';

  if (allJobs.length === 0) {
    return {
      matchConfidenceLevel: MatchConfidenceLevel.UNMATCHED,
      confidence: 0,
      jobRecord: null,
      matchedField: null,
      extractedRoleTitle: extractedRole,
      extractedJobId,
      reason: 'Candidate job store is currently empty'
    };
  }

  let bestMatch = null;
  let bestScore = 0;
  let bestReasons = [];

  const emailText = `${parsedEmail.subject || ''} ${parsedEmail.snippet || ''} ${parsedEmail.bodyText || ''}`.toLowerCase();
  const threadId = parsedEmail.threadId;

  for (const job of allJobs) {
    let score = 0;
    let reasons = [];

    // Priority A: Exact BruntWork / External Job ID match
    if (extractedJobId) {
      const isIdInUrl = job.job_url && job.job_url.includes(extractedJobId);
      const isIdInSourceId = job.sourceJobId && String(job.sourceJobId) === extractedJobId;
      const isIdInHash = job.job_hash && job.job_hash.includes(extractedJobId);

      if (isIdInUrl || isIdInSourceId || isIdInHash) {
        score += 95;
        reasons.push(`Exact Job ID match: ${extractedJobId}`);
      }
    }

    // Priority B: Exact URL in email text
    if (job.job_url && emailText.includes(job.job_url.toLowerCase())) {
      score += 90;
      reasons.push('Exact job URL found in email');
    }

    // Priority C: Exact normalized role title match
    if (extractedRole && job.title) {
      const normExtracted = normalizeTitleForComparison(extractedRole);
      const normJob = normalizeTitleForComparison(job.title);

      if (normExtracted === normJob) {
        score += 85;
        reasons.push(`Exact role title match: "${job.title}"`);
      } else if (normExtracted.includes(normJob) || normJob.includes(normExtracted)) {
        score += 75;
        reasons.push(`Role title substring match: "${job.title}"`);
      } else {
        const wordOverlap = calculateWordOverlap(normExtracted, normJob);
        if (wordOverlap >= 0.75) {
          score += 65;
          reasons.push(`Strong role title similarity (${Math.round(wordOverlap * 100)}%): "${job.title}"`);
        } else if (wordOverlap >= 0.5) {
          score += 35;
          reasons.push(`Partial role title similarity: "${job.title}"`);
        }
      }
    } else if (job.title) {
      // Fallback title matching against subject / email text
      const titleScore = calculateRawTitleMatchScore(job.title, emailText, parsedEmail.subject);
      if (titleScore > 0) {
        score += titleScore;
        reasons.push(`Subject/text title match score: +${titleScore}`);
      }
    }

    // Priority D: Company match
    const isBruntworkSender = /bruntwork/i.test(parsedEmail.senderEmail || '') || /bruntwork/i.test(parsedEmail.from || '');
    const isBruntworkJob = String(job.source_site || '').toLowerCase() === 'bruntwork' || /bruntwork/i.test(job.company || '');
    if (isBruntworkSender && isBruntworkJob) {
      score += 15;
      reasons.push('BruntWork company alignment');
    }

    // Priority E: Conversation thread match
    if (threadId && Array.isArray(job.lifecycleEvents)) {
      if (job.lifecycleEvents.some(e => e.threadId === threadId)) {
        score += 30;
        reasons.push('Existing Gmail conversation thread match');
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = job;
      bestReasons = reasons;
    }
  }

  // Normalize score to confidence level
  const normalizedConfidence = Math.max(0, Math.min(1.0, bestScore / 100));

  let confidenceLevel = MatchConfidenceLevel.UNMATCHED;
  if (bestScore >= 80) {
    confidenceLevel = MatchConfidenceLevel.HIGH;
  } else if (bestScore >= 50) {
    confidenceLevel = MatchConfidenceLevel.MEDIUM;
  } else if (bestScore >= 30) {
    confidenceLevel = MatchConfidenceLevel.LOW;
  }

  return {
    matchConfidenceLevel: confidenceLevel,
    confidence: normalizedConfidence,
    jobRecord: confidenceLevel !== MatchConfidenceLevel.UNMATCHED ? bestMatch : null,
    matchedField: bestReasons.join(', '),
    extractedRoleTitle: extractedRole,
    extractedJobId,
    reason: bestReasons.join('; ') || 'No significant match found'
  };
}

function normalizeTitleForComparison(title = '') {
  return compactText(title)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateWordOverlap(titleA = '', titleB = '') {
  const stopWords = new Set(['the', 'and', 'for', 'with', 'in', 'at', 'to', 'a', 'an', 'specialist', 'developer', 'assistant', 'manager']);
  const wordsA = titleA.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  const wordsB = new Set(titleB.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w)));

  if (wordsA.length === 0 || wordsB.size === 0) return 0;

  let matches = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      matches += 1;
    }
  }

  return matches / Math.max(wordsA.length, wordsB.size);
}

function calculateRawTitleMatchScore(jobTitle = '', emailText = '', subject = '') {
  if (!jobTitle) return 0;

  const cleanJobTitle = compactText(jobTitle).toLowerCase();
  const cleanSubject = compactText(subject).toLowerCase();

  if (cleanSubject.includes(cleanJobTitle)) return 45;
  if (emailText.includes(cleanJobTitle)) return 35;

  return 0;
}
