/**
 * 電力流向模擬 — 雙限制重力模型（Doubly-constrained Gravity Model）
 * ─────────────────────────────────────────────────────────────
 * 沒有真實的輸電線潮流資料，所以用交通工程常見的 OD 分配法來「推估」：
 *
 *   F[s][t] = a[s] · b[t] · S[s] · D[t] · f(d_st)
 *
 *   S[s]  電廠 s 的即時出力（MW）
 *   D[t]  負載點 t 的需求（= 總出力 × 需求權重）
 *   f(d)  距離阻抗：越遠越難送，exp(-d/λ)
 *   a,b   平衡係數，用迭代比例配適（IPF / Furness 法）求解，
 *         確保「每座電廠送出的總量 = 其出力」且「每個負載點收到的總量 = 其需求」
 *
 * 結果：北部需求大、北部電源不足 → 中南部電力自然往北流（南電北送 / 中電北送），
 *       不需要寫死任何一條「南往北」規則，而且隨太陽能日夜變化自動改變流向。
 */
export function solveFlows(sources, targets, { lambda = 1.3, iterations = 24, minShare = 0.06 } = {}) {
  const S = sources.map((s) => Math.max(0, s.mw));
  const supply = S.reduce((a, b) => a + b, 0);
  const wSum = targets.reduce((a, t) => a + t.demand, 0);
  const D = targets.map((t) => (supply * t.demand) / wSum);

  // 距離阻抗矩陣（經緯度近似距離，以「度」為單位即可）
  const K = sources.map((s) =>
    targets.map((t) => {
      const dx = (s.pos[0] - t.pos[0]) * Math.cos((23.7 * Math.PI) / 180);
      const dy = s.pos[1] - t.pos[1];
      return Math.exp(-Math.hypot(dx, dy) / lambda);
    })
  );

  const a = new Array(S.length).fill(1);
  const b = new Array(D.length).fill(1);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < S.length; i++) {
      let sum = 0;
      for (let j = 0; j < D.length; j++) sum += b[j] * D[j] * K[i][j];
      a[i] = sum > 0 ? 1 / sum : 0;
    }
    for (let j = 0; j < D.length; j++) {
      let sum = 0;
      for (let i = 0; i < S.length; i++) sum += a[i] * S[i] * K[i][j];
      b[j] = sum > 0 ? 1 / sum : 0;
    }
  }

  // 修剪細枝：佔該電廠出力 < minShare 的流向省略，剩餘的等比例放大，
  // 讓畫面只留下有意義的主幹（避免東部電廠拉出橫越中央山脈的雜線）
  const flows = [];
  for (let i = 0; i < S.length; i++) {
    const row = D.map((_, j) => a[i] * b[j] * S[i] * D[j] * K[i][j]);
    const kept = row.map((mw) => (mw >= S[i] * minShare ? mw : 0));
    const keptSum = kept.reduce((x, y) => x + y, 0);
    kept.forEach((mw, j) => {
      if (mw > 1) flows.push({ source: i, target: j, mw: (mw * S[i]) / keptSum });
    });
  }
  return flows;
}
