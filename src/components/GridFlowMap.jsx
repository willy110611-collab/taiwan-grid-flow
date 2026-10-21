import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GridFlowEngine } from '../engine/GridFlowEngine.js';

/**
 * 地圖畫布。只負責「掛載 / 卸載」引擎與把新快照交給它；
 * 每幀的動畫在引擎內部以 requestAnimationFrame 執行，不經過 React。
 */
export default function GridFlowMap({ snapshot, options, onReady }) {
  const container = useRef(null);
  const engine = useRef(null);

  useEffect(() => {
    engine.current = new GridFlowEngine(container.current, options);
    onReady?.(engine.current);
    if (import.meta.env.DEV) window.__gridEngine = engine.current; // 方便在 console 調參
    return () => {
      engine.current?.destroy();
      engine.current = null;
    };
    // options 只在第一次掛載時使用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (snapshot && engine.current) engine.current.setSnapshot(snapshot);
  }, [snapshot]);

  return <div ref={container} className="map" />;
}
