import Link from 'next/link';
import { HelpCircle, LockKeyhole, MonitorCog, Send } from 'lucide-react';

export const metadata = { title: 'FAQ | JobPilot' };

const faqs = [
  {
    question: 'Does JobPilot apply to jobs without review?',
    answer: 'The safer default is review-first. A role can be scraped and scored automatically, but live submit should only happen after the source and application flow are audited and the profile allows it.',
  },
  {
    question: 'Can the web app store my AI, CAPTCHA, or job-board keys?',
    answer: 'The recommended open-source setup is no. Keep AI provider keys, CAPTCHA solver keys, job-board passwords, resumes, cookies, and browser profiles on the local runner.',
  },
  {
    question: 'Can I run this on a server or worker?',
    answer: 'Yes, as long as you control the worker and can run browser automation there. Use the CLI scheduler on a trusted machine, VPS, or automation host. The hosted dashboard should only sync safe metadata and approvals.',
  },
  {
    question: 'How does Telegram work?',
    answer: 'Each user creates their own Telegram bot with BotFather. The CLI validates the token, discovers the chat, and saves the token locally. The hosted dashboard does not need the Telegram token.',
  },
  {
    question: 'What happens when a company redirects to an ATS?',
    answer: 'Audited flows can be automated. Unknown or risky application systems should route to manual review until the resolver and form handler are tested.',
  },
  {
    question: 'Can contributors add more job platforms?',
    answer: 'Yes. New sources should include scraper tests, recency checks, duplicate handling, and an apply-flow audit before live submission is enabled.',
  },
];

export default function FAQPage() {
  return (
    <div className="container section">
      <div className="page-header" style={{ maxWidth: '760px' }}>
        <span className="page-eyebrow"><HelpCircle size={15} /> FAQ</span>
        <h1 className="heading-lg">Practical answers for running JobPilot safely.</h1>
        <p className="text-body">
          Job automation touches private accounts and real applications, so the product needs clear boundaries.
        </p>
      </div>

      <div style={{ display: 'grid', gap: '14px' }}>
        {faqs.map((faq) => (
          <section key={faq.question} className="panel">
            <h2 className="heading-sm" style={{ marginBottom: 8 }}>{faq.question}</h2>
            <p className="muted" style={{ lineHeight: 1.7 }}>{faq.answer}</p>
          </section>
        ))}
      </div>

      <section className="grid-3" style={{ marginTop: '34px' }}>
        {[
          { icon: LockKeyhole, title: 'Secret storage', body: 'Keep provider keys, resumes, cookies, and account credentials on the local runner.' },
          { icon: MonitorCog, title: 'Apply runner', body: 'Run Playwright automation from your own computer, VPS, or private worker.' },
          { icon: Send, title: 'Review alerts', body: 'Use Telegram to approve, skip, and inspect queued roles before submit.' },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.title} className="card">
              <Icon size={22} style={{ color: 'var(--accent-light)', marginBottom: 12 }} />
              <h3 className="heading-sm" style={{ marginBottom: 8 }}>{item.title}</h3>
              <p className="muted">{item.body}</p>
            </article>
          );
        })}
      </section>

      <div style={{ display: 'flex', gap: '10px', marginTop: '28px', flexWrap: 'wrap' }}>
        <Link href="/docs" className="button button-primary">Read Documentation</Link>
        <Link href="/features" className="button">View Features</Link>
      </div>
    </div>
  );
}
