"use client";

import { useState } from 'react';
import { Clipboard } from 'lucide-react';

export default function CommandButton({ command }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button type="button" onClick={handleCopy} className="button button-ghost" title="Copy command">
      <Clipboard size={15} /> {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
