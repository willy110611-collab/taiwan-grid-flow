import { Panel } from './Panels.jsx';
import { fmtMw } from './widgets.jsx';
import { PLANTS } from '../config/geo.js';
import { NUCLEAR, NUCLEAR_IDS, NUCLEAR_SOURCES, NUCLEAR_VERIFIED } from '../config/nuclear.js';
import { useT, isEn, tx } from '../i18n.js';

const year = (d) => d.slice(0, 4);

/**
 * 「核能」分類面板：台電即時核能出力＋三座核電廠現況（停機年份、再運轉進度），點一列打開該廠電廠卡
 */
export function NuclearPanel({ snapshot, onPlant, onClose }) {
  useT();
  const live = (snapshot?.plants || []).reduce((a, p) => a + (p.mix?.nuclear || 0), 0);
  return (
    <Panel title="核能" onClose={onClose}>
      <div className="plant-head">
        <div><b>{fmtMw(live)}</b> <small>MW</small></div>
        <span className="muted">{tx('台電即時', 'Taipower live')}</span>
      </div>
      <p className="fine">
        {live > 1
          ? tx('台電即時資料中有核能機組發電。', 'Taipower’s live data shows nuclear units generating.')
          : tx('目前沒有核電機組運轉（2025 年 5 月 17 日核三 2 號機停機後）。', 'No nuclear units are running (since Maanshan unit 2 shut down on 17 May 2025).')}
      </p>
      <ul className="nuke-list">
        {NUCLEAR_IDS.map((id) => {
          const n = NUCLEAR[id];
          const cfg = PLANTS.find((p) => p.id === id);
          return (
            <li key={id}>
              <button onClick={() => onPlant(id)}>
                <span className="nk-main">
                  <b>{isEn() ? cfg.en : cfg.name}</b>
                  <small>
                    {isEn() ? n.placeEn : n.place}・{tx('2 部機組', '2 units')}・
                    {tx(`執照屆期 ${n.licenseEnd.map(year).join('、')} 年`, `licences expired ${n.licenseEnd.map(year).join(' & ')}`)}
                  </small>
                </span>
                <em className="tag">{isEn() ? n.statusEn : n.status}</em>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="fine">
        {tx('核二、核三廠內的「Gas1／Gas2」是燃油氣渦輪備用機組，台電歸在「燃料油」，不算核能。',
          'The “Gas1/Gas2” units at Kuosheng and Maanshan are oil-fired gas-turbine backups; Taipower lists them under fuel oil, not nuclear.')}
      </p>
      <p className="fine">
        {tx('資料：', 'Sources: ')}{tx('台電「今日電力資訊」（即時出力）', 'Taipower live generation')}
        {NUCLEAR_SOURCES.map((s) => <span key={s.url}>{'；'}<a href={s.url} target="_blank" rel="noreferrer">{isEn() ? s.en : s.label}</a></span>)}
        {tx(`（狀態整理於 ${NUCLEAR_VERIFIED}）`, ` (status as of ${NUCLEAR_VERIFIED})`)}
      </p>
    </Panel>
  );
}

/** 電廠卡裡的核電廠現況段落 */
export function NuclearStatus({ id }) {
  useT();
  const n = NUCLEAR[id];
  if (!n) return null;
  return (
    <div className="life-sec">
      <div className="hl-k">{tx('核能機組現況', 'Nuclear units')}</div>
      <p className="fine">
        <em className="tag">{isEn() ? n.statusEn : n.status}</em>{' '}
        {tx(`1 號機運轉執照 ${n.licenseEnd[0]} 屆期、2 號機 ${n.licenseEnd[1]} 屆期。`, `Unit 1 licence expired ${n.licenseEnd[0]}, unit 2 ${n.licenseEnd[1]}. `)}
        {isEn() ? n.noteEn : n.note}
      </p>
      <p className="fine">
        {!n.noGas && <>{tx('下方「Gas」機組是廠內燃油氣渦輪備用機組，台電歸在燃料油。', 'The “Gas” units below are on-site oil-fired gas-turbine backups, listed by Taipower under fuel oil.')}{' '}</>}
        <a href={NUCLEAR_SOURCES[0].url} target="_blank" rel="noreferrer">{isEn() ? NUCLEAR_SOURCES[0].en : NUCLEAR_SOURCES[0].label}</a>
      </p>
    </div>
  );
}
