import { Panel } from './Panels.jsx';
import { fmtMw, rgb } from './widgets.jsx';
import { PLANTS, SOLAR_COUNTY_KW } from '../config/geo.js';
import { FUELS } from '../config/energy.js';
import { nearestWind } from '../data/useAir.js';
import { solarSun } from '../data/parseGenary.js';
import { windText } from './Life.jsx';
import { useT } from '../i18n.js';

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
export function PlantPanel({ id, snapshot, air, onClose }) {
  const t = useT();
  const cfg = PLANTS.find((p) => p.id === id);
  if (!cfg) return null;
  const s = snapshot?.plants?.find((p) => p.id === id);
  const mw = s?.mw || 0;
  const units = (snapshot?.units || []).filter((u) => u.plantId === id && !u.load)
    .sort((a, b) => b.mw - a.mw || (b.capacity || 0) - (a.capacity || 0));
  const mix = Object.entries(s?.mix || {}).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
  const wind = cfg.offshore || s?.mix?.wind > 0 ? nearestWind(air?.stations || [], cfg.pos) : null;
  const pump = id === 'mingtan' ? snapshot?.charging?.pump : 0;
  const cems = air?.cems?.[id];

  return (
    <Panel title={cfg.name} onClose={onClose}>
      <div className="plant-head">
        <div><b>{fmtMw(mw)}</b> <small>MW</small></div>
        <span className="muted">{cfg.en}</span>
      </div>

      {mix.length > 0 && (
        <div className="plant-mix">
          {mix.map(([f, v]) => (
            <span key={f} style={{ flexGrow: v, background: rgb(FUELS[f]?.color || [200, 200, 200]) }} title={FUELS[f]?.label} />
          ))}
        </div>
      )}
      {mix.length > 0 && (
        <p className="fine">{mix.map(([f, v]) => `${t(FUELS[f]?.label || f)} ${fmtMw(v)} MW`).join(' · ')}</p>
      )}

      {pump > 1 && (
        <p className="plant-note cool">⇢ {t('抽水儲能中')} {fmtMw(pump)} MW：{t('用電網多出來的電把水抽上山，晚上再放水發電。地圖上流進這裡的粒子就是這些電。')}</p>
      )}

      {cfg.offshore && (
        <div className="life-sec">
          <div className="hl-k">{t('附近風況')}</div>
          {wind ? (
            <p className="fine">
              {wind.site}{t('測站')}（{t('岸邊')}，{wind.d.toFixed(0)} km）：{windText(wind.dir)} <b>{wind.speed} m/s</b>
              {' · '}{wind.speed < 3 ? t('風太小，風機轉不太動') : wind.speed > 20 ? t('風太大，風機可能停機保護') : mw < 1 ? t('有風但沒發電：可能是檢修、測試或尚未商轉') : t('風況正常')}
            </p>
          ) : <p className="fine">{t('空品測站風速資料讀取中（需中繼站環境部金鑰）')}</p>}
          <p className="fine">{t('岸邊風速通常比外海小，僅供參考。')}</p>
        </div>
      )}

      <div className="life-sec">
        <div className="hl-k">{units.length ? `${t('台電即時機組')}（${units.length}）` : t('資料來源')}</div>
        {units.length ? (
          <ul className="units">
            {units.map((u) => {
              const pct = u.capacity > 0 ? Math.min(1.05, u.mw / u.capacity) : null;
              const tone = NOTE_TONE.find(([re]) => re.test(u.note))?.[1];
              return (
                <li key={u.unit}>
                  <span className="u-name">{u.unit}</span>
                  <span className="u-bar"><i style={{ width: `${(pct ?? 0) * 100}%`, background: rgb(FUELS[u.fuel]?.color || [200, 200, 200]) }} /></span>
                  <span className="u-mw">{fmtMw(Math.max(0, u.mw))}{u.capacity > 0 ? <small> / {fmtMw(u.capacity)}</small> : null}</span>
                  {u.note && u.note.trim() && <em className={`tag ${tone || ''}`}>{u.note}</em>}
                </li>
              );
            })}
          </ul>
        ) : cfg.solar ? (
          <p className="fine">
            {t('台電即時資料中約 86% 的太陽能是一整行「其它購電太陽能」，沒有位置；這裡依台電「各縣市太陽光電裝置容量」')}（{SOLAR_COUNTY_KW.version}）{t('分配')}
            {solarSun()?.[id] ? `，${t('並依氣象署即時日射量調整（目前係數')} ×${solarSun()[id].toFixed(2)}）` : '。'}
          </p>
        ) : s?.estimated ? (
          <p className="fine">{t('台電未即時公布這座離島電廠的出力，依典型負載、季節與時段推估。')}</p>
        ) : (
          <p className="fine">{t('台電以彙總列公布（例如陸域風力、小水力），依各節點比例分配。')}</p>
        )}
      </div>

      {cems && Object.keys(cems.items || {}).length > 0 && (
        <div className="life-sec">
          <div className="hl-k">{t('煙道即時監測（環境部 CEMS）')}</div>
          <p className="fine">
            {Object.entries(cems.items).map(([k, it]) => `${t(k)} ${Math.round(it.max * 10) / 10}${it.std ? ` / ${it.std}` : ''} ${it.unit || ''}`).join(' · ')}
          </p>
        </div>
      )}
      <p className="fine">{t('資料：台灣電力公司「今日電力資訊」各機組發電量，每 10 分鐘更新。')}</p>
    </Panel>
  );
}
