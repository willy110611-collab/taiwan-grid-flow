import { useEffect, useRef, useState } from 'react';
import { tx } from '../i18n.js';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GridFlowEngine } from '../engine/GridFlowEngine.js';

/**
 * 地圖畫布。只負責「掛載 / 卸載」引擎與把新快照交給它；
 * 每幀的動畫在引擎內部以 requestAnimationFrame 執行，不經過 React。
 */
export default function GridFlowMap({ snapshot, options, onReady }) {
  const container = useRef(null);
  const engine = useRef(null);
  const [noGl, setNoGl] = useState(false);

  useEffect(() => {
    // 地圖畫好就收起 index.html 的開機畫面（最多等 6 秒）
    const hide = () => {
      const el = document.getElementById('splash');
      if (!el || el.classList.contains('out')) return;
      // 樣式檔還沒套用完就再等一下，避免露出沒排版的畫面
      if (document.querySelector('link[rel="preload"][as="style"]')) { setTimeout(hide, 50); return; }
      el.classList.add('out');
      setTimeout(() => el.remove(), 600);
    };
    // 瀏覽器不支援或關閉了 WebGL（部分公司電腦、舊手機、關掉硬體加速）：地圖建不起來 → 收起開機畫面、顯示說明，數字與面板照常可用
    try {
      if (!hasWebGl()) throw new Error('no webgl');
      engine.current = new GridFlowEngine(container.current, options);
    } catch {
      engine.current = null;
      setNoGl(true);
      hide();
      return undefined;
    }
    onReady?.(engine.current);
    engine.current.onFirstDraw(hide);
    const safety = setTimeout(hide, 6000);
    if (import.meta.env.DEV) window.__gridEngine = engine.current; // 方便在 console 調參
    return () => {
      clearTimeout(safety);
      engine.current?.destroy();
      engine.current = null;
    };
    // options 只在第一次掛載時使用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (snapshot && engine.current) engine.current.setSnapshot(snapshot);
  }, [snapshot]);

  return (
    <div ref={container} className="map">
      {noGl && (
        <div className="map-fallback" role="alert">
          <b>{tx('這個瀏覽器無法畫出地圖', 'This browser can’t draw the map')}</b>
          <p>{tx('地圖需要 WebGL（3D 繪圖）。請開啟瀏覽器的「硬體加速」，或改用最新版 Chrome、Safari、Edge。上方的發電、用電數字和各個面板仍然可以使用。',
            'The map needs WebGL (3D graphics). Turn on hardware acceleration in your browser, or use a recent Chrome, Safari or Edge. The figures above and all panels still work.')}</p>
        </div>
      )}
    </div>
  );
}

function hasWebGl() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}
