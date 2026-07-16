import { state } from './state.js';
import { showToast } from './ui-common.js';

/* =========================================================
   インデックス（index.json outline）編集モーダル

   LIBRO book の index.json が持つ目次情報 outline
   （[{description, "dest-page", children:[...]}, ...]、最大3階層）を
   編集するモーダルダイアログを提供する。

   - 編集はモーダル内のローカル行データ（rows）に対して行い、
     OK押下時のみ state.libroBook.indexJson.outline へ書き戻す。
   - 書き戻した outline は「LIBRO形式で書き出す」実行時に
     buildLibroBookExport() が index.json を再シリアライズすることで保存される。
   - description の先頭には既存データの慣例で U+FEFF（BOM文字）が付くため、
     表示・編集時は除去し、書き出し時に付与する。未編集の行は元の
     生文字列をそのまま維持してバイト単位の往復不変性を保つ。
   ========================================================= */

const MAX_LEVEL = 3;

/**
 * 編集中の行データ（モーダルを開いてから閉じるまでの間だけ有効）。
 * @type {Array<{level:number, text:string, destPage:string, orig:Object|null, origText:string|null}>}
 * - level: 1〜3 の階層
 * - text: 表示・編集用の見出し文字列（先頭のU+FEFF除去済み）
 * - destPage: 遷移先ページ番号の入力値（文字列のまま保持し、OK時に検証）
 * - orig: 元のoutline項目オブジェクト（未知プロパティ温存用）。新規行はnull
 * - origText: 元のdescription生文字列（U+FEFF含む）。新規行はnull
 */
let rows = [];


/** 文字列先頭のU+FEFF（BOM文字）を1つ除去する。 */
function stripBom(s) {
  return s.replace(/^\uFEFF/, '');
}


/**
 * outlineツリーを行データへ平坦化する（4階層以上は3階層目に丸める）。
 * @param {Array<Object>} items - outline項目の配列
 * @param {number} level - この配列の階層（1始まり）
 * @param {Array<Object>} out - 追記先の行データ配列
 */
function flattenOutline(items, level, out) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const raw = typeof item.description === 'string' ? item.description : '';
    out.push({
      level,
      text: stripBom(raw),
      destPage: Number.isInteger(item['dest-page']) ? String(item['dest-page']) : '',
      orig: item,
      origText: raw,
    });
    if (Array.isArray(item.children) && item.children.length) {
      flattenOutline(item.children, Math.min(level + 1, MAX_LEVEL), out);
    }
  }
}


/**
 * インデックス編集モーダルを開く。LIBRO book 未読込時は何もしない
 * （ボタン自体も updateIndexEditBtnState で非活性化されている）。
 */
export function openIndexEditor() {
  if (!state.libroBook) return;
  rows = [];
  flattenOutline(state.libroBook.indexJson.outline || [], 1, rows);
  renderRows();
  document.getElementById('indexEditorOverlay').classList.add('is-open');
}


/**
 * インデックス編集モーダルを閉じる。
 * @param {boolean} save - trueなら検証のうえ state.libroBook.indexJson.outline へ書き戻す。
 *   検証エラー時はトーストを表示してモーダルを開いたままにする。
 */
export function closeIndexEditor(save) {
  const overlay = document.getElementById('indexEditorOverlay');
  if (!overlay || !overlay.classList.contains('is-open')) return;

  if (save) {
    const outline = buildOutlineFromRows();
    if (outline === null) return; // 検証エラー（トースト表示済み）
    const indexJson = state.libroBook.indexJson;
    if (outline.length === 0) {
      // 全行削除：元からoutlineを持つbookのみ空配列化し、元から無いbookにはキーを追加しない
      if ('outline' in indexJson) indexJson.outline = [];
    } else {
      indexJson.outline = outline;
    }
    showToast('インデックスを更新しました（「LIBRO形式で書き出す」でbookに保存されます）', 3000);
  }

  overlay.classList.remove('is-open');
  rows = [];
}


/** 末尾に新規行（第1階層・空欄）を追加する。 */
export function addIndexRow() {
  rows.push({ level: 1, text: '', destPage: '', orig: null, origText: null });
  renderRows();
  const wrap = document.getElementById('indexEditorRows');
  wrap.scrollTop = wrap.scrollHeight;
}


/** インデックス編集ボタンの活性・非活性をLIBRO book読込有無に応じて更新する。 */
export function updateIndexEditBtnState() {
  document.getElementById('indexEditBtn')?.classList.toggle('disabled', !state.libroBook);
}


/** rows の内容でモーダル内の行リストDOMを再構築する。 */
function renderRows() {
  const wrap = document.getElementById('indexEditorRows');
  wrap.textContent = '';

  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'index-editor-empty';
    empty.textContent = 'インデックス項目がありません。「＋ 項目を追加」で作成してください。';
    wrap.appendChild(empty);
    return;
  }

  rows.forEach((row, i) => {
    const div = document.createElement('div');
    div.className = `index-row level-${row.level}`;

    // 階層セレクト
    const levelSel = document.createElement('select');
    levelSel.className = 'index-row-level';
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      const opt = document.createElement('option');
      opt.value = String(lv);
      opt.textContent = `第${lv}階層`;
      levelSel.appendChild(opt);
    }
    levelSel.value = String(row.level);
    levelSel.addEventListener('change', () => {
      row.level = parseInt(levelSel.value, 10);
      div.className = `index-row level-${row.level}`;
    });

    // 見出し入力
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'index-row-text';
    textInput.placeholder = '見出し';
    textInput.value = row.text;
    textInput.addEventListener('input', () => { row.text = textInput.value; });

    // ページ番号入力
    const pageInput = document.createElement('input');
    pageInput.type = 'text';
    pageInput.inputMode = 'numeric';
    pageInput.className = 'index-row-page';
    pageInput.placeholder = 'ページ';
    pageInput.value = row.destPage;
    pageInput.addEventListener('input', () => { row.destPage = pageInput.value; });

    // 行操作ボタン
    const upBtn = makeRowBtn('↑', '上へ移動', () => {
      if (i === 0) return;
      [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
      renderRows();
    });
    const downBtn = makeRowBtn('↓', '下へ移動', () => {
      if (i === rows.length - 1) return;
      [rows[i], rows[i + 1]] = [rows[i + 1], rows[i]];
      renderRows();
    });
    const insBtn = makeRowBtn('＋', 'この行の下に項目を追加', () => {
      rows.splice(i + 1, 0, { level: row.level, text: '', destPage: '', orig: null, origText: null });
      renderRows();
    });
    const delBtn = makeRowBtn('×', 'この項目を削除', () => {
      rows.splice(i, 1);
      renderRows();
    });

    div.append(levelSel, textInput, pageInput, upBtn, downBtn, insBtn, delBtn);
    wrap.appendChild(div);
  });
}


/** 行操作用の小ボタンを生成する。 */
function makeRowBtn(label, tip, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'index-row-btn';
  btn.textContent = label;
  btn.title = tip;
  btn.addEventListener('click', onClick);
  return btn;
}


/**
 * rows から outline ツリーを組み立てる。
 * 検証エラー時はトーストを表示して null を返す。
 * @returns {Array<Object>|null}
 */
function buildOutlineFromRows() {
  const totalPages = state.libroBook.indexJson.pages?.length || state.totalPages;
  const result = [];
  const lastItemAtLevel = {};
  let prevLevel = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const text = row.text.trim();
    if (!text) {
      showToast(`${i + 1}行目：見出しが未入力です`);
      return null;
    }

    // ページ番号：空欄はdest-pageキー自体を省略、入力があれば範囲内整数のみ許容
    let destPage = null;
    const pageStr = row.destPage.trim();
    if (pageStr !== '') {
      destPage = Number(pageStr);
      if (!Number.isInteger(destPage) || destPage < 1 || destPage > totalPages) {
        showToast(`${i + 1}行目：ページ番号は1〜${totalPages}の整数で入力してください`);
        return null;
      }
    }

    // 直前の行より2段以上深い階層は「直前+1」に丸める（先頭行は必ず第1階層になる）
    const level = Math.min(row.level, prevLevel + 1);

    // 見出し：未編集なら元の生文字列（先頭U+FEFF含む）をそのまま維持し、
    // 新規・編集済みは既存データの慣例にあわせて先頭にU+FEFFを付与する
    // 未編集判定はtrim前の入力値（row.text）で行う。trim後の値（text）で比較すると、
    // 元データに前後空白がある未編集行が「編集済み」扱いになりバイト不変性が壊れる。
    const description = (row.origText !== null && stripBom(row.origText) === row.text)
      ? row.origText
      : '\uFEFF' + text;

    // 元項目の未知プロパティを引き継いだ新オブジェクトを作る（children/dest-pageは作り直す）
    const item = { ...(row.orig || {}), description };
    delete item.children;
    delete item['dest-page'];
    if (destPage !== null) item['dest-page'] = destPage;

    if (level === 1) {
      result.push(item);
    } else {
      const parent = lastItemAtLevel[level - 1];
      if (!parent.children) parent.children = [];
      parent.children.push(item);
    }
    lastItemAtLevel[level] = item;
    prevLevel = level;
  }

  return result;
}
