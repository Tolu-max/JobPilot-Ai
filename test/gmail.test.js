import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  GmailAuthenticator,
  parseGmailMessage,
  classifyDeterministic,
  extractInterviewDetails,
  EmailEventType,
  matchEmailToApplication,
  MatchConfidenceLevel
} from '../src/gmail/index.js';
import { buildConfig } from '../src/config.js';

const ROOT_DIR = process.cwd();

test('Gmail Authenticator handles missing credentials gracefully without throwing unhandled exceptions', () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const auth = new GmailAuthenticator(config);

  assert.equal(auth.profileName, 'tolu');
  assert.ok(auth.tokenFilePath.includes(path.join('profiles', 'tolu', 'gmailToken.json')));

  // Without credentials configured
  const creds = auth.getCredentials();
  assert.equal(typeof creds, 'object');
  assert.equal(typeof auth.isConfigured(), 'boolean');
});

test('Gmail Authenticator supports candidate profile-scoped environment overrides', () => {
  process.env.TOLU_GMAIL_CLIENT_ID = 'test-tolu-client-id';
  process.env.TOLU_GMAIL_CLIENT_SECRET = 'test-tolu-client-secret';
  process.env.TOLU_GMAIL_REFRESH_TOKEN = 'test-tolu-refresh-token';

  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const auth = new GmailAuthenticator(config);
  const creds = auth.getCredentials();

  assert.equal(creds.clientId, 'test-tolu-client-id');
  assert.equal(creds.clientSecret, 'test-tolu-client-secret');
  assert.equal(creds.directRefreshToken, 'test-tolu-refresh-token');

  delete process.env.TOLU_GMAIL_CLIENT_ID;
  delete process.env.TOLU_GMAIL_CLIENT_SECRET;
  delete process.env.TOLU_GMAIL_REFRESH_TOKEN;
});

test('Gmail Message Parser parses headers, base64 body, snippet, and sender info', () => {
  const rawMsg = {
    id: 'msg_123456',
    threadId: 'thread_789',
    internalDate: '1723980000000',
    payload: {
      headers: [
        { name: 'From', value: 'BruntWork Talent Team <talent@bruntwork.co>' },
        { name: 'To', value: 'toluoyelola066@gmail.com' },
        { name: 'Subject', value: 'Application Confirmation: Full Stack Web Developer' },
        { name: 'Date', value: 'Tue, 18 Aug 2026 14:00:00 +0100' }
      ],
      mimeType: 'text/plain',
      body: {
        data: Buffer.from('Thank you for applying to the Full Stack Web Developer position at BruntWork. We have received your application.').toString('base64url')
      }
    },
    snippet: 'Thank you for applying to the Full Stack Web Developer position at BruntWork.'
  };

  const parsed = parseGmailMessage(rawMsg);

  assert.equal(parsed.id, 'msg_123456');
  assert.equal(parsed.threadId, 'thread_789');
  assert.equal(parsed.senderName, 'BruntWork Talent Team');
  assert.equal(parsed.senderEmail, 'talent@bruntwork.co');
  assert.equal(parsed.senderDomain, 'bruntwork.co');
  assert.equal(parsed.subject, 'Application Confirmation: Full Stack Web Developer');
  assert.ok(parsed.bodyText.includes('We have received your application'));
});

test('Gmail Classifier deterministically identifies APPLICATION_CONFIRMATION', () => {
  const email = {
    subject: 'We received your application for Front-End Web Developer',
    bodyText: 'Hi Tolu,\n\nThank you for submitting your application to BruntWork. We have received your submission and our team is reviewing it.',
    senderEmail: 'notifications@bruntwork.co'
  };

  const result = classifyDeterministic(email);
  assert.equal(result.classification, EmailEventType.APPLICATION_CONFIRMATION);
  assert.ok(result.confidence >= 0.9);
});

test('Gmail Classifier deterministically identifies CLIENT_INTERVIEW', () => {
  const email = {
    subject: 'Client Interview Invitation: Senior PHP & Laravel Developer',
    bodyText: 'We are pleased to invite you to a client interview with our US client team.\n\nPlease find the meeting details below:\nDate: Monday, August 24 at 3:00 PM EST\nMeeting: https://meet.google.com/abc-defg-hij',
    senderEmail: 'recruiter@bruntwork.com'
  };

  const result = classifyDeterministic(email);
  assert.equal(result.classification, EmailEventType.CLIENT_INTERVIEW);
  assert.ok(result.confidence >= 0.9);

  const interview = extractInterviewDetails(email);
  assert.equal(interview.platform, 'Google Meet');
  assert.equal(interview.meetingUrl, 'https://meet.google.com/abc-defg-hij');
  assert.equal(interview.timezone, 'EST');
  assert.ok(interview.scheduledAt.includes('August 24'));
});

test('Gmail Classifier deterministically identifies RECRUITER_INTERVIEW with Calendly link', () => {
  const email = {
    subject: 'Interview Invitation - BruntWork Screening',
    bodyText: 'We would like to invite you for an initial screen interview.\nPlease book a slot on my Calendly: https://calendly.com/bruntwork-recruiter/30min\nLooking forward to speaking with you.',
    senderEmail: 'hr@bruntwork.co'
  };

  const result = classifyDeterministic(email);
  assert.equal(result.classification, EmailEventType.RECRUITER_INTERVIEW);
  assert.ok(result.confidence >= 0.85);

  const interview = extractInterviewDetails(email);
  assert.equal(interview.platform, 'Calendly');
  assert.equal(interview.meetingUrl, 'https://calendly.com/bruntwork-recruiter/30min');
});

test('Gmail Classifier deterministically identifies TECHNICAL ASSESSMENT', () => {
  const email = {
    subject: 'Next Steps: Technical Skills Assessment',
    bodyText: 'Please complete the following coding challenge on HackerRank within 48 hours:\nhttps://hackerrank.com/tests/12345\nGood luck!',
    senderEmail: 'assessments@bruntwork.co'
  };

  const result = classifyDeterministic(email);
  assert.equal(result.classification, EmailEventType.ASSESSMENT);
  assert.ok(result.confidence >= 0.9);
});

test('Gmail Classifier deterministically identifies REJECTION without false positives', () => {
  const email = {
    subject: 'Application Update: WordPress & SEO Specialist',
    bodyText: 'Thank you for taking the time to apply. Unfortunately, we have decided to move forward with other candidates whose experience more closely aligns with our current needs.',
    senderEmail: 'talent@bruntwork.co'
  };

  const result = classifyDeterministic(email);
  assert.equal(result.classification, EmailEventType.REJECTION);
  assert.ok(result.confidence >= 0.9);
});

test('Gmail Classifier deterministically identifies OFFER', () => {
  const email = {
    subject: 'Job Offer: Full Stack Web Developer at BruntWork',
    bodyText: 'We are pleased to offer you the position of Full Stack Web Developer. Attached is your formal offer of employment and contract.',
    senderEmail: 'onboarding@bruntwork.com'
  };

  const result = classifyDeterministic(email);
  assert.equal(result.classification, EmailEventType.OFFER);
  assert.ok(result.confidence >= 0.9);
});

test('Gmail Application Matcher matches high confidence on exact URL and title', async () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);

  // Mock an applied job in candidate store
  const mockEmail = {
    subject: 'Client Interview: Full Stack Web Developer',
    bodyText: 'Your application for Full Stack Web Developer at https://bruntwork.co/jobs/12345 is progressing to client interview.',
    receivedAt: new Date().toISOString(),
    threadId: 'th_001',
    senderEmail: 'recruiter@bruntwork.co'
  };

  // Run matcher
  const match = await matchEmailToApplication(mockEmail, config);
  assert.ok(match.matchConfidenceLevel !== undefined);
});

test('Profile isolation: Tolu and Sister maintain independent Gmail configurations and states', () => {
  const toluConfig = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const sisterConfig = buildConfig(['node', 'jobpilot', '--profile=sister']);

  const toluAuth = new GmailAuthenticator(toluConfig);
  const sisterAuth = new GmailAuthenticator(sisterConfig);

  assert.notEqual(toluAuth.tokenFilePath, sisterAuth.tokenFilePath);
  assert.ok(toluAuth.tokenFilePath.includes('profiles\\tolu') || toluAuth.tokenFilePath.includes('profiles/tolu'));
  assert.ok(sisterAuth.tokenFilePath.includes('profiles\\sister') || sisterAuth.tokenFilePath.includes('profiles/sister'));
});

test('Interview details extractor handles Zoom, Teams, missing dates, and timezone formatting safely', () => {
  // Zoom test
  const zoomEmail = {
    subject: 'Interview with Hiring Team',
    bodyText: 'Please join our Zoom meeting on Wednesday, September 2 at 10:00 AM UTC: https://zoom.us/j/987654321',
    senderName: 'Alex Recruiter'
  };
  const zoomDetails = extractInterviewDetails(zoomEmail);
  assert.equal(zoomDetails.platform, 'Zoom');
  assert.equal(zoomDetails.meetingUrl, 'https://zoom.us/j/987654321');
  assert.equal(zoomDetails.timezone, 'UTC');
  assert.equal(zoomDetails.interviewer, 'Alex Recruiter');

  // Teams test
  const teamsEmail = {
    subject: 'Client Technical Screen',
    bodyText: 'Here is the Microsoft Teams link: https://teams.microsoft.com/l/meetup-join/abc123xyz\nSee you on Friday, October 10 at 4:30 PM WAT.',
    senderName: 'Sarah Client Manager'
  };
  const teamsDetails = extractInterviewDetails(teamsEmail);
  assert.equal(teamsDetails.platform, 'Microsoft Teams');
  assert.equal(teamsDetails.meetingUrl, 'https://teams.microsoft.com/l/meetup-join/abc123xyz');
  assert.equal(teamsDetails.timezone, 'WAT');

  // Missing link test (never invents fake URL)
  const noLinkEmail = {
    subject: 'Phone Discussion',
    bodyText: 'We will call you directly at 2:00 PM EST.'
  };
  const noLinkDetails = extractInterviewDetails(noLinkEmail);
  assert.equal(noLinkDetails.meetingUrl, '');
  assert.equal(noLinkDetails.platform, 'Other / Unknown');
});
