/**
 * Build Resume Library Generator
 *
 * Compiles all 8 fixed role-specific resumes into structured JSON, plain text,
 * and standard ATS-compliant PDF files using Playwright.
 *
 * Run via: node scripts/build-resume-library.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { RESUME_PROFILES } from '../src/resumeLibrary.js';

const ROOT_DIR = process.cwd();

function generateResumeHtml(candidate, resume) {
  const isTolu = candidate.candidateId === 'tolu';

  const contactLine = isTolu
    ? `<span><strong>Phone:</strong> ${candidate.contact.phone}</span> | 
       <span><strong>Email:</strong> ${candidate.contact.email}</span> | 
       <span><strong>Location:</strong> ${candidate.contact.location}</span> | 
       <span><strong>Portfolio:</strong> <a href="${candidate.contact.portfolio}">${candidate.contact.portfolio}</a></span> | 
       <span><strong>GitHub:</strong> <a href="${candidate.contact.github}">${candidate.contact.github}</a></span>`
    : `<span><strong>Phone:</strong> ${candidate.contact.phone}</span> | 
       <span><strong>Email:</strong> ${candidate.contact.email}</span> | 
       <span><strong>Location:</strong> ${candidate.contact.location}</span>`;

  const skillsHtml = (resume.highlightedSkills || [])
    .map(skill => `<li class="skill-item">${escapeHtml(skill)}</li>`)
    .join('');

  const experienceHtml = (resume.experience || [])
    .map(exp => `
      <div class="entry">
        <div class="entry-header">
          <span class="role-title"><strong>${escapeHtml(exp.role)}</strong> — <span class="company-name">${escapeHtml(exp.company)}</span></span>
          <span class="period">${escapeHtml(exp.period)}</span>
        </div>
        <div class="location-sub">${escapeHtml(exp.location || '')}</div>
        <ul class="bullet-list">
          ${(exp.bulletPoints || []).map(bp => `<li>${escapeHtml(bp)}</li>`).join('')}
        </ul>
      </div>
    `).join('');

  const projectsHtml = (resume.projects && resume.projects.length > 0)
    ? `
      <section class="section">
        <h2 class="section-title">KEY PROJECTS</h2>
        ${resume.projects.map(proj => `
          <div class="entry">
            <div class="entry-header">
              <span class="role-title"><strong>${escapeHtml(proj.title)}</strong></span>
              <span class="period">${escapeHtml(proj.role || '')}</span>
            </div>
            ${proj.technologies ? `<div class="tech-stack"><strong>Tech Stack:</strong> ${escapeHtml(proj.technologies)}</div>` : ''}
            <ul class="bullet-list">
              ${(proj.bulletPoints || []).map(bp => `<li>${escapeHtml(bp)}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </section>
    ` : '';

  const educationHtml = (candidate.education || [])
    .map(edu => `
      <div class="entry-header edu-item">
        <span><strong>${escapeHtml(edu.degree)}</strong> — ${escapeHtml(edu.institution)}</span>
        <span class="period">${escapeHtml(edu.period || edu.year || '')}</span>
      </div>
    `).join('');

  const certificationsHtml = (candidate.certifications && candidate.certifications.length > 0)
    ? `
      <section class="section">
        <h2 class="section-title">CERTIFICATIONS</h2>
        ${candidate.certifications.map(cert => `
          <div class="entry-header edu-item">
            <span><strong>${escapeHtml(cert.title)}</strong> — ${escapeHtml(cert.issuer)}</span>
            <span class="period">${escapeHtml(cert.year)}</span>
          </div>
        `).join('')}
      </section>
    ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(candidate.name)} - ${escapeHtml(resume.title)}</title>
  <style>
    @page {
      size: letter;
      margin: 0.45in 0.5in 0.45in 0.5in;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, Helvetica, sans-serif;
      color: #1a1a1a;
      line-height: 1.35;
      font-size: 9.5pt;
      background: #ffffff;
    }
    .header {
      text-align: center;
      margin-bottom: 12px;
      border-bottom: 1.5px solid #222222;
      padding-bottom: 8px;
    }
    .candidate-name {
      font-size: 16pt;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #111111;
      margin-bottom: 3px;
      text-transform: uppercase;
    }
    .headline {
      font-size: 10pt;
      font-weight: 600;
      color: #2b4c7e;
      margin-bottom: 4px;
    }
    .contact-info {
      font-size: 8.5pt;
      color: #444444;
    }
    .contact-info a {
      color: #2b4c7e;
      text-decoration: none;
    }
    .section {
      margin-bottom: 11px;
    }
    .section-title {
      font-size: 10.5pt;
      font-weight: 700;
      color: #111111;
      border-bottom: 1px solid #cccccc;
      padding-bottom: 2px;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .summary-text {
      font-size: 9.2pt;
      text-align: justify;
      color: #222222;
      line-height: 1.35;
    }
    .skills-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 3px 14px;
      list-style-type: square;
      padding-left: 16px;
      font-size: 9pt;
    }
    .skill-item {
      color: #222222;
    }
    .entry {
      margin-bottom: 8px;
    }
    .entry-header {
      display: flex;
      justify-content: space-between;
      font-size: 9.5pt;
      margin-bottom: 2px;
    }
    .role-title {
      color: #111111;
    }
    .company-name {
      color: #2b4c7e;
    }
    .period {
      color: #555555;
      font-size: 8.5pt;
      font-weight: 500;
      white-space: nowrap;
    }
    .location-sub {
      font-size: 8.5pt;
      color: #666666;
      font-style: italic;
      margin-bottom: 3px;
    }
    .tech-stack {
      font-size: 8.5pt;
      color: #444444;
      margin-bottom: 3px;
    }
    .bullet-list {
      padding-left: 16px;
      margin-top: 2px;
    }
    .bullet-list li {
      font-size: 9pt;
      color: #2a2a2a;
      margin-bottom: 2.5px;
      line-height: 1.32;
    }
    .edu-item {
      font-size: 9.2pt;
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 class="candidate-name">${escapeHtml(candidate.name)}</h1>
    <div class="headline">${escapeHtml(resume.headline || resume.title)}</div>
    <div class="contact-info">${contactLine}</div>
  </div>

  <section class="section">
    <h2 class="section-title">PROFESSIONAL SUMMARY</h2>
    <p class="summary-text">${escapeHtml(resume.summary)}</p>
  </section>

  <section class="section">
    <h2 class="section-title">CORE SKILLS & PROFICIENCIES</h2>
    <ul class="skills-grid">
      ${skillsHtml}
    </ul>
  </section>

  <section class="section">
    <h2 class="section-title">PROFESSIONAL EXPERIENCE</h2>
    ${experienceHtml}
  </section>

  ${projectsHtml}

  <section class="section">
    <h2 class="section-title">EDUCATION</h2>
    ${educationHtml}
  </section>

  ${certificationsHtml}
</body>
</html>`;
}

function generateResumePlainText(candidate, resume) {
  const lines = [];
  lines.push(candidate.name.toUpperCase());
  lines.push(resume.headline || resume.title);
  lines.push(`Phone: ${candidate.contact.phone} | Email: ${candidate.contact.email} | Location: ${candidate.contact.location}`);
  if (candidate.contact.portfolio) lines.push(`Portfolio: ${candidate.contact.portfolio} | GitHub: ${candidate.contact.github}`);
  lines.push('\n' + '='.repeat(60));
  lines.push('PROFESSIONAL SUMMARY');
  lines.push('='.repeat(60));
  lines.push(resume.summary);
  lines.push('\n' + '='.repeat(60));
  lines.push('CORE SKILLS & PROFICIENCIES');
  lines.push('='.repeat(60));
  for (const skill of resume.highlightedSkills || []) {
    lines.push(`• ${skill}`);
  }
  lines.push('\n' + '='.repeat(60));
  lines.push('PROFESSIONAL EXPERIENCE');
  lines.push('='.repeat(60));
  for (const exp of resume.experience || []) {
    lines.push(`${exp.role} — ${exp.company} (${exp.period}) [${exp.location || ''}]`);
    for (const bp of exp.bulletPoints || []) {
      lines.push(`  • ${bp}`);
    }
    lines.push('');
  }
  if (resume.projects && resume.projects.length > 0) {
    lines.push('='.repeat(60));
    lines.push('KEY PROJECTS');
    lines.push('='.repeat(60));
    for (const proj of resume.projects) {
      lines.push(`${proj.title} | ${proj.role || ''}`);
      if (proj.technologies) lines.push(`Tech Stack: ${proj.technologies}`);
      for (const bp of proj.bulletPoints || []) {
        lines.push(`  • ${bp}`);
      }
      lines.push('');
    }
  }
  lines.push('='.repeat(60));
  lines.push('EDUCATION');
  lines.push('='.repeat(60));
  for (const edu of candidate.education || []) {
    lines.push(`${edu.degree} — ${edu.institution} (${edu.period || edu.year || ''})`);
  }
  if (candidate.certifications && candidate.certifications.length > 0) {
    lines.push('\n' + '='.repeat(60));
    lines.push('CERTIFICATIONS');
    lines.push('='.repeat(60));
    for (const cert of candidate.certifications) {
      lines.push(`${cert.title} — ${cert.issuer} (${cert.year})`);
    }
  }
  return lines.join('\n');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function main() {
  console.log('[build-resumes] Starting fixed resume library generator...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    for (const [candidateId, resumes] of Object.entries(RESUME_PROFILES)) {
      const masterPath = path.join(ROOT_DIR, 'profiles', candidateId, 'masterCareerProfile.json');
      const masterContent = await fs.readFile(masterPath, 'utf8');
      const candidateMaster = JSON.parse(masterContent);

      console.log(`\n[build-resumes] Processing candidate: ${candidateMaster.name} (${candidateId})`);

      let isFirst = true;

      for (const resume of Object.values(resumes)) {
        const resumeDir = path.join(ROOT_DIR, 'profiles', candidateId, 'resumes', resume.folderName);
        await fs.mkdir(resumeDir, { recursive: true });

        // 1. Write structured JSON
        const jsonPath = path.join(resumeDir, 'resume.json');
        await fs.writeFile(jsonPath, JSON.stringify(resume, null, 2), 'utf8');

        // 2. Write Plain Text
        const plainText = generateResumePlainText(candidateMaster, resume);
        const txtPath = path.join(resumeDir, 'resume.txt');
        await fs.writeFile(txtPath, plainText, 'utf8');

        // 3. Compile ATS PDF via Playwright
        const html = generateResumeHtml(candidateMaster, resume);
        const htmlPath = path.join(resumeDir, 'resume.html');
        await fs.writeFile(htmlPath, html, 'utf8');

        const page = await context.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        const pdfPath = path.join(resumeDir, 'resume.pdf');
        await page.pdf({
          path: pdfPath,
          format: 'Letter',
          printBackground: true,
          margin: {
            top: '0.45in',
            bottom: '0.45in',
            left: '0.5in',
            right: '0.5in'
          }
        });
        await page.close();

        // If this is the primary/first resume, also copy to default fallback profiles/<candidateId>/resume.pdf
        if (isFirst) {
          const defaultPdfPath = path.join(ROOT_DIR, 'profiles', candidateId, 'resume.pdf');
          await fs.copyFile(pdfPath, defaultPdfPath);
          console.log(`[build-resumes]  -> Copied primary ${resume.id} to default fallback: ${defaultPdfPath}`);
          isFirst = false;
        }

        console.log(`[build-resumes]  ✓ Built ${resume.id} -> ${pdfPath}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log('\n[build-resumes] All 8 fixed resume library profiles compiled successfully!');
}

main().catch(err => {
  console.error('[build-resumes] Error:', err);
  process.exit(1);
});
