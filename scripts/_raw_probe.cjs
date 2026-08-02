const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell',
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 90000 });
  const box = await page.$('input[type=checkbox]');
  if (box) { await box.click(); await new Promise(r=>setTimeout(r,150));
    for (const b of await page.$$('button')) { const t=(await page.evaluate(el=>el.textContent,b))||''; if(/library|agree|continue|start/i.test(t)&&t.length<40){await b.click();break;} }
    await new Promise(r=>setTimeout(r,500)); }
  await page.waitForSelector('canvas.stage-canvas');
  const dataUrl = await page.evaluate(async (id, targetFrame) => {
    const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const setInput = (el, value) => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const select = document.querySelector('select');
    setInput(select, id);
    for (let i=0;i<6;i++) await raf();
    const scrub = document.querySelector('.scrubber input[type=range]');
    setInput(scrub, targetFrame);
    for (let i=0;i<4;i++) await raf();
    const canvas = document.querySelector('canvas.stage-canvas');
    return canvas.toDataURL('image/png');
  }, process.argv[2], Number(process.argv[3]));
  fs.writeFileSync(process.argv[4], Buffer.from(dataUrl.split(',')[1], 'base64'));
  await browser.close();
}
main();
