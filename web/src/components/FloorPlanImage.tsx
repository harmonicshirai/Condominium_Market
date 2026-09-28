import { useState } from 'react';

interface FloorPlanImageProps {
  url: string | null | undefined;
  /** 拡大用の URL（押すと別タブで開く） */
  largeUrl?: string | null;
  size: 'thumb' | 'card' | 'large';
}

/**
 * 間取り図。画像は保存せず、見るときに掲載元から読み込む（リファラーは送らない）。
 * URL があるのは詳細を取得した保存物件だけで数が少ないため、遅延読み込みはしない。
 * 読み込めなければ何も出さない（掲載終了などで消えた画像）。
 */
export default function FloorPlanImage({ url, largeUrl, size }: FloorPlanImageProps) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  // width・height は元画像の縦横比（220×165）。読み込み前から枠を確保しておく
  const image = (
    <img
      className={`floor-plan floor-plan--${size}`}
      src={url}
      alt="間取り図"
      width={220}
      height={165}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
  if (!largeUrl) return image;
  return (
    <a className="floor-plan-link" href={largeUrl} target="_blank" rel="noopener noreferrer" title="間取り図を大きく表示" onClick={(event) => event.stopPropagation()}>
      {image}
    </a>
  );
}
