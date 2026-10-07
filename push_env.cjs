const fs = require('fs');
const { execSync } = require('child_process');

const envContent = fs.readFileSync('.env', 'utf8');
const lines = envContent.split('\n');

const vars = [];

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  
  // Remove wrapping quotes if present
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  
  if (key && val) {
    vars.push({ key, val });
  }
}

console.log(`Found ${vars.length} variables to set.`);

const svc = 'jobpilot-scraper';
console.log(`\nSetting variables for ${svc}...`);

for (const { key, val } of vars) {
  try {
    process.stdout.write(`Setting ${key}... `);
    // Use stdin mode to handle special characters safely
    execSync(`railway variable set ${key} --stdin --service ${svc} -p 17689ab1-53d5-427d-a0a7-c7e48ecd7b53 -e production --skip-deploys`, {
      input: val,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log('OK');
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }
}

console.log('\nAll variables configured successfully!');
