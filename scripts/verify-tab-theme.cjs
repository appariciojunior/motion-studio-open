const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const url = process.env.MOTION_STUDIO_URL || 'http://localhost:3000/';
const candidates = process.platform === 'win32'
  ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
  : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

const executablePath = process.env.CHROME_PATH || candidates.find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error('Chrome/Edge not found. Set CHROME_PATH to run the UI theme verification.');

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1294, height: 912, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.tab.active');

    const { styles, tabToContentGaps, templateTabToSearchGap } = await page.evaluate(() => {
      const pick = (selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          color: style.color,
          borderBottomWidth: style.borderBottomWidth,
          borderBottomStyle: style.borderBottomStyle,
          borderTopLeftRadius: style.borderTopLeftRadius,
          borderBottomLeftRadius: style.borderBottomLeftRadius,
        };
      };
      const rowsAfterTabs = [...document.querySelectorAll('.ctl-row')]
        .filter((row) => row.querySelector('.segmented, .pills') && row.nextElementSibling?.classList.contains('ctl-row'));

      return {
        styles: {
          segmentedGroup: pick('.segmented'),
          pillsGroup: pick('.pills'),
          activeTab: pick('.tab.active'),
          inactiveTab: pick('.tab:not(.active)'),
          activeSeg: pick('.seg.active'),
          inactiveSeg: pick('.seg:not(.active)'),
          activePill: pick('.pill.active'),
          inactivePill: pick('.pill:not(.active)'),
          sliderValue: pick('.controls .sval'),
          xyValue: pick('.controls .xypad-vals'),
          assetBadge: pick('.right .badge'),
          assetIndex: pick('.right .asset-idx'),
        },
        tabToContentGaps: rowsAfterTabs.map((row) => {
          const tabs = row.querySelector('.segmented, .pills');
          const nextLabel = row.nextElementSibling.querySelector('.ctl-label');
          return nextLabel.getBoundingClientRect().top - tabs.getBoundingClientRect().bottom;
        }),
        templateTabToSearchGap:
          document.querySelector('.searchbox').getBoundingClientRect().top
          - document.querySelector('.tabs').getBoundingClientRect().bottom,
      };
    });

    const activeBackground = 'rgb(40, 40, 40)';
    const inactiveBackground = 'rgb(29, 29, 29)';
    const activeForeground = 'rgb(244, 201, 20)';
    const panelValueForeground = 'rgb(76, 76, 76)';

    for (const [name, style] of Object.entries({
      segmentedGroup: styles.segmentedGroup,
      pillsGroup: styles.pillsGroup,
    })) {
      assertEqual(style.borderBottomWidth, '1px', `${name} bottom divider width`);
      assertEqual(style.borderBottomStyle, 'solid', `${name} bottom divider style`);
      assertEqual(style.borderBottomLeftRadius, '0px', `${name} group bottom radius`);
    }

    for (const [name, style] of Object.entries({
      activeTab: styles.activeTab,
      activeSeg: styles.activeSeg,
      activePill: styles.activePill,
    })) {
      assertEqual(style.background, activeBackground, `${name} background`);
      assertEqual(style.color, activeForeground, `${name} foreground`);
      assertEqual(style.borderTopLeftRadius, '8px', `${name} top radius`);
      assertEqual(style.borderBottomLeftRadius, '0px', `${name} bottom radius`);
    }

    for (const [name, style] of Object.entries({
      inactiveTab: styles.inactiveTab,
      inactiveSeg: styles.inactiveSeg,
      inactivePill: styles.inactivePill,
    })) {
      assertEqual(style.background, inactiveBackground, `${name} background`);
    }

    for (const [name, style] of Object.entries({
      sliderValue: styles.sliderValue,
      xyValue: styles.xyValue,
      assetBadge: styles.assetBadge,
      assetIndex: styles.assetIndex,
    })) {
      assertEqual(style.color, panelValueForeground, `${name} foreground`);
    }

    if (tabToContentGaps.length < 2) throw new Error('Expected multiple tab groups followed by panel content.');
    tabToContentGaps.forEach((gap, index) => {
      if (gap < 16) throw new Error(`tab group ${index + 1} content gap: expected at least 16px, received ${gap}px`);
    });
    if (templateTabToSearchGap < 16) {
      throw new Error(`template tabs content gap: expected at least 16px, received ${templateTabToSearchGap}px`);
    }

    console.log('Tab theme verification passed for tab, seg, and pill controls.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
