import { useCallback, useMemo, useRef, useState } from 'react';
import GridFlowMap from './components/GridFlowMap.jsx';
import Hud from './components/Hud.jsx';
import { useGridData } from './data/useGridData.js';
import { useHighlights } from './data/useHighlights.js';

/**
 * 網址參數
 *  ?mode=wallpaper  桌布模式（Lively Wallpaper 用）：不可互動、自動放空巡航、30fps
 *  ?sim=1           強制模擬資料
 *  ?density=2       粒子密度倍率
 *  ?fps=60          強制幀率
 */
const params = new URLSearchParams(location.search);
const WALLPAPER = params.get('mode') === 'wallpaper';
const MOBILE = matchMedia('(pointer: coarse)').matches || innerWidth < 700;
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DENSITY = Number(params.get('density')) || (REDUCE ? 0.4 : MOBILE ? 0.8 : 1);
// 省電：手機與桌布預設 30fps（仿軌島手機預設省電模式）
const FPS = Number(params.get('fps')) || (WALLPAPER || MOBILE ? 30 : 60);

export default function App() {
  const snapshot = useGridData();
  const engine = useRef(null);
  const [stats, setStats] = useState(null);
  const [daylight, setDaylight] = useState(null);
  const [ui, setUiState] = useState({ filter: 'all', panel: null, cruise: WALLPAPER, shot: null });
  const highlights = useHighlights(snapshot, stats);

  const options = useMemo(() => ({
    density: DENSITY,
    fps: FPS,
    mode: WALLPAPER ? 'wallpaper' : 'app',
    onStats: setStats,
    onDaylight: setDaylight,
    onShot: (shot) => setUiState((s) => ({ ...s, shot, cruise: shot ? true : WALLPAPER ? s.cruise : false }))
  }), []);

  const setUi = useCallback((patch) => {
    if (patch.toggleCruise) {
      const on = engine.current?.toggleCruise();
      setUiState((s) => ({ ...s, cruise: !!on, panel: on && MOBILE ? null : s.panel }));
      return;
    }
    if (patch.filter) engine.current?.setFilter(patch.filter);
    setUiState((s) => ({ ...s, ...patch }));
  }, []);

  return (
    <main className={`app ${WALLPAPER ? 'wallpaper' : ''}`} style={daylight ? { '--sky': daylight.sky } : undefined}>
      <GridFlowMap snapshot={snapshot} options={options} onReady={(e) => (engine.current = e)} />
      <div className="sky" style={{ opacity: daylight ? 0.25 + daylight.day * 0.35 + daylight.twilight * 0.4 : 0.3 }} />
      <div className="vignette" />
      <Hud snapshot={snapshot} ui={ui} setUi={setUi} highlights={highlights} daylight={daylight} wallpaper={WALLPAPER} />
    </main>
  );
}
