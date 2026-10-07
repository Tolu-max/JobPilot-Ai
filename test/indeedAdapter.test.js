import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indeedAdapter, unwrapIndeedRedirect, resolveIndeedDestination } from '../src/adapters/indeed.js';
import { getAdapter } from '../src/adapters/index.js';
import { classifyApplyUrl } from '../src/adapters/atsResolver.js';
import { FormStep } from '../src/adapters/types.js';

test('Indeed Adapter: matches Indeed job URLs across domains', () => {
  assert.equal(indeedAdapter.matches('https://www.indeed.com/viewjob?jk=12345'), true);
  assert.equal(indeedAdapter.matches('https://ng.indeed.com/jobs?q=developer'), true);
  assert.equal(indeedAdapter.matches('https://uk.indeed.com/rc/clk?jk=123'), true);
  assert.equal(indeedAdapter.matches('https://www.jobberman.com/jobs/123'), false);
  assert.equal(indeedAdapter.matches('https://boards.greenhouse.io/job/123'), false);
});

test('Indeed Adapter: getAdapter resolves indeed for Indeed URLs', () => {
  const resolved = getAdapter('https://www.indeed.com/viewjob?jk=12345');
  assert.equal(resolved.name, 'indeed');
});

test('Indeed Adapter: classifyApplyUrl recognizes Indeed as audited gateway', () => {
  const result = classifyApplyUrl('https://www.indeed.com/viewjob?jk=12345');
  assert.equal(result.adapter, 'indeed');
  assert.equal(result.supported, true);
  assert.equal(result.audited, true);
  assert.equal(result.kind, 'gateway');
});

test('Indeed Adapter: unwrapIndeedRedirect extracts external ATS destinations', () => {
  const directAts = 'https://boards.greenhouse.io/acme/jobs/123';
  assert.equal(unwrapIndeedRedirect(directAts), directAts);

  const wrapped = 'https://secure.indeed.com/auth?continue=https%3A%2F%2Fjobs.lever.co%2Facme%2F456';
  assert.equal(unwrapIndeedRedirect(wrapped), 'https://jobs.lever.co/acme/456');

  const wrappedDest = 'https://www.indeed.com/applystart?jk=123&dest=https%3A%2F%2Fapply.workable.com%2Facme%2Fj%2F789';
  assert.equal(unwrapIndeedRedirect(wrappedDest), 'https://apply.workable.com/acme/j/789');

  const internalOnly = 'https://www.indeed.com/viewjob?jk=12345';
  assert.equal(unwrapIndeedRedirect(internalOnly), '');
});

test('Indeed Adapter: advance resolves external ATS URL in testMode and prepares handoff', async () => {
  const fakePage = {
    url: () => 'https://www.indeed.com/viewjob?jk=12345',
    evaluate: async () => ({ href: 'https://boards.greenhouse.io/acme/jobs/12345', text: 'Apply on company site' })
  };

  const ctx = {
    config: { testMode: true },
    candidate: { name: 'Toluwalope Oyelola', email: 'tolu@example.com' },
    job: {
      title: 'Full Stack Developer',
      raw: {
        thirdPartyApplyUrl: 'https://boards.greenhouse.io/acme/jobs/12345'
      }
    }
  };

  const result = await indeedAdapter.advance(fakePage, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, true);
  assert.equal(result.step, FormStep.REVIEW);
  assert.ok(result.reason.includes('TEST_MODE'));
  assert.equal(result.meta.downstreamAdapter, 'greenhouse');
  assert.equal(result.meta.resolvedUrl, 'https://boards.greenhouse.io/acme/jobs/12345');
});

test('Indeed Adapter: advance handles native Indeed Easy Apply in testMode', async () => {
  const fakePage = {
    url: () => 'https://www.indeed.com/viewjob?jk=67890',
    evaluate: async () => ({ href: '', text: 'Apply now' })
  };

  const ctx = {
    config: { testMode: true },
    candidate: { name: 'Temiloluwa Ruth Oyelola', email: 'temmy152000@gmail.com' },
    job: {
      title: 'Virtual Assistant',
      hasIndeedApply: true,
      raw: {
        indeedApplyEnabled: true
      }
    }
  };

  const result = await indeedAdapter.advance(fakePage, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, true);
  assert.equal(result.step, FormStep.REVIEW);
  assert.ok(result.reason.includes('TEST_MODE: Indeed Easy Apply prepared'));
  assert.equal(result.meta.indeedApply, true);
});

test('Indeed Adapter: getCurrentStep detects submitted status correctly', async () => {
  const fakePage = {
    url: () => 'https://www.indeed.com/viewjob?jk=12345',
    locator: () => ({
      innerText: async () => 'Your application has been submitted'
    })
  };

  const step = await indeedAdapter.getCurrentStep(fakePage);
  assert.equal(step, FormStep.SUBMITTED);
});

test('Indeed Adapter: getIndeedJobPageUrl builds clean slugged URL', () => {
  const { getIndeedJobPageUrl } = indeedAdapter;
  assert.equal(
    getIndeedJobPageUrl('https://www.indeed.com/rc/clk?jk=6383d80d654c902b', 'SEO Specialist'),
    'https://www.indeed.com/job/seo-specialist-6383d80d654c902b'
  );
  assert.equal(
    getIndeedJobPageUrl('4fa9d4f17a1b9c62', 'Digital Marketing Specialist'),
    'https://www.indeed.com/job/digital-marketing-specialist-4fa9d4f17a1b9c62'
  );
});

test('Indeed Adapter: advance resolves company website and prepares handoff when allowed', async () => {
  const fakePage = {
    url: () => 'https://www.indeed.com/job/seo-specialist-12345',
    evaluate: async () => ({ href: 'https://smartmarketingagency.com/careers/apply', text: 'Apply on company site' })
  };

  const ctx = {
    config: { testMode: true, allowCompanyWebsites: true },
    candidate: { name: 'Toluwalope Oyelola', email: 'tolu@example.com' },
    job: {
      title: 'SEO Specialist',
      applicationUrl: 'https://smartmarketingagency.com/careers/apply'
    }
  };

  const result = await indeedAdapter.advance(fakePage, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, true);
  assert.equal(result.step, FormStep.REVIEW);
  assert.ok(result.reason.includes('company website (generic)'));
  assert.equal(result.meta.downstreamAdapter, 'generic');
  assert.equal(result.meta.resolvedUrl, 'https://smartmarketingagency.com/careers/apply');
});

test('Indeed Adapter: fillStep populates contact details and answers screening questions', async () => {
  const filledValues = {};
  const checkedRadios = [];
  const selectedOptions = {};

  const makeFakeInput = (id, prompt, type = 'text') => {
    const input = {
      isVisible: async () => true,
      isDisabled: async () => false,
      inputValue: async () => filledValues[id] || '',
      fill: async (v) => { filledValues[id] = v; },
      evaluate: async (fn) => fn({ id, name: id, prompt, type, labels: [{ textContent: prompt }] }),
      waitFor: async () => true,
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {},
      pressSequentially: async (v) => { filledValues[id] = v; },
      first: () => input
    };
    return input;
  };

  const fakePage = {
    url: () => 'https://smartapply.indeed.com/beta/indeedapply/form/contact-info',
    locator: (selector) => {
      if (selector.includes('first-name') || selector.includes('firstName')) {
        return { first: () => makeFakeInput('input-firstName', 'First name'), isVisible: async () => true };
      }
      if (selector.includes('last-name') || selector.includes('lastName')) {
        return { first: () => makeFakeInput('input-lastName', 'Last name'), isVisible: async () => true };
      }
      if (selector.includes('phone')) {
        return { first: () => makeFakeInput('input-phoneNumber', 'Phone number', 'tel'), isVisible: async () => true };
      }
      if (selector.includes('email')) {
        return { first: () => makeFakeInput('input-email', 'Email address', 'email'), isVisible: async () => true };
      }
      if (selector.includes('city') || selector.includes('location')) {
        return { first: () => makeFakeInput('input-location', 'City', 'text'), isVisible: async () => true };
      }
      if (selector.includes('headline') || selector.includes('jobTitle')) {
        return { first: () => makeFakeInput('input-headline', 'Headline', 'text'), isVisible: async () => true };
      }
      if (selector.includes('input[type="radio"]')) {
        const radioMock = {
          getAttribute: async (attr) => attr === 'name' ? 'sponsorQuestion' : '',
          evaluate: async (fn) => fn({ closest: () => ({ textContent: 'Will you require visa sponsorship?' }), labels: [{ textContent: 'No' }], value: 'no' }),
          isVisible: async () => true,
          check: async () => { checkedRadios.push('checked:radio'); }
        };
        return {
          first: () => radioMock,
          count: async () => (selector.includes(':checked') ? 0 : 1),
          all: async () => [
            radioMock,
            {
              getAttribute: async (attr) => attr === 'name' ? 'remoteQuestion' : '',
              evaluate: async (fn) => fn({ closest: () => ({ textContent: 'Are you comfortable working remotely?' }), labels: [{ textContent: 'Yes' }], value: 'yes' }),
              isVisible: async () => true,
              check: async () => { checkedRadios.push('checked:remote'); }
            }
          ]
        };
      }
      if (selector.includes('select:visible')) {
        return {
          all: async () => [
            {
              isDisabled: async () => false,
              inputValue: async () => '',
              evaluate: async (fn) => fn({ id: 'edu-select', options: [{ value: '', text: 'Select...' }, { value: 'bachelor', text: "Bachelor's Degree" }] }),
              selectOption: async (opt) => { selectedOptions['education'] = opt.value; }
            }
          ]
        };
      }
      if (selector.includes('input[type="text"]:visible') || selector.includes('input[type="number"]:visible')) {
        return {
          all: async () => [
            makeFakeInput('q-wp-exp', 'How many years of work experience do you have with WordPress?', 'number')
          ]
        };
      }
      if (selector.includes('textarea:visible')) {
        return {
          all: async () => [
            makeFakeInput('q-why-fit', 'Why are you a good fit for this role?')
          ]
        };
      }
      return {
        first: () => ({ isVisible: async () => false, count: async () => 0 }),
        count: async () => 0,
        all: async () => []
      };
    }
  };

  const ctx = {
    candidate: {
      name: 'Toluwalope Samuel Oyelola',
      email: 'toluoyelola066@gmail.com',
      phone: '08083723613',
      location: 'Kaduna, Nigeria',
      skills: ['WordPress', 'PHP', 'Laravel', 'JavaScript', 'MySQL', 'SEO'],
      yearsExperience: 4
    },
    answers: {
      why_good_fit: 'Extensive 4-year experience building full stack web platforms and optimizing WordPress sites.',
      describe_experience: 'Full stack development with PHP, Laravel, and WordPress.'
    },
    config: {
      applicationDefaults: { yearsExperience: 4 }
    }
  };

  await indeedAdapter.fillStep(fakePage, FormStep.DETAILS, ctx);

  assert.equal(filledValues['input-firstName'], 'Toluwalope');
  assert.equal(filledValues['input-lastName'], 'Samuel Oyelola');
  assert.equal(filledValues['input-email'], 'toluoyelola066@gmail.com');
  assert.equal(filledValues['input-phoneNumber'], '08083723613');
  assert.equal(selectedOptions['education'], 'bachelor');
  assert.ok(checkedRadios.length > 0);
  assert.equal(filledValues['q-wp-exp'], '4');
  assert.ok(filledValues['q-why-fit'].includes('Extensive 4-year experience'));
});

test('Indeed Adapter: verifySubmission detects in-page proof', async () => {
  const fakePage = {
    locator: () => ({
      innerText: async () => 'Your application has been submitted'
    }),
    url: () => 'https://smartapply.indeed.com/post-apply'
  };

  const res = await indeedAdapter.verifySubmission({}, fakePage);
  assert.equal(res.proof, 'CONFIRMED');
  assert.ok(res.markers.length > 0);
});

test('Indeed Adapter: advance identifies expired listings and halts immediately without timeout', async () => {
  const fakePage = {
    url: () => 'https://www.indeed.com/viewjob?jk=expired123',
    evaluate: async (fn) => {
      // Mock DOM environment where document.body has expired text
      return true; // isExpired === true
    }
  };

  const ctx = {
    config: { testMode: true },
    job: {
      id: 'indeed-expired123',
      title: 'Customer Experience Assoc',
      applicationUrl: 'https://www.indeed.com/viewjob?jk=expired123'
    }
  };

  const result = await indeedAdapter.advance(fakePage, FormStep.DETAILS, ctx);
  assert.equal(result.advanced, false);
  assert.ok(result.reason.includes('expired on Indeed'));
  assert.equal(result.meta.expired, true);
});
