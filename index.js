import 'dotenv/config';
import { buildConfig } from './src/config.js';
import { appendLog } from './src/logger.js';
import { runJobHunt } from './src/pipeline.js';

let activeConfig = null;

async function main() {
  const config = buildConfig();
  activeConfig = config;
  await runJobHunt(config);
}

main().catch(async (error) => {
  await appendLog(`Fatal error: ${error.stack || error.message}`, activeConfig);
  console.error(error);
  process.exitCode = 1;
});
