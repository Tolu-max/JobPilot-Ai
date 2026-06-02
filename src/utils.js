export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function humanDelay(config) {
  const min = config.minDelayMs || 2000;
  const max = config.maxDelayMs || 6000;
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await sleep(ms);
}

export function compactText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripHtml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/â€¦|â¦/g, '…')
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€\u009d/g, '"')
    .replace(/â€"/g, '\u2013')
    .replace(/â€"/g, '\u2014')
    .replace(/please mention the word[\s\S]{0,300}?when applying[^\n]*/gi, '')
    .replace(/please mention the word\s+\*{0,2}\w+\*{0,2}[^\n]*/gi, '')
    .replace(/#[A-Z][a-zA-Z]*[A-Z][a-zA-Z]*/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n').replace(/<p[^>]*>/gi, '\n')
    .replace(/<\/li>/gi, '\n').replace(/<li[^>]*>/gi, '\u2022 ')
    .replace(/<\/div>/gi, '\n').replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/ul>/gi, '\n').replace(/<\/ol>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '\u2013').replace(/&mdash;/g, '\u2014')
    .replace(/&hellip;/g, '\u2026').replace(/&bull;/g, '\u2022')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function normalizeJobText(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
