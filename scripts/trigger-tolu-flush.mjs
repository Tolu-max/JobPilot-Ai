import { buildConfig } from '../src/config.js';
import { flushPendingApplyQueue } from '../src/pipeline.js';

const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
console.log('Flushing pending apply queue for Tolu...');
const res = await flushPendingApplyQueue(config);
console.log('Flush result:', JSON.stringify(res, null, 2));
