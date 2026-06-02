import { text, select, isCancel, note, spinner } from '@clack/prompts';
import pc from 'picocolors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();

export async function interactiveChat(args) {
  const profilesDir = path.join(ROOT, 'profiles');
  let profiles = [];
  try {
    profiles = await fs.readdir(profilesDir);
    profiles = profiles.filter(p => !p.startsWith('.') && p !== 'example');
  } catch {
    note('No profiles found. Run setup first.', 'Error');
    return;
  }

  if (profiles.length === 0) {
    note('No profiles found. Run setup first.', 'Error');
    return;
  }

  let profile = profiles[0];
  if (profiles.length > 1) {
    const p = await select({
      message: 'Select a profile to chat about:',
      options: profiles.map(p => ({ value: p, label: p }))
    });
    if (isCancel(p)) return;
    profile = p;
  }

  const prefsPath = path.join(ROOT, 'profiles', profile, 'preferences.json');
  const storePath = path.join(ROOT, 'profiles', profile, 'processedJobs.json');
  const envContent = await fs.readFile(path.join(ROOT, '.env'), 'utf-8').catch(() => '');
  
  let prefs = {};
  let store = { jobs: [] };
  try { prefs = JSON.parse(await fs.readFile(prefsPath, 'utf-8')); } catch {}
  try { store = JSON.parse(await fs.readFile(storePath, 'utf-8')); } catch {}

  const geminiKey = process.env.GEMINI_API_KEY || envContent.match(/GEMINI_API_KEY=([^\r\n]+)/)?.[1]?.trim();
  if (!geminiKey) {
    note('GEMINI_API_KEY not found. Run jobpilot init to configure it.', 'Error');
    return;
  }
  const ai = new GoogleGenAI({ apiKey: geminiKey });

  console.clear();
    note(`JobPilot Assistant\nChatting context: Profile '${profile}'\nType "exit" or "quit" to leave.`, 'Ready');

  while (true) {
    const msg = await text({
      message: 'You:',
      placeholder: 'Ask me anything (type exit to quit)'
    });

    if (isCancel(msg) || !msg.trim()) break;
    if (msg.toLowerCase() === 'exit' || msg.toLowerCase() === 'quit') break;

    const s = spinner();
    s.start('Thinking...');

    try {
      let schedulerRunning = false;
      try {
        const output = execSync('npx pm2 jlist', { encoding: 'utf-8', cwd: ROOT, timeout: 5000, shell: true, windowsHide: true });
        const pm2List = JSON.parse(output);
        const app = pm2List.find(p => p.name === 'jobpilot-scheduler');
        if (app && app.pm2_env.status === 'online') schedulerRunning = true;
      } catch { /* ignore */ }

      const prompt = `You are JobPilot, an expert AI career assistant helping a user manage their automated job applications.
Context:
Profile preferences: ${JSON.stringify(prefs)}
Recent jobs processed: ${JSON.stringify(store.jobs.slice(-10))}
System Status: The background job scheduler is currently ${schedulerRunning ? 'RUNNING' : 'STOPPED'}. (If the user asks if JobPilot is running, use this status).

User Query: ${msg}

Provide a concise, helpful, and friendly response.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      s.stop(pc.cyan('JobPilot:'));
      console.log(response.text + '\n');
    } catch (err) {
      s.stop(pc.red('Error reaching AI.'));
      console.log(err.message + '\n');
    }
  }
}
