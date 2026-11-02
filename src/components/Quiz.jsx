import { useEffect, useMemo, useState } from 'react';
import { Panel } from './Panels.jsx';
import { QUIZ_BANK, SOURCES } from '../config/quizBank.js';
import { FILTERS } from '../config/energy.js';
import {
  MAP_QUESTIONS, questionsOf, weekOf, seasonOf, seasonWeeks, seasonLabel, prevSeason, weekRange, useQuiz, answerOf,
  openQuestion, optionsOf, submitAnswer, fetchBoard, setName, forgetMe, seasonStats, markSeen, fmtTime
} from '../data/quiz.js';
import { isEn, tx, useT } from '../i18n.js';

/**
 * 每週知識題（更多 → 知識題）
 *  畫面：題目清單（本週＋本季前幾週可補答）→ 作答（答對綠色、答錯紅色並標出正確答案、附出處）→ 排行榜（本季／上一季）
 *  看地圖題可以「先去地圖找」：面板收起、下方出現提示列，按「回去作答」回到這題（時間繼續算）
 */
let lastView = { v: 'list' }; // 關掉面板再打開時回到原本的畫面（例如去地圖找答案再回來）
const PANEL_LABEL = { home: ['我的家', 'Home'], appliance: ['家電', 'Appliances'], highlights: ['亮點', 'Peaks'] };
const live = (snap) => snap?.source === 'live' || /[?&]sim\b/.test(globalThis.location?.search || '');

export function QuizPanel({ snapshot, setUi, onClose }) {
  useT();
  const s = useQuiz();
  const [view, setViewState] = useState(lastView);
  const setView = (v) => { lastView = v; setViewState(v); };
  useEffect(() => { markSeen(); }, []);
  const cur = weekOf();
  const weeks = useMemo(() => seasonWeeks(cur), [cur]);
  const st = seasonStats(s, weeks);
  const season = seasonOf(cur);

  const title = view.v === 'board' ? tx('排行榜', 'Leaderboard') : tx('知識題', 'Quiz');
  const meta = view.v === 'board' ? seasonLabel(view.season || season) : view.v === 'q' ? `${weekLabel(view.week, cur)}` : seasonLabel(season);
  return (
    <Panel title={title} meta={meta} onClose={onClose}>
      {view.v === 'list' && <QuizList s={s} weeks={weeks} cur={cur} st={st} onOpen={(week, item) => setView({ v: 'q', week, qid: item.qid })} onBoard={() => setView({ v: 'board', season })} />}
      {view.v === 'q' && <Question key={view.week + view.qid} s={s} week={view.week} item={questionsOf(view.week).find((x) => x.qid === view.qid)} snapshot={snapshot} setUi={setUi}
        onNext={(next) => setView(next ? { v: 'q', week: next.week, qid: next.qid } : { v: 'list' })} onBack={() => setView({ v: 'list' })} weeks={weeks} />}
      {view.v === 'board' && <Board season={view.season || season} cur={season} st={st} s={s} onSeason={(x) => setView({ v: 'board', season: x })} onBack={() => setView({ v: 'list' })} />}
    </Panel>
  );
}

const weekLabel = (w, cur) => (w === cur ? tx('本週', 'This week') : tx(`${weekRange(w)} 那週`, `Week of ${weekRange(w)}`));
const qText = (item) => (item.kind === 'k' ? (isEn() ? QUIZ_BANK.find((q) => q.id === item.id)?.qEn : QUIZ_BANK.find((q) => q.id === item.id)?.q) : MAP_QUESTIONS[item.id].q());

function QuizList({ s, weeks, cur, st, onOpen, onBoard }) {
  const [showOld, setShowOld] = useState(false);
  const list = questionsOf(cur);
  const done = list.filter((it) => answerOf(s, cur, it.qid));
  const older = weeks.filter((w) => w !== cur);
  const missed = older.reduce((a, w) => a + questionsOf(w).filter((it) => !answerOf(s, w, it.qid)).length, 0);
  const next = [cur, ...older].flatMap((w) => questionsOf(w).filter((it) => !answerOf(s, w, it.qid)).map((it) => [w, it]))[0];
  return (
    <>
      <div className="qz-head">
        <div><div className="hl-k">{tx(`本週・${weekRange(cur)}`, `This week · ${weekRange(cur)}`)}</div><div className="big">{done.length}<small> / {list.length} {tx('題', '')}　{tx('答對', 'correct')} {done.filter((it) => answerOf(s, cur, it.qid).ok).length}</small></div></div>
        <div style={{ textAlign: 'right' }}><div className="hl-k" style={{ justifyContent: 'flex-end' }}>{tx('本季', 'Season')}</div><div className="big">{st.ok}<small> / {st.total} {tx('答對', 'correct')}</small></div></div>
      </div>
      <div className="qz-prog">{list.map((it) => { const a = answerOf(s, cur, it.qid); return <i key={it.qid} className={a ? (a.ok ? 'ok' : 'ng') : ''} />; })}</div>
      <QList s={s} week={cur} onOpen={onOpen} />
      {older.length > 0 && (
        <>
          <button className="qz-more" onClick={() => setShowOld(!showOld)} aria-expanded={showOld}>
            {missed ? tx(`本季前幾週還有 ${missed} 題可以補答`, `${missed} earlier question${missed > 1 ? 's' : ''} this season`) : tx('本季前幾週', 'Earlier this season')} {showOld ? '▴' : '▾'}
          </button>
          {showOld && older.slice().reverse().map((w) => (
            <div key={w}><div className="hl-k" style={{ marginTop: 10 }}>{weekRange(w)}</div><QList s={s} week={w} onOpen={onOpen} /></div>
          ))}
        </>
      )}
      <div className="qz-btns">
        {next && <button className="qz-btn" onClick={() => onOpen(next[0], next[1])}>{tx('繼續作答', 'Continue')}</button>}
        <button className="qz-btn dim" onClick={onBoard}>{tx('排行榜', 'Leaderboard')}</button>
      </div>
      <p className="fine" style={{ marginTop: 12 }}>{tx('每週一換 5 題，什麼時候答都可以；每兩個月一季，季內可以補答前幾週的題目。答對多的排前面，同分比作答時間。不會推播打擾你。', 'Five new questions every Monday — answer any time. Each season lasts two months and you can catch up on earlier weeks. Most correct ranks first; ties go to the faster total time. No notifications.')}</p>
    </>
  );
}

function QList({ s, week, onOpen }) {
  return (
    <ul className="qz-list">
      {questionsOf(week).map((it, i) => {
        const a = answerOf(s, week, it.qid);
        return (
          <li key={it.qid}>
            <button onClick={() => onOpen(week, it)}>
              <span className="n">{i + 1}</span>
              <span>{qText(it)}<span className={`qz-type ${it.kind === 'm' ? 'qzmap' : ''}`}>{it.kind === 'm' ? tx('看地圖', 'Map') : tx('知識', 'Fact')}</span></span>
              <span className={`st ${a ? (a.ok ? 'ok' : 'ng') : 'go'}`}>{a ? (a.ok ? tx('答對', 'Right') : tx('答錯', 'Wrong')) : tx('作答 ›', 'Answer ›')}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Question({ s, week, item, snapshot, setUi, onNext, onBack, weeks }) {
  const [busy, setBusy] = useState(false);
  const ready = item && (item.kind === 'k' || live(snapshot));
  useEffect(() => { if (ready) openQuestion(week, item, snapshot); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return <p className="fine">{tx('找不到這一題。', 'Question not found.')} <button className="linkish" onClick={onBack}>{tx('回到題目列表', 'Back')}</button></p>;
  const a = answerOf(s, week, item.qid);
  const idx = questionsOf(week).findIndex((x) => x.qid === item.qid) + 1;
  const k = item.kind === 'k' ? QUIZ_BANK.find((q) => q.id === item.id) : null;
  const m = item.kind === 'm' ? MAP_QUESTIONS[item.id] : null;
  const keys = k ? k.opts.map((_, i) => i) : optionsOf(s, week, item);
  const label = (key) => (k ? ((isEn() && k.optsEn) || k.opts)[key] : m.label(key));
  const pick = async (key) => {
    if (a || busy) return;
    if (m && !live(snapshot)) return;
    setBusy(true);
    await submitAnswer(week, item, key, snapshot);
    setBusy(false);
  };
  // 下一題：同一週還沒答的，再來是本季其他週
  const next = [week, ...weeks.filter((w) => w !== week).reverse()].flatMap((w) => questionsOf(w).filter((it) => !answerOf(s, w, it.qid) && !(w === week && it.qid === item.qid)).map((it) => ({ week: w, qid: it.qid })))[0];
  const more = (k || m)?.more;
  const goMore = () => {
    if (more?.filter) setUi({ filter: more.filter, panel: null, quizPeek: { week, qid: item.qid } });
    else if (more?.panel) setUi({ panel: more.panel });
  };
  const moreLabel = more?.filter ? tx(`地圖切到「${FILTERS.find((f) => f.id === more.filter)?.label}」`, `Map: ${({ all: 'All', green: 'Green', thermal: 'Thermal', nuclear: 'Nuclear', demand: 'Demand', air: 'Air' })[more.filter]}`) : more?.panel ? tx(`打開「${PANEL_LABEL[more.panel][0]}」`, `Open ${PANEL_LABEL[more.panel][1]}`) : null;
  return (
    <>
      <div className="hl-k">{tx(`第 ${idx} 題`, `Question ${idx}`)}・{item.kind === 'm' ? tx('看地圖', 'Map') : tx('知識', 'Fact')}{item.kind === 'm' && <span className="qz-new">{tx('答案依當下台電資料', 'Answer uses live Taipower data')}</span>}</div>
      <div className="qz-q">{qText(item)}</div>
      {!ready || !keys ? (
        <p className="fine warm">{tx('目前讀不到台電即時資料，這題等資料恢復再答。', 'Live Taipower data isn’t available right now — come back to this one later.')}</p>
      ) : (
        <div className="qz-opts" role="group" aria-label={tx('選項', 'Options')}>
          {keys.map((key, i) => {
            const isRight = a && key === a.correct, isMine = a && key === a.choice;
            const cls = a ? (isRight ? 'right' : isMine ? 'wrong' : 'dim') : '';
            return (
              <button key={String(key)} className={cls} onClick={() => pick(key)} disabled={!!a || busy} aria-pressed={isMine || undefined}>
                <b>{'ABCD'[i]}</b>{label(key)}
                {isRight && <span className="r ok">{tx('正確', 'Correct')}</span>}
                {isMine && !isRight && <span className="r ng">{tx('你的答案', 'Your answer')}</span>}
              </button>
            );
          })}
        </div>
      )}
      {!a && m && ready && keys && (
        <>
          <div className="qz-exp">{tx('提示：', 'Hint: ')}{m.hint()}</div>
          <div className="qz-btns"><button className="qz-btn green" onClick={() => setUi({ panel: null, quizPeek: { week, qid: item.qid }, ...(more?.filter ? { filter: more.filter } : {}) })}>{tx('先去地圖找 ›', 'Find it on the map ›')}</button></div>
        </>
      )}
      {a && (
        <div className="qz-exp">
          {k ? <p>{isEn() ? k.expEn : k.exp}</p> : <p>{tx('答案用你作答當下的台電資料判斷。', 'Checked against Taipower data at the moment you answered.')}</p>}
          {k && <p className="src">{tx('出處：', 'Source: ')}{k.src.map((id, i) => { const so = SOURCES[id]; return <span key={id}>{i ? '、' : ''}{so.url ? <a href={so.url} target="_blank" rel="noreferrer">{isEn() ? so.en : so.zh} ↗</a> : (isEn() ? so.en : so.zh)}</span>; })}</p>}
          {moreLabel && <p className="src"><button className="linkish" onClick={goMore}>{tx('想看更多：', 'See more: ')}{moreLabel} ›</button></p>}
          <p className="src muted">{tx('作答時間', 'Time')} {fmtTime(a.ms)}</p>
        </div>
      )}
      <div className="qz-btns">
        {a && next && <button className="qz-btn" onClick={() => onNext(next)}>{tx('下一題 ›', 'Next ›')}</button>}
        <button className="qz-btn dim" onClick={onBack}>{tx('題目列表', 'All questions')}</button>
      </div>
    </>
  );
}

function Board({ season, cur, st, s, onSeason, onBack }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setNameInput] = useState(s.name);
  const [confirm, setConfirm] = useState(false);
  const load = () => { setErr(false); fetchBoard(season).then(setData).catch(() => setErr(true)); };
  useEffect(load, [season]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = prevSeason(cur);
  const me = data?.me;
  const share = async () => {
    const text = me ? tx(`我在台灣脈動知識題排第 ${me.rank} 名（${seasonLabel(season)}，答對 ${me.ok} 題）`, `I’m #${me.rank} in the Taiwan Grid Flow quiz (${seasonLabel(season)}, ${me.ok} correct)`) : tx('來台灣脈動答知識題', 'Try the Taiwan Grid Flow quiz');
    const url = location.origin + location.pathname;
    try { if (navigator.share) await navigator.share({ text, url }); else await navigator.clipboard.writeText(`${text} ${url}`); } catch { /* 取消分享 */ }
  };
  return (
    <>
      <div className="qz-tabs" role="tablist">
        <button role="tab" aria-selected={season === cur} className={season === cur ? 'on' : ''} onClick={() => onSeason(cur)}>{tx('本季', 'This season')}</button>
        <button role="tab" aria-selected={season === prev} className={season === prev ? 'on' : ''} onClick={() => onSeason(prev)}>{tx('上一季', 'Last season')}</button>
      </div>
      {err ? <p className="fine warm">{tx('排行榜暫時讀不到，稍後再試。', 'The leaderboard isn’t available right now. Try again later.')} <button className="linkish" onClick={load}>{tx('重試', 'Retry')}</button></p>
        : !data ? <p className="fine">{tx('讀取中…', 'Loading…')}</p>
        : !data.top.length ? <p className="fine">{tx('這一季還沒有人作答。', 'No answers yet this season.')}</p>
        : (
          <>
            <ol className="qz-rank">
              {data.top.map((r) => (
                <li key={r.rank} className={me && me.rank === r.rank ? 'me' : ''}><span className="r">{r.rank}</span><span className="nm">{r.name || tx('匿名', 'Anonymous')}</span><span className="s">{r.ok}</span><span className="t">{fmtTime(r.ms)}</span></li>
              ))}
            </ol>
            {me && me.rank > data.top.length && (
              <>
                <div className="qz-gap">⋯</div>
                <ol className="qz-rank"><li className="me"><span className="r">{me.rank}</span><span className="nm">{tx('我', 'Me')}（{me.name || s.name}）</span><span className="s">{me.ok}</span><span className="t">{fmtTime(me.ms)}</span></li></ol>
              </>
            )}
            <p className="fine" style={{ marginTop: 10 }}>{tx(`${seasonLabel(season)}・${data.players.toLocaleString()} 人參加。數字＝答對題數，右邊是作答總時間；同分時間短的排前面。`, `${seasonLabel(season)} · ${data.players.toLocaleString()} players. Number = correct answers; right = total time (ties go to the faster).`)}</p>
          </>
        )}
      {season === cur && !me && st.n === 0 && <p className="fine">{tx('答一題就會上榜。', 'Answer one question to join the board.')}</p>}
      {editing ? (
        <form className="qz-name" onSubmit={async (e) => { e.preventDefault(); if (await setName(name)) { setEditing(false); load(); } }}>
          <input value={name} maxLength={16} onChange={(e) => setNameInput(e.target.value)} aria-label={tx('暱稱', 'Nickname')} autoFocus />
          <button className="qz-btn green" type="submit">{tx('儲存', 'Save')}</button>
        </form>
      ) : (
        <div className="qz-btns">
          <button className="qz-btn dim" onClick={() => setEditing(true)}>{tx('改暱稱', 'Nickname')}</button>
          <button className="qz-btn" onClick={share}>{tx('分享我的排名', 'Share')}</button>
        </div>
      )}
      <div className="qz-btns"><button className="qz-btn dim" onClick={onBack}>{tx('回到題目列表', 'Back to questions')}</button></div>
      <p className="fine" style={{ marginTop: 12 }}>
        {tx(`暱稱：${s.name}。不用註冊；伺服器只存隨機代碼、暱稱、各題對錯與作答時間，1 年後自動刪除。`, `Nickname: ${s.name}. No sign-up; the server keeps only a random code, nickname, right/wrong and time per question, deleted after a year.`)}
        {' '}{confirm ? <><button className="linkish warm" onClick={async () => { await forgetMe().catch(() => {}); setConfirm(false); load(); }}>{tx('確定刪除', 'Delete')}</button>　<button className="linkish" onClick={() => setConfirm(false)}>{tx('取消', 'Cancel')}</button></> : <button className="linkish" onClick={() => setConfirm(true)}>{tx('刪除我的紀錄', 'Delete my record')}</button>}
      </p>
    </>
  );
}

/** 去地圖找答案時，畫面下方的提示列 */
export function QuizPeekBar({ peek, setUi }) {
  useT();
  const item = peek && questionsOf(peek.week).find((x) => x.qid === peek.qid);
  if (!item) return null;
  return (
    <div className="qz-peek" role="status">
      <span>{qText(item)}</span>
      <button onClick={() => { lastView = { v: 'q', week: peek.week, qid: peek.qid }; setUi({ panel: 'quiz', quizPeek: null }); }}>{tx('回去作答', 'Answer')} ›</button>
      <button className="x" onClick={() => setUi({ quizPeek: null })} aria-label={tx('關閉提示', 'Dismiss')}>×</button>
    </div>
  );
}

/** 主畫面：本季排行榜前三名（點了打開排行榜）。讀不到或還沒有人作答時不顯示 */
let topCache = null;
export function QuizTop3({ setUi, s }) {
  useT();
  const [data, setData] = useState(topCache);
  useEffect(() => {
    let alive = true;
    const load = () => { if (document.visibilityState === 'visible') fetchBoard(seasonOf(weekOf())).then((d) => { topCache = d; if (alive) setData(d); }).catch(() => {}); };
    load();
    const id = setInterval(load, 15 * 60e3); // 每 15 分鐘更新一次（排名不需要即時）
    return () => { alive = false; clearInterval(id); };
  }, [s.ans]); // 自己答完題目也重新整理
  if (!data?.top?.length) return null;
  const me = data.me;
  const [, m] = data.season.split('-').map(Number);
  return (
    <button className="qz-top3" onClick={() => { lastView = { v: 'board' }; setUi({ panel: 'quiz' }); }} aria-label={tx('知識題排行榜', 'Quiz leaderboard')}>
      <span className="h"><span>{tx('知識題・本季前三', 'Quiz · top 3')}</span><span>{tx(`${m}–${m + 1} 月`, seasonLabel(data.season).replace(/ \d{4}$/, ''))}</span></span>
      <ol>
        {data.top.slice(0, 3).map((r) => (
          <li key={r.rank}><i>{r.rank}</i><span>{r.name || tx('匿名', 'Anonymous')}</span><b>{tx(`${r.ok} 題`, `${r.ok}`)}</b></li>
        ))}
      </ol>
      <span className="me">{me ? (me.rank <= 3 ? tx(`你是第 ${me.rank} 名！`, `You’re #${me.rank}!`) : tx(`我第 ${me.rank} 名・答對 ${me.ok} 題`, `Me: #${me.rank} · ${me.ok} correct`)) : tx('來答本週的題目', 'Join this week')} ›</span>
    </button>
  );
}
