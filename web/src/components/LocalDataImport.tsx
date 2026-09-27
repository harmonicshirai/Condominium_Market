import { useRef, useState } from 'react';
import { parseBundle, saveStoredBundle, type LocalData } from '../lib/localListings';

interface LocalDataImportProps {
  onLoaded: (data: LocalData) => void;
  onCancel?: () => void;
}

/** 共有用ファイル（掲載物件データ）を読み込む。データはこのブラウザの中にだけ保存する */
export default function LocalDataImport({ onLoaded, onCancel }: LocalDataImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const text = await file.text();
      const data = parseBundle(text);
      await saveStoredBundle(text).catch(() => {
        setMessage('このブラウザに保存できなかったため、ページを閉じると消えます（表示はできます）。');
      });
      onLoaded(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ファイルを読み込めませんでした');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <section className="content-section">
      <div className="section-heading section-heading--content"><h2>掲載物件</h2></div>
      <div className="detail-card import-card">
        <h3>共有用ファイルを読み込む</h3>
        <p>送られてきた「掲載物件データ_（日付）.json」というファイルを選ぶと、物件の一覧・地図・相場との比較を見られます。</p>
        <ol className="import-steps">
          <li>LINE やメールで届いたファイルを、スマホやパソコンに保存します。</li>
          <li>下の「ファイルを選ぶ」を押して、そのファイルを選びます。</li>
        </ol>
        <p className="form-note">ファイルの中身はこのブラウザの中にだけ保存され、インターネット上には送られません。次に開いたときも表示されます。</p>
        <div className="check-row">
          <button type="button" className="button button--primary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? '読み込み中…' : 'ファイルを選ぶ'}</button>
          {onCancel ? <button type="button" className="button button--quiet" onClick={onCancel}>やめる</button> : null}
        </div>
        <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void handleFile(event.target.files?.[0])} />
        {message ? <p className="inline-error" role="alert">{message}</p> : null}
      </div>
    </section>
  );
}
