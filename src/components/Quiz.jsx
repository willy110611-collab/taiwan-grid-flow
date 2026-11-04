import { useEffect, useMemo, useState } from 'react';
import { Panel } from './Panels.jsx';
import { QUIZ_BANK, SOURCES } from '../config/quizBank.js';
import { FILTERS } from '../config/energy.js';
import {
  MAP_QUESTIONS, questionsOf, roundOf, roundSeason, seasonRounds, seasonLabel, prevSeason, roundRange, useQuiz, answerOf,
  openQuestion, optionsOf, submitAnswer, fetchBoard, setName, syncMe, forgetMe, seasonStats, markSeen, fmtTime,
  canAnswer, answerable, lateRounds, prevRound, LATE_MAX
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
  const cur = roundOf();
  const weeks = useMemo(() => seasonRounds(cur), [cur]);
  const st = seasonStats(s, weeks);
  const season = roundSeason(cur);

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

const weekLabel = (w, cur) => (w === cur ? tx('這一期', 'This round') : roundRange(w));
const qText = (item) => (item.kind === 'k' ? (isEn() ? QUIZ_BANK.find((q) => q.id === item.id)?.qEn : QUIZ_BANK.find((q) => q.id === item.id)?.q) : MAP_QUESTIONS[item.id].q());

function QuizList({ s, weeks, cur, st, onOpen, onBoard }) {
  const [showOld, setShowOld] = useState(false);
  useEffect(() => { fetchBoard(roundSeason(cur)).then(syncMe).catch(() => {}); }, [cur]); // 同步加入的期與補答次數（換裝置也一致）
  const list = questionsOf(cur);
  const done = list.filter((it) => answerOf(s, cur, it.qid));
  const older = weeks.filter((w) => w !== cur);
  const left = (w) => questionsOf(w).filter((it) => !answerOf(s, w, it.qid)).length;
  const open = older.filter((w) => answerable(canAnswer(s, w, cur)) && left(w)); // 現在可以補答的期
  const free = open.some((w) => canAnswer(s, w, cur) === 'free');
  const prev = prevRound(cur);
  const lateLeft = Math.max(0, LATE_MAX - lateRounds(s, roundSeason(cur)).length);
  const closed = older.filter((w) => !open.includes(w));
  const next = [cur, ...open.slice().reverse()].flatMap((w) => questionsOf(w).filter((it) => !answerOf(s, w, it.qid)).map((it) => [w, it]))[0];
  const lateNote = (w) => {
    const c = canAnswer(s, w, cur);
    if (c === 'free') return tx('新加入，可以補答', 'New player — catch up');
    if (c === 'late') return lateRounds(s, roundSeason(cur)).includes(w) ? tx('補答中', 'Catching up') : tx(`可補答・本季還有 ${lateLeft} 次`, `Catch up · ${lateLeft} left this season`);
    return '';
  };
  return (
    <>
      <div className="qz-head">
        <div><div className="hl-k">{tx(`這一期・${roundRange(cur)}`, `This round · ${roundRange(cur)}`)}</div><div className="big">{done.length}<small> / {list.length} {tx('題', '')}　{tx('答對', 'correct')} {done.filter((it) => answerOf(s, cur, it.qid).ok).length}</small></div></div>
        <div style={{ textAlign: 'right' }}><div className="hl-k" style={{ justifyContent: 'flex-end' }}>{tx('本季', 'Season')}</div><div className="big">{st.ok}<small> / {st.total} {tx('答對', 'correct')}</small></div></div>
      </div>
      <div className="qz-prog">{list.map((it) => { const a = answerOf(s, cur, it.qid); return <i key={it.qid} className={a ? (a.ok ? 'ok' : 'ng') : ''} />; })}</div>
      <QList s={s} week={cur} cur={cur} onOpen={onOpen} />
      {open.slice().reverse().map((w) => (
        <div key={w}><div className="hl-k qz-late" style={{ marginTop: 12 }}>{roundRange(w)}<span className="qz-new">{lateNote(w)}</span></div><QList s={s} week={w} cur={cur} onOpen={onOpen} /></div>
      ))}
      {!free && older.includes(prev) && !open.includes(prev) && left(prev) > 0 && (
        <p className="fine" style={{ marginTop: 8 }}>{tx(`上一期還有 ${left(prev)} 題沒答，但本季 ${LATE_MAX} 次補答機會已經用完。`, `${left(prev)} unanswered last round, but you’ve used all ${LATE_MAX} catch-ups this season.`)}</p>
      )}
      {closed.length > 0 && (
        <>
          <button className="qz-more" onClick={() => setShowOld(!showOld)} aria-expanded={showOld}>
            {tx('本季前幾期（已截止）', 'Earlier this season (closed)')} {showOld ? '▴' : '▾'}
          </button>
          {showOld && closed.slice().reverse().map((w) => (
            <div key={w}><div className="hl-k" style={{ marginTop: 10 }}>{roundRange(w)}</div><QList s={s} week={w} cur={cur} onOpen={onOpen} /></div>
          ))}
        </>
      )}
      <div className="qz-btns">
        {next && <button className="qz-btn" onClick={() => onOpen(next[0], next[1])}>{tx('繼續作答', 'Continue')}</button>}
        <button className="qz-btn dim" onClick={onBoard}>{tx('排行榜', 'Leaderboard')}</button>
      </div>
      <p className="fine" style={{ marginTop: 12 }}>{tx(
        `每週一、週四各換 3 題。上一期沒答完的可以補答，每季 ${LATE_MAX} 次；更早的期就截止了（第一次加入的人，加入的那一期可以補答本季所有題目）。每兩個月一季，答對多的排前面，同分比作答時間。不會推播打擾你。`,
        `Three new questions every Monday and Thursday. You can catch up on the previous round ${LATE_MAX} times per season; older rounds close (new players can catch up on the whole season during the round they join). Seasons last two months; most correct ranks first, ties go to the faster total time. No notifications.`
      )}</p>
    </>
  );
}

function QList({ s, week, cur, onOpen }) {
  const can = answerable(canAnswer(s, week, cur));
  return (
    <ul className="qz-list">
      {questionsOf(week).map((it, i) => {
        const a = answerOf(s, week, it.qid);
        return (
          <li key={it.qid}>
            <button onClick={() => onOpen(week, it)} disabled={!a && !can}>
              <span className="n">{i + 1}</span>
              <span>{qText(it)}<span className={`qz-type ${it.kind === 'm' ? 'qzmap' : ''}`}>{it.kind === 'm' ? tx('看地圖', 'Map') : tx('知識', 'Fact')}</span></span>
              <span className={`st ${a ? (a.ok ? 'ok' : 'ng') : can ? 'go' : 'off'}`}>{a ? (a.ok ? tx('答對', 'Right') : tx('答錯', 'Wrong')) : can ? tx('作答 ›', 'Answer ›') : tx('已截止', 'Closed')}</span>
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
  const cur = roundOf(), can = canAnswer(s, week, cur);
  const idx = questionsOf(week).findIndex((x) => x.qid === item.qid) + 1;
  const k = item.kind === 'k' ? QUIZ_BANK.find((q) => q.id === item.id) : null;
  const m = item.kind === 'm' ? MAP_QUESTIONS[item.id] : null;
  const keys = k ? k.opts.map((_, i) => i) : optionsOf(s, week, item);
  const label = (key) => (k ? ((isEn() && k.optsEn) || k.opts)[key] : m.label(key));
  const pick = async (key) => {
    if (a || busy || !answerable(can)) return;
    if (m && !live(snapshot)) return;
    setBusy(true);
    await submitAnswer(week, item, key, snapshot);
    setBusy(false);
  };
  // 下一題：同一期還沒答的，再來是這一期、可以補答的期（補答下一期不會自動扣次數：要使用者自己點）
  const next = [week, ...weeks.filter((w) => w !== week).reverse()].filter((w) => { const c = canAnswer(s, w, cur); return c === 'open' || c === 'free' || (c === 'late' && lateRounds(s, roundSeason(cur)).includes(w)); })
    .flatMap((w) => questionsOf(w).filter((it) => !answerOf(s, w, it.qid) && !(w === week && it.qid === item.qid)).map((it) => ({ week: w, qid: it.qid })))[0];
  const lateLeft = Math.max(0, LATE_MAX - lateRounds(s, roundSeason(cur)).length);
  const firstLate = !a && can === 'late' && !lateRounds(s, roundSeason(cur)).includes(week);
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
      {!a && !answerable(can) ? (
        <p className="fine warm">{can === 'nolate' ? tx(`本季 ${LATE_MAX} 次補答機會已經用完，這一期不能再補答。`, `You’ve used all ${LATE_MAX} catch-ups this season.`) : tx('這一期已經截止，不能再作答。', 'This round is closed.')}</p>
      ) : !ready || !keys ? (
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
      {firstLate && <p className="fine" style={{ marginTop: 8 }}>{tx(`補答上一期：作答後會用掉本季 1 次補答機會（還有 ${lateLeft} 次），這一期其他題就不再扣。`, `Catching up: answering uses 1 of your ${lateLeft} catch-ups left this season (the rest of this round is free).`)}</p>}
      {!a && m && ready && keys && answerable(can) && (
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
  const [nameMsg, setNameMsg] = useState('');
  const load = () => { setErr(false); fetchBoard(season).then((d) => { syncMe(d); setData(d); }).catch(() => setErr(true)); };
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
        <>
          <form className="qz-name" onSubmit={async (e) => {
            e.preventDefault();
            const r = await setName(name);
            if (r === 'ok') { setEditing(false); setNameMsg(''); load(); }
            else setNameMsg({ locked: tx('暱稱已經改過一次了。要再改請到「更多 → 意見回饋」聯絡管理者。', 'You’ve already changed your nickname once. To change it again, contact us via More → Feedback.'), taken: tx('這個暱稱已經有人用了，換一個吧。', 'That nickname is taken — try another.'), empty: tx('請輸入暱稱。', 'Please enter a nickname.'), offline: tx('暫時無法儲存，稍後再試。', 'Couldn’t save right now. Try again later.') }[r]);
            if (r === 'locked') setEditing(false);
          }}>
            <input value={name} maxLength={16} onChange={(e) => setNameInput(e.target.value)} aria-label={tx('暱稱', 'Nickname')} autoFocus />
            <button className="qz-btn green" type="submit">{tx('確定', 'Save')}</button>
          </form>
          <p className="fine warm" style={{ marginTop: 6 }}>{tx('暱稱只能免費改一次，之後要改請聯絡管理者。', 'You can change your nickname once for free; after that, contact us.')}</p>
        </>
      ) : (
        <div className="qz-btns">
          {!s.renamed && <button className="qz-btn dim" onClick={() => { setNameMsg(''); setEditing(true); }}>{tx('改暱稱（限一次）', 'Nickname (once)')}</button>}
          <button className="qz-btn" onClick={share}>{tx('分享我的排名', 'Share')}</button>
        </div>
      )}
      {nameMsg && <p className="fine warm" style={{ marginTop: 6 }}>{nameMsg}</p>}
      {s.renamed && !editing && <p className="fine" style={{ marginTop: 6 }}>{tx('暱稱已改過一次；要再改請到「更多 → 意見回饋」聯絡管理者。', 'Nickname already changed once; to change it again, contact us via More → Feedback.')}</p>}
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
    const load = () => { if (document.visibilityState === 'visible') fetchBoard(roundSeason(roundOf())).then((d) => { topCache = d; if (alive) setData(d); }).catch(() => {}); };
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
      <span className="me">{me ? (me.rank <= 3 ? tx(`你是第 ${me.rank} 名！`, `You’re #${me.rank}!`) : tx(`我第 ${me.rank} 名・答對 ${me.ok} 題`, `Me: #${me.rank} · ${me.ok} correct`)) : tx('來答這一期的題目', 'Join this round')} ›</span>
    </button>
  );
}

/** 這一期還沒答完時跳出的小提醒（每期最多一次；按「下次再說」或答題後就不再出現；不推播） */
export function QuizNudge({ s, setUi, blocked }) {
  useT();
  const [show, setShow] = useState(false);
  const cur = roundOf();
  const left = questionsOf(cur).filter((it) => !answerOf(s, cur, it.qid)).length;
  const seen = (() => { try { return localStorage.getItem('tgf-quiz-nudge') === cur; } catch { return false; } })();
  useEffect(() => {
    if (seen || !left || blocked) return undefined;
    const id = setTimeout(() => setShow(true), 6000); // 打開網頁 6 秒後（先看一下地圖）
    return () => clearTimeout(id);
  }, [seen, left, blocked]);
  if (!show || seen || !left || blocked) return null;
  const done = () => { try { localStorage.setItem('tgf-quiz-nudge', cur); } catch { /* 略 */ } setShow(false); };
  const top = topCache?.top?.[0];
  return (
    <div className="qz-nudge" role="dialog" aria-label={tx('知識題提醒', 'Quiz reminder')}>
      <div className="qz-nudge-h"><span>{tx('知識題', 'Quiz')}</span><button onClick={done} aria-label={tx('關閉', 'Close')}>×</button></div>
      <b>{tx(`這一期還有 ${left} 題沒答`, `${left} question${left > 1 ? 's' : ''} left this round`)}</b>
      <p>{top ? tx(`本季目前第一：${top.name}（答對 ${top.ok} 題）`, `Season leader: ${top.name} (${top.ok} correct)`) : tx('每週一、四換題，約 1 分鐘答完。', 'New questions every Mon & Thu — about a minute.')}</p>
      <div className="qz-nudge-b">
        <button className="go" onClick={() => { done(); lastView = { v: 'list' }; setUi({ panel: 'quiz' }); }}>{tx('去答題', 'Answer now')}</button>
        <button onClick={done}>{tx('下次再說', 'Later')}</button>
      </div>
    </div>
  );
}
