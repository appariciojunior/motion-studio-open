#!/usr/bin/env node
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const URL = process.env.MS_URL || 'http://localhost:3000';
const CHROME = [
  process.env.MS_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].find((candidate) => candidate && fs.existsSync(candidate));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

(async () => {
  if (!CHROME) throw new Error('Chrome not found');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    console.log('open library');
    await page.goto(`${URL}/library`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('motion-welcome-seen', '1');
      localStorage.setItem('motion-tour-seen', '1');
      localStorage.setItem('motion-mockup-tour-seen', '1');
    });
    console.log('reload clean profile');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('motion-projects-v1');
      return raw && JSON.parse(raw).activeId;
    }, { timeout: 90_000 });
    await sleep(800);

    console.log('inspect 2d');
    const first = await page.evaluate(() => {
      const index = JSON.parse(localStorage.getItem('motion-projects-v1'));
      const project = index.projects.find((item) => item.id === index.activeId);
      return {
        project,
        scene: !!localStorage.getItem(`motion-project-${project.id}`),
        mockup: !!localStorage.getItem(`motion-3d-v1:${project.id}`),
      };
    });
    assert(first.project.mode === '2d', 'fresh /library project is not 2D');
    assert(!first.mockup, '2D project acquired a Mockup key');

    console.log('open mockup');
    await page.goto(`${URL}/mockup`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('motion-projects-v1');
      if (!raw) return false;
      const index = JSON.parse(raw);
      return index.projects.find((item) => item.id === index.activeId)?.mode === 'mockup';
    }, { timeout: 90_000 });
    await sleep(800);
    console.log('inspect mockup');
    const mockup = await page.evaluate(() => {
      const index = JSON.parse(localStorage.getItem('motion-projects-v1'));
      const project = index.projects.find((item) => item.id === index.activeId);
      return {
        project,
        count: index.projects.length,
        scene: !!localStorage.getItem(`motion-project-${project.id}`),
        mockup: !!localStorage.getItem(`motion-3d-v1:${project.id}`),
      };
    });
    assert(mockup.project.mode === 'mockup', '/mockup did not select a Mockup project');
    assert(mockup.count === 2, 'switching modes did not create exactly one matching project');
    assert(!mockup.scene, 'Mockup project acquired a 2D scene key');
    assert(mockup.mockup, 'Mockup project did not persist its studio document');

    console.log('return library');
    await page.goto(`${URL}/library`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('motion-projects-v1');
      if (!raw) return false;
      const index = JSON.parse(raw);
      return index.projects.find((item) => item.id === index.activeId)?.mode === '2d';
    }, { timeout: 90_000 });
    await sleep(800);
    const returned = await page.evaluate(() => {
      const index = JSON.parse(localStorage.getItem('motion-projects-v1'));
      const project = index.projects.find((item) => item.id === index.activeId);
      return { project, count: index.projects.length };
    });
    assert(returned.project.id === first.project.id, 'returning to Library did not restore its 2D project');
    assert(returned.count === 2, 'returning to an existing mode created a duplicate project');
    assert(errors.length === 0, `page errors: ${errors.join(' | ')}`);

    console.log(JSON.stringify({ first, mockup, returned, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
