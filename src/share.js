/**
 * 分享連結（E4）
 *  ?plant=<電廠 id>         打開就飛到這座電廠並打開電廠卡
 *  ?view=經度,緯度,縮放,傾斜,角度  打開就是這個畫面
 * 手機用系統分享選單（LINE、訊息…），電腦複製到剪貼簿。
 */
const BASE = () => `${location.origin}${location.pathname}`;

export const plantLink = (id) => `${BASE()}?plant=${encodeURIComponent(id)}`;
export function viewLink(v) {
  const r = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
  return `${BASE()}?view=${[r(v.center[0], 4), r(v.center[1], 4), r(v.zoom, 2), Math.round(v.pitch), Math.round(v.bearing)].join(',')}`;
}

/** 回傳 'shared' | 'copied' | 'failed' */
export async function shareLink(url, title) {
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title, url });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    try {
      const ta = Object.assign(document.createElement('textarea'), { value: url });
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      return 'copied';
    } catch { return 'failed'; }
  }
}
