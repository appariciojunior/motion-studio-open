// A/B: card silhouettes segmented out of REAL rendered pixels on both sides.
// arqe 1080x1440 -> ours 810x1080 is a flat 0.75, and both run 30fps/360 frames,
// so frame numbers correspond 1:1. Bands are [y0, y1, x0, x1].
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
const K = 0.75;
const PHASE = { 120:'repouso', 135:'u=0.25', 147:'u=0.45 (dobra funda)', 150:'u=0.50 (de perfil)', 153:'u=0.55 (entrando)', 165:'u=0.75', 180:'repouso (+1 passo)' };

let worst = 0, worstAt = '', n = 0, sum = 0;
console.log('quadro | fase                  | n | pior desvio de borda | altura arqe->nossa');
console.log('-------|-----------------------|---|----------------------|-------------------');
for (const f of Object.keys(ARQE)) {
  const a = ARQE[f], o = OURS[f];
  if (a.length !== o.length) { console.log(`f${f}: CONTAGEM DIFERE ${a.length} vs ${o.length}`); continue; }
  let worstF = 0; const hs = [];
  for (let i = 0; i < a.length; i++) {
    for (let k = 0; k < 4; k++) {
      const d = Math.abs(a[i][k] * K - o[i][k]);
      if (d > worstF) worstF = d;
      if (d > worst) { worst = d; worstAt = `f${f} banda${i} campo${k}`; }
      sum += d; n++;
    }
    const ha = (a[i][1] - a[i][0] + 1) * K, ho = o[i][1] - o[i][0] + 1;
    hs.push(`${ha.toFixed(1)}->${ho}`);
  }
  console.log(`f${f.padStart(5)} | ${PHASE[f].padEnd(21)} | ${a.length} | ${worstF.toFixed(2).padStart(20)} | ${hs.join('  ')}`);
}
console.log(`\ndesvio medio ${(sum / n).toFixed(2)} px  |  pior ${worst.toFixed(2)} px (${worstAt})  |  ${n} bordas comparadas`);
console.log(`pior desvio relativo ao lado curto do palco (810 px): ${(100 * worst / 810).toFixed(3)}%`);
