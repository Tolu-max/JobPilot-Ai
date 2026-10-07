import fs from 'node:fs/promises';
import path from 'node:path';
import { emitEvent, EventTypes } from './eventBus.js';
import { extractResumeIntelligence } from './resumeIntelligence.js';

const CACHE_FILENAME = 'cv-data.json';

export async function loadCvData(config) {
  const resumePath = config.resumePath;
  if (!resumePath) return null;

  const absPath = path.isAbsolute(resumePath)
    ? resumePath
    : path.resolve(process.cwd(), resumePath);

  try {
    await fs.access(absPath);
  } catch {
    console.warn(`[cvParser] Resume not found at: ${absPath}`);
    return null;
  }

  const cachePath = path.join(config.profileDir, CACHE_FILENAME);
  const resumeHash = await hashFile(absPath);

  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (cached.source?.hash === resumeHash || cached._pdfHash === resumeHash || cached._resumeHash === resumeHash) {
      console.log(`[cvParser] Using cached CV data for ${config.profileName}: ${cached.name || 'unknown'}`);
      return cached;
    }
  } catch {
    // Cache miss.
  }

  console.log(`[cvParser] Resume changed or no cache - parsing CV for ${config.profileName}...`);
  const structured = await extractResumeIntelligence(absPath, config);
  const toSave = {
    ...structured,
    _resumeHash: resumeHash,
    _pdfHash: resumeHash,
    _parsedAt: new Date().toISOString(),
    _resumePath: absPath
  };

  await fs.mkdir(config.profileDir, { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(toSave, null, 2)}\n`, 'utf8');
  await emitEvent(EventTypes.RESUME_PARSED, {
    name: toSave.name,
    skills: toSave.skills || [],
    needsOcr: Boolean(toSave.source?.needsOcr),
    extractionMethod: toSave.source?.extractionMethod
  }, config).catch(() => {});

  console.log(`[cvParser] CV data cached to ${cachePath}`);
  return toSave;
}

async function hashFile(filePath) {
  const { createHash } = await import('node:crypto');
  const buffer = await fs.readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}
