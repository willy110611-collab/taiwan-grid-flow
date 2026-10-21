/**
 * 模擬資料產生器 — 打不到台電 API 時的 fallback。
 *
 * 產出與台電 genary 「相同格式」的資料（aaData 陣列），
 * 所以 fallback 與真實資料走的是同一條解析管線，不會有兩套邏輯。
 *
 * 曲線依台灣時間（UTC+8）生成：
 *  - 太陽能：日出到日落的鐘形曲線 + 緩慢雲量起伏
 *  - 風力：東北季風季（10–3 月）較強，緩慢呼吸變化
 *  - 抽蓄水力：傍晚尖峰放水發電
 *  - 核三：2025/5 已停機，維持 0（若重啟，改這裡即可）
 *  - 燃氣：補足剩餘負載（調度機組）
 */
export function mockGenary(now = new Date()) {
  const tw = new Date(now.getTime() + 8 * 3600e3);
  const h = tw.getUTCHours() + tw.getUTCMinutes() / 60;
  const month = tw.getUTCMonth() + 1;
  const t = now.getTime() / 60000; // 分鐘

  const slow = (period, phase = 0) => Math.sin((2 * Math.PI * t) / period + phase);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // 全台負載：夜間 ~25 GW，午後尖峰 ~36 GW
  const load = 25500 + 9500 * clamp01(Math.sin((Math.PI * (h - 6.5)) / 15)) ** 1.2 + 600 * slow(97);

  const sunUp = clamp01(Math.sin((Math.PI * (h - 5.8)) / 12.4));
  const cloud = 0.82 + 0.12 * slow(53) + 0.06 * slow(17, 1.3);
  const solar = 12500 * sunUp ** 1.35 * cloud;

  const monsoon = month >= 10 || month <= 3 ? 1 : 0.45;
  const wind = (1700 + 1100 * (0.5 + 0.5 * slow(181)) + 300 * slow(29, 2)) * monsoon;

  const evening = Math.exp(-(((h - 19.3) / 1.6) ** 2));
  const hydro = 520 + 2100 * evening + 120 * slow(41);

  const nuclear = 0;
  const coal = 9800 + 900 * slow(240, 0.7) - 1500 * sunUp; // 白天光電多時降載
  const cogen = 1350;
  const other = 520;
  const gas = Math.max(6000, load - solar - wind - hydro - nuclear - coal - cogen - other);

  const rows = [];
  const typeCell = (zh, en) => `<A NAME='${en.toLowerCase()}'></A><b>${zh}(${en})</b>`;
  const push = (zh, en, units, total) => {
    const capSum = units.reduce((a, [, cap]) => a + cap, 0);
    let rest = total;
    units.forEach(([name, cap], i) => {
      const share = i === units.length - 1 ? rest : Math.min(cap, (total * cap) / capSum);
      rest -= share;
      const mw = Math.max(0, share);
      rows.push([typeCell(zh, en), '', name, cap.toFixed(1), `${mw.toFixed(1)}(${((mw / cap) * 100).toFixed(1)}%)`, '', mw > 0 ? '' : '停機']);
    });
    rows.push([typeCell(zh, en), '', '小計', capSum.toFixed(1), total.toFixed(1), '', '']);
  };

  push('核能', 'Nuclear', [['核三Gen.1', 951], ['核三Gen.2', 951]], nuclear);
  push('燃煤', 'Coal', [
    ['台中#1-10', 5500], ['林口#1-3', 2400], ['興達#1-4', 2100], ['大林#1-2', 1600]
  ], coal * 0.74);
  push('民營電廠-燃煤', 'IPP-Coal', [['麥寮#1-3', 1800], ['和平#1-2', 1300]], coal * 0.26);
  push('燃氣', 'LNG', [
    ['大潭CC#1-9', 6400], ['興達新CC#1-3', 3900], ['通霄CC#1-6', 2700],
    ['南部CC#1-4', 1100], ['台中新CC#1-2', 2600], ['大林#5-6', 1000]
  ], gas * 0.84);
  push('民營電廠-燃氣', 'IPP-LNG', [['國光', 480], ['新桃', 600], ['星彰', 490], ['嘉惠', 670]], gas * 0.16);
  push('汽電共生', 'Co-Gen', [['汽電共生', 4000]], cogen);
  push('水力', 'Hydro', [['明潭#1-6', 1620], ['大觀二#1-4', 1000], ['德基', 234], ['青山', 360], ['其他小水力', 600]], hydro);
  push('風力', 'Wind', [
    ['台電離岸一期', 110], ['海能', 376], ['沃旭大彰化東南', 900], ['中能', 300],
    ['海洋竹南', 128], ['允能雲林', 640], ['陸域風力', 1100]
  ], wind);
  push('太陽能', 'Solar', [['太陽能購電', 13000], ['台電自有', 600]], solar);
  push('其它再生能源', 'Other Renewable', [['生質/地熱', 800]], other);

  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${tw.getUTCFullYear()}-${pad(tw.getUTCMonth() + 1)}-${pad(tw.getUTCDate())} ${pad(tw.getUTCHours())}:${pad(Math.floor(tw.getUTCMinutes() / 10) * 10)}`;

  return { '': stamp, aaData: rows };
}
