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

/**
 * 各區收支約束的流向（v0.8.73 起使用）
 * ─────────────────────────────────────────────────────────────
 * 重力模型會同時畫出雙向交叉的流（北部明明多電，仍有南部電廠的光往北送）。這裡改成：
 *  1. 每一區先自給：區內電廠的電先送給區內負載點（區內仍用重力模型分配，近的多）
 *  2. 只有「多出來的電」才送到缺電的區（區與區之間也用距離阻抗分配）
 *  → 區間只剩單一方向的淨流量，方向與台電各區實測收支一致（凌晨北部自給 > 100% 時就畫成北部往外送）
 * sources：{ pos, mw, region }；targets：{ pos, demand, region }（demand 已是 MW，總和會自動對齊總發電）
 */
export function solveRegionalFlows(sources, targets, { lambda = 1.3, minShare = 0.06 } = {}) {
  const regions = [...new Set([...sources.map((s) => s.region), ...targets.map((t) => t.region)])];
  const supply = sources.reduce((a, s) => a + Math.max(0, s.mw), 0);
  const dSum = targets.reduce((a, t) => a + Math.max(0, t.demand), 0) || 1;
  const D = targets.map((t) => (Math.max(0, t.demand) * supply) / dSum); // 總需求對齊總發電
  const dist = (p, q) => Math.hypot((p[0] - q[0]) * Math.cos((23.7 * Math.PI) / 180), p[1] - q[1]);
  const K = (p, q) => Math.exp(-dist(p, q) / lambda);
  const G = {}, L = {}, C = {};
  for (const r of regions) { G[r] = 0; L[r] = 0; C[r] = [0, 0, 0]; }
  sources.forEach((s) => { G[s.region] += Math.max(0, s.mw); });
  targets.forEach((t, j) => { L[t.region] += D[j]; const c = C[t.region]; c[0] += t.pos[0] * D[j]; c[1] += t.pos[1] * D[j]; c[2] += D[j]; });
  const center = (r) => (C[r][2] > 0 ? [C[r][0] / C[r][2], C[r][1] / C[r][2]] : sources.find((s) => s.region === r)?.pos || [121, 23.7]);
  // 區間淨流量：多電的區 → 缺電的區（雙限制重力，只在區之間）
  const surplus = regions.filter((r) => G[r] > L[r] + 1), deficit = regions.filter((r) => L[r] > G[r] + 1);
  const T = {}; // T[s][d] MW
  if (surplus.length && deficit.length) {
    const X = surplus.map((r) => G[r] - L[r]), Y = deficit.map((r) => L[r] - G[r]);
    const k = surplus.map((s) => deficit.map((d) => K(center(s), center(d))));
    const a = X.map(() => 1), b = Y.map(() => 1);
    for (let it = 0; it < 30; it++) {
      X.forEach((_, i) => { const sum = Y.reduce((acc, y, j) => acc + b[j] * y * k[i][j], 0); a[i] = sum > 0 ? 1 / sum : 0; });
      Y.forEach((_, j) => { const sum = X.reduce((acc, x, i) => acc + a[i] * x * k[i][j], 0); b[j] = sum > 0 ? 1 / sum : 0; });
    }
    surplus.forEach((s, i) => { T[s] = {}; deficit.forEach((d, j) => { T[s][d] = a[i] * b[j] * X[i] * Y[j] * k[i][j]; }); });
  }
  // 外送分給區內各電廠：越靠近缺電區、出力越大的電廠送越多（不平均攤給每一座 → 外送線條清楚，不會被修剪掉）
  const exportOf = sources.map(() => ({}));
  for (const s of Object.keys(T)) {
    for (const d of Object.keys(T[s])) {
      const idx = sources.map((x, i) => i).filter((i) => sources[i].region === s && sources[i].mw > 0);
      const w = idx.map((i) => sources[i].mw * K(sources[i].pos, center(d)) ** 2);
      const wSum = w.reduce((x, y) => x + y, 0);
      idx.forEach((i, n) => { if (wSum > 0) exportOf[i][d] = (T[s][d] * w[n]) / wSum; });
    }
  }
  const flows = [];
  sources.forEach((src, i) => {
    const S = Math.max(0, src.mw);
    if (S <= 0) return;
    const r = src.region;
    const local = new Array(targets.length).fill(0), out = new Array(targets.length).fill(0);
    // 送往某一組負載點：依「需求 × 距離阻抗」分配 amount
    const spread = (row, amount, pick) => {
      let w = 0;
      const ws = targets.map((t, j) => { const v = pick(t) ? D[j] * K(src.pos, t.pos) : 0; w += v; return v; });
      if (w > 0) ws.forEach((v, j) => { row[j] += (amount * v) / w; });
    };
    let exp = 0;
    for (const [d, mw] of Object.entries(exportOf[i])) { const m = Math.min(mw, S - exp); exp += m; spread(out, m, (t) => t.region === d); }
    spread(local, S - exp, (t) => t.region === r);
    // 區內：佔電廠出力 < minShare 的細枝省略、其餘等比例放大（和重力模型相同）；區間外送不修剪（只省略 < 15 MW）
    const kept = local.map((mw) => (mw >= S * minShare ? mw : 0));
    const keptSum = kept.reduce((x, y) => x + y, 0);
    kept.forEach((mw, j) => { if (mw > 1 && keptSum > 0) flows.push({ source: i, target: j, mw: (mw * (S - exp)) / keptSum }); });
    out.forEach((mw, j) => { if (mw >= 15) flows.push({ source: i, target: j, mw }); });
  });
  return flows;
}
