"use client";

import { useState } from 'react';
import { Check, Clipboard } from 'lucide-react';

export default function CommandBlock({ command, prompt = '$', label = 'Copy command', className = '', style }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!command) return;
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={`command-block ${className}`.trim()} style={style}>
      <code>
        {prompt && <span className="command-prompt">{prompt} </span>}
        {command}
      </code>
      <button type="button" onClick={handleCopy} className="command-copy-button" title={label} aria-label={label}>
        {copied ? <Check size={15} /> : <Clipboard size={15} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}
