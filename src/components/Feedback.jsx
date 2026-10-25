import { useState } from 'react';
import { APP } from '../config/app.js';
import { Panel } from './Panels.jsx';
import { tx, isEn } from '../i18n.js';

/**
 * 意見回饋：送到中繼站 POST /feedback（v8.5），設計者在 LINE 收到通知
 *  ・不用登入；聯絡方式選填；可選擇附上版本與目前畫面
 *  ・不存 IP，中繼站只用來限制同一台 60 秒內只能送一則
 */
const KINDS = [['bug', '問題回報', 'Problem'], ['data', '資料有誤', 'Wrong data'], ['idea', '功能建議', 'Idea'], ['other', '其他', 'Other']];
const MAX = 500;

export function FeedbackPanel({ view, onClose }) {
  const [kind, setKind] = useState('bug');
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [withCtx, setWithCtx] = useState(true);
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error | fast | full
  const device = matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
  const ctxText = [`v${APP.version}`, device === 'mobile' ? tx('手機', 'phone') : tx('電腦', 'desktop'), isEn() ? 'English' : '中文', view].filter(Boolean).join(tx('・', ' · '));

  const submit = async () => {
    if (text.trim().length < 2 || status === 'sending') return;
    setStatus('sending');
    try {
      const body = { kind, text: text.trim(), contact: contact.trim() || null, ctx: withCtx ? { v: APP.version, device, lang: isEn() ? 'en' : 'zh', view: view || '' } : null };
      const r = await fetch(`${APP.relayUrl}/feedback`, { method: 'POST', body: JSON.stringify(body) });
      if (r.status === 429) { setStatus('fast'); return; }
      if (r.status === 503 && (await r.json().catch(() => null))?.error === 'full') { setStatus('full'); return; }
      if (!r.ok) throw new Error(r.status);
      setStatus('sent');
    } catch { setStatus('error'); }
  };

  if (status === 'sent') {
    return (
      <Panel title={tx('意見回饋', 'Feedback')} onClose={onClose}>
        <div className="fb-done">
          <b>{tx('收到了，謝謝！', 'Got it — thank you!')}</b>
          <p className="fine">{tx('設計者會看到這則回饋。有留聯絡方式的話，需要時會回覆你。', 'The designer will read this and reply if you left a contact.')}</p>
          <div className="upd-btns"><button onClick={() => { setText(''); setStatus('idle'); }}>{tx('再寫一則', 'Write another')}</button><button className="primary" onClick={onClose}>{tx('關閉', 'Close')}</button></div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={tx('意見回饋', 'Feedback')} onClose={onClose}>
      <p className="fine fb-intro">{tx('哪裡壞了、數字怪怪的、想要什麼功能，都可以告訴設計者。', 'Something broken, a number that looks off, a feature you want — tell the designer.')}</p>
      <div className="seg seg-wrap" role="radiogroup" aria-label={tx('類別', 'Type')}>
        {KINDS.map(([k, zh, en]) => (
          <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{tx(zh, en)}</button>
        ))}
      </div>
      <textarea className="fb-text" rows={5} maxLength={MAX} value={text} onChange={(e) => setText(e.target.value)}
        aria-label={tx('回饋內容', 'Your feedback')}
        placeholder={tx('例如：電廠卡的數字和台電網站不一樣、某個按鈕按了沒反應…', 'e.g. a plant card doesn’t match Taipower’s site, a button does nothing…')} />
      <div className="fine fb-count">{text.length} / {MAX}</div>
      <input className="fb-input" value={contact} maxLength={80} onChange={(e) => setContact(e.target.value)}
        aria-label={tx('聯絡方式（選填）', 'Contact (optional)')}
        placeholder={tx('聯絡方式（選填：Email 或 LINE ID，想收到回覆再填）', 'Contact (optional: email or LINE ID if you want a reply)')} />
      <label className="fine fb-ctx">
        <input type="checkbox" checked={withCtx} onChange={(e) => setWithCtx(e.target.checked)} />
        <span>{tx('一起送出版本與目前畫面，方便找問題', 'Include version and current view to help track it down')}<br /><span className="muted">{ctxText}</span></span>
      </label>
      {status === 'error' && <p className="fine fb-err">{tx('沒有送出去，請檢查網路後再試一次。', 'Couldn’t send — check your connection and try again.')}</p>}
      {status === 'full' && <p className="fine fb-err">{tx('今天收到的回饋已經滿了，請明天再試。', 'Today’s feedback limit has been reached — please try again tomorrow.')}</p>}
      {status === 'fast' && <p className="fine fb-err">{tx('送得太快了，請過一分鐘再試。', 'Too fast — please wait a minute and try again.')}</p>}
      <div className="upd-btns fb-btns">
        <button className="primary" onClick={submit} disabled={text.trim().length < 2 || status === 'sending'}>{status === 'sending' ? tx('送出中…', 'Sending…') : tx('送出', 'Send')}</button>
      </div>
      <p className="fine">{tx('不用登入。內容只有設計者看得到，不會公開，保存 180 天後自動刪除；請不要填身分證、帳號等個人資料。', 'No sign-in needed. Only the designer sees this; it is never published and is deleted after 180 days. Please don’t include ID numbers, account numbers or other personal data.')}</p>
    </Panel>
  );
}
