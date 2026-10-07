function decodeCfEmail(encoded) {
  let email = '';
  const r = parseInt(encoded.substr(0, 2), 16);
  for (let n = 2; encoded.length - n; n += 2) {
    const c = parseInt(encoded.substr(n, 2), 16) ^ r;
    email += String.fromCharCode(c);
  }
  return email;
}

async function findTargetJobs() {
  const res = await fetch('http://www.hotnigerianjobs.com/feed/rss.xml', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const text = await res.text();
  const items = text.match(/<item>[\s\S]*?<\/item>/gi) || [];
  console.log(`Total items in RSS: ${items.length}`);

  const candidates = [];

  for (let i = 0; i < items.length; i++) {
    const title = items[i].match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
    const link = items[i].match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '';
    const desc = items[i].match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '';
    const full = `${title} ${desc}`.toLowerCase();

    if (/developer|software|frontend|backend|web|wordpress|php|laravel|customer support|customer care|customer service|virtual assistant|data entry|it support/i.test(full)) {
      candidates.push({ title, link });
    }
  }

  console.log(`Found ${candidates.length} matching candidate jobs in feed:`);
  for (const c of candidates) {
    console.log(`- ${c.title} -> ${c.link}`);
  }
}

findTargetJobs();
