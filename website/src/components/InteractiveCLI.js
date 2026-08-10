'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Play, RotateCcw } from 'lucide-react';

const COMMANDS = [
  { key: 'run', label: 'Run', command: 'jobpilot run --profile=tolu --review-first', desc: 'scrape, score, queue' },
  { key: 'doctor', label: 'Doctor', command: 'jobpilot doctor --profile=tolu', desc: 'check config' },
  { key: 'telegram', label: 'Telegram', command: 'jobpilot telegram --profile=tolu', desc: 'link approvals' },
  { key: 'scheduler', label: 'Scheduler', command: 'jobpilot scheduler --profiles=tolu,sister', desc: 'continuous mode' },
];

const RESPONSES = {
  run: [
    ['muted', 'loading profile: tolu'],
    ['muted', 'sources: bruntwork, jobberman, weworkremotely, jobicy'],
    ['dim', ''],
    ['muted', 'bruntwork          50 roles scraped'],
    ['muted', 'jobberman           1 role scraped'],
    ['muted', 'jobicy             38 roles scraped'],
    ['dim', ''],
    ['green', '84  Frontend Developer        BruntWork       review'],
    ['green', '78  JavaScript Developer      Jobberman       review'],
    ['warn', '42  Senior DevOps Engineer     Jobberman       ignored: senior/devops'],
    ['dim', ''],
    ['green', '2 roles queued for Telegram review'],
    ['green', '0 auto-submits without approval'],
  ],
  doctor: [
    ['muted', 'checking local profile bundle'],
    ['green', '[env]      DEEPSEEK_API_KEY       set'],
    ['green', '[browser]  playwright chromium    ready'],
    ['green', '[profile]  resume                 found'],
    ['warn', '[source]   jobberman login         review-only'],
    ['green', '[source]   bruntwork apply flow    ready'],
    ['dim', ''],
    ['green', 'profile is safe to run'],
  ],
  telegram: [
    ['muted', 'validating bot token'],
    ['green', 'bot connected'],
    ['muted', 'send /start in Telegram'],
    ['green', 'chat linked to profile: tolu'],
    ['dim', ''],
    ['muted', 'commands: /status /reviews /pause /resume /run'],
  ],
  scheduler: [
    ['muted', 'starting scheduler for 2 profiles'],
    ['muted', 'interval: 15 minutes'],
    ['dim', ''],
    ['green', '[09:00] tolu    51 scraped, 2 review, 0 applied'],
    ['green', '[09:01] sister  50 scraped, 4 review, 0 applied'],
    ['muted', '[09:15] no duplicate applications'],
    ['muted', '[09:30] waiting for Telegram approvals'],
  ],
};

const COLOR = {
  green: 'var(--green)',
  warn: 'var(--amber)',
  dim: 'var(--paper-dim)',
  muted: 'var(--paper-muted)',
};

const TYPE_DELAY = 9;

export default function InteractiveCLI() {
  const [active, setActive] = useState('run');
  const [lines, setLines] = useState([]);
  const [typing, setTyping] = useState(null);
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');
  const timerRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [lines, typing]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const runCommand = useCallback((key) => {
    if (running) return;
    const command = COMMANDS.find((item) => item.key === key) || COMMANDS[0];
    const queue = [...(RESPONSES[command.key] || [])];

    clearTimeout(timerRef.current);
    setActive(command.key);
    setRunning(true);
    setTyping(null);
    setLines([{ text: `$ ${command.command}`, color: 'var(--paper)', prompt: true }]);

    function nextLine() {
      if (!queue.length) {
        setTyping(null);
        setRunning(false);
        return;
      }

      const [tone, text] = queue.shift();
      const color = COLOR[tone] || 'var(--paper-soft)';
      if (!text) {
        setLines((prev) => [...prev, { text: '', color }]);
        timerRef.current = setTimeout(nextLine, 50);
        return;
      }

      let i = 0;
      setTyping({ text, chars: 0, color });
      function tick() {
        i += 1;
        if (i >= text.length) {
          setTyping(null);
          setLines((prev) => [...prev, { text, color }]);
          timerRef.current = setTimeout(nextLine, 65);
          return;
        }
        setTyping({ text, chars: i, color });
        timerRef.current = setTimeout(tick, TYPE_DELAY);
      }
      timerRef.current = setTimeout(tick, TYPE_DELAY);
    }

    timerRef.current = setTimeout(nextLine, 120);
  }, [running]);

  const clear = () => {
    clearTimeout(timerRef.current);
    setLines([]);
    setTyping(null);
    setRunning(false);
    setInput('');
  };

  const submitInput = (event) => {
    if (event.key !== 'Enter') return;
    const raw = input.trim().replace(/^jobpilot\s+/i, '');
    const match = COMMANDS.find((item) => item.command.includes(raw) || item.key === raw);
    if (match) runCommand(match.key);
    else {
      setLines((prev) => [
        ...prev,
        { text: `$ jobpilot ${raw}`, color: 'var(--paper)', prompt: true },
        { text: `unknown command: ${raw || '(empty)'}`, color: 'var(--red)' },
        { text: 'try: run, doctor, telegram, scheduler', color: 'var(--paper-dim)' },
      ]);
    }
    setInput('');
  };

  return (
    <div className="cli-console">
      <div className="cli-command-list" role="tablist" aria-label="CLI demo commands">
        {COMMANDS.map((cmd) => (
          <button
            key={cmd.key}
            type="button"
            className={`cli-command ${active === cmd.key ? 'active' : ''}`}
            onClick={() => runCommand(cmd.key)}
            disabled={running}
          >
            <span>{cmd.label}</span>
            <small>{cmd.desc}</small>
          </button>
        ))}
      </div>

      <div className="cli-frame" onClick={() => document.getElementById('cli-input')?.focus()}>
        <div className="cli-titlebar">
          <div className="cli-title">
            <span className="cli-dot" />
            <span>jobpilot local runner</span>
          </div>
          <div className="cli-actions">
            {running && <span className="cli-running">running</span>}
            <button type="button" onClick={(event) => { event.stopPropagation(); runCommand(active); }} disabled={running} title="Run selected command">
              <Play size={14} />
            </button>
            <button type="button" onClick={(event) => { event.stopPropagation(); clear(); }} title="Clear terminal">
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        <div className="cli-output">
          {lines.length === 0 && !typing && (
            <div className="cli-hint">Select a command above or type run, doctor, telegram, scheduler.</div>
          )}

          <AnimatePresence initial={false}>
            {lines.map((line, index) => (
              <motion.div
                key={`${line.text}-${index}`}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={line.prompt ? 'cli-line prompt' : 'cli-line'}
                style={{ color: line.color }}
              >
                {line.text || ' '}
              </motion.div>
            ))}
          </AnimatePresence>

          {typing && (
            <div className="cli-line" style={{ color: typing.color }}>
              {typing.text.slice(0, typing.chars)}
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ repeat: Infinity, duration: 0.55, ease: 'linear' }}
                className="cli-cursor"
              >
                |
              </motion.span>
            </div>
          )}

          {!running && (
            <div className="cli-input-row">
              <span>$</span>
              <input
                id="cli-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={submitInput}
                placeholder="type a command"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
