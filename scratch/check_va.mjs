async function main() {
  const res = await fetch('https://www.hotnigerianjobs.com/hotjobs/959115/codelabprojects-nigeria-limited-job-recruitment-5.html', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const html = await res.text();
  const subLinkMatch = html.match(/Virtual Assistant[\s\S]*?href="([^"]+)"/i);
  console.log('VA link:', subLinkMatch ? subLinkMatch[1] : null);

  if (subLinkMatch) {
    const vaPage = await (await fetch(subLinkMatch[1], { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    const applyMatch = vaPage.match(/How to Apply[\s\S]{0,1000}/i) || vaPage.match(/Method of Application[\s\S]{0,1000}/i);
    console.log('Apply section:', applyMatch ? applyMatch[0] : null);
  }
}
main();
