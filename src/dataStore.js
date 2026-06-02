import fs from 'node:fs/promises';
import path from 'node:path';
import { readRecentEvents } from './eventBus.js';

export async function listProfiles(rootDir = process.cwd()) {
  const profilesDir = path.join(rootDir, 'profiles');
  try {
    const entries = await fs.readdir(profilesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'example')
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function readProfile(rootDir, profileName) {
  const profileDir = path.join(rootDir, 'profiles', profileName);
  const [preferences, candidateProfile, jobStore, events] = await Promise.all([
    readJson(path.join(profileDir, 'preferences.json'), {}),
    readJson(path.join(profileDir, 'candidateProfile.json'), {}),
    readJson(path.join(profileDir, 'processedJobs.json'), { jobs: [] }),
    readRecentEvents({ rootDir, profileName, eventsDir: path.join(rootDir, 'data', 'events') }, 25)
  ]);

  return {
    profileName,
    profileDir,
    displayName: preferences.displayName || candidateProfile.name || profileName,
    preferences,
    candidateProfile,
    jobs: Array.isArray(jobStore.jobs) ? jobStore.jobs : [],
    events
  };
}

export async function getSystemSnapshot(rootDir = process.cwd(), options = {}) {
  const profileNames = options.profileNames || await listProfiles(rootDir);
  const profiles = await Promise.all(profileNames.map((name) => readProfile(rootDir, name)));
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const totals = {
    profiles: profiles.length,
    jobs: 0,
    applied: 0,
    reviewed: 0,
    pendingApply: 0,
    failed: 0,
    ignored: 0,
    todayJobs: 0,
    todayApplied: 0
  };

  let latestActivity = 0;
  for (const profile of profiles) {
    for (const job of profile.jobs) {
      totals.jobs += 1;
      if (job.status === 'applied') totals.applied += 1;
      if (job.status === 'reviewed') totals.reviewed += 1;
      if (job.status === 'pending_apply') totals.pendingApply += 1;
      if (job.status === 'failed') totals.failed += 1;
      if (job.status === 'ignored') totals.ignored += 1;

      const updated = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
      if (updated > latestActivity) latestActivity = updated;
      if (updated >= dayAgo) {
        totals.todayJobs += 1;
        if (job.status === 'applied') totals.todayApplied += 1;
      }
    }
  }

  return {
    profiles,
    totals,
    latestActivity: latestActivity ? new Date(latestActivity).toISOString() : null,
    generatedAt: new Date().toISOString()
  };
}

export async function readJobHistory(rootDir = process.cwd(), profileName = null) {
  const profileNames = profileName ? [profileName] : await listProfiles(rootDir);
  const profiles = await Promise.all(profileNames.map((name) => readProfile(rootDir, name)));
  return profiles.flatMap((profile) =>
    profile.jobs.map((job) => ({
      ...job,
      profileName: profile.profileName,
      displayName: profile.displayName
    }))
  );
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}
