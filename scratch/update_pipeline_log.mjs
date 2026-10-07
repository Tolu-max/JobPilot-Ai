import fs from 'node:fs';

let content = fs.readFileSync('src/pipeline.js', 'utf8');
const isCrlf = content.includes('\r\n');
const eol = isCrlf ? '\r\n' : '\n';

const target = [
  '          const applyResult = await attemptApplicationOnce(job, optimizer, config);',
  '          row.status = statusForApplicationResult(applyResult);'
].join(eol);

const replacement = [
  '          const applyResult = await attemptApplicationOnce(job, optimizer, config);',
  '          console.log(`[auto-apply] ${config.profileName} | Outcome for "${job.title}": ${applyResult.outcome} | Reason: ${applyResult.reason || "None"}`);',
  '          row.status = statusForApplicationResult(applyResult);'
].join(eol);

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('src/pipeline.js', content, 'utf8');
  console.log('Successfully updated src/pipeline.js with outcome logging');
} else {
  console.log('Target not found in src/pipeline.js');
}
