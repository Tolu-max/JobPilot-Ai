import fs from 'node:fs/promises';
import path from 'node:path';
import { buildConfig } from '../src/config.js';
import { loadJobStore } from '../src/jobStore.js';
import { loadOrBuildCandidateProfile } from '../src/profileParser.js';
import { loadCvData } from '../src/cvParser.js';
import { localMatchJob } from '../src/localMatcher.js';

const profileName = String(process.argv.find((arg) => arg.startsWith('--profile='))?.split('=')[1] || 'sister');
const config = buildConfig(['node', 'jobpilot', `--profile=${profileName}`]);
const profile = await loadOrBuildCandidateProfile(config);
const cvData = await loadCvData(config).catch(() => null);
if (cvData) config.cvData = cvData;

const store = await loadJobStore(config);
const ignored = (store.jobs || []).filter((job) => job.status === 'ignored');
const ranked = [];
for (const job of ignored) {
  const local = await localMatchJob(job, profile, config);
  ranked.push({
    title: job.title,
    company: job.company || '',
    url: job.applicationUrl || job.job_url || job.url || '',
    previousScore: job.score ?? null,
    score: local.score,
    recommendation: local.recommendation,
    matchedSkills: local.matchedSkills || [],
    missingSkills: local.missingSkills || [],
    reasons: local.reasons || []
  });
}
ranked.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

const reportDir = path.join(config.profileDir, 'ranking');
await fs.mkdir(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `ignored-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await fs.writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), profile: profileName, count: ranked.length, ranked }, null, 2)}\n`);

console.log(`[rank] ${profileName}: ranked ${ranked.length} ignored roles against current CV`);
for (const [index, row] of ranked.entries()) {
  console.log(`[rank] ${String(index + 1).padStart(2, '0')} | ${row.score} | ${row.recommendation} | ${row.title} | ${row.company}`);
  console.log(`[rank]     matched: ${row.matchedSkills.slice(0, 5).join(', ') || 'none'}; reason: ${row.reasons.slice(0, 2).join(' | ') || 'none'}`);
}
console.log(`[rank] report: ${reportPath}`);
