import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://job-boards.greenhouse.io/canonical/jobs/5569916');
  
  const fileInputs = await page.$$eval('input[type="file"]', els => els.map(e => ({
    id: e.id,
    name: e.name,
    class: e.className,
    accept: e.accept,
    visible: e.offsetParent !== null
  })));
  console.log('File inputs:', fileInputs);

  const attachButtons = await page.$$eval('button, a, div[role="button"]', els => 
    els.map(e => ({ tag: e.tagName, text: e.innerText?.trim(), id: e.id, class: e.className }))
       .filter(e => /attach/i.test(e.text))
  );
  console.log('Attach buttons:', attachButtons);

  await browser.close();
})();
