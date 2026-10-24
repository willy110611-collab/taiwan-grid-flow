import { Component } from 'react';
import { reportError } from '../report.js';
import { tx } from '../i18n.js';

/**
 * G1 錯誤隔離：包住每個面板與地圖。
 *  其中一個出錯，只有它顯示「暫時出錯」，其他功能照常；同時匿名回報（G3）
 */
export class Guard extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    reportError(error, this.props.name || 'panel');
  }
  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.silent) return null;
    return (
      <section className={`guard-card ${this.props.full ? 'full' : ''}`} role="alert">
        <b>{tx('這個功能暫時出錯了', 'This feature hit an error')}</b>
        <p>{tx('其他功能照常可以用，錯誤已自動回報。', 'Everything else still works; the error was reported automatically.')}</p>
        <div className="guard-btns">
          <button onClick={() => this.setState({ error: null })}>{tx('再試一次', 'Try again')}</button>
          {this.props.onClose && <button onClick={() => { this.setState({ error: null }); this.props.onClose(); }}>{tx('關閉', 'Close')}</button>}
          <button onClick={() => location.reload()}>{tx('重新整理', 'Reload')}</button>
        </div>
      </section>
    );
  }
}
