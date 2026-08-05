/**
 * LIBRO＋CRAFT 配信用ビルド。
 *
 * app/ を読み取り専用の入力として dist/ を生成する。app/ は一切変更しない。
 *
 * 行うこと  : JS からコメントを除去する（terser の再出力）
 * 行わないこと: モジュールの統合（バンドル）、変数名の短縮（mangle）、コード圧縮（compress）
 *
 * 出力は入力と同じファイル構成・同じファイル名を維持するため、
 * dist/index.html の <script type="module" src="js/main.js"> は書き換え不要で動作する。
 */
import { readdir, readFile, writeFile, rm, cp, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

const ROOT     = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR  = join(ROOT, 'app');
const OUT_DIR  = join(ROOT, 'dist');
const JS_DIR   = join(OUT_DIR, 'js');

/** terser へ渡すオプション。コメント削除のみを行う設定。 */
const TERSER_OPTIONS = {
  ecma: 2022,
  // app/js/*.js は ES Modules。これを付けないと import/export で構文エラーになる。
  module: true,
  // コード圧縮・変数名短縮はいずれも行わない（確定スコープ）。
  compress: false,
  mangle: false,
  format: {
    comments: false,   // ← 本ビルドの目的
    beautify: true,    // 1行化せず整形して出力する
    indent_level: 2,
  },
};

async function main() {
  // 1. 出力先をクリアして app/ をまるごとコピーする
  await rm(OUT_DIR, { recursive: true, force: true });
  await cp(SRC_DIR, OUT_DIR, { recursive: true });

  // 2. dist/js 直下の .js だけを処理する（vendor/ は対象外）
  const entries = await readdir(JS_DIR, { withFileTypes: true });
  const targets = entries
    .filter(e => e.isFile() && e.name.endsWith('.js'))
    .map(e => e.name)
    .sort();

  let beforeTotal = 0;
  let afterTotal  = 0;

  for (const name of targets) {
    const path   = join(JS_DIR, name);
    const before = await readFile(path, 'utf8');
    const result = await minify(before, TERSER_OPTIONS);
    if (typeof result.code !== 'string' || result.code.length === 0) {
      throw new Error(`ビルド失敗: ${name} の出力が空です`);
    }
    await writeFile(path, result.code, 'utf8');
    const afterSize = (await stat(path)).size;
    beforeTotal += Buffer.byteLength(before, 'utf8');
    afterTotal  += afterSize;
    console.log(`  ${name}: ${Buffer.byteLength(before, 'utf8')} -> ${afterSize} バイト`);
  }

  const rate = beforeTotal === 0 ? 0 : Math.round((1 - afterTotal / beforeTotal) * 1000) / 10;
  console.log(`\n処理ファイル数: ${targets.length}`);
  console.log(`JS 合計: ${beforeTotal} -> ${afterTotal} バイト（${rate}% 削減）`);
  console.log(`出力先: ${OUT_DIR}`);
  console.log('※ app/js/vendor/ は処理対象外（そのままコピー）');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
