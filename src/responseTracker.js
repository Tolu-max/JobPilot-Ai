import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import aiRouter, { TaskTypes, hasAvailableAiProvider } from './aiRouter.js';
import { loadJobStore, upsertJobRecord } from './jobStore.js';
import { appendLog } from './logger.js';

export async function checkEmailResponses(config) {
  const imapUser = process.env.IMAP_USER;
  const imapPassword = process.env.IMAP_PASSWORD;
  const imapHost = process.env.IMAP_HOST || 'imap.gmail.com';
  const imapPort = parseInt(process.env.IMAP_PORT || '993', 10);

  if (!imapUser || !imapPassword) {
    await appendLog('ResponseTracker: No IMAP credentials configured. Skipping.', config);
    return;
  }

  const imapConfig = {
    imap: {
      user: imapUser,
      password: imapPassword,
      host: imapHost,
      port: imapPort,
      tls: true,
      authTimeout: 10000
    }
  };

  await appendLog('ResponseTracker: Connecting to IMAP...', config);

  try {
    const connection = await imaps.connect(imapConfig);
    await connection.openBox('INBOX');

    // Fetch emails from the last 7 days
    const delay = 7 * 24 * 3600 * 1000;
    const since = new Date(Date.now() - delay);
    
    const searchCriteria = [
      ['SINCE', since.toISOString()]
    ];
    const fetchOptions = {
      bodies: ['HEADER', 'TEXT'],
      struct: true
    };

    const messages = await connection.search(searchCriteria, fetchOptions);
    await appendLog(`ResponseTracker: Found ${messages.length} recent emails.`, config);

    const store = await loadJobStore(config);
    const appliedJobs = store.jobs.filter(j => j.status === 'applied');

    if (appliedJobs.length === 0) {
      await appendLog('ResponseTracker: No applied jobs to track.', config);
      connection.end();
      return;
    }

    if (!hasAvailableAiProvider(config)) {
      await appendLog('ResponseTracker: No available AI provider configured. Skipping email analysis.', config);
      connection.end();
      return;
    }

    for (const msg of messages) {
      const all = msg.parts.find((part) => part.which === 'TEXT');
      const id = msg.attributes.uid;
      const idHeader = "Imap-Id: " + id + "\r\n";
      
      const mail = await simpleParser(idHeader + all.body);
      const subject = mail.subject || '';
      const text = mail.text || '';
      const from = mail.from?.text || '';

      // Skip obvious spam or promotional
      if (/newsletter|marketing|no-reply/i.test(from)) continue;

      // Find matching job
      const matchingJob = appliedJobs.find(job => {
        // match by company name
        const companyWords = job.company.split(/\s+/).filter(w => w.length > 3).map(w => w.toLowerCase());
        const matchesCompany = companyWords.some(w => subject.toLowerCase().includes(w) || from.toLowerCase().includes(w));
        
        // or match by job title keywords
        const matchesTitle = subject.toLowerCase().includes(job.title.toLowerCase().split(' ')[0]);

        return matchesCompany || matchesTitle;
      });

      if (matchingJob) {
        await appendLog(`ResponseTracker: Analyzing email potentially regarding ${matchingJob.company}...`, config);
        
        const prompt = `
        Analyze this email response from a company regarding a job application.
        Job Title: ${matchingJob.title}
        Company: ${matchingJob.company}
        
        Email Subject: ${subject}
        Email From: ${from}
        Email Body: ${text.substring(0, 2000)}
        
        Categorize the response into one of the following JSON statuses:
        {
          "status": "interview_requested" | "rejected" | "next_steps_required" | "general_update" | "unrelated",
          "summary": "Brief 1 sentence summary of what they said"
        }
        Return ONLY valid JSON.
        `;

        try {
          const routed = await aiRouter.request({
            taskType: TaskTypes.FALLBACK_REASONING,
            prompt,
            profile: { profileName: config.profileName },
            jobData: { title: matchingJob.title, company: matchingJob.company, localScore: 90 },
            fallbackLevel: 'response-tracker',
            config
          });

          const raw = routed.response || '';
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            
            if (parsed.status !== 'unrelated' && parsed.status !== matchingJob.response_status) {
              await appendLog(`ResponseTracker: Update for ${matchingJob.company}: ${parsed.status}`, config);
              
              await upsertJobRecord(config, matchingJob, matchingJob.status, {
                response_status: parsed.status,
                response_summary: parsed.summary,
                last_contact_date: new Date().toISOString()
              });
            }
          }
        } catch (err) {
          await appendLog(`ResponseTracker: AI error analyzing email: ${err.message}`, config);
        }
      }
    }

    connection.end();
  } catch (err) {
    await appendLog(`ResponseTracker: IMAP error: ${err.message}`, config);
  }
}
