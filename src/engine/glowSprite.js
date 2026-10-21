/**
 * 產生一張柔和的放射狀光暈貼圖（白色，alpha 由中心向外指數衰減）。
 * 以 IconLayer 的 mask 模式使用 → 可用 getColor 任意染色，並以加法混合疊出光暈。
 */
export function createGlowSprite(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c; // 0..1
      // 核心亮 + 長尾霧氣：兩個高斯疊加，邊緣平滑歸零
      const core = Math.exp(-(d * d) / 0.012);
      const haze = Math.exp(-(d * d) / 0.12) * 0.55;
      const edge = Math.max(0, 1 - d) ** 1.5;
      const a = Math.min(1, (core + haze) * edge);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    atlas: canvas.toDataURL('image/png'),
    mapping: { glow: { x: 0, y: 0, width: size, height: size, mask: true } }
  };
}
