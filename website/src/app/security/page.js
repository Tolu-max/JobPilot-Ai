import Link from 'next/link';
import CommandBlock from '@/components/CommandBlock';

export const metadata = { title: 'Security · JobPilot' };

const stays = [
  ['Resume files (PDF / DOCX / TXT)', 'never read by any cloud process'],
  ['Parsed profile.yaml (skills, history)', 'read only by the local matcher and the AI provider you pick'],
  ['AI provider keys (DeepSeek, Gemini, OpenRouter, Groq, …)', 'used directly from the CLI to the provider; the web has no access'],
  ['CAPTCHA solver keys (CapSolver)', 'used directly by the local runner during a submit'],
  ['Job-board login cookies and saved Playwright sessions', 'live in ~/.jobpilot/profiles/<name>/.playwright'],
  ['Telegram bot token', 'stored under the profile; the bot only ever talks to you'],
  ['Browser screenshots and apply traces', 'written to local logs for your debugging only'],
  ['Raw scraper HTML and error dumps', 'never leave the machine'],
];

const syncs = [
  ['Job title', 'so you can read the queue without opening the link'],
  ['Company name', 'same reason'],
  ['Source board name', 'e.g. "greenhouse" or "remoteok"'],
  ['Match score (integer 0–100)', 'so the dashboard can sort by relevance'],
  ['Public job URL', 'the URL anyone can already open without an account'],
  ['Status (pending / approved / applied / failed)', 'so approvals and outcomes show up across devices'],
  ['Profile label (e.g. "alex")', 'just the label string, never the profile contents'],
  ['Created and updated timestamps', 'for ordering and recency'],
  ['Your approve / reject decisions', 'pulled back by the local scheduler on its next tick'],
];

const threats = [
  {
    title: 'Compromised dashboard ⇒ cannot apply for you',
    body: 'The web has no API into your machine. Even with full database access, an attacker gets metadata only: titles, companies, URLs. They cannot trigger submits, cannot read your resume, cannot exfiltrate your keys, cannot order new scrapes.',
  },
  {
    title: 'Compromised laptop ⇒ same risk as before JobPilot',
    body: 'If your laptop is compromised, JobPilot is the least of your problems — the attacker already has your shell, your browser cookies, and your saved passwords. The CLI runs as your user, with your permissions. It does not escalate.',
  },
  {
    title: 'Compromised AI provider ⇒ leaks the scoring prompt only',
    body: 'When the AI scorer runs, it sees a job description and a profile summary. It does not see your raw resume file, your password, your email contents, or your dashboard token. The least leaky provider for this work is one you already trust — pick accordingly.',
  },
  {
    title: 'Malicious adapter PR ⇒ caught at audit',
    body: 'Every ATS adapter goes through code review and ships with tests. The release gate refuses any commit that introduces a network call to an unexpected host. New adapters land in manual-review-only mode and graduate to auto-apply after a real trace.',
  },
];

const checklist = [
  ['Read the source.', 'It is MIT-licensed and small. The scraper layer, the scorer, the apply runner, and the dashboard sync are each a few hundred lines.'],
  ['Run jobpilot doctor.', 'Doctor reports exactly which env vars, which profile files, and which sources are configured. It does not phone home.'],
  ['Start with review-first.', 'It is the default. Keep it on until you have watched the runner do five or ten applications and trust what you see.'],
  ['Use a dedicated browser profile.', 'Playwright stores cookies under the profile directory. Treat that directory like a password store.'],
  ['Rotate keys when you stop using a provider.', 'You hold the keys. The dashboard never sees them, so we can never rotate them for you.'],
];

export default function SecurityPage() {
  return (
    <div className="container section">
      <div className="page-header" style={{ maxWidth: 820 }}>
        <span className="page-eyebrow">security model</span>
        <h1 className="heading-lg">A short, honest accounting of what JobPilot can and cannot see.</h1>
        <p className="text-body">
          Job-application tooling sits on top of the most sensitive things you own: your resume, your AI bills, your professional reputation. This page documents the boundary the project is designed around. If something here is wrong, that&apos;s a bug — open an issue.
        </p>
      </div>

      {/* ── data boundary ──────────────────────────────────────── */}
      <section style={{ marginBottom: 56 }}>
        <div className="kicker" style={{ marginBottom: 14 }}>data boundary</div>
        <h2 className="heading-md" style={{ marginBottom: 22, maxWidth: 720 }}>
          Two columns. Everything is in one or the other, by design.
        </h2>

        <div className="boundary-grid">
          <div className="boundary-cell local">
            <h4>local — stays on the laptop running the CLI</h4>
            <ul>
              {stays.map(([what, why]) => (
                <li key={what}>
                  <span><strong style={{ color: 'var(--paper)' }}>{what}.</strong> <span className="muted">{why}.</span></span>
                </li>
              ))}
            </ul>
          </div>
          <div className="boundary-cell web">
            <h4>syncs — what the dashboard receives (if you log in)</h4>
            <ul>
              {syncs.map(([what, why]) => (
                <li key={what}>
                  <span><strong style={{ color: 'var(--paper)' }}>{what}.</strong> <span className="muted">{why}.</span></span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── CLI auth handoff ──────────────────────────────────── */}
      <section style={{ marginBottom: 56 }}>
        <div className="kicker" style={{ marginBottom: 14 }}>cli ↔ web auth</div>
        <h2 className="heading-md" style={{ marginBottom: 16, maxWidth: 720 }}>
          You never paste a token. Auth happens through a one-time localhost handoff.
        </h2>

        <div className="grid-2" style={{ alignItems: 'stretch' }}>
          <article className="panel" style={{ display: 'grid', gap: 14 }}>
            <h3 className="heading-sm">How it works</h3>
            <ol style={{ listStyle: 'none', display: 'grid', gap: 10, counterReset: 'step' }}>
              {[
                'You run jobpilot login on your machine.',
                'CLI binds a loopback HTTP server on a random unused high port (e.g. 47823).',
                'CLI opens your default browser to /login?cli_port=47823 on the dashboard.',
                'You sign in with GitHub or Google (Supabase OAuth, no password stored anywhere).',
                'Dashboard POSTs the session token to http://localhost:47823 — only your machine receives it.',
                'CLI verifies the token, writes it to ~/.jobpilot/credentials, closes the loopback, and shuts down the server.',
              ].map((line, i) => (
                <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.78rem', color: 'var(--amber)', minWidth: 26 }}>0{i + 1}</span>
                  <span style={{ color: 'var(--paper-soft)', lineHeight: 1.6 }}>{line}</span>
                </li>
              ))}
            </ol>
            <CommandBlock command="jobpilot login" />
          </article>

          <article className="panel" style={{ display: 'grid', gap: 14 }}>
            <h3 className="heading-sm">Why it&apos;s safer than a token paste</h3>
            <ul style={{ listStyle: 'none', display: 'grid', gap: 12 }}>
              <li style={{ display: 'flex', gap: 10 }}>
                <span style={{ color: 'var(--green)', fontWeight: 700 }}>·</span>
                <span className="muted">No copy-paste means no clipboard malware can intercept the token, and no shell history captures it.</span>
              </li>
              <li style={{ display: 'flex', gap: 10 }}>
                <span style={{ color: 'var(--green)', fontWeight: 700 }}>·</span>
                <span className="muted">The loopback port is random, ephemeral, and bound to 127.0.0.1 only. Other machines on your network cannot reach it.</span>
              </li>
              <li style={{ display: 'flex', gap: 10 }}>
                <span style={{ color: 'var(--green)', fontWeight: 700 }}>·</span>
                <span className="muted">The token is scoped to dashboard sync — it cannot trigger applies on your machine, only read and write metadata in your dashboard row.</span>
              </li>
              <li style={{ display: 'flex', gap: 10 }}>
                <span style={{ color: 'var(--green)', fontWeight: 700 }}>·</span>
                <span className="muted">Revoke any time from <code className="inline-code">/dashboard/settings</code> or with <code className="inline-code">jobpilot logout</code>. Worker stops syncing immediately.</span>
              </li>
            </ul>
          </article>
        </div>
      </section>

      {/* ── threat model ──────────────────────────────────────── */}
      <section style={{ marginBottom: 56 }}>
        <div className="kicker" style={{ marginBottom: 14 }}>threat model</div>
        <h2 className="heading-md" style={{ marginBottom: 22, maxWidth: 720 }}>
          What gets worse when one piece is compromised — and what stays safe.
        </h2>
        <div className="grid-2">
          {threats.map((t) => (
            <article key={t.title} className="panel" style={{ display: 'grid', gap: 10 }}>
              <h3 className="heading-sm" style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{t.title}</h3>
              <p className="muted" style={{ lineHeight: 1.7 }}>{t.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── trust checklist ────────────────────────────────────── */}
      <section style={{ marginBottom: 56 }}>
        <div className="kicker" style={{ marginBottom: 14 }}>your trust checklist</div>
        <h2 className="heading-md" style={{ marginBottom: 22, maxWidth: 720 }}>
          Five things to do before running JobPilot against a real job search.
        </h2>
        <ol style={{ listStyle: 'none', display: 'grid', gap: 18, counterReset: 'check' }}>
          {checklist.map(([head, body], i) => (
            <li key={i} style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: 16, padding: '18px 0', borderTop: '1px solid var(--line)' }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '1.1rem', color: 'var(--amber)' }}>0{i + 1}</span>
              <div>
                <h3 className="heading-sm" style={{ marginBottom: 6, fontFamily: 'IBM Plex Mono, monospace' }}>{head}</h3>
                <p className="muted" style={{ lineHeight: 1.7 }}>{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── report ─────────────────────────────────────────────── */}
      <div className="cta-strip">
        <div>
          <div className="kicker" style={{ marginBottom: 10 }}>responsible disclosure</div>
          <h2 className="heading-md" style={{ marginBottom: 8 }}>Found a security issue?</h2>
          <p className="muted" style={{ maxWidth: 540 }}>
            Email <code className="inline-code">security@jobpilot.dev</code> or open a private GitHub security advisory. We acknowledge within 72 hours and credit reporters in the changelog unless you ask us not to.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="https://github.com/Tolu-max/JobPilot-Ai/security/advisories/new" target="_blank" rel="noopener noreferrer" className="button button-primary">
            File an advisory
          </Link>
          <Link href="/docs" className="button">Read docs</Link>
        </div>
      </div>
    </div>
  );
}
