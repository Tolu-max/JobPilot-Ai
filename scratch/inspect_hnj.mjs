function decodeCfEmail(encoded) {
  let email = '';
  const r = parseInt(encoded.substr(0, 2), 16);
  for (let n = 2; encoded.length - n; n += 2) {
    const c = parseInt(encoded.substr(n, 2), 16) ^ r;
    email += String.fromCharCode(c);
  }
  return email;
}

async function main() {
  const res = await fetch('http://www.hotnigerianjobs.com/feed/rss.xml', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const text = await res.text();
  const items = text.match(/<item>[\s\S]*?<\/item>/gi) || [];
  console.log(`Total items in RSS: ${items.length}`);

  for (let i = 0; i < Math.min(items.length, 8); i++) {
    const title = items[i].match(/<title>([\s\S]*?)<\/title>/i)?.[1];
    const link = items[i].match(/<link>([\s\S]*?)<\/link>/i)?.[1];
    try {
      const pageRes = await fetch(link, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await pageRes.text();
      const cfMatch = html.match(/data-cfemail="([a-f0-9]+)"/i);
      const email = cfMatch ? decodeCfEmail(cfMatch[1]) : null;
      
      const extMatch = html.match(/href="([^"]+)"[^>]*>(?:Click here to apply|Apply here|Click here)/i);
      const applyLink = extMatch ? extMatch[1] : null;

      console.log({
        index: i,
        title,
        link,
        decodedEmail: email,
        applyLink
      });
    } catch (err) {
      console.error(`Error fetching ${link}: ${err.message}`);
    }
  }
}

main();
