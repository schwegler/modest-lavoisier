const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log(msg.text()));
  await page.goto('http://localhost:3000/test_editor.html');
  await page.waitForTimeout(2000);
  await browser.close();
  process.exit(0);
})();
