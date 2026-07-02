import { mediaBlobs } from './state.js';
import { ANNOTATION_TYPE_CONFIG } from './config.js';
import { addStickyClickHandler } from './sticky.js';
import { makeDraggable, makeResizable } from './annotation-interaction.js';

/* ============================================================
   LIBRO bookフォルダ形式（index.json / p####.json / 暗号化ページ画像 /
   annots / sounds）の読込・解析。
   仕様の詳細は docs/libro_integration_計画書.md と
   .claude/skills/libro-integration/SKILL.md を参照。
============================================================ */

/** Pbve2000形式のヘッダー長（"Pbve2000" の8バイト） */
const PBVE_HEADER_LEN = 8;

/**
 * Pbve2000形式のデータを復号する。
 * 先頭8バイト（"Pbve2000"ヘッダー）を除去し、残りを 0xCC でXORすると元データが復元される。
 * @param {ArrayBuffer} buffer - 暗号化されたバイナリデータ
 * @returns {Uint8Array} 復号済みデータ
 */
export function decodePbve2000(buffer) {
  const src  = new Uint8Array(buffer);
  const body = src.subarray(PBVE_HEADER_LEN);
  const out  = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) out[i] = body[i] ^ 0xCC;
  return out;
}


/**
 * Pbve2000形式でデータを暗号化する（decodePbve2000と対称の処理）。
 * 先頭に "Pbve2000"（8バイト）ヘッダーを付加し、本体を 0xCC でXORする。
 * @param {ArrayBuffer|Uint8Array} data - 平文バイナリデータ
 * @returns {Uint8Array} 暗号化済みデータ（ヘッダー8バイト＋XOR済み本体）
 */
export function encodePbve2000(data) {
  const body = data instanceof Uint8Array ? data : new Uint8Array(data);
  const header = new TextEncoder().encode('Pbve2000');
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  for (let i = 0; i < body.length; i++) out[header.length + i] = body[i] ^ 0xCC;
  return out;
}


/**
 * zip内から相対パス末尾一致でエントリを探す。
 * book root フォルダ（16進数フォルダ名）が zip 内に含まれる場合も含まれない場合も対応する。
 * @param {JSZip} zip
 * @param {string} name - 探すファイル名（例: 'index.json'）
 * @returns {JSZip.JSZipObject|null}
 */
function findZipEntry(zip, name) {
  let found = null;
  zip.forEach((relPath, entry) => {
    if (found) return;
    if (relPath === name || relPath.endsWith('/' + name)) found = entry;
  });
  return found;
}


/**
 * ZIPがLIBRO bookフォルダ形式かどうかを判定する（index.jsonの有無で判定）。
 * @param {JSZip} zip
 * @returns {boolean}
 */
export function isLibroBookZip(zip) {
  return !!findZipEntry(zip, 'index.json');
}


/**
 * annots[] の actions 配列から既知パターンを判定する。
 * @param {Array<Object>} actions
 * @returns {'pagelink'|'uri'|'launch'|'toggle'|null} 既知種別。判定不能な場合は null
 */
function classifyActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  const kinds = actions.map(a => a.action);
  if (kinds.includes('GoTo') && kinds.includes('FitPage')) return 'pagelink';
  if (kinds.length === 1 && kinds[0] === 'URI')    return 'uri';
  if (kinds.length === 1 && kinds[0] === 'Launch') return 'launch';
  if (kinds.every(k => k === 'Hide' || k === 'Show')) return 'toggle';
  return null;
}


/**
 * annots[] 内のHide/Show（付箋・答え表示等の開閉）ペアを、targetsの相互参照から自動判定する。
 * 双方が互いをtargetsに含む場合のみペアとして確定する（片方向のみの参照はペア扱いしない）。
 * @param {Array<Object>} annots - _id 付与済みのページ内annots配列
 * @returns {{ pairs: Array<[Object,Object]>, pairedIds: Set<number> }}
 */
function findTogglePairs(annots) {
  const byId = new Map();
  annots.forEach(a => { if (a._id != null) byId.set(a._id, a); });

  const pairedIds = new Set();
  const pairs = [];

  annots.forEach(a => {
    if (a._id == null || pairedIds.has(a._id)) return;
    if (classifyActions(a.actions) !== 'toggle') return;

    const targets = [];
    a.actions.forEach(act => { if (Array.isArray(act.targets)) targets.push(...act.targets); });

    for (const t of targets) {
      const other = byId.get(t);
      if (!other || other === a || pairedIds.has(other._id)) continue;
      if (classifyActions(other.actions) !== 'toggle') continue;

      const otherTargets = [];
      other.actions.forEach(act => { if (Array.isArray(act.targets)) otherTargets.push(...act.targets); });
      if (otherTargets.includes(a._id)) {
        pairs.push([a, other]);
        pairedIds.add(a._id);
        pairedIds.add(other._id);
        break;
      }
    }
  });

  return { pairs, pairedIds };
}


/**
 * rect（ページ画像ピクセル座標系の絶対値） を、ページ幅・高さに対する%指定のstyle文字列に変換する。
 * @param {[number,number,number,number]} rect - [x, y, width, height]
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @returns {string} "left:..%;top:..%;width:..%;height:..%;" 形式のstyle文字列
 */
function rectToStyle(rect, pageWidth, pageHeight) {
  const [x, y, w, h] = rect;
  const leftPct   = (x / pageWidth)  * 100;
  const topPct    = (y / pageHeight) * 100;
  const widthPct  = (w / pageWidth)  * 100;
  const heightPct = (h / pageHeight) * 100;
  return `left:${leftPct}%;top:${topPct}%;width:${widthPct}%;height:${heightPct}%;`;
}


/**
 * ページ内のannots[]を、ContentsBuilderの既知アノテーション（annotations.json互換オブジェクト）、
 * 付箋Hide/Showペア（togglePairs。位置・グループ編集および書き出しに対応）、
 * 編集不可アノテーション（未知パターンのみ。書き出し時は無変更のまま書き戻す）
 * とに分類・変換する。
 * @param {Object} pageJson - p####.json のパース済みオブジェクト
 * @param {number} pageNum - 1始まりのページ番号
 * @returns {{ known: Array<Object>, unknown: Array<Object>, togglePairs: Array<Object>, maxId: number }}
 */
function convertPageAnnotations(pageJson, pageNum) {
  const annots = (pageJson.annots || []).map(a => {
    const idMatch = (a.filename || '').match(/(\d+)\.\w+$/);
    return { ...a, _id: idMatch ? parseInt(idMatch[1], 10) : null };
  });

  const pageWidth  = pageJson.width;
  const pageHeight = pageJson.height;

  const { pairs, pairedIds } = findTogglePairs(annots);

  const known  = [];
  const unknown = [];
  const togglePairs = [];
  let maxId = 0;

  pairs.forEach(([a, b]) => {
    // hidden:false（初期表示）側を閉状態、hidden:true側を開状態とする
    const closed = a.hidden ? b : a;
    const open   = a.hidden ? a : b;
    maxId = Math.max(maxId, closed._id || 0, open._id || 0);
    togglePairs.push({
      pageNum,
      closedId:   closed._id,
      openId:     open._id,
      closedFile: closed.filename,
      openFile:   open.filename,
      rect:       closed.rect,
      pageWidth,
      pageHeight,
    });
    // 位置・グループ編集後に書き出し可能な既知アノテーションとして扱うため、
    // 未知アノテーションへは登録しない（convertStickyGroupToLibroAnnotsで再生成する）
  });

  annots.forEach(a => {
    if (a._id != null) maxId = Math.max(maxId, a._id);
    if (a._id != null && pairedIds.has(a._id)) return; // ペア済みは処理済み

    const kind = classifyActions(a.actions);
    const style = rectToStyle(a.rect, pageWidth, pageHeight);

    if (kind === 'pagelink') {
      // LIBRO側のJSONには表示タイプ・塗り色に相当するプロパティが存在せず、
      // 実データのページリンクは基本的に紙面（ページ画像）上の見た目をそのまま活かす
      // 透明ホットスポットであるため、インポート時は「紙面カラー」型をデフォルトとする。
      const goto = a.actions.find(ac => ac.action === 'GoTo');
      known.push({
        className: 'ann-object dt-page-color',
        type: 'pagelink',
        id: a._id,
        page: pageNum,
        style,
        savedData: JSON.stringify({ annDisplayType: 'page-color', annTarget: goto?.page ?? '' }),
      });
    } else if (kind === 'uri') {
      const uri = a.actions.find(ac => ac.action === 'URI');
      known.push({
        className: 'ann-object',
        type: 'externallink',
        id: a._id,
        page: pageNum,
        style: style + `background:${ANNOTATION_TYPE_CONFIG.externallink.color};`,
        savedData: JSON.stringify({ annDisplayType: 'marker', annUrl: uri?.uri || '' }),
      });
    } else if (kind === 'launch') {
      const launch = a.actions.find(ac => ac.action === 'Launch');
      const baseName = (launch?.filename || '').split('/').pop().replace(/\.mp3$/i, '');
      known.push({
        className: 'ann-object',
        type: 'audio',
        id: a._id,
        page: pageNum,
        style: style + `background:${ANNOTATION_TYPE_CONFIG.audio.color};`,
        savedData: JSON.stringify({ annDisplayType: 'marker', annFile: baseName, annPlayMode: '0' }),
      });
    } else {
      // 既知パターンに一致しない：編集不可・削除しない未知アノテーションとして保持のみ行う
      unknown.push({ pageNum, raw: a });
    }
  });

  return { known, unknown, togglePairs, maxId };
}


/**
 * LIBRO bookフォルダ形式のZIPを解析し、ページ画像・アノテーションデータを取り出す。
 * - ページ画像（p####-1.jpg等）・音声（sounds/*.mp3）はPbve2000復号する
 * - annots/*.png は平文のためそのままBlobURL化する
 * - annots[] は既知4パターン（GoTo+FitPage / URI / Launch / Hide+Show）を判定し、
 *   既知のものはContentsBuilderの内部データ形式へ変換、それ以外は未知アノテーションとして保持のみ行う
 * @param {JSZip} zip - JSZip.loadAsync 済みのZIPオブジェクト
 * @returns {Promise<{
 *   pages: Array<{pageNum:number, width:number, height:number, imageUrl:string, jsonPath:string}>,
 *   knownAnnotations: Array<Object>,
 *   togglePairs: Array<Object>,
 *   unknownAnnotations: Array<Object>,
 *   maxAnnotId: number,
 *   baseDir: string,
 *   indexJson: Object,
 * }>}
 */
export async function parseLibroBookZip(zip) {
  const indexEntry = findZipEntry(zip, 'index.json');
  if (!indexEntry) throw new Error('index.jsonが見つかりません');

  const fullIndexPath = indexEntry.name;
  const baseDir = fullIndexPath.slice(0, fullIndexPath.length - 'index.json'.length);

  const indexJson = JSON.parse(await indexEntry.async('string'));

  const pages = [];
  const knownAnnotations = [];
  const togglePairsRaw = [];
  const unknownAnnotations = [];
  let maxAnnotId = 0;

  const pageMetaList = indexJson.pages || [];
  for (let i = 0; i < pageMetaList.length; i++) {
    const pageMeta = pageMetaList[i];
    const pageNum = i + 1;

    // ページJSON（アノテーション定義を含む）を読み込む
    let pageJson = {};
    if (pageMeta.json) {
      const pageJsonEntry = zip.file(baseDir + pageMeta.json);
      if (pageJsonEntry) pageJson = JSON.parse(await pageJsonEntry.async('string'));
    }
    const pageWidth  = pageJson.width  || pageMeta.width;
    const pageHeight = pageJson.height || pageMeta.height;

    // ページ画像（最高解像度=1/1）をPbve2000復号してBlobURL化
    const imageRel = pageMeta.images?.['1/1'] || Object.values(pageMeta.images || {})[0];
    let imageUrl = '';
    if (imageRel) {
      const imgEntry = zip.file(baseDir + imageRel);
      if (imgEntry) {
        const buf = await imgEntry.async('arraybuffer');
        const decoded = decodePbve2000(buf);
        imageUrl = URL.createObjectURL(new Blob([decoded], { type: 'image/jpeg' }));
      }
    }
    pages.push({ pageNum, width: pageWidth, height: pageHeight, imageUrl, jsonPath: pageMeta.json });

    // 参照されている音声ファイルをPbve2000復号してmediaBlobsへキャッシュ
    // （resolveMediaSrc は "ファイル名.mp3" 形式のキーを参照するため、拡張子込みで格納する）
    for (const annot of (pageJson.annots || [])) {
      for (const action of (annot.actions || [])) {
        if (action.action === 'Launch' && action.filename) {
          const baseName = action.filename.split('/').pop();
          if (mediaBlobs[baseName]) continue;
          const entry = zip.file(baseDir + action.filename);
          if (!entry) continue;
          const buf = await entry.async('arraybuffer');
          const decoded = decodePbve2000(buf);
          mediaBlobs[baseName] = URL.createObjectURL(new Blob([decoded], { type: 'audio/mpeg' }));
        }
      }
    }

    // annots[] を既知/未知に分類・変換
    const { known, unknown, togglePairs, maxId } = convertPageAnnotations(pageJson, pageNum);
    knownAnnotations.push(...known);
    unknownAnnotations.push(...unknown);
    togglePairsRaw.push(...togglePairs.map(tp => ({ ...tp, baseDir })));
    maxAnnotId = Math.max(maxAnnotId, maxId);
  }

  // Hide/Showペア用のannots画像（平文PNG）をBlobURL化する
  const togglePairs = [];
  for (const tp of togglePairsRaw) {
    const closedEntry = zip.file(tp.baseDir + tp.closedFile);
    const openEntry   = zip.file(tp.baseDir + tp.openFile);
    if (!closedEntry || !openEntry) continue;
    const closedBlob = await closedEntry.async('blob');
    const openBlob   = await openEntry.async('blob');
    togglePairs.push({
      pageNum: tp.pageNum,
      rect: tp.rect,
      pageWidth: tp.pageWidth,
      pageHeight: tp.pageHeight,
      closedId:   tp.closedId,
      openId:     tp.openId,
      closedFile: tp.closedFile,
      openFile:   tp.openFile,
      closedImageUrl: URL.createObjectURL(new Blob([closedBlob], { type: 'image/png' })),
      openImageUrl:   URL.createObjectURL(new Blob([openBlob],   { type: 'image/png' })),
    });
  }

  return { pages, knownAnnotations, togglePairs, unknownAnnotations, maxAnnotId, baseDir, indexJson };
}


/**
 * Hide/Showペア（付箋・答え表示等の開閉）を、位置移動・リサイズ・グループ化・書き出しに対応した
 * インタラクティブな `.sticky-note.libro-toggle` 要素として#pageLeftに描画する。
 * 色（見た目）は元のPNG画像そのままとし変更不可（openAnnotationSettingsDialog/confirmAnnotationが
 * dataset.libroToggle を見て塗り色UIを無効化する）。クリック時の開閉・選択・グループ挙動は
 * 通常の付箋と同じ addStickyClickHandler をそのまま再利用する。
 * @param {Array<Object>} togglePairs - parseLibroBookZip が返す togglePairs
 */
export function renderTogglePairs(togglePairs) {
  const page = document.getElementById('pageLeft');
  const pageRect = page.getBoundingClientRect();

  togglePairs.forEach(tp => {
    const [x, y, w, h] = tp.rect;
    // 通常の付箋・アノテーションと同じ px 座標系（scaleAnnotations / makeDraggable / makeResizable が
    // 前提とする形式）に変換して配置する
    const leftPx   = (x / tp.pageWidth)  * pageRect.width;
    const topPx    = (y / tp.pageHeight) * pageRect.height;
    const widthPx  = (w / tp.pageWidth)  * pageRect.width;
    const heightPx = (h / tp.pageHeight) * pageRect.height;

    const wrap = document.createElement('div');
    wrap.className = 'sticky-note libro-toggle state-visible';
    wrap.dataset.type        = 'sticky';
    wrap.dataset.id          = tp.closedId;
    wrap.dataset.libroToggle = '1';
    wrap.dataset.closedId    = tp.closedId;
    wrap.dataset.openId      = tp.openId;
    wrap.dataset.closedFile  = tp.closedFile;
    wrap.dataset.openFile    = tp.openFile;
    wrap.dataset.page        = tp.pageNum;
    wrap.style.cssText = `left:${leftPx}px; top:${topPx}px; width:${widthPx}px; height:${heightPx}px;`;

    const closedImg = document.createElement('img');
    closedImg.className = 'libro-toggle-closed';
    closedImg.src = tp.closedImageUrl;

    const openImg = document.createElement('img');
    openImg.className = 'libro-toggle-open';
    openImg.src = tp.openImageUrl;

    wrap.appendChild(closedImg);
    wrap.appendChild(openImg);

    addStickyClickHandler(wrap);
    makeDraggable(wrap);
    makeResizable(wrap);

    page.appendChild(wrap);
  });
}


/* ============================================================
   LIBRO bookフォルダ形式への書き出し（エクスポート）。
   ページリンク／外部リンク／音声再生（GoTo+FitPage / URI / Launch）に加え、
   付箋（Hide/Show）の書き出しにも対応する。
   付箋は「既存付箋（LIBRO由来、色変更不可・画像そのまま再利用）」と
   「新規付箋（ContentsBuilder作成、色に応じてPNGを新規ラスタライズ）」を区別して扱う。
============================================================ */

/**
 * アノテーションIDから "annots/xxxx.png" 形式のファイル名を組み立てる。
 * 実データ調査により、IDは4桁でゼロ埋めされていることを確認済み（4桁を超える場合はそのまま）。
 * @param {number} id
 * @returns {string}
 */
function libroMarkerFilename(id) {
  return `annots/${String(id).padStart(4, '0')}.png`;
}


/**
 * "left:x%;top:y%;width:w%;height:h%;" 形式のstyle文字列を、
 * ページ画像ピクセル座標系の rect（rectToStyleの逆変換）に変換する。
 * @param {string} style
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @returns {[number,number,number,number]} [x, y, width, height]
 */
function styleToRect(style, pageWidth, pageHeight) {
  const pct = (name) => {
    const m = (style || '').match(new RegExp(`${name}:\\s*([\\d.]+)%`));
    return m ? parseFloat(m[1]) : 0;
  };
  return [
    Math.round((pct('left')   / 100) * pageWidth),
    Math.round((pct('top')    / 100) * pageHeight),
    Math.round((pct('width')  / 100) * pageWidth),
    Math.round((pct('height') / 100) * pageHeight),
  ];
}


/**
 * アノテーション種別のマーカー画像をCanvasでラスタライズし、PNGバイト列を生成する。
 * LIBROは種別を問わずannots[]の全要素がfilenameでマーカーPNGを参照するため、
 * ContentsBuilder上で新規作成した（LIBRO由来でない）アノテーションの書き出し時に必要となる。
 * @param {string} type - pagelink / externallink / audio
 * @param {number} pxWidth
 * @param {number} pxHeight
 * @returns {Promise<Uint8Array>}
 */
export async function rasterizeMarkerPng(type, pxWidth, pxHeight) {
  const cfg = ANNOTATION_TYPE_CONFIG[type] || {};
  const w = Math.max(1, Math.min(1200, pxWidth));
  const h = Math.max(1, Math.min(1200, pxHeight));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = cfg.color || 'rgba(120,120,120,0.6)';
  ctx.fillRect(0, 0, w, h);

  const pathData = (cfg.iconSvg || '').match(/d="([^"]+)"/)?.[1];
  if (pathData) {
    const iconSize = Math.min(w, h) * 0.6;
    const scale = iconSize / 24; // アイコンは24x24 viewBox基準
    ctx.save();
    ctx.translate((w - iconSize) / 2, (h - iconSize) / 2);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fill(new Path2D(pathData));
    ctx.restore();
  }

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}


/**
 * 付箋の「閉」（解答を隠す状態）PNGを、指定色で塗った矩形としてラスタライズする。
 * @param {string} color - CSS色（STICKY_COLOR_MAPの値）
 * @param {number} pxWidth
 * @param {number} pxHeight
 * @returns {Promise<Uint8Array>}
 */
export async function rasterizeStickyClosedPng(color, pxWidth, pxHeight) {
  const w = Math.max(1, Math.min(1200, pxWidth));
  const h = Math.max(1, Math.min(1200, pxHeight));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color || '#4488cc';
  ctx.fillRect(0, 0, w, h);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}


/**
 * 付箋の「開」（解答が見えている状態）PNGを、完全透明の矩形としてラスタライズする。
 * ContentsBuilderで新規作成した付箋には「開」側の元画像が存在しないため、
 * 下地のページがそのまま見える状態を透明PNGで再現する。
 * @param {number} pxWidth
 * @param {number} pxHeight
 * @returns {Promise<Uint8Array>}
 */
export async function rasterizeStickyOpenPng(pxWidth, pxHeight) {
  const w = Math.max(1, Math.min(1200, pxWidth));
  const h = Math.max(1, Math.min(1200, pxHeight));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}


/**
 * 1グループ（グループ化されていない単独付箋の場合はメンバー1件）分の付箋を、
 * LIBROの annots[] 要素（メンバーごとに「閉」「開」2件）に変換する。
 * グループ内のどのメンバーをクリックしてもグループ全体が同時にトグルするよう、
 * 全メンバーの「閉」id・「開」idをそれぞれの Hide/Show targets に列挙する
 * （1メンバーのみの場合、実データで確認済みの1:1相互参照ペアと同一構造になる）。
 *
 * 「開」（解答が見えている状態）の元画像には、LIBRO由来の場合は解答等の内容が
 * 描き込まれている可能性があり再生成できないため、closedMode/openModeを独立させ、
 * 既存付箋の色だけを変更した場合は「開」画像を無変更のまま維持できるようにする。
 * @param {Array<{closedId:number, openId:number, closedFile?:string, openFile?:string, style:string,
 *   closedMode:'reuse'|'color', openMode:'reuse'|'transparent', color?:string}>} members
 *   - style: 現在のDOM位置から算出した "left:x%;top:y%;width:w%;height:h%;" 形式
 *   - closedMode/openMode='reuse': closedFile/openFileの画像をそのまま再利用（新規PNG生成なし）
 *   - closedMode='color': colorをもとに新規PNGを生成（「閉」のみ）
 *   - openMode='transparent': 完全透明PNGを新規生成（「開」のみ。新規付箋のみで発生）
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @param {JSZip} zip
 * @param {string} baseDir
 * @returns {Promise<{annotJsons:Array<Object>, newPngWrites:Array<{path:string, bytes:Uint8Array}>}>}
 */
export async function convertStickyGroupToLibroAnnots(members, pageWidth, pageHeight, zip, baseDir) {
  const closedIds = members.map(m => m.closedId);
  const openIds   = members.map(m => m.openId);

  const annotJsons = [];
  const newPngWrites = [];

  for (const m of members) {
    const rect = styleToRect(m.style, pageWidth, pageHeight);
    const closedFile = m.closedFile || libroMarkerFilename(m.closedId);
    const openFile   = m.openFile   || libroMarkerFilename(m.openId);

    if (m.closedMode === 'color') {
      const closedBytes = await rasterizeStickyClosedPng(m.color, rect[2], rect[3]);
      newPngWrites.push({ path: baseDir + closedFile, bytes: closedBytes });
    }
    if (m.openMode === 'transparent') {
      const openBytes = await rasterizeStickyOpenPng(rect[2], rect[3]);
      newPngWrites.push({ path: baseDir + openFile, bytes: openBytes });
    }

    annotJsons.push({
      filename: closedFile,
      rect,
      actions: [
        { action: 'Hide', targets: closedIds },
        { action: 'Show', targets: openIds },
      ],
    });
    annotJsons.push({
      filename: openFile,
      rect,
      hidden: true,
      actions: [
        { action: 'Hide', targets: openIds },
        { action: 'Show', targets: closedIds },
      ],
    });
  }

  return { annotJsons, newPngWrites };
}


/**
 * ContentsBuilderのアノテーションオブジェクトをLIBROの annots[] 要素に変換する
 * （convertPageAnnotationsの逆変換）。対応する既存マーカーPNGがzip内に無い場合は
 * 新規マーカーPNGを生成する。
 * @param {{id:number, type:string, style:string, savedData:string}} domData
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @param {JSZip} zip - 書き出し先zip（既存マーカーPNGの有無確認に使用）
 * @param {string} baseDir
 * @returns {Promise<{annotJson:Object, newPngBytes:Uint8Array|null}|null>} 対応外の種別は null
 */
export async function convertAnnotationToLibroAnnot(domData, pageWidth, pageHeight, zip, baseDir) {
  const rect = styleToRect(domData.style, pageWidth, pageHeight);
  const filename = libroMarkerFilename(domData.id);

  let sd = {};
  try { sd = JSON.parse(domData.savedData || '{}'); } catch (_) {}

  let actions;
  if (domData.type === 'pagelink') {
    actions = [{ action: 'GoTo', page: Number(sd.annTarget) || 1 }, { action: 'FitPage' }];
  } else if (domData.type === 'externallink') {
    actions = [{ action: 'URI', uri: sd.annUrl || '' }];
  } else if (domData.type === 'audio') {
    actions = [{ action: 'Launch', filename: `sounds/${(sd.annFile || '').trim()}.mp3` }];
  } else {
    return null; // LIBROに対応するactionが無い種別
  }

  let newPngBytes = null;
  if (!zip.file(baseDir + filename)) {
    newPngBytes = await rasterizeMarkerPng(domData.type, rect[2], rect[3]);
  }

  return { annotJson: { filename, rect, actions }, newPngBytes };
}


/**
 * ContentsBuilderの現在の状態からLIBRO book zipを書き出す。
 * 保持している元zip（インスタンスをそのまま変更）に対し、annots[]が変わったページの
 * p####.jsonと、新規マーカーPNG・新規音声（Pbve2000暗号化）のみを上書き・追加する。
 * ページ画像・既存のannots PNG・既存の音声・index.jsonは一切書き換えない。
 * @param {{zip:JSZip, baseDir:string, indexJson:Object}} libroBook - state.libroBook
 * @param {Array<{id:number, page:number, type:string, style:string, savedData:string}>} domAnnotations
 *   - LIBROに変換可能な種別（pagelink/externallink/audio）のDOM由来アノテーションデータ
 * @param {Array<{pageNum:number, raw:Object}>} passthroughAnnotations - state.libroUnknownAnnotations
 *   （真に未知のアノテーションのみ。無変更のまま書き戻す）
 * @param {Array<{pageNum:number, members:Array<Object>}>} [domStickyGroups] - 付箋のグループ一覧
 *   （groupId未設定の付箋は単独1件のグループとして渡す。members仕様は convertStickyGroupToLibroAnnots 参照）
 * @returns {Promise<JSZip>}
 */
export async function buildLibroBookExport(libroBook, domAnnotations, passthroughAnnotations, domStickyGroups = []) {
  const { zip, baseDir, indexJson } = libroBook;
  const pageMetaList = indexJson.pages || [];

  const byPage = new Map();
  domAnnotations.forEach(a => {
    if (!byPage.has(a.page)) byPage.set(a.page, []);
    byPage.get(a.page).push(a);
  });
  const passthroughByPage = new Map();
  passthroughAnnotations.forEach(({ pageNum, raw }) => {
    if (!passthroughByPage.has(pageNum)) passthroughByPage.set(pageNum, []);
    passthroughByPage.get(pageNum).push(raw);
  });
  const stickyGroupsByPage = new Map();
  domStickyGroups.forEach(g => {
    if (!stickyGroupsByPage.has(g.pageNum)) stickyGroupsByPage.set(g.pageNum, []);
    stickyGroupsByPage.get(g.pageNum).push(g);
  });

  for (let i = 0; i < pageMetaList.length; i++) {
    const pageMeta = pageMetaList[i];
    const pageNum = i + 1;
    if (!pageMeta.json) continue;

    const pageJsonPath = baseDir + pageMeta.json;
    const pageJsonEntry = zip.file(pageJsonPath);
    if (!pageJsonEntry) continue;

    const pageJson = JSON.parse(await pageJsonEntry.async('string'));
    const pageWidth  = pageJson.width;
    const pageHeight = pageJson.height;

    // 未知アノテーションの生データは無変更のまま書き戻す（内部管理用の_idは除去）
    const passthrough = (passthroughByPage.get(pageNum) || []).map(({ _id, ...clean }) => clean);

    const converted = [];
    for (const domData of (byPage.get(pageNum) || [])) {
      const result = await convertAnnotationToLibroAnnot(domData, pageWidth, pageHeight, zip, baseDir);
      if (!result) continue;
      if (result.newPngBytes) zip.file(baseDir + result.annotJson.filename, result.newPngBytes);
      converted.push(result.annotJson);
    }

    const stickyAnnots = [];
    for (const group of (stickyGroupsByPage.get(pageNum) || [])) {
      const { annotJsons, newPngWrites } = await convertStickyGroupToLibroAnnots(group.members, pageWidth, pageHeight, zip, baseDir);
      newPngWrites.forEach(({ path, bytes }) => zip.file(path, bytes));
      stickyAnnots.push(...annotJsons);
    }

    pageJson.annots = [...passthrough, ...converted, ...stickyAnnots];

    const usedIds = pageJson.annots
      .map(a => { const m = (a.filename || '').match(/(\d+)\.\w+$/); return m ? parseInt(m[1], 10) : null; })
      .filter(id => id != null);
    if (usedIds.length) pageJson['annot-range'] = [Math.min(...usedIds), Math.max(...usedIds)];

    zip.file(pageJsonPath, JSON.stringify(pageJson));
  }

  // 新規追加された音声ファイル（元zipにまだ存在しないもの）のみPbve2000暗号化して追加
  const referencedAudio = new Set();
  domAnnotations.forEach(a => {
    if (a.type !== 'audio') return;
    try {
      const fileName = (JSON.parse(a.savedData || '{}').annFile || '').trim();
      if (fileName) referencedAudio.add(`${fileName}.mp3`);
    } catch (_) {}
  });
  for (const key of referencedAudio) {
    const soundPath = baseDir + 'sounds/' + key;
    if (zip.file(soundPath)) continue; // 既存音声は無変更
    const blobUrl = mediaBlobs[key];
    if (!blobUrl) continue;
    const res = await fetch(blobUrl);
    const buf = new Uint8Array(await res.arrayBuffer());
    zip.file(soundPath, encodePbve2000(buf));
  }

  return zip;
}
