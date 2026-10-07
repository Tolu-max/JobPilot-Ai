import test from 'node:test';
import assert from 'node:assert/strict';
import { localMatchJob } from '../src/localMatcher.js';
import { evaluateHistoricalCluster, ClusterTier } from '../src/matching/historicalClusterEvaluator.js';
import { buildConfig } from '../src/config.js';
import fs from 'node:fs';
import path from 'node:path';

test('Sister role isolation: strictly rejects specialized and irrelevant roles', async () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=sister']);
  const profileDir = path.resolve('profiles/sister');
  const candidateProfile = JSON.parse(fs.readFileSync(path.join(profileDir, 'candidateProfile.json'), 'utf8'));

  const problematicRoles = [
    { title: 'Real Estate Listing Coordinator', desc: 'Coordinate listings in MLS and AppFolio.' },
    { title: 'Senior Legal Support Specialist (Leap CRM)', desc: 'Assist legal team with Leap CRM documentation.' },
    { title: 'Outbound Medical Receptionist - Gentu', desc: 'Manage patient appointments in Gentu medical software.' },
    { title: 'Patient Coordinator', desc: 'Handle clinic intake and patient scheduling.' },
    { title: 'Senior Video Editor (Premiere Pro & After Effects)', desc: 'High end post-production, VFX, Davinci, Premiere Pro, After Effects.' },
    { title: 'Motion Graphics Designer & Animator', desc: '3D animation, cinema 4d, motion graphics.' },
    { title: 'Brand Identity Designer & Art Director', desc: 'Lead brand design, typography, Figma, and creative direction.' },
    { title: 'AU Bookkeeper & Admin Assistant (Xero)', desc: 'Manage bookkeeping in Xero and reconcile accounts.' },
    { title: 'Bookkeeper | Xero/Zoho Books', desc: 'Full-charge bookkeeping in Xero.' },
    { title: 'IT Microsoft Support Specialist', desc: 'Manage active directory, Windows servers, and networks.' }
  ];

  for (const item of problematicRoles) {
    const job = {
      title: item.title,
      description: item.desc,
      requirements: item.desc
    };

    const res = await localMatchJob(job, candidateProfile, config);
    assert.equal(
      res.score,
      0,
      `Expected 0 score for "${item.title}", but got ${res.score} (reasons: ${res.reasons?.join('; ')})`
    );
    assert.equal(res.recommendation, 'ignore');
  }

  const legitimateRoles = [
    { title: 'Customer Support Specialist', desc: 'Assist customers with ticket inquiries, live chat, and email support.' },
    { title: 'Virtual Assistant', desc: 'Calendar management, email triage, data entry, and meeting scheduling.' },
    { title: 'Client Operations Coordinator', desc: 'Coordinate client onboarding, CRM pipeline updates, and customer follow up.' },
    { title: 'Appointment Setter', desc: 'Outreach to qualify leads and schedule sales appointments.' },
    { title: 'Social Media Manager', desc: 'Create social posts, schedule updates across Instagram and LinkedIn, Canva graphics, and community engagement.' },
    { title: 'Social Media Content Creator & Video Editor', desc: 'Create social reels, short-form CapCut video editing, caption writing, and TikTok content.' }
  ];

  for (const item of legitimateRoles) {
    const job = {
      title: item.title,
      description: item.desc,
      requirements: item.desc
    };

    const res = await localMatchJob(job, candidateProfile, config);
    assert.ok(
      res.score >= 70,
      `Expected high score for legitimate role "${item.title}", but got ${res.score} (reasons: ${res.reasons?.join('; ')})`
    );
    assert.notEqual(res.recommendation, 'ignore');
  }
});
