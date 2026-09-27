// 手元専用の掲載物件データ（public/local-data）を公開ビルドに含めない
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve('dist/local-data');
if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true });
  console.log('dist/local-data を削除しました（公開ビルドに含めない）');
}
