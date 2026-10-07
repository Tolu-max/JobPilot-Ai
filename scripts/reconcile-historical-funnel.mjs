import fs from 'node:fs/promises';
import path from 'node:path';
import { extractRoleTitle, extractJobId } from '../src/gmail/gmailMessageParser.js';
import { extractInterviewDetails } from '../src/gmail/gmailClassifier.js';
import { selectResumeForJob } from '../src/resumeSelector.js';
import { getResumeProfile } from '../src/resumeLibrary.js';

function normalizeTitle(t = '') {
  return t.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanRole(roleStr = '') {
  return roleStr
    .replace(/[\-–—|]\s*BruntWork.*$/i, '')
    .replace(/[\-–—|]\s*Application.*$/i, '')
    .replace(/[.,;!?]$/, '')
    .trim();
}

async function main() {
  const rawEmails = await fs.readFile('data/tolu-historical-gmail-archive.json', 'utf8');
  const emails = JSON.parse(rawEmails);

  // Sort emails chronologically (oldest to newest)
  emails.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());

  // Known Client Interview associations from Gmail threads & prep sessions:
  // 1. "Trusted Marketing, LLC" -> Role: "SEO & Content Optimization Expert" (Applied ~Feb 2, 2026)
  // 2. "DIQ SEO" -> Role: "WordPress SEO Specialist" (Applied ~June 2026)
  // 3. "Media 405" -> Role: "Digital Marketing Specialist" (Applied ~July 2026)

  const applications = new Map();

  function getOrCreateApp(roleTitle, initialDate = null, sourceJobId = null) {
    const norm = normalizeTitle(roleTitle);
    if (!applications.has(norm)) {
      const fakeJob = { title: roleTitle, description: roleTitle, source_site: 'bruntwork' };
      const resumeSel = selectResumeForJob({ profileName: 'tolu' }, fakeJob);
      const resProfile = getResumeProfile('tolu', resumeSel.profileId);

      applications.set(norm, {
        roleTitle,
        normalizedRole: norm,
        sourceJobId: sourceJobId || null,
        appliedAt: initialDate,
        resumeProfile: resumeSel.profileId,
        resumeTitle: resProfile?.title || resumeSel.profileId,
        events: [],
        lifecycle: {
          confirmedAt: null,
          recruiterResponseAt: null,
          recruiterInterviewBookingAt: null,
          recruiterInterviewScheduledAt: null,
          clientInterviewPrepAt: null,
          clientInterviewAt: null,
          clientName: null,
          rejectedAt: null,
          offerAt: null
        },
        currentStage: 'applied',
        finalOutcome: 'pending'
      });
    }
    const app = applications.get(norm);
    if (!app.sourceJobId && sourceJobId) app.sourceJobId = sourceJobId;
    if (!app.appliedAt && initialDate) app.appliedAt = initialDate;
    return app;
  }

  let totalConfirmations = 0;
  let totalRecruiterResponses = 0;
  let totalRecruiterInterviewBookings = 0;
  let totalRecruiterCalendarInvites = 0;
  let totalClientInterviewPreps = 0;
  let totalClientInterviews = 0;
  let totalRejections = 0;
  let totalUnknown = 0;

  for (const email of emails) {
    const subject = email.subject || '';
    const body = email.bodyText || '';
    const date = email.receivedAt;
    const cleanSubject = subject.trim();
    const text = `${subject}\n\n${body}`.toLowerCase();

    // Classification
    if (/client interview\s*\(/i.test(subject) || /client interview:/i.test(subject)) {
      totalClientInterviews++;
      const clientMatch = subject.match(/client interview\s*\(([^)]+)\)/i);
      const clientName = clientMatch ? clientMatch[1].trim() : 'BruntWork Client';

      // Map client interview to the corresponding applied role
      let targetRole = 'SEO Specialist';
      if (/trusted marketing/i.test(clientName)) targetRole = 'SEO & Content Optimization Expert';
      else if (/diq/i.test(clientName)) targetRole = 'WordPress SEO Specialist';
      else if (/media 405/i.test(clientName)) targetRole = 'Digital Marketing Manager';

      const app = getOrCreateApp(targetRole, date);
      app.lifecycle.clientInterviewAt = date;
      app.lifecycle.clientName = clientName;
      app.currentStage = 'client_interview_invited';
      app.events.push({ stage: 'CLIENT_INTERVIEW', clientName, subject, receivedAt: date });
    }
    else if (/candidate preparation with bruntwork/i.test(subject)) {
      totalClientInterviewPreps++;
      let prepRole = 'WordPress SEO Specialist';
      if (/digital marketing/i.test(subject)) prepRole = 'Digital Marketing Manager';
      else if (/seo & content/i.test(subject)) prepRole = 'SEO & Content Optimization Expert';
      else if (/wordpress seo/i.test(subject)) prepRole = 'WordPress SEO Specialist';

      const app = getOrCreateApp(prepRole, date);
      app.lifecycle.clientInterviewPrepAt = date;
      app.events.push({ stage: 'CLIENT_INTERVIEW_PREP', subject, receivedAt: date });
    }
    else if (/book in a meeting for/i.test(subject)) {
      totalRecruiterInterviewBookings++;
      const roleMatch = subject.match(/book in a meeting for\s+(.+)$/i);
      const role = roleMatch ? cleanRole(roleMatch[1]) : 'Specialist';
      const app = getOrCreateApp(role, date);
      app.lifecycle.recruiterInterviewBookingAt = date;
      if (app.currentStage === 'applied') app.currentStage = 'recruiter_interview_invited';
      app.events.push({ stage: 'RECRUITER_INTERVIEW_BOOKING', role, subject, receivedAt: date });
    }
    else if (/invitation (?:from an unknown sender: )?tolu oyelola and ([^@|]+)/i.test(subject) || /updated invitation: tolu oyelola and ([^@|]+)/i.test(subject)) {
      totalRecruiterCalendarInvites++;
      const recruiterMatch = subject.match(/(?:invitation.*?:\s*tolu oyelola and\s+)([^@|]+)/i);
      const interviewer = recruiterMatch ? recruiterMatch[1].trim() : 'Recruiter';
      // Associate with latest recruiter booking role if available
      const latestBookingRole = Array.from(applications.values())
        .filter(a => a.lifecycle.recruiterInterviewBookingAt && new Date(a.lifecycle.recruiterInterviewBookingAt).getTime() <= new Date(date).getTime())
        .sort((a, b) => new Date(b.lifecycle.recruiterInterviewBookingAt).getTime() - new Date(a.lifecycle.recruiterInterviewBookingAt).getTime())[0];

      if (latestBookingRole) {
        latestBookingRole.lifecycle.recruiterInterviewScheduledAt = date;
        latestBookingRole.events.push({ stage: 'RECRUITER_INTERVIEW_SCHEDULED', interviewer, subject, receivedAt: date });
      }
    }
    else if (/^rejection\b/i.test(subject) || /unfortunately/i.test(text) || /not (?:moving|proceeding) forward/i.test(text) || /decided to (?:proceed|move forward) with (?:another|other) candidate/i.test(text)) {
      totalRejections++;
      const stdRole = extractRoleTitle(subject, body);
      const jobId = extractJobId(subject, body);
      if (stdRole) {
        const app = getOrCreateApp(stdRole, date, jobId);
        app.lifecycle.rejectedAt = date;
        app.finalOutcome = 'rejected';
        app.events.push({ stage: 'REJECTION', subject, receivedAt: date });
      }
    }
    else if (/- application confirmation$/i.test(cleanSubject) || /^application confirmation\b/i.test(cleanSubject) || /we(?:'ve| have)? received your application/i.test(text)) {
      totalConfirmations++;
      const confRole = subject.match(/(.+?)\s*[-–—|]\s*Application Confirmation/i)?.[1] || extractRoleTitle(subject, body);
      if (confRole) {
        const app = getOrCreateApp(cleanRole(confRole), date);
        app.lifecycle.confirmedAt = date;
        app.events.push({ stage: 'APPLICATION_CONFIRMATION', subject, receivedAt: date });
      }
    }
    else if (/^update on your application\b/i.test(cleanSubject) || /application update\b/i.test(cleanSubject) || /we've received strong interest/i.test(text)) {
      totalRecruiterResponses++;
      const updateRole = extractRoleTitle(subject, body);
      if (updateRole) {
        const app = getOrCreateApp(updateRole, date);
        app.lifecycle.recruiterResponseAt = date;
        app.events.push({ stage: 'RECRUITER_RESPONSE', subject, receivedAt: date });
      }
    } else {
      totalUnknown++;
    }
  }

  const allApps = Array.from(applications.values());
  const recruiterInterviewApps = allApps.filter(a => a.lifecycle.recruiterInterviewBookingAt || a.lifecycle.recruiterInterviewScheduledAt);
  const clientInterviewApps = allApps.filter(a => a.lifecycle.clientInterviewAt || a.lifecycle.clientInterviewPrepAt);
  const rejectedApps = allApps.filter(a => a.lifecycle.rejectedAt);

  console.log('========================================================================');
  console.log('📊 HISTORICAL APPLICATION → GMAIL → INTERVIEW FUNNEL RECONCILIATION');
  console.log('========================================================================');
  console.log(`Candidate:                               TOLU`);
  console.log(`Historical Analysis Window:              ${emails[0]?.receivedAt?.slice(0, 10)} to ${emails[emails.length - 1]?.receivedAt?.slice(0, 10)} (~9 Months)`);
  console.log(`Total BruntWork Emails In Inbox:         ${emails.length}`);
  console.log(`Total Distinct Roles Applied For:        ${allApps.length}`);
  console.log(`------------------------------------------------------------------------`);
  console.log(`Confirmed Applications:                  ${totalConfirmations}`);
  console.log(`Recruiter Responses (Under Review):      ${totalRecruiterResponses}`);
  console.log(`Recruiter Interview Booking Invites:     ${totalRecruiterInterviewBookings}`);
  console.log(`Recruiter Calendar Scheduled Invites:    ${totalRecruiterCalendarInvites}`);
  console.log(`Candidate Prep for Client Interviews:    ${totalClientInterviewPreps}`);
  console.log(`Client Interview Sessions:               ${totalClientInterviews}`);
  console.log(`Rejections Received:                     ${totalRejections}`);
  console.log(`------------------------------------------------------------------------`);
  console.log(`Applications Reaching Recruiter Int:     ${recruiterInterviewApps.length} (${((recruiterInterviewApps.length / allApps.length) * 100).toFixed(1)}% Conversion)`);
  console.log(`Applications Reaching Client Int:        ${clientInterviewApps.length} (${((clientInterviewApps.length / allApps.length) * 100).toFixed(1)}% Conversion)`);
  console.log(`Applications with Final Rejection:       ${rejectedApps.length} (${((rejectedApps.length / allApps.length) * 100).toFixed(1)}%)`);
  console.log('========================================================================\n');

  // Breakdown by Resume Profile
  const resumeBreakdown = {
    'tolu-wordpress-seo': { title: 'WordPress & SEO Specialist', apps: 0, recruiterInts: 0, clientInts: 0, rejections: 0 },
    'tolu-frontend': { title: 'Frontend / Web Developer', apps: 0, recruiterInts: 0, clientInts: 0, rejections: 0 },
    'tolu-fullstack': { title: 'Full Stack Web Developer', apps: 0, recruiterInts: 0, clientInts: 0, rejections: 0 },
    'tolu-ecommerce': { title: 'E-Commerce Specialist', apps: 0, recruiterInts: 0, clientInts: 0, rejections: 0 }
  };

  for (const app of allApps) {
    const prof = resumeBreakdown[app.resumeProfile] || resumeBreakdown['tolu-fullstack'];
    prof.apps++;
    if (app.lifecycle.recruiterInterviewBookingAt || app.lifecycle.recruiterInterviewScheduledAt) prof.recruiterInts++;
    if (app.lifecycle.clientInterviewAt || app.lifecycle.clientInterviewPrepAt) prof.clientInts++;
    if (app.lifecycle.rejectedAt) prof.rejections++;
  }

  console.log('📈 PERFORMANCE BREAKDOWN BY FIXED RESUME PROFILE:');
  console.log('---------------------------------------------------------------------------------------------------------');
  console.log('| Resume Profile                 | Total Apps | Recruiter Ints (%) | Client Ints (%) | Rejections |');
  console.log('---------------------------------------------------------------------------------------------------------');
  for (const [profId, data] of Object.entries(resumeBreakdown)) {
    const recRate = data.apps > 0 ? ((data.recruiterInts / data.apps) * 100).toFixed(1) + '%' : '0%';
    const clientRate = data.apps > 0 ? ((data.clientInts / data.apps) * 100).toFixed(1) + '%' : '0%';
    console.log(`| ${profId.padEnd(30)} | ${String(data.apps).padEnd(10)} | ${String(data.recruiterInts).padEnd(2)} (${recRate.padEnd(6)})      | ${String(data.clientInts).padEnd(2)} (${clientRate.padEnd(6)})    | ${String(data.rejections).padEnd(10)} |`);
  }
  console.log('---------------------------------------------------------------------------------------------------------\n');

  console.log('🏆 1. REAL HISTORICAL APPLICATIONS THAT REACHED CLIENT INTERVIEWS (Top Funnel Stage):');
  console.log('=========================================================================================================');
  for (const app of clientInterviewApps) {
    console.log(`\n• Role:                   ${app.roleTitle}`);
    console.log(`  Client Name:            ${app.lifecycle.clientName || 'N/A'}`);
    console.log(`  Resume Profile Used:    ${app.resumeTitle} (${app.resumeProfile})`);
    console.log(`  Application Date:       ${app.appliedAt?.slice(0, 10) || 'N/A'}`);
    console.log(`  Recruiter Booking:      ${app.lifecycle.recruiterInterviewBookingAt?.slice(0, 10) || 'N/A'}`);
    console.log(`  Candidate Prep Date:    ${app.lifecycle.clientInterviewPrepAt?.slice(0, 10) || 'N/A'}`);
    console.log(`  Client Interview Date:  ${app.lifecycle.clientInterviewAt?.slice(0, 10) || 'N/A'}`);
    console.log(`  Current / Final Stage:  Client Interview Reached`);
  }

  const recruiterOnly = recruiterInterviewApps.filter(a => !a.lifecycle.clientInterviewAt && !a.lifecycle.clientInterviewPrepAt);
  console.log(`\n\n🎯 2. REAL HISTORICAL APPLICATIONS THAT REACHED RECRUITER INTERVIEW (Screening Stage): (${recruiterOnly.length} Total)`);
  console.log('=========================================================================================================');
  for (const app of recruiterOnly) {
    console.log(`\n• Role:                   ${app.roleTitle}`);
    console.log(`  Resume Profile Used:    ${app.resumeTitle} (${app.resumeProfile})`);
    console.log(`  Application Date:       ${app.appliedAt?.slice(0, 10) || 'N/A'}`);
    console.log(`  Recruiter Invite Date:  ${(app.lifecycle.recruiterInterviewBookingAt || app.lifecycle.recruiterInterviewScheduledAt)?.slice(0, 10) || 'N/A'}`);
    console.log(`  Current / Final Stage:  Recruiter Screening`);
  }

  // Save report
  await fs.writeFile('data/historical-funnel-reconciliation.json', JSON.stringify({
    summary: {
      totalEmails: emails.length,
      totalApplications: allApps.length,
      recruiterInterviews: recruiterInterviewApps.length,
      clientInterviews: clientInterviewApps.length,
      rejections: rejectedApps.length
    },
    resumeBreakdown,
    clientInterviewApplications: clientInterviewApps,
    recruiterInterviewApplications: recruiterOnly,
    allApplications: allApps
  }, null, 2), 'utf8');

  console.log('\n\n✅ Detailed historical reconciliation saved to data/historical-funnel-reconciliation.json');
}

main().catch(console.error);
