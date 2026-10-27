import { Panel } from './Panels.jsx';
import { useState } from 'react';
import { fmtMw, rgb, Icon } from './widgets.jsx';
import { PLANTS, SOLAR_COUNTY_KW, plantName, unitName } from '../config/geo.js';
import { FUELS } from '../config/energy.js';
import { nearestWind } from '../data/useAir.js';
import { solarSun } from '../data/parseGenary.js';
import { windText } from './Life.jsx';
import { useT, isEn, tx, tr } from '../i18n.js';
import { rowHM } from '../data/history.js';
import { PlantHistory } from './PlantHistory.jsx';
import { shareLink, plantLink } from '../share.js';
import { NuclearStatus } from './Nuclear.jsx';
import { NUCLEAR } from '../config/nuclear.js';

/** 機組備註 → 標籤顏色 */
const NOTE_TONE = [
  [/歲修|檢修|故障|停機|通訊異常/, 'warm'],
  [/降載|減排|配合/, 'gold'],
  [/測試|試運轉/, 'cool']
];

/**
 * 電廠詳細卡（點地圖上的電廠光球）
 *  ・台電公布的每部機組：出力／裝置容量／狀態備註（歲修、環保停機、友善降載…）
 *  ・離岸風場：最近岸邊測站的風速，解釋為什麼 0 MW
 *  ・抽蓄水力：抽水（儲能）中的電量
 *  ・沒有逐機組資料的節點（各縣市太陽能群等）：說明分配方式
 */
export function PlantPanel({ id, snapshot, air, rows, onClose }) {
  const t = useT();
  const [msg, setMsg] = useState('');
  const cfg = PLANTS.find((p) => p.id === id);
  if (!cfg) return null;
  // E2：今天 00:00 到現在的出力（回放用的歷史紀錄；打開 App 之前的時段依燃料曲線推估）
  // hm 用台電資料時間（timestamp），不是抓取時間
  const series = (rows || []).map((r) => ({ t: r.t, hm: rowHM(r), mw: r.plants?.find((p) => p.id === id)?.mw ?? 0, est: !!r.reconstructed }));
  const peak = series.reduce((a, x) => (x.mw > (a?.mw ?? -1) ? x : a), null);
  const low = series.reduce((a, x) => (x.mw < (a?.mw ?? Infinity) ? x : a), null);
  const share = async () => {
    const r = await shareLink(plantLink(id), `${cfg.name}｜台灣脈動`);
    setMsg(r === 'copied' ? tx('已複製連結', 'Link copied') : r === 'failed' ? tx('無法分享，請手動複製網址', 'Could not share; copy the address manually') : '');
  };
  const s = snapshot?.plants?.find((p) => p.id === id);
  const mw = s?.mw || 0;
  const units = (snapshot?.units || []).filter((u) => u.plantId === id && !u.load)
    .sort((a, b) => b.mw - a.mw || (b.capacity || 0) - (a.capacity || 0));
  const mix = Object.entries(s?.mix || {}).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
  const wind = cfg.offshore || s?.mix?.wind > 0 ? nearestWind(air?.stations || [], cfg.pos) : null;
  const pump = id === 'mingtan' ? snapshot?.charging?.pump : 0;
  const cems = air?.cems?.[id];
  // 裝置容量與目前利用率：只在出力幾乎都來自自己的機組時顯示（太陽能群等依比例分攤的節點不算）
  //  容量欄是「-」的機組（例如部分光電、停用機組）不算，出力也只算有容量的機組；抽水中（明潭）不顯示
  const capUnits = units.filter((u) => u.capacity > 0);
  const cap = capUnits.reduce((a, u) => a + u.capacity, 0);
  const capMw = capUnits.reduce((a, u) => a + Math.max(0, u.mw || 0), 0);
  const showCap = cap > 0 && s && !s.estimated && !(pump > 1) && (s.allocatedMw || 0) <= mw * 0.05 + 1;
  const capPct = Math.min(100, Math.round((capMw / (cap || 1)) * 100));

  return (
    <Panel title={plantName(cfg)} onClose={onClose}>
      {/* 電廠卡上半：運轉率圓環＋目前出力、燃料組成、今日出力曲線、即時機組（v0.8.65 新版） */}
      <div className={`plant-hero ${showCap ? '' : 'no-ring'}`}>
        {showCap && <CapRing pct={capPct} color={rgb(FUELS[mix[0]?.[0]]?.color || [110, 240, 190])} />}
        <div className="ph-main">
          {mix.length > 0 && (
            <div className="ph-chips">
              {mix.slice(0, 3).map(([f]) => <span key={f} className="ph-chip" style={{ '--c': rgb(FUELS[f]?.color || [200, 200, 200]) }}>{t(FUELS[f]?.label || f)}</span>)}
            </div>
          )}
          <div className="ph-mw" style={{ color: rgb(FUELS[mix[0]?.[0]]?.color || [232, 238, 252]) }}>{fmtMw(mw)}<small>MW</small></div>
          <div className="ph-sub">{showCap ? `${tx('裝置容量', 'Capacity')} ${fmtMw(cap)} MW · ` : ''}{isEn() ? cfg.name : cfg.en}</div>
        </div>
      </div>
      {cfg.op && !isEn() && <p className="fine plant-op">經營：{cfg.op}（OpenStreetMap）</p>}{/* OSM 只有中文公司名 → 英文介面不顯示，不自行翻譯 */}

      {mix.length > 0 && (
        <>
          <div className="plant-mix">
            {mix.map(([f, v]) => (
              <span key={f} style={{ flexGrow: v, background: rgb(FUELS[f]?.color || [200, 200, 200]) }} title={t(FUELS[f]?.label || f)} />
            ))}
          </div>
          <div className="ph-legend">
            {mix.map(([f, v]) => <span key={f}><i style={{ background: rgb(FUELS[f]?.color || [200, 200, 200]) }} />{t(FUELS[f]?.label || f)} <b>{fmtMw(v)}</b> MW</span>)}
          </div>
        </>
      )}

      {series.length >= 3 && peak?.mw > 0 && (
        <div className="plant-spark">
          <div className="hl-k ph-k">{tx('今日出力', 'Output today')}<span>{series[0].hm} → {series[series.length - 1].hm}</span></div>
          <TodayChart series={series} peak={peak} low={low} color={rgb(FUELS[mix[0]?.[0]]?.color || [110, 240, 190])} />
          <div className="ph-ann">
            <span><i className="hi" />{tx('最高', 'High')} <b>{fmtMw(peak.mw)}</b> MW {peak.hm}</span>
            <span><i className="lo" />{tx('最低', 'Low')} {fmtMw(low.mw)} MW {low.hm}</span>
          </div>
          {series.some((x) => x.est) && <p className="fine">{tx('＊打開 App 前的時段依燃料曲線推估', '* hours before you opened the app are estimated from fuel curves')}</p>}
        </div>
      )}

      <div className="life-sec">
        <div className="hl-k">{units.length ? `${t('台電即時機組')}${tx(`（${units.length}）`, ` (${units.length})`)}` : t('資料來源')}</div>
        {units.length ? (
          <ul className="units">
            {units.map((u) => {
              const pct = u.capacity > 0 ? Math.min(1.05, u.mw / u.capacity) : null;
              const tone = NOTE_TONE.find(([re]) => re.test(u.note))?.[1];
              return (
                <li key={u.unit}>
                  <span className="u-name">{unitName(u.unit, cfg)}</span>
                  <span className="u-bar"><i style={{ width: `${(pct ?? 0) * 100}%`, background: rgb(FUELS[u.fuel]?.color || [200, 200, 200]) }} /></span>
                  <span className="u-mw">{fmtMw(Math.max(0, u.mw))}{u.capacity > 0 ? <small> / {fmtMw(u.capacity)}</small> : null}</span>
                  {u.note && u.note.trim() && <em className={`tag ${tone || ''}`}>{tr(u.note)}</em>}
                </li>
              );
            })}
          </ul>
        ) : NUCLEAR[id] ? (
          <p className="fine">{tx('台電即時資料中目前沒有這座電廠的機組。', 'Taipower’s live data currently lists no units for this plant.')}</p>
        ) : cfg.solar ? (
          <p className="fine">
            {t('台電即時資料中約 86% 的太陽能是一整行「其它購電太陽能」，沒有位置；這裡依台電「各縣市太陽光電裝置容量」')}（{SOLAR_COUNTY_KW.version}）{t('分配')}
            {solarSun()?.[id] ? (isEn() ? `, adjusted by CWA live solar radiation (factor ×${solarSun()[id].toFixed(2)}).` : `，並依氣象署即時日射量調整（目前係數 ×${solarSun()[id].toFixed(2)}）`) : (isEn() ? '.' : '。')}
          </p>
        ) : s?.estimated ? (
          <p className="fine">{t('台電未即時公布這座離島電廠的出力，依典型負載、季節與時段推估。')}</p>
        ) : (
          <p className="fine">{t('台電以彙總列公布（例如陸域風力、小水力），依各節點比例分配。')}</p>
        )}
      </div>

      {pump > 1 && (
        <p className="plant-note cool">⇢ {t('抽水儲能中')} {fmtMw(pump)} MW：{t('用電網多出來的電把水抽上山，晚上再放水發電。地圖上流進這裡的粒子就是這些電。')}</p>
      )}

      {cfg.offshore && (
        <div className="life-sec">
          <div className="hl-k">{t('附近風況')}</div>
          {wind ? (
            <p className="fine">
              {wind.site}{t('測站')}{tx(`（岸邊，${wind.d.toFixed(0)} km）：`, ` (coast, ${wind.d.toFixed(0)} km): `)}{windText(wind.dir)} <b>{wind.speed} m/s</b>
              {' · '}{wind.speed < 3 ? t('風太小，風機轉不太動') : wind.speed > 20 ? t('風太大，風機可能停機保護') : mw < 1 ? t('有風但沒發電：可能是檢修、測試或尚未商轉') : t('風況正常')}
            </p>
          ) : <p className="fine">{t('附近測站的風速資料讀取中')}</p>}
          <p className="fine">{t('岸邊風速通常比外海小，僅供參考。')}</p>
        </div>
      )}

      <NuclearStatus id={id} />

      <PlantHistory id={id} fuel={cfg.fuel || mix[0]?.[0]} />

      {cems && Object.keys(cems.items || {}).length > 0 && (
        <div className="life-sec">
          <div className="hl-k">{t('煙道即時監測（環境部 CEMS）')}{cems.time ? <span className="muted">　{tx(`${cems.time.slice(11, 16)} 量測`, `measured ${cems.time.slice(11, 16)}`)}</span> : null}</div>
          <p className="fine">
            {Object.entries(cems.items).map(([k, it]) => `${t(k)} ${Math.round(it.max * 10) / 10}${it.std ? ` / ${it.std}` : ''} ${it.unit || ''}`).join(' · ')}
          </p>
        </div>
      )}
      <p className="fine">{t('資料：台灣電力公司「今日電力資訊」各機組發電量，每 10 分鐘更新。')}</p>
      <div className="store-btns">
        <button onClick={share}>{Icon.share}<span>{tx('分享這座電廠', 'Share this plant')}</span></button>
      </div>
      {msg && <p className="fine green">{msg}</p>}
    </Panel>
  );
}

/** 運轉率圓環（目前出力 ÷ 裝置容量） */
function CapRing({ pct, color }) {
  const r = 40, c = 2 * Math.PI * r;
  return (
    <div className="cap-ring" role="img" aria-label={tx(`目前運轉 ${pct}%`, `Running at ${pct}%`)}>
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
        <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 48 48)" style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
      </svg>
      <b>{pct}%<small>{tx('運轉率', 'running')}</small></b>
    </div>
  );
}

/** 今日出力：面積圖，標出最高（金）與最低（灰） */
function TodayChart({ series, peak, low, color }) {
  const W = 320, H = 64, n = series.length;
  const max = Math.max(1, peak.mw), min = Math.min(0, low.mw);
  const X = (i) => (i / Math.max(1, n - 1)) * W, Y = (v) => H - 6 - ((v - min) / (max - min || 1)) * (H - 14);
  const d = series.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.mw).toFixed(1)}`).join('');
  const ip = series.indexOf(peak), il = series.indexOf(low);
  // 圓點用 HTML 疊在圖上（SVG 用 preserveAspectRatio="none" 拉滿寬度，圓會被壓扁）
  const dot = (i, v) => ({ left: `${(X(i) / W) * 100}%`, top: `${(Y(v) / H) * 100}%` });
  return (
    <div className="ph-today">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="ph-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.32" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <path d={`${d}L${W} ${H}L0 ${H}Z`} fill="url(#ph-fill)" />
        <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <i className="hi" style={dot(ip, peak.mw)} />
      <i className="lo" style={dot(il, low.mw)} />
    </div>
  );
}
