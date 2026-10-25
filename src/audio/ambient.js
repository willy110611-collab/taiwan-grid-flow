/**
 * 背景音「電網的聲音」：瀏覽器即時合成（Web Audio），不用音樂檔、沒有版權問題
 * ─────────────────────────────────────────────────────────────
 *  ・和弦墊底（A 大調，幾個稍微走音的弦波疊在一起）→ 經過低通濾波
 *      綠能比例越高，濾波越開 → 音色越亮
 *  ・很輕的 60 Hz／120 Hz 嗡聲（台灣電網的頻率）
 *  ・音量緩慢起伏：備轉容量率越低（供電越吃緊），起伏越快
 *  ・預設關閉；iPhone 規定要使用者點過畫面才能出聲，所以只在按下開關後啟動
 *  ・App 切到背景時暫停，回到前景再繼續（省電）
 */
const KEY = 'tgf-sound';
const VOLUME = 0.16;

let ctx = null;
let nodes = null;
let state = { green: 0.15, reserve: 12 };

export const soundPref = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const savePref = (on) => { try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch { /* 只在本次有效 */ } };
export const soundSupported = () => typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);

function build() {
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // 和弦墊底：A2、E3、A3、C#4（每個音兩個稍微走音的振盪器 → 柔和的合唱感）
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  const swell = ctx.createGain(); // 音量起伏
  swell.gain.value = 0.75;
  filter.connect(swell).connect(master);
  const oscs = [];
  for (const [f, g] of [[110, 0.32], [164.81, 0.22], [220, 0.18], [277.18, 0.12]]) {
    for (const det of [-6, 5]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = g / 2;
      o.connect(og).connect(filter);
      o.start();
      oscs.push(o);
    }
  }

  // 起伏：慢速 LFO 調整 swell 的音量
  const lfo = ctx.createOscillator();
  const lfoDepth = ctx.createGain();
  lfo.frequency.value = 0.08;
  lfoDepth.gain.value = 0.22;
  lfo.connect(lfoDepth).connect(swell.gain);
  lfo.start();

  // 電網嗡聲：60 Hz 與 120 Hz，音量很小
  const hum = ctx.createGain();
  hum.gain.value = 0.05;
  hum.connect(master);
  for (const [f, g] of [[60, 0.6], [120, 0.4]]) {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const og = ctx.createGain();
    og.gain.value = g;
    o.connect(og).connect(hum);
    o.start();
    oscs.push(o);
  }

  nodes = { master, filter, lfo, oscs };
  apply(0.1);
}

/** 依目前電網狀態調整音色與節奏（timeConst 秒內平滑過去） */
function apply(timeConst = 3) {
  if (!ctx || !nodes) return;
  const now = ctx.currentTime;
  const g = Math.max(0, Math.min(0.6, state.green));
  nodes.filter.frequency.setTargetAtTime(350 + (g / 0.6) * 2600, now, timeConst);
  // 備轉 15% 以上 → 很慢（約 12 秒一次）；6% 以下 → 約 2 秒一次
  const r = Math.max(6, Math.min(15, state.reserve));
  const rate = 0.08 + ((15 - r) / 9) * 0.42;
  nodes.lfo.frequency.setTargetAtTime(rate, now, timeConst);
}

export function setGridMood({ green, reserve } = {}) {
  if (Number.isFinite(green)) state.green = green;
  if (Number.isFinite(reserve)) state.reserve = reserve;
  apply();
}

let visBound = false;
function onVis() {
  if (!ctx) return;
  if (document.hidden) ctx.suspend().catch(() => {});
  else if (soundPref()) ctx.resume().catch(() => {});
}

/** 開啟（必須在使用者點擊的處理函式裡呼叫，iPhone 才會出聲） */
export function startSound() {
  if (!soundSupported()) return false;
  try {
    if (!ctx) build();
    ctx.resume().catch(() => {});
    nodes.master.gain.cancelScheduledValues(ctx.currentTime);
    nodes.master.gain.setTargetAtTime(VOLUME, ctx.currentTime, 0.8); // 約 2 秒淡入
    savePref(true);
    if (!visBound) { document.addEventListener('visibilitychange', onVis); visBound = true; }
    return true;
  } catch { return false; }
}

export function stopSound() {
  savePref(false);
  if (!ctx || !nodes) return;
  nodes.master.gain.cancelScheduledValues(ctx.currentTime);
  nodes.master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
  setTimeout(() => { if (!soundPref()) ctx?.suspend().catch(() => {}); }, 1500);
}
