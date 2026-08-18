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
  const appliedJobs = (store.jobs || []).filter(j => j.status === 'applied' || j.lifecycleStatus);

  if (appliedJobs.length === 0) {
    return {
      matchConfidenceLevel: MatchConfidenceLevel.UNMATCHED,
      confidence: 0,
      jobRecord: null,
      matchedField: null,
      reason: 'No applied jobs found in candidate store'
    };
  }

  let bestMatch = null;
  let bestScore = 0;
  let bestField = null;
  let bestReason = '';

  const emailText = `${parsedEmail.subject || ''} ${parsedEmail.snippet || ''} ${parsedEmail.bodyText || ''}`.toLowerCase();
  const threadId = parsedEmail.threadId;

  for (const job of appliedJobs) {
    let score = 0;
    let matchReasons = [];

    // Signal 0: Existing thread association (highest confidence)
    if (threadId && Array.isArray(job.lifecycleEvents)) {
      const hasThreadEvent = job.lifecycleEvents.some(e => e.threadId === threadId);
      if (hasThreadEvent) {
        score += 60;
        matchReasons.push('Matching Gmail conversation thread');
      }
    }

    // Signal 1: Direct Job URL in email text
    if (job.job_url && emailText.includes(job.job_url.toLowerCase())) {
      score += 50;
      matchReasons.push('Exact job URL found in email');
    }

    // Signal 2: Reference ID / Job Hash
    if (job.job_hash && emailText.includes(job.job_hash.toLowerCase())) {
      score += 40;
      matchReasons.push('Job hash / reference ID found in email');
    }

    // Signal 3: Job Title Match
    const titleScore = calculateTitleMatchScore(job.title, emailText, parsedEmail.subject);
    if (titleScore > 0) {
      score += titleScore;
      matchReasons.push(`Title match score: +${titleScore}`);
    }

    // Signal 4: Company Match
    if (job.company) {
      const companyNorm = job.company.toLowerCase().trim();
      if (companyNorm && (emailText.includes(companyNorm) || parsedEmail.senderEmail?.includes(companyNorm))) {
        score += 20;
        matchReasons.push(`Company match: "${job.company}"`);
      }
    }

    // Signal 5: Bruntwork Source alignment
    const isBruntworkSender = /bruntwork|brunt/i.test(parsedEmail.senderEmail || '') || /bruntwork/i.test(parsedEmail.from || '');
    const isBruntworkJob = String(job.source_site || '').toLowerCase() === 'bruntwork';
    if (isBruntworkSender && isBruntworkJob) {
      score += 15;
      matchReasons.push('BruntWork sender matched BruntWork applied role');
    }

    // Signal 6: Date order check (email should arrive on or after job creation/application)
    if (job.appliedAt || job.createdAt) {
      const appliedTime = new Date(job.appliedAt || job.createdAt).getTime();
      const emailTime = new Date(parsedEmail.receivedAt).getTime();
      if (emailTime < appliedTime - 86400000) { // email predates application by > 1 day
        score -= 40;
        matchReasons.push('Email timestamp predates application');
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = job;
      bestField = matchReasons.join(', ');
      bestReason = matchReasons.join('; ');
    }
  }

  // Normalize score to confidence
  const normalizedConfidence = Math.max(0, Math.min(1.0, bestScore / 100));

  let confidenceLevel = MatchConfidenceLevel.UNMATCHED;
  if (normalizedConfidence >= 0.80) {
    confidenceLevel = MatchConfidenceLevel.HIGH;
  } else if (normalizedConfidence >= 0.50) {
    confidenceLevel = MatchConfidenceLevel.MEDIUM;
  } else if (normalizedConfidence >= 0.25) {
    confidenceLevel = MatchConfidenceLevel.LOW;
  }

  return {
    matchConfidenceLevel: confidenceLevel,
    confidence: normalizedConfidence,
    jobRecord: confidenceLevel !== MatchConfidenceLevel.UNMATCHED ? bestMatch : null,
    matchedField: bestField,
    reason: bestReason || 'No significant match found'
  };
}

function calculateTitleMatchScore(jobTitle = '', emailText = '', subject = '') {
  if (!jobTitle) return 0;

  const cleanJobTitle = compactText(jobTitle).toLowerCase();
  const cleanSubject = compactText(subject).toLowerCase();

  // Exact title in subject
  if (cleanSubject.includes(cleanJobTitle)) {
    return 45;
  }

  // Exact title in full email text
  if (emailText.includes(cleanJobTitle)) {
    return 35;
  }

  // Significant word overlap
  const stopWords = new Set(['the', 'and', 'for', 'with', 'in', 'at', 'to', 'a', 'an', 'senior', 'junior', 'remote']);
  const titleWords = cleanJobTitle
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  if (titleWords.length === 0) return 0;

  let matchedWords = 0;
  for (const word of titleWords) {
    if (emailText.includes(word)) {
      matchedWords += 1;
    }
  }

  const ratio = matchedWords / titleWords.length;
  if (ratio >= 0.8) return 25;
  if (ratio >= 0.5) return 15;

  return 0;
}
