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
import { extractRoleTitle, extractJobId } from '../src/gmail/gmailMessageParser.js';
import { buildConfig } from '../src/config.js';
import { upsertJobRecord } from '../src/jobStore.js';

const ROOT_DIR = process.cwd();

test('Case A: BruntWork application update extracts role and classifies as RECRUITER_RESPONSE (not interview)', () => {
  const rawMsg = {
    id: 'msg_bw_001',
    threadId: 'th_001',
    payload: {
      headers: [
        { name: 'Subject', value: 'Update on Your Application for the Power Platform & AI Solutions Developer' },
        { name: 'From', value: 'BruntWork Talent Team <applications@bruntwork.co>' }
      ],
      mimeType: 'text/plain',
      body: {
        data: Buffer.from('Hello Tolu,\nThank you for your interest in the role: Power Platform & AI Solutions Developer.\nWe\'ve received strong interest and our hiring team is reviewing profiles.').toString('base64url')
      }
    }
  };

  const parsed = parseGmailMessage(rawMsg);
  assert.equal(parsed.extractedRoleTitle, 'Power Platform & AI Solutions Developer');

  const classification = classifyDeterministic(parsed);
  assert.equal(classification.classification, EmailEventType.RECRUITER_RESPONSE);
  assert.notEqual(classification.classification, EmailEventType.RECRUITER_INTERVIEW);

  const interview = extractInterviewDetails(parsed);
  assert.equal(interview.platform, null);
});

test('Case B: Rejection email with body job opening and ID extracts roleTitle and jobId', () => {
  const rawMsg = {
    id: 'msg_bw_002',
    threadId: 'th_002',
    payload: {
      headers: [
        { name: 'Subject', value: 'Rejection: Commerce Specialist | Shopify' },
        { name: 'From', value: 'BruntWork Careers <notifications@bruntwork.co>' }
      ],
      mimeType: 'text/plain',
      body: {
        data: Buffer.from('Dear Candidate,\nRegarding the job opening, Commerce Specialist | Shopify with the job ID number 59248285331, you had applied for, we have decided to move forward with another applicant.').toString('base64url')
      }
    }
  };

  const parsed = parseGmailMessage(rawMsg);
  assert.equal(parsed.extractedRoleTitle, 'Commerce Specialist | Shopify');
  assert.equal(parsed.extractedJobId, '59248285331');

  const classification = classifyDeterministic(parsed);
  assert.equal(classification.classification, EmailEventType.REJECTION);
});

test('Case C: Rejection mentioning interview process is NOT classified as an interview invitation', () => {
  const rawMsg = {
    id: 'msg_bw_003',
    payload: {
      headers: [
        { name: 'Subject', value: 'Update on Your Application for the Front-End Web Developer / UI/UX Specialist' },
        { name: 'From', value: 'BruntWork <talent@bruntwork.co>' }
      ],
      mimeType: 'text/plain',
      body: {
        data: Buffer.from('Thank you again for the time, thought, and effort you put into the application and interview process. Unfortunately, we have decided not to move forward with your candidacy at this time.').toString('base64url')
      }
    }
  };

  const parsed = parseGmailMessage(rawMsg);
  const classification = classifyDeterministic(parsed);

  assert.equal(classification.classification, EmailEventType.REJECTION);
  assert.notEqual(classification.classification, EmailEventType.RECRUITER_INTERVIEW);
  assert.notEqual(classification.classification, EmailEventType.CLIENT_INTERVIEW);
});

test('Case D: Actual interview invitation extracts platform, meeting URL, and stage', () => {
  const rawMsg = {
    id: 'msg_bw_004',
    payload: {
      headers: [
        { name: 'Subject', value: 'Interview Invitation: Front-End Web Developer' },
        { name: 'From', value: 'Sarah Recruiter <sarah@bruntwork.co>' }
      ],
      mimeType: 'text/plain',
      body: {
        data: Buffer.from('We would like to invite you for an initial screening interview.\nPlease book your slot here: https://calendly.com/bruntwork-recruiting/30min\nWe look forward to speaking with you.').toString('base64url')
      }
    }
  };

  const parsed = parseGmailMessage(rawMsg);
  const classification = classifyDeterministic(parsed);

  assert.equal(classification.classification, EmailEventType.RECRUITER_INTERVIEW);

  const interview = extractInterviewDetails(parsed);
  assert.equal(interview.platform, 'Calendly');
  assert.equal(interview.meetingUrl, 'https://calendly.com/bruntwork-recruiting/30min');
});

test('Case E: Application matching with exact matching role returns HIGH confidence', async () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);

  // Stage mock applied job
  await upsertJobRecord(config, {
    applicationUrl: 'https://bruntwork.co/jobs/frontend-web-developer',
    title: 'Front-End Web Developer / UI/UX Specialist',
    company: 'BruntWork',
    source_site: 'bruntwork'
  }, 'applied', { resumeProfile: 'tolu-frontend' });

  const parsedEmail = {
    subject: 'Update on Your Application for the Front-End Web Developer / UI/UX Specialist',
    extractedRoleTitle: 'Front-End Web Developer / UI/UX Specialist',
    senderEmail: 'notifications@bruntwork.co',
    bodyText: 'Your application is under review.'
  };

  const match = await matchEmailToApplication(parsedEmail, config);
  assert.equal(match.matchConfidenceLevel, MatchConfidenceLevel.HIGH);
  assert.equal(match.jobRecord.title, 'Front-End Web Developer / UI/UX Specialist');
  assert.equal(match.jobRecord.resumeProfile, 'tolu-frontend');
});

test('Case F: Application matching with exact BruntWork Job ID returns HIGH confidence even if title differs', async () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);

  await upsertJobRecord(config, {
    applicationUrl: 'https://bruntwork.co/jobs/59248285331',
    sourceJobId: '59248285331',
    title: 'Shopify Specialist',
    company: 'BruntWork',
    source_site: 'bruntwork'
  }, 'applied', { resumeProfile: 'tolu-ecommerce' });

  const parsedEmail = {
    subject: 'Rejection: Commerce Specialist | Shopify',
    extractedRoleTitle: 'Commerce Specialist | Shopify',
    extractedJobId: '59248285331',
    senderEmail: 'notifications@bruntwork.co',
    bodyText: 'The job opening, Commerce Specialist | Shopify with the job ID number 59248285331...'
  };

  const match = await matchEmailToApplication(parsedEmail, config);
  assert.equal(match.matchConfidenceLevel, MatchConfidenceLevel.HIGH);
  assert.equal(match.jobRecord.sourceJobId, '59248285331');
  assert.equal(match.jobRecord.resumeProfile, 'tolu-ecommerce');
});

test('Case G: Client Interview extracts Google Meet and date/time accurately', () => {
  const rawMsg = {
    id: 'msg_bw_007',
    payload: {
      headers: [
        { name: 'Subject', value: 'Client Interview: Senior Full Stack Developer' },
        { name: 'From', value: 'BruntWork Client Services <client@bruntwork.co>' }
      ],
      mimeType: 'text/plain',
      body: {
        data: Buffer.from('We are pleased to invite you to a client interview.\nDate: Monday, August 24 at 3:00 PM EST\nMeeting: https://meet.google.com/abc-defg-hij').toString('base64url')
      }
    }
  };

  const parsed = parseGmailMessage(rawMsg);
  const classification = classifyDeterministic(parsed);
  assert.equal(classification.classification, EmailEventType.CLIENT_INTERVIEW);

  const interview = extractInterviewDetails(parsed);
  assert.equal(interview.platform, 'Google Meet');
  assert.equal(interview.meetingUrl, 'https://meet.google.com/abc-defg-hij');
  assert.equal(interview.timezone, 'EST');
  assert.ok(interview.scheduledAt.includes('August 24'));
});

test('Security & Profile Isolation: Credentials and tokens stay strictly isolated', () => {
  const toluConfig = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const sisterConfig = buildConfig(['node', 'jobpilot', '--profile=sister']);

  const toluAuth = new GmailAuthenticator(toluConfig);
  const sisterAuth = new GmailAuthenticator(sisterConfig);

  assert.notEqual(toluAuth.tokenFilePath, sisterAuth.tokenFilePath);
  assert.ok(toluAuth.tokenFilePath.includes('profiles\\tolu') || toluAuth.tokenFilePath.includes('profiles/tolu'));
  assert.ok(sisterAuth.tokenFilePath.includes('profiles\\sister') || sisterAuth.tokenFilePath.includes('profiles/sister'));
});

test('Security & Secrets: Doctor check and diagnostics never expose raw refresh token values', async () => {
  const { inspectHealth } = await import('../src/cli/doctor.js');
  const secretRefreshToken = 'sensitive-super-secret-refresh-token-99999';

  const report = await inspectHealth({
    rootDir: ROOT_DIR,
    profileName: 'tolu',
    env: {
      ...process.env,
      TOLU_GMAIL_CLIENT_ID: 'tolu-client-id',
      TOLU_GMAIL_CLIENT_SECRET: 'tolu-client-secret',
      TOLU_GMAIL_REFRESH_TOKEN: secretRefreshToken
    }
  });

  const reportJson = JSON.stringify(report);
  assert.equal(reportJson.includes(secretRefreshToken), false, 'Doctor report JSON must never contain raw refresh token value');

  const gmailCheck = report.profiles[0].checks.find(c => c.label === 'Gmail Integration');
  assert.ok(gmailCheck, 'Gmail Integration check should exist');
  assert.equal(gmailCheck.status, 'pass');
  assert.equal(gmailCheck.detail.includes(secretRefreshToken), false, 'Check detail must not contain token');
});
