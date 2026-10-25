import { useMemo, useState } from 'react';
import { Panel } from './Panels.jsx';
import { Icon, fmtMw, rgb } from './widgets.jsx';
import { PLANTS, plantName } from '../config/geo.js';
import { FUELS } from '../config/energy.js';
import { t, tx, tr, useT } from '../i18n.js';
import { shareLink, viewLink } from '../share.js';

/**
 * 電廠（E1 搜尋 ＋ E3 今日異常機組 ＋ E4 分享畫面）
 *  ・搜尋電廠名稱、英文名、機組名稱（例如「台中」「大潭CC#3」「Formosa」）→ 飛過去並打開電廠卡
 *  ・今天台電備註為歲修／故障／降載／測試的機組，依電廠分組
 */
const KINDS = [
  { key: 'down', re: /歲修|檢修|大修/, zh: '歲修／檢修', en: 'Maintenance', tone: 'warm' },
  { key: 'fault', re: /故障|跳機|停機|通訊異常|機組異常/, zh: '故障／停機', en: 'Fault / shutdown', tone: 'warm' },
  { key: 'derate', re: /降載|減排|配合|環保|空污|燃料|水源|乾旱/, zh: '降載／減排', en: 'Derated', tone: 'gold' },
  { key: 'test', re: /測試|試運轉|試車/, zh: '測試', en: 'Testing', tone: 'cool' }
];
export const noteKind = (note) => KINDS.find((k) => k.re.test(note || ''));
const norm = (s) => String(s || '').toLowerCase().replace(/臺/g, '台').replace(/\s+/g, '');

export function FinderPanel({ snapshot, onOpen, getView, onClose }) {
  useT();
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const plantsById = useMemo(() => Object.fromEntries((snapshot?.plants || []).map((p) => [p.id, p])), [snapshot]);
  const units = (snapshot?.units || []).filter((u) => !u.load);

  const results = useMemo(() => {
    const k = norm(q);
    if (!k) return [];
    const hit = new Map();
    for (const p of PLANTS) {
      if ([p.name, p.en, p.id].some((x) => norm(x).includes(k))) hit.set(p.id, { id: p.id, why: '' });
    }
    for (const u of units) {
      if (u.plantId && norm(u.unit).includes(k) && !hit.has(u.plantId)) hit.set(u.plantId, { id: u.plantId, why: u.unit });
    }
    return [...hit.values()].slice(0, 12);
  }, [q, units]); // eslint-disable-line react-hooks/exhaustive-deps

  const issues = useMemo(() => {
    const by = new Map();
    for (const u of units) {
      const kind = noteKind(u.note);
      if (!kind) continue;
      const key = u.plantId || `x:${u.sub || u.fuel}`;
      const g = by.get(key) || { id: u.plantId, name: plantName(PLANTS.find((p) => p.id === u.plantId)) || tr(u.sub || u.unit), list: [], cap: 0 };
      g.list.push({ ...u, kind });
      g.cap += u.capacity || 0;
      by.set(key, g);
    }
    return [...by.values()].sort((a, b) => b.cap - a.cap);
  }, [units]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = KINDS.map((k) => ({ ...k, n: issues.reduce((a, g) => a + g.list.filter((u) => u.kind.key === k.key).length, 0), cap: issues.reduce((a, g) => a + g.list.filter((u) => u.kind.key === k.key).reduce((b, u) => b + (u.capacity || 0), 0), 0) })).filter((k) => k.n);

  const top = (snapshot?.plants || []).filter((p) => p.mw > 0).sort((a, b) => b.mw - a.mw).slice(0, 5);
  const name = (id) => plantName(PLANTS.find((p) => p.id === id)) || id;
  const share = async () => {
    const v = getView?.();
    if (!v) return;
    const r = await shareLink(viewLink(v), '台灣光脈動');
    setMsg(r === 'copied' ? tx('已複製目前畫面的連結', 'Link to this view copied') : r === 'shared' ? '' : r === 'failed' ? tx('無法分享，請手動複製網址', 'Could not share; copy the address manually') : '');
  };

  return (
    <Panel title="電廠" onClose={onClose}>
      <input
        className="loc-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={tx('搜尋電廠或機組，例如 台中、大潭、海洋竹南', 'Search, e.g. Taichung or 台中')}
        enterKeyHint="search"
      />
      {q.trim() && (
        results.length ? (
          <ul className="finder-list">
            {results.map((r) => (
              <li key={r.id}>
                <button onClick={() => onOpen(r.id)}>
                  <b>{name(r.id)}</b>
                  <small>{r.why || tx(PLANTS.find((p) => p.id === r.id)?.en, PLANTS.find((p) => p.id === r.id)?.name)}</small>
                  <span>{fmtMw(plantsById[r.id]?.mw || 0)} <small>MW</small></span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="fine">{tx(`找不到「${q}」`, `No match for “${q}”`)}</p>
      )}

      {!q.trim() && (
        <>
          <section className="life-sec">
            <div className="hl-k">{tx('今天沒在全力發電的機組', 'Units not at full output today')}　<span className="muted">{tx('台電備註', 'Taipower notes')}</span></div>
            {counts.length ? (
              <div className="issue-chips">
                {counts.map((k) => <span key={k.key} className={`tag ${k.tone}`}>{tx(k.zh, k.en)} {k.n}{tx(' 部', '')}{k.cap ? ` · ${fmtMw(k.cap)} MW` : ''}</span>)}
              </div>
            ) : <p className="fine">{snapshot ? tx('目前沒有歲修、故障或降載的機組。', 'No units under maintenance, faults or derating right now.') : t('資料讀取中…')}</p>}
            <ul className="finder-list issues">
              {issues.map((g) => (
                <li key={g.id || g.name}>
                  <button onClick={() => g.id && onOpen(g.id)} disabled={!g.id}>
                    <b>{g.name}</b>
                    <span className="issue-units">
                      {g.list.map((u) => (
                        <em key={u.unit} className={`note ${u.kind.tone}`}>
                          {tr(u.unit)} <small>{fmtMw(u.mw)}/{fmtMw(u.capacity || 0)} MW</small> {tr(u.note)}
                        </em>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="life-sec">
            <div className="hl-k">{tx('目前出力前五名', 'Top 5 plants now')}</div>
            <ul className="finder-list">
              {top.map((p) => {
                const f = Object.entries(p.mix || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
                return (
                  <li key={p.id}>
                    <button onClick={() => onOpen(p.id)}>
                      <i className="fuel-dot" style={{ background: rgb(FUELS[f]?.color || [200, 200, 200]) }} />
                      <b>{name(p.id)}</b>
                      <small>{t(FUELS[f]?.label || '')}</small>
                      <span>{fmtMw(p.mw)} <small>MW</small></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="store-btns">
            <button onClick={share}>{Icon.share}<span>{tx('分享目前畫面', 'Share this view')}</span></button>
          </div>
          {msg && <p className="fine green">{msg}</p>}
        </>
      )}
    </Panel>
  );
}
