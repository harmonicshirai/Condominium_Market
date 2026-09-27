import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const metaPath = resolve('public/data/meta.json');
if (!existsSync(metaPath)) {
  console.error('公開データがありません。先にリポジトリのルートで .venv\\Scripts\\python -m pipeline.update_all を実行してください');
  process.exit(1);
}

try {
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  if (!Array.isArray(meta.sources) || meta.sources.some((source) => typeof source.credit !== 'string' || !source.credit.trim())) {
    throw new Error('sources の credit が空です');
  }
} catch (error) {
  console.error(`公開データを確認できません: ${error instanceof Error ? error.message : '不明なエラー'}`);
  process.exit(1);
}
