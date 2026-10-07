import fs from 'node:fs';

let content = fs.readFileSync('src/scrapers/indeed.js', 'utf8');

const oldBlock = `      if (Array.isArray(cookies) && cookies.length > 0) {
        return cookies.map((c) => {`;

const newBlock = `      if (Array.isArray(cookies) && cookies.length > 0) {
        const now = Date.now() / 1000;
        return cookies.filter((c) => {
          if (!c.name || !c.value) return false;
          if (c.name.includes('cf_') || c.name.includes('_cf')) return false;
          if (c.expirationDate && c.expirationDate < now) return false;
          return true;
        }).map((c) => {`;

if (content.includes(oldBlock)) {
  content = content.replace(oldBlock, newBlock);
  fs.writeFileSync('src/scrapers/indeed.js', content, 'utf8');
  console.log('Successfully updated loadIndeedCookies filtering in src/scrapers/indeed.js');
} else {
  console.log('Target block not found in src/scrapers/indeed.js');
}
