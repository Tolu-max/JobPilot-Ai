const r = await fetch('https://www.myjobmag.com/job/collection-specialist-kano-seedstars-academy');
const t = await r.text();
const keyInfo = t.match(/<ul class="job-key-info">([\s\S]*?)<\/ul>/i);
console.log('Key Info:', keyInfo ? keyInfo[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : 'N/A');

const descMatch = t.match(/<div class="job-details">([\s\S]*?)<\/div>/i);
if (descMatch) {
  console.log('Description:\n', descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}
