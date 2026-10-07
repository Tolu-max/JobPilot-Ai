import { buildConfig } from '../src/config.js';
import { loadJobStore } from '../src/jobStore.js';
import { sendReviewNotification } from '../src/telegramBot.js';

const profileName = String(process.argv.find((arg) => arg.startsWith('--profile='))?.split('=')[1] || 'sister');
const config = buildConfig(['node', 'jobpilot', `--profile=${profileName}`]);
const store = await loadJobStore(config);
const reviews = (store.jobs || [])
  .filter((job) => job.status === 'reviewed')
  .sort((a, b) => (b.score || 0) - (a.score || 0));

console.log(`[resend] ${profileName}: resending ${reviews.length} reviewed job(s)`);
for (const job of reviews) {
  await sendReviewNotification({
    ...job,
    reviewReason: job.reason || job.reviewReason || 'Awaiting your approval.',
    isNewReview: true
  }, job.score || 0, config);
}
console.log(`[resend] ${profileName}: completed`);
