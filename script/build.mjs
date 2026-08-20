/**
 * LIBRO＋CRAFT 配信用ビルド。
 *
 * app/ を読み取り専用の入力として LIBRO_CRAFT/ を生成する。app/ は一切変更しない。
 *
 * 行うこと  : JS からコメントを除去する（terser の再出力）
 *             index.html から HTML コメントを除去する
 *             css/style.css から CSS コメントを除去する
 *             icons/sprite.svg から XML コメントを除去する
 *
 * 例外      : js/vendor/ は対象外。jszip.min.js 冒頭のバナーコメントは MIT/GPLv3 の
 *             ライセンス表示であり、法的に保持が必要なため削除しない。
 *             js/vendor/JSZIP_LICENSE.md も同様にそのまま配置する。
 *
 * 行わないこと: モジュールの統合（バンドル）、変数名の短縮（mangle）、コード圧縮（compress）
 *
 * 出力は入力と同じファイル構成・同じファイル名を維持するため、
 * LIBRO_CRAFT/index.html の <script type="module" src="js/main.js"> は書き換え不要で動作する。
 */
import { readdir, readFile, writeFile, rm, cp, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR   = join(ROOT, 'app');
const OUT_DIR   = join(ROOT, 'LIBRO_CRAFT');
const JS_DIR    = join(OUT_DIR, 'js');
const HTML_FILE = join(OUT_DIR, 'index.html');
const CSS_FILE  = join(OUT_DIR, 'css', 'style.css');
const SVG_FILE  = join(OUT_DIR, 'icons', 'sprite.svg');

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

/**
 * HTML / XML コメント（<!-- ... -->）を除去する。SVG にもそのまま使える。
 *
 * - <script> / <style> / <textarea> / <pre> の中身は対象外。コメント記法がテキストとして
 *   書かれている可能性があるため、要素ごとスキップする。
 * - 条件付きコメント（<!--[if ...]>）は互換性のため残す。
 * - <!DOCTYPE html> は "<!--" で始まらないため対象外。
 * - 行全体がコメントだった行は空行を残さず行ごと削除し、行末のコメントは直前の空白ごと削除する。
 *
 * @param {string} html - 入力HTML/XML
 * @returns {string} コメントを除去したHTML/XML
 */
function stripHtmlComments(html) {
  // 生テキスト要素（中身をHTMLとして解釈しない要素）は丸ごと退避する。
  const RAW_TEXT = /<(script|style|textarea|pre)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

  const strip = (s) => s
    // 1) その行がコメントだけで構成される場合は、改行ごと削除する（空行を残さない）
    .replace(/^[ \t]*(?:<!--(?!\[if)[\s\S]*?-->[ \t]*)+\r?\n/gm, '')
    // 2) 残ったコメント（行末・行中）は、直前の空白ごと削除する
    .replace(/[ \t]*<!--(?!\[if)[\s\S]*?-->/g, '');

  let out  = '';
  let last = 0;
  for (const m of html.matchAll(RAW_TEXT)) {
    out += strip(html.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  out += strip(html.slice(last));
  return out;
}

/** コメント跡地を示す一時マーカー。CSS 中に現れ得ない制御文字（U+0000）を使う。 */
const CSS_MARK = String.fromCharCode(0);

/**
 * CSS のブロックコメントを除去する。
 *
 * - 文字列リテラル（'...' / "..."）の中は対象外。content プロパティ等でコメント記法が
 *   文字列として書かれていても壊さない。
 * - 行全体がコメントだった行は空行を残さず行ごと削除し、行末のコメントは直前の空白ごと削除する。
 *
 * @param {string} css - 入力CSS
 * @returns {string} コメントを除去したCSS
 */
function stripCssComments(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      // 文字列リテラルはそのまま通す（バックスラッシュによるエスケープを考慮）
      let j = i + 1;
      while (j < css.length && css[j] !== c) {
        j += css[j] === '\\' ? 2 : 1;
      }
      out += css.slice(i, Math.min(j + 1, css.length));
      i = j + 1;
    } else if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      out += CSS_MARK;
    } else {
      out += c;
      i += 1;
    }
  }
  return out
    // 1) その行がコメントだけで構成される場合は、改行ごと削除する（空行を残さない）
    .replace(new RegExp(`^[ \\t]*(?:${CSS_MARK}[ \\t]*)+\\r?\\n`, 'gm'), '')
    // 2) 残ったマーカーは、直前の空白ごと削除する
    .replace(new RegExp(`[ \\t]*${CSS_MARK}`, 'g'), '');
}

/**
 * 1ファイルを変換して上書きし、削減バイト数をログ出力する。
 *
 * @param {string} path - 対象ファイルの絶対パス
 * @param {string} label - ログ表示名
 * @param {(src: string) => string} transform - 変換関数
 */
async function stripFile(path, label, transform) {
  const before = await readFile(path, 'utf8');
  const after  = transform(before);
  if (after.length === 0) {
    throw new Error(`ビルド失敗: ${label} の出力が空です`);
  }
  await writeFile(path, after, 'utf8');
  const beforeSize = Buffer.byteLength(before, 'utf8');
  const afterSize  = (await stat(path)).size;
  const rate = Math.round((1 - afterSize / beforeSize) * 1000) / 10;
  console.log(`${label}: ${beforeSize} -> ${afterSize} バイト（${rate}% 削減）`);
}

async function main() {
  if (OUT_DIR === ROOT || OUT_DIR === SRC_DIR) {
    throw new Error(`ビルド失敗: 出力先が不正です（${OUT_DIR}）`);
  }

  // 1. 出力先をクリアして app/ をまるごとコピーする
  await rm(OUT_DIR, { recursive: true, force: true });
  await cp(SRC_DIR, OUT_DIR, { recursive: true });

  // 2. LIBRO_CRAFT/js 直下の .js だけを処理する（vendor/ は対象外）
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

  // 3. index.html / style.css / sprite.svg のコメントを除去する
  await stripFile(HTML_FILE, 'index.html', stripHtmlComments);
  await stripFile(CSS_FILE,  'css/style.css', stripCssComments);
  await stripFile(SVG_FILE,  'icons/sprite.svg', stripHtmlComments);

  console.log(`出力先: ${OUT_DIR}`);
  console.log('※ js/vendor/ は処理対象外（ライセンス表示を保持するためそのままコピー）');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
