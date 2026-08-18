import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RESUME_PROFILES, getCandidateResumeProfiles, getResumeProfile } from '../src/resumeLibrary.js';
import { selectResumeForJob } from '../src/resumeSelector.js';
import { buildConfig } from '../src/config.js';

const ROOT_DIR = process.cwd();

test('master career profiles exist, are valid JSON, and completely isolated', () => {
  const toluMasterPath = path.join(ROOT_DIR, 'profiles', 'tolu', 'masterCareerProfile.json');
  const sisterMasterPath = path.join(ROOT_DIR, 'profiles', 'sister', 'masterCareerProfile.json');

  assert.ok(fs.existsSync(toluMasterPath), 'Tolu masterCareerProfile.json must exist');
  assert.ok(fs.existsSync(sisterMasterPath), 'Sister masterCareerProfile.json must exist');

  const tolu = JSON.parse(fs.readFileSync(toluMasterPath, 'utf8'));
  const sister = JSON.parse(fs.readFileSync(sisterMasterPath, 'utf8'));

  // Verify Tolu
  assert.equal(tolu.candidateId, 'tolu');
  assert.equal(tolu.name, 'TOLUWALOPE SAMUEL OYELOLA');
  assert.equal(tolu.contact.email, 'toluoyelola066@gmail.com');
  assert.ok(tolu.verifiedSkills.includes('Laravel'), 'Tolu must have verified Laravel skill');
  assert.ok(tolu.verifiedSkills.includes('PHP'), 'Tolu must have verified PHP skill');
  assert.ok(tolu.workExperience.some(e => e.company === 'AAIPhones'), 'Tolu experience must include AAIPhones');
  assert.ok(tolu.workExperience.some(e => e.company === 'Guru Web Design & SEO'), 'Tolu experience must include Guru Web Design & SEO');
  assert.ok(tolu.projects.some(p => p.id === 'proj_tconnect'), 'Tolu projects must include TConnect');

  // Verify Sister
  assert.equal(sister.candidateId, 'sister');
  assert.equal(sister.name, 'TEMILOLUWA RUTH OYELOLA');
  assert.equal(sister.contact.email, 'temmy152000@gmail.com');
  assert.ok(sister.verifiedSkills.includes('HubSpot CRM'), 'Sister must have verified HubSpot skill');
  assert.ok(sister.verifiedSkills.includes('Zendesk'), 'Sister must have verified Zendesk skill');
  assert.ok(sister.workExperience.some(e => e.company === "D'Lite Treats and Confectioneries"), 'Sister experience must include D\'Lite Treats');
  assert.ok(sister.workExperience.some(e => e.company === 'ePrintzLab'), 'Sister experience must include ePrintzLab');

  // Verify zero data leakage
  assert.notEqual(tolu.name, sister.name);
  assert.notEqual(tolu.contact.email, sister.contact.email);
  assert.ok(!JSON.stringify(tolu).includes(sister.contact.email));
  assert.ok(!JSON.stringify(sister).includes(tolu.contact.email));
  assert.ok(!JSON.stringify(sister).includes('TConnect'));
  assert.ok(!JSON.stringify(tolu).includes('ePrintzLab'));
});

test('resume library contains exactly 4 fixed profiles for Tolu and 4 for Sister', () => {
  const toluProfiles = getCandidateResumeProfiles('tolu');
  const sisterProfiles = getCandidateResumeProfiles('sister');

  assert.equal(toluProfiles.length, 4, 'Tolu must have exactly 4 fixed resume profiles');
  assert.equal(sisterProfiles.length, 4, 'Sister must have exactly 4 fixed resume profiles');

  const toluIds = toluProfiles.map(p => p.id).sort();
  const expectedToluIds = ['tolu-fullstack', 'tolu-frontend', 'tolu-wordpress-seo', 'tolu-ecommerce'].sort();
  assert.deepEqual(toluIds, expectedToluIds);

  const sisterIds = sisterProfiles.map(p => p.id).sort();
  const expectedSisterIds = ['sister-customer-support', 'sister-virtual-assistant', 'sister-crm', 'sister-ecommerce'].sort();
  assert.deepEqual(sisterIds, expectedSisterIds);
});

test('all 8 compiled resume PDF files exist and are non-empty', () => {
  for (const [candidateId, profiles] of Object.entries(RESUME_PROFILES)) {
    for (const profile of Object.values(profiles)) {
      const pdfPath = path.join(ROOT_DIR, 'profiles', candidateId, 'resumes', profile.folderName, 'resume.pdf');
      const txtPath = path.join(ROOT_DIR, 'profiles', candidateId, 'resumes', profile.folderName, 'resume.txt');
      const jsonPath = path.join(ROOT_DIR, 'profiles', candidateId, 'resumes', profile.folderName, 'resume.json');

      assert.ok(fs.existsSync(pdfPath), `PDF must exist: ${pdfPath}`);
      assert.ok(fs.existsSync(txtPath), `TXT must exist: ${txtPath}`);
      assert.ok(fs.existsSync(jsonPath), `JSON must exist: ${jsonPath}`);

      const pdfStats = fs.statSync(pdfPath);
      assert.ok(pdfStats.size > 1000, `PDF must be valid size: ${pdfPath} (${pdfStats.size} bytes)`);

      const txtContent = fs.readFileSync(txtPath, 'utf8');
      assert.ok(txtContent.length > 200, `TXT content must be populated: ${txtPath}`);
    }

    // Check default fallback resume.pdf exists
    const fallbackPath = path.join(ROOT_DIR, 'profiles', candidateId, 'resume.pdf');
    assert.ok(fs.existsSync(fallbackPath), `Fallback resume.pdf must exist for ${candidateId}`);
    assert.ok(fs.statSync(fallbackPath).size > 1000, `Fallback resume.pdf must be non-empty for ${candidateId}`);
  }
});

test('deterministic resume selector correctly matches Tolu target roles', () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);

  // 1. Laravel / Backend -> tolu-fullstack
  const laravelJob = {
    title: 'Senior Laravel & PHP Backend Developer',
    description: 'Looking for an experienced Laravel developer to build REST APIs, MySQL databases, and payment flows.',
    requirements: 'PHP, Laravel framework, MySQL, Git'
  };
  const laravelResult = selectResumeForJob(config, laravelJob);
  assert.equal(laravelResult.profileId, 'tolu-fullstack');
  assert.ok(laravelResult.resumePath.endsWith('resumes\\fullstack\\resume.pdf') || laravelResult.resumePath.endsWith('resumes/fullstack/resume.pdf'));
  assert.equal(laravelResult.fallbackUsed, false);

  // 2. Frontend / UI -> tolu-frontend
  const frontendJob = {
    title: 'Frontend Web Developer (JavaScript / HTML / CSS)',
    description: 'We need a frontend developer to create responsive user interfaces and optimize web page performance.',
    requirements: 'JavaScript ES6+, Bootstrap, HTML5, CSS3, responsive design'
  };
  const frontendResult = selectResumeForJob(config, frontendJob);
  assert.equal(frontendResult.profileId, 'tolu-frontend');
  assert.ok(frontendResult.resumePath.endsWith('resumes\\frontend\\resume.pdf') || frontendResult.resumePath.endsWith('resumes/frontend/resume.pdf'));

  // 3. WordPress / SEO -> tolu-wordpress-seo
  const seoJob = {
    title: 'Technical SEO Specialist & WordPress Manager',
    description: 'Manage on-page SEO, Google Business Profiles, citations, and WordPress site maintenance for our clients.',
    requirements: 'WordPress, Technical SEO, Google Search Console, Schema markup'
  };
  const seoResult = selectResumeForJob(config, seoJob);
  assert.equal(seoResult.profileId, 'tolu-wordpress-seo');
  assert.ok(seoResult.resumePath.endsWith('resumes\\wordpress-seo\\resume.pdf') || seoResult.resumePath.endsWith('resumes/wordpress-seo/resume.pdf'));

  // 4. E-Commerce / Web Operations -> tolu-ecommerce
  const ecomJob = {
    title: 'E-Commerce Website Specialist & Web Operations',
    description: 'Manage online store catalog, inventory listings, checkout troubleshooting, and payment gateway issues.',
    requirements: 'E-commerce experience, catalog management, payment gateway verification, store maintenance'
  };
  const ecomResult = selectResumeForJob(config, ecomJob);
  assert.equal(ecomResult.profileId, 'tolu-ecommerce');
  assert.ok(ecomResult.resumePath.endsWith('resumes\\ecommerce\\resume.pdf') || ecomResult.resumePath.endsWith('resumes/ecommerce/resume.pdf'));
});

test('deterministic resume selector correctly matches Sister target roles', () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=sister']);

  // 1. Customer Support -> sister-customer-support
  const supportJob = {
    title: 'Remote Customer Support Specialist (Live Chat & Email)',
    description: 'Handle customer inquiries, ticket queues on Zendesk, and resolve client complaints with empathy.',
    requirements: 'Zendesk, customer service, written communication, issue resolution'
  };
  const supportResult = selectResumeForJob(config, supportJob);
  assert.equal(supportResult.profileId, 'sister-customer-support');
  assert.ok(supportResult.resumePath.endsWith('resumes\\customer-support\\resume.pdf') || supportResult.resumePath.endsWith('resumes/customer-support/resume.pdf'));
  assert.equal(supportResult.fallbackUsed, false);

  // 2. Virtual Assistant / Admin -> sister-virtual-assistant
  const vaJob = {
    title: 'Virtual Assistant / Administrative Coordinator',
    description: 'Provide executive administrative support, manage calendars, organize documentation, and prepare reports.',
    requirements: 'Microsoft Office, Excel, calendar scheduling, documentation, virtual assistance'
  };
  const vaResult = selectResumeForJob(config, vaJob);
  assert.equal(vaResult.profileId, 'sister-virtual-assistant');
  assert.ok(vaResult.resumePath.endsWith('resumes\\virtual-assistant\\resume.pdf') || vaResult.resumePath.endsWith('resumes/virtual-assistant/resume.pdf'));

  // 3. CRM / Lead Management -> sister-crm
  const crmJob = {
    title: 'CRM Specialist & Lead Qualification Coordinator',
    description: 'Track applicant pipelines, screen candidate qualifications, update HubSpot CRM records, and manage intake.',
    requirements: 'HubSpot, CRM management, lead qualification, candidate screening, pipeline management'
  };
  const crmResult = selectResumeForJob(config, crmJob);
  assert.equal(crmResult.profileId, 'sister-crm');
  assert.ok(crmResult.resumePath.endsWith('resumes\\crm\\resume.pdf') || crmResult.resumePath.endsWith('resumes/crm/resume.pdf'));

  // 4. E-Commerce / Operations -> sister-ecommerce
  const ecomOpsJob = {
    title: 'E-Commerce Support & Order Management Assistant',
    description: 'Process customer orders, verify payment receipts, log spreadsheets, and manage daily business operations.',
    requirements: 'Order management, payments, spreadsheets, customer operations, bookkeeping'
  };
  const ecomOpsResult = selectResumeForJob(config, ecomOpsJob);
  assert.equal(ecomOpsResult.profileId, 'sister-ecommerce');
  assert.ok(ecomOpsResult.resumePath.endsWith('resumes\\ecommerce\\resume.pdf') || ecomOpsResult.resumePath.endsWith('resumes/ecommerce/resume.pdf'));
});

test('resume selector gracefully falls back to primary resume on generic or unmatched job without errors', () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const genericJob = {
    title: 'General Remote Contributor',
    description: 'Looking for a reliable team member.',
    requirements: 'Must be punctual and detail oriented.'
  };

  const result = selectResumeForJob(config, genericJob);
  assert.ok(result.profileId.startsWith('tolu-'), 'Must return a valid Tolu profile ID');
  assert.ok(fs.existsSync(result.resumePath), 'Returned resume path must exist on disk');
  assert.ok(result.selectionReason.length > 0, 'Must include a selection reason');
});
