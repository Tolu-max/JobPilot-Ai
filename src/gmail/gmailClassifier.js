/**
 * Gmail Email Event Classifier & Interview Extractor
 *
 * Deterministic first-layer classification with strong keyword signals
 * and interview metadata extraction.
 */

import { hasAvailableAiProvider, request, TaskTypes } from '../aiRouter.js';

export const EmailEventType = Object.freeze({
  APPLICATION_CONFIRMATION: 'APPLICATION_CONFIRMATION',
  RECRUITER_RESPONSE: 'RECRUITER_RESPONSE',
  ASSESSMENT: 'ASSESSMENT',
  RECRUITER_INTERVIEW: 'RECRUITER_INTERVIEW',
  CLIENT_INTERVIEW: 'CLIENT_INTERVIEW',
  REJECTION: 'REJECTION',
  OFFER: 'OFFER',
  UNKNOWN: 'UNKNOWN'
});

export async function classifyEmailMessage(parsedEmail = {}, config = {}) {
  // Tier 1: High-confidence deterministic classification
  const deterministic = classifyDeterministic(parsedEmail);

  if (deterministic.confidence >= 0.8 || deterministic.classification !== EmailEventType.UNKNOWN) {
    const extractedInterview = isInterviewStage(deterministic.classification)
      ? extractInterviewDetails(parsedEmail)
      : null;

    return {
      classification: deterministic.classification,
      confidence: deterministic.confidence,
      reason: deterministic.reason,
      tier: 'deterministic',
      interviewDetails: extractedInterview
    };
  }

  // Tier 2: Optional AI fallback for ambiguous emails if AI provider available
  if (config && hasAvailableAiProvider(config)) {
    try {
      const aiResult = await classifyWithAi(parsedEmail, config);
      if (aiResult && aiResult.classification) {
        const extractedInterview = isInterviewStage(aiResult.classification)
          ? extractInterviewDetails(parsedEmail)
          : null;

        return {
          ...aiResult,
          tier: 'ai_fallback',
          interviewDetails: extractedInterview
        };
      }
    } catch (err) {
      console.warn(`[gmailClassifier] AI classification fallback skipped: ${err.message}`);
    }
  }

  return {
    classification: EmailEventType.UNKNOWN,
    confidence: 0.1,
    reason: 'Insufficient matching patterns',
    tier: 'fallback',
    interviewDetails: null
  };
}

export function classifyDeterministic(parsedEmail = {}) {
  const subject = String(parsedEmail.subject || '').toLowerCase();
  const body = String(parsedEmail.bodyText || '').toLowerCase();
  const text = `${subject}\n\n${body}`;

  // 1. REJECTION signals (check first or high weight to avoid misinterpreting polite rejection phrasing)
  const rejectionPatterns = [
    /unfortunately/i,
    /not (?:moving|proceeding) forward/i,
    /decided to (?:proceed|move forward) with (?:another|other) candidate/i,
    /pursue other candidates/i,
    /position has been filled/i,
    /will not be moving your application/i,
    /not be proceeding with your application/i,
    /regret to inform you/i,
    /not selected for (?:this|the) (?:role|position)/i,
    /we won't be moving forward/i,
    /other applicants whose skills and experience more closely align/i
  ];

  for (const pattern of rejectionPatterns) {
    if (pattern.test(text)) {
      return {
        classification: EmailEventType.REJECTION,
        confidence: 0.95,
        reason: `Matched rejection pattern: "${pattern.source}"`
      };
    }
  }

  // 2. OFFER signals
  const offerPatterns = [
    /offer of employment/i,
    /job offer/i,
    /pleased to offer you the (?:position|role)/i,
    /offer letter/i,
    /employment agreement/i,
    /welcome to the team/i,
    /congratulations on your offer/i
  ];

  for (const pattern of offerPatterns) {
    if (pattern.test(text)) {
      return {
        classification: EmailEventType.OFFER,
        confidence: 0.95,
        reason: `Matched offer pattern: "${pattern.source}"`
      };
    }
  }

  // 3. CLIENT INTERVIEW signals
  const clientInterviewPatterns = [
    /client interview/i,
    /interview with (?:the|our) client/i,
    /meet (?:with )?(?:the|our) client/i,
    /client round/i,
    /client meeting/i,
    /client team interview/i
  ];

  for (const pattern of clientInterviewPatterns) {
    if (pattern.test(text)) {
      return {
        classification: EmailEventType.CLIENT_INTERVIEW,
        confidence: 0.92,
        reason: `Matched client interview pattern: "${pattern.source}"`
      };
    }
  }

  // 4. RECRUITER INTERVIEW / GENERAL INTERVIEW signals
  const recruiterInterviewPatterns = [
    /invitation to interview/i,
    /schedule (?:an?|your) interview/i,
    /interview (?:invitation|scheduled|details)/i,
    /book (?:a|your) (?:call|interview|screening|slot)/i,
    /calendly\.com/i,
    /initial screen(?:ing)?/i,
    /recruiter (?:screen|call|interview)/i,
    /would like to invite you (?:for|to) an? (?:interview|call|discussion)/i,
    /availability for a (?:brief|quick|30-minute|short) (?:call|interview|chat)/i,
    /meet\.google\.com|zoom\.us\/j|teams\.microsoft\.com/i
  ];

  for (const pattern of recruiterInterviewPatterns) {
    if (pattern.test(text)) {
      return {
        classification: EmailEventType.RECRUITER_INTERVIEW,
        confidence: 0.90,
        reason: `Matched recruiter interview pattern: "${pattern.source}"`
      };
    }
  }

  // 5. ASSESSMENT signals
  const assessmentPatterns = [
    /skills? assessment/i,
    /technical (?:test|assessment|challenge)/i,
    /coding (?:challenge|assessment|test)/i,
    /take-home (?:assignment|task|challenge)/i,
    /complete the (?:assessment|test|questionnaire)/i,
    /hackerrank\.com|testgorilla\.com|codility\.com|codesignal\.com/i
  ];

  for (const pattern of assessmentPatterns) {
    if (pattern.test(text)) {
      return {
        classification: EmailEventType.ASSESSMENT,
        confidence: 0.92,
        reason: `Matched assessment pattern: "${pattern.source}"`
      };
    }
  }

  // 6. APPLICATION CONFIRMATION signals
  const confirmationPatterns = [
    /thank you for (?:applying|your application|submitting your application)/i,
    /we (?:have )?received your application/i,
    /application (?:received|confirmation|submitted successfully)/i,
    /we received your submission/i,
    /your application to .* has been received/i
  ];

  for (const pattern of confirmationPatterns) {
    if (pattern.test(text)) {
      return {
        classification: EmailEventType.APPLICATION_CONFIRMATION,
        confidence: 0.95,
        reason: `Matched application confirmation pattern: "${pattern.source}"`
      };
    }
  }

  // 7. GENERAL RECRUITER RESPONSE
  const generalResponsePatterns = [
    /reviewed your application/i,
    /regarding your application/i,
    /application status update/i,
    /update on your application/i,
    /following up on your application/i
  ];

  for (const pattern of generalResponsePatterns) {
    if (pattern.test(text)) {
      return {
        classification: EmailEventType.RECRUITER_RESPONSE,
        confidence: 0.80,
        reason: `Matched recruiter response pattern: "${pattern.source}"`
      };
    }
  }

  return {
    classification: EmailEventType.UNKNOWN,
    confidence: 0.1,
    reason: 'No matching deterministic pattern'
  };
}

function isInterviewStage(classification) {
  return classification === EmailEventType.RECRUITER_INTERVIEW || classification === EmailEventType.CLIENT_INTERVIEW;
}

export function extractInterviewDetails(parsedEmail = {}) {
  const text = `${parsedEmail.subject || ''}\n\n${parsedEmail.bodyText || ''}`;

  // 1. Meeting URL extraction
  let meetingUrl = '';
  const meetingUrlMatch = text.match(/https?:\/\/(?:[a-zA-Z0-9-]+\.)?(?:zoom\.us\/j\/[a-zA-Z0-9?=_&%-]+|meet\.google\.com\/[a-z0-9-]+|teams\.microsoft\.com\/l\/meetup-join\/[a-zA-Z0-9?=_&%-]+|calendly\.com\/[a-zA-Z0-9-_/]+)/i);
  if (meetingUrlMatch) {
    meetingUrl = meetingUrlMatch[0];
  }

  // 2. Platform identification
  let platform = 'Other / Unknown';
  if (/zoom\.us/i.test(meetingUrl) || /zoom/i.test(text)) platform = 'Zoom';
  else if (/meet\.google\.com/i.test(meetingUrl) || /google meet/i.test(text)) platform = 'Google Meet';
  else if (/teams\.microsoft\.com/i.test(meetingUrl) || /microsoft teams/i.test(text)) platform = 'Microsoft Teams';
  else if (/calendly\.com/i.test(meetingUrl) || /calendly/i.test(text)) platform = 'Calendly';

  // 3. Date / Time extraction
  let scheduledAt = '';
  let timezone = '';

  const tzMatch = text.match(/\b(EST|EDT|PST|PDT|CST|CDT|GMT|UTC|WAT|BST|CET|CEST|AEST|AEDT)\b/i);
  if (tzMatch) {
    timezone = tzMatch[1].toUpperCase();
  }

  // Look for date patterns like "Monday, August 25 at 3:00 PM" or "2026-08-25 14:00"
  const dateMatch = text.match(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?,?\s*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*(?:20\d{2})?(?:\s+(?:at|@)\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)?/i);
  if (dateMatch) {
    scheduledAt = dateMatch[0].trim();
  }

  // 4. Interviewer extraction
  let interviewer = parsedEmail.senderName || '';

  return {
    platform,
    meetingUrl,
    scheduledAt,
    timezone,
    interviewer
  };
}

async function classifyWithAi(parsedEmail, config) {
  const prompt = `You are an email event classifier for a job search tracking system.
Classify the following email into exactly one of these categories:
- APPLICATION_CONFIRMATION
- RECRUITER_RESPONSE
- ASSESSMENT
- RECRUITER_INTERVIEW
- CLIENT_INTERVIEW
- REJECTION
- OFFER
- UNKNOWN

Email Sender: ${parsedEmail.from}
Email Subject: ${parsedEmail.subject}
Email Body:
${(parsedEmail.bodyText || '').slice(0, 1500)}

Respond in valid JSON only with this schema:
{
  "classification": "CATEGORY_NAME",
  "confidence": 0.0 to 1.0,
  "reason": "short explanation"
}`;

  const aiRes = await request({ taskType: TaskTypes.FAST_FILTER, prompt, config });
  const responseText = aiRes?.text || '';
  const cleaned = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  if (Object.values(EmailEventType).includes(parsed.classification)) {
    return {
      classification: parsed.classification,
      confidence: Math.max(0.1, Math.min(1.0, Number(parsed.confidence) || 0.7)),
      reason: String(parsed.reason || 'AI classification')
    };
  }

  return null;
}
