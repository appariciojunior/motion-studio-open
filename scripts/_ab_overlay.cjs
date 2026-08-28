// Draws arqe's card silhouettes over ours, both segmented from real rendered
// pixels, on our 810x1080 stage. Coinciding outlines = matching geometry.
const fs = require('node:fs');
const path = require('node:path');

const ARQE = {
  120: [[21,470,371,708],[495,944,371,708],[969,1418,371,708]],
  135: [[29,451,371,708],[476,925,371,708],[950,1399,371,708]],
  147: [[112,351,371,708],[376,825,371,708],[850,1299,371,708]],
  150: [[258,707,371,708],[732,1181,371,708]],
  153: [[140,589,371,708],[614,1063,371,708],[1088,1327,371,708]],
  165: [[40,489,371,708],[514,963,371,708],[988,1410,371,708]],
  180: [[21,470,371,708],[495,944,371,708],[969,1418,371,708]],
};
const OURS = {
  120: [[15,352,278,531],[371,708,278,531],[727,1064,278,531]],
  135: [[21,338,278,531],[356,694,278,531],[712,1050,278,531]],
  147: [[83,262,278,531],[281,619,278,531],[637,974,278,531]],
  150: [[193,530,278,531],[549,886,278,531]],
  153: [[104,442,278,531],[460,798,278,531],[816,996,278,531]],
  165: [[29,367,278,531],[385,722,278,531],[741,1058,278,531]],
  180: [[15,352,278,531],[371,708,278,531],[727,1064,278,531]],
};
const LABEL = { 120:'repouso', 135:'u=0.25', 147:'u=0.45', 150:'u=0.50', 153:'u=0.55', 165:'u=0.75', 180:'repouso+1' };
const K = 0.75, W = 810, H = 1080, SC = 0.30, PAD = 18;
const cw = W * SC, ch = H * SC;
const frames = Object.keys(ARQE);
const sheetW = PAD + frames.length * (cw + PAD);
const sheetH = PAD + 34 + ch + PAD + 26;

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}" viewBox="0 0 ${sheetW} ${sheetH}">
<rect width="100%" height="100%" fill="#0d0d0f"/>
<text x="${PAD}" y="24" font-family="monospace" font-size="15" fill="#e8e8ea">A/B Flip 01 — silhuetas dos cartoes, medidas nos pixels renderizados dos dois apps</text>`;

frames.forEach((f, i) => {
  const x0 = PAD + i * (cw + PAD), y0 = PAD + 34;
  svg += `<g transform="translate(${x0},${y0})">
  <rect width="${cw}" height="${ch}" fill="#161619" stroke="#2a2a30"/>`;
  for (const b of ARQE[f]) {
    const y = b[0] * K * SC, h = (b[1] - b[0] + 1) * K * SC;
    const x = b[2] * K * SC, w = (b[3] - b[2] + 1) * K * SC;
    svg += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="none" stroke="#ff4d6d" stroke-width="2.6"/>`;
  }
  for (const b of OURS[f]) {
    const y = b[0] * SC, h = (b[1] - b[0] + 1) * SC;
    const x = b[2] * SC, w = (b[3] - b[2] + 1) * SC;
    svg += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="none" stroke="#4dd4ff" stroke-width="1.1" stroke-dasharray="5 4"/>`;
  }
  svg += `<text x="4" y="${ch + 15}" font-family="monospace" font-size="11" fill="#9a9aa4">f${f}  ${LABEL[f]}</text></g>`;
});

svg += `<text x="${PAD}" y="${sheetH - 8}" font-family="monospace" font-size="12" fill="#9a9aa4">`
  + `<tspan fill="#ff4d6d">solido = arqe (1080x1440 reescalado x0,75)</tspan>   `
  + `<tspan fill="#4dd4ff">tracejado = nosso (810x1080)</tspan>   desvio medio 0,30 px  |  pior 1,25 px</text></svg>`;

const out = path.join(__dirname, '..', '.shots', 'ab-flip-overlay.svg');
fs.writeFileSync(out, svg);
console.log('wrote', out);
