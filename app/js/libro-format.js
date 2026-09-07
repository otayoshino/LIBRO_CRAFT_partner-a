import { mediaBlobs, state } from './state.js';
import { ANNOTATION_TYPE_CONFIG, ANN_COLOR_OPTIONS, BTN_COLOR_OPTIONS, DAIMON_PRESSED_COLOR, ICON_COLOR_OPTIONS } from './config.js';
import { addStickyClickHandler } from './sticky.js';
import { getPageBaseSize, makeDraggable, makeResizable } from './annotation-interaction.js';
import { addDaimonClickHandler, addKotaeClickHandler, makeDaimonResizable, renderButtonVisual } from './buttons.js';

/* ============================================================
   LIBRO bookフォルダ形式（index.json / p####.json / 暗号化ページ画像 /
   annots / sounds）の読込・解析。
   仕様の詳細は docs/libro_integration_計画書.md と
   .claude/skills/libro-integration/SKILL.md を参照。
============================================================ */

/** Pbve2000形式のヘッダー長（"Pbve2000" の8バイト） */
const PBVE_HEADER_LEN = 8;

/**
 * CRAFT独自の判別用メタデータのキー名（docs/libro_integration_計画書.md 4-3b参照）。
 * Libro+側の公式スキーマとの衝突リスクを避けるため、衝突しうるキーをこの1個に限定する。
 */
const CRAFT_META_KEY = 'libro-craft-meta';

/**
 * libro-craft-meta のスキーマバージョン（互換性が必要な変更をする際に上げる）。
 * 2: book全体マーカーへ settings（環境設定のbook単位保存）を追加。
 */
const CRAFT_META_SCHEMA_VERSION = 2;

/**
 * libro-craft-metaのうち「Hide/Showトグルのペア（role:'closed'|'open'）」として
 * 復元する種別。付箋・答ボタン・大問ボタン・証明ボタンが対象。
 *
 * known系（pagelink/uri/launch由来）にもlibro-craft-metaを付与するが、そちらは
 * actions構成のみで種別が一意判定できるため role を持たせず、表示形式（display-type）・
 * 塗り色・ラベルの復元にのみ使う（applyCraftMetaDisplayType 参照）。roleが無いメタは
 * extractCraftMetaTogglePairs 側でトグルペアとして扱われない。
 *
 * また大問／答ボタンのメタには見た目（btn-preset / btn-scale / btn-label / image-file）も
 * 記録し、再インポート時にネイティブボタンとして完全に復元できるようにしている
 * （convertDaimonButtonToLibroAnnots / renderTogglePairs 参照）。
 * メタの有無は「CRAFT製かどうか」の判別にも使い、メタなし（他ツール由来）は
 * 元データの見た目を壊さないようリサイズ・見た目編集を制限する。
 */
const CRAFT_META_TOGGLE_TYPES = new Set(['sticky', 'kotae', 'daimon', 'shomei']);

/**
 * Pbve2000形式のデータを復号する。
 * 先頭8バイト（"Pbve2000"ヘッダー）を除去し、残りを 0xCC でXORすると元データが復元される。
 * @param {ArrayBuffer} buffer - 暗号化されたバイナリデータ
 * @returns {Uint8Array} 復号済みデータ
 */
function decodePbve2000(buffer) {
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
function encodePbve2000(data) {
  const body = data instanceof Uint8Array ? data : new Uint8Array(data);
  const header = new TextEncoder().encode('Pbve2000');
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  for (let i = 0; i < body.length; i++) out[header.length + i] = body[i] ^ 0xCC;
  return out;
}


/**
 * バイナリの先頭が "Pbve2000" ヘッダーで始まっているかどうかを判定する。
 * 別オーサリングツール由来のbookでは、本来Pbve2000暗号化される音声・アノテーション画像が
 * 平文のまま格納されている場合があるため、復号前にこの判定を行い平文データの破壊を防ぐ。
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {boolean}
 */
function isPbve2000Encoded(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < PBVE_HEADER_LEN) return false;
  return new TextDecoder().decode(bytes.subarray(0, PBVE_HEADER_LEN)) === 'Pbve2000';
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
 * LIBRO book形式のZIPを読み込んでよいかを判定する。
 * ページ画像の復号・BlobURL化を伴わない軽量パス（JSONの読み出しのみ）で判定するため、
 * 拒否するbookで復号コストを払わずに済む。
 *
 * 判定ルール：
 *   1. index.json が無い                                   → 拒否（'no-index'）
 *   2. index.json が壊れている                             → 拒否（'broken-index'）
 *   3. index.json.configs['libro-craft-meta'] がある       → 許可（'craft-book'）
 *      CRAFTが書き出したbookは、LIBRO+由来のpassthroughアノテーションを含んでいても
 *      再読込できる必要があるため無条件で許可する。
 *   4. libro-craft-meta を持たない annot が1件でもある     → 拒否（'libro-annots'）
 *   5. それ以外（アノテーション0件のLIBRO+生book等）       → 許可（'ok'）
 *
 * annots[] は p####.json 側と index.json.pages[] 側の双方に置かれうる（実bookの構造）ため、
 * 両方を走査する。
 * @param {JSZip} zip - JSZip.loadAsync 済みのZIPオブジェクト
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
export async function checkLibroBookLoadable(zip) {
  const indexEntry = findZipEntry(zip, 'index.json');
  if (!indexEntry) return { ok: false, reason: 'no-index' };

  let indexJson;
  try {
    indexJson = JSON.parse(await indexEntry.async('string'));
  } catch (_) {
    return { ok: false, reason: 'broken-index' };
  }

  if (indexJson.configs && indexJson.configs[CRAFT_META_KEY]) {
    return { ok: true, reason: 'craft-book' };
  }

  const fullIndexPath = indexEntry.name;
  const baseDir = fullIndexPath.slice(0, fullIndexPath.length - 'index.json'.length);

  const hasLibroAnnot = (annots) =>
    Array.isArray(annots) && annots.some(a => !a || !a[CRAFT_META_KEY]);

  const pageMetaList = indexJson.pages || [];
  for (let i = 0; i < pageMetaList.length; i++) {
    const pageMeta = pageMetaList[i];
    if (!pageMeta) continue;

    // index.json 側のミラー
    if (hasLibroAnnot(pageMeta.annots)) return { ok: false, reason: 'libro-annots' };

    // p####.json 側
    if (!pageMeta.json) continue;
    const pageJsonEntry = zip.file(baseDir + pageMeta.json);
    if (!pageJsonEntry) continue;
    let pageJson;
    try {
      pageJson = JSON.parse(await pageJsonEntry.async('string'));
    } catch (_) {
      continue;
    }
    if (hasLibroAnnot(pageJson.annots)) return { ok: false, reason: 'libro-annots' };
  }

  return { ok: true, reason: 'ok' };
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
 * URI actionの `uri` 文字列が、LIBROビューア側でeval実行される擬似関数呼び出し
 * （例: `toAppendix("folder",1)` / `toMovie("code","a==","b==")`）かどうかを判定し、
 * 関数名と引数部分（丸括弧内の生文字列）に分解する。
 * 実URL（`https://...`）や解釈不能な文字列は null を返す。
 * @param {string} uri
 * @returns {{fn:string, args:string}|null}
 */
function parseLibroLinkFunction(uri) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/.exec((uri || '').trim());
  return m ? { fn: m[1], args: m[2] } : null;
}


/**
 * `toAppendix("folder",1)` 形式の引数文字列を単純にカンマ分割し、前後の引用符を外す。
 * 実データでは引数内カンマは未確認のため、単純分割のみ対応する。
 * @param {string} argsStr
 * @returns {string[]}
 */
function splitLibroCallArgs(argsStr) {
  return (argsStr || '').split(',').map(s => {
    const t = s.trim();
    const m = /^["'](.*)["']$/.exec(t);
    return m ? m[1] : t;
  });
}


/**
 * toMovie("ディレクトリ","企業ID","難読化ID",表示モード) の引数文字列（丸括弧内）を
 * J-stream指定の値 {dir, corpId, videoId, showMode} へ変換する。
 * 企業ID・難読化IDはLIBRO+ビューア（J-Stream）が要求する形式の文字列を
 * そのまま保持する値であり、CRAFT側でのエンコード・デコードは行わない
 * （実データでは値自体がbase64風の見た目になるが、CRAFTから見れば不透明な文字列）。
 *
 * 第4引数（表示モード）は数値・引用符なしで、0=ページ内（モーダル）／1=別タブ
 * （LIBRO+実装確認済み、2026-07-24）。省略時（引数3個）は '0' 扱いとする。
 * toMovieBNR、引数が3個・4個以外の場合は null を返す（呼び出し側で内部ファイル指定
 * または生文字列保持へフォールバックする）。
 * @param {string} fn   - 関数名（'toMovie' / 'toMovieBNR'）
 * @param {string} args - 丸括弧内の生文字列
 * @returns {{dir:string, corpId:string, videoId:string, showMode:string}|null}
 */
function parseJstreamArgs(fn, args) {
  if (fn !== 'toMovie') return null;
  const parts = splitLibroCallArgs(args);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const showMode = parts.length === 4 ? (parts[3] || '0') : '0';
  return { dir: parts[0], corpId: parts[1], videoId: parts[2], showMode };
}


/**
 * savedData のJ-stream指定（annJstreamDir / annJstreamCorpId / annJstreamVideoId / annShowMode）を
 * toMovie の引数文字列（丸括弧内）へ変換する。企業ID・難読化IDは入力値をそのまま
 * 書き出す（CRAFT側でのエンコードは行わない。フィールドの値＝URIに書かれる値）。
 *
 * 第4引数（表示モード）は toMovieBNR と同じ「数値・引用符なし」形式で書き出す
 * （0=ページ内（モーダル）／1=別タブ、LIBRO+実装確認済み、2026-07-24）。
 * @param {object} sd - アノテーションのsavedData（JSON.parse済み）
 * @returns {string}
 */
function buildJstreamArgs(sd) {
  const dir      = (sd.annJstreamDir     || '').trim();
  const corpId   = (sd.annJstreamCorpId  || '').trim();
  const videoId  = (sd.annJstreamVideoId || '').trim();
  const showMode = sd.annShowMode || '0';
  return `"${dir}","${corpId}","${videoId}",${showMode}`;
}


/**
 * 動画アノテーションの入力方式（annVideoSrc）を解決する。
 * '0'＝内部ファイル／'1'＝外部タグ／'2'＝J-stream。
 *
 * 2026-07-21〜2026-07-23のUI不具合により、CRAFT上で新規作成したJ-stream動画の
 * savedDataには annVideoSrc キー自体が入っていない（hidden inputがフォームに
 * 追加されていなかったため。annotation-dialog.js側は修正済み）。この欠落データを
 * '0'（内部ファイル）と誤判定すると書き出し時にアノテーションごと消えるため、
 * J-stream入力欄のいずれかが存在すれば '2' とみなす。
 * どれも無い場合のみ従来どおり '0' へフォールバックする。
 * @param {object} sd - アノテーションのsavedData（JSON.parse済み）
 * @returns {'0'|'1'|'2'}
 */
export function resolveVideoSrc(sd) {
  if (sd.annVideoSrc === '0' || sd.annVideoSrc === '1' || sd.annVideoSrc === '2') return sd.annVideoSrc;
  if (sd.annJstreamDir !== undefined || sd.annJstreamCorpId !== undefined || sd.annJstreamVideoId !== undefined) return '2';
  return '0';
}


/**
 * actions[] 内の全targetsを1つの配列にまとめる（Hide/Show問わず全て平坦化する）。
 * @param {Array<Object>} actions
 * @returns {Array<number>}
 */
function flattenTargets(actions) {
  const out = [];
  (actions || []).forEach(act => { if (Array.isArray(act.targets)) out.push(...act.targets); });
  return out;
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

    const targets = flattenTargets(a.actions);

    for (const t of targets) {
      const other = byId.get(t);
      if (!other || other === a || pairedIds.has(other._id)) continue;
      if (classifyActions(other.actions) !== 'toggle') continue;

      const otherTargets = flattenTargets(other.actions);
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
 * annots[] 内の `libro-craft-meta` を持つ要素から、Hide/Showトグルペアをグループ単位で復元する。
 * CRAFTが書き出したbookのみに存在するマーカーのため、構造ヒューリスティック（findTogglePairs/
 * detectDaimonGroup）より優先して採用する（曖昧さのない確実な判定）。
 *
 * 同一 `group-id` を持つ要素同士が1つの論理トグル単位（付箋グループ等）のメンバー一式であり、
 * その中でメンバーごとの closed/open の対応付けは `rect` の一致で復元する
 * （convertStickyGroupToLibroAnnotsはメンバーごとに同一rectでclosed/open両方を生成するため）。
 * @param {Array<Object>} annots - _id 付与済みのページ内annots配列
 * @returns {{ pairs: Array<{closed:Object, open:Object, groupId:string, type:string, meta:Object}>,
 *   consumedIds: Set<number> }} meta は closed 側のlibro-craft-meta本体（大問／答ボタンの
 *   見た目復元に使う。CRAFT製かどうかの判別にも使う）
 */
function extractCraftMetaTogglePairs(annots) {
  const byGroup = new Map(); // groupId -> { closed: Object[], open: Object[] }

  annots.forEach(a => {
    if (a._id == null) return;
    const meta = a[CRAFT_META_KEY];
    if (!meta || !CRAFT_META_TOGGLE_TYPES.has(meta.type)) return;
    if (meta.role !== 'closed' && meta.role !== 'open') return;
    const groupId = meta['group-id'];
    if (!groupId) return;
    if (!byGroup.has(groupId)) byGroup.set(groupId, { closed: [], open: [] });
    byGroup.get(groupId)[meta.role].push(a);
  });

  const pairs = [];
  const consumedIds = new Set();

  byGroup.forEach((bucket, groupId) => {
    const openPool = [...bucket.open];
    bucket.closed.forEach(closed => {
      const rectKey = JSON.stringify(closed.rect);
      const idx = openPool.findIndex(o => JSON.stringify(o.rect) === rectKey);
      if (idx === -1) return; // 対応するopenが見つからない場合はこのメンバーだけ復元を諦める
      const [open] = openPool.splice(idx, 1);
      pairs.push({ closed, open, groupId, type: closed[CRAFT_META_KEY].type, meta: closed[CRAFT_META_KEY] });
      consumedIds.add(closed._id);
      consumedIds.add(open._id);
    });
  });

  return { pairs, consumedIds };
}


/**
 * トグルペアが「大問ボタン」（押下で紐付く複数の他トグルペアを一括Hide/Showする）かどうかを判定する。
 * 実データ（p0004.json）で確認したパターン：actions が4つ（グループ一括Hide/Show 1組＋自己Hide/Show 1組）
 * で構成され、グループ側のtargetsが自分自身のペア以外の複数idを横断する。
 *
 * この形状はグループ付箋の一括開閉マスタートグル（p0016.json id4500⇄4512で実例確認）と構造的に同一だが、
 * 実データ比較の結果、真の大問ボタンは配下の各トグルペアが必ず1:1で完結するため、
 * グループ側Hide/Showそれぞれのtargets件数（自己/パートナーid除く）が一致する一方、
 * グループ付箋マスターは3+ノードの絡み合い等でこの件数が食い違うことを確認した。
 * これを追加の判別条件とする（件数が一致しない場合は誤判定を避けて安全側＝通常付箋に倒す）。
 * ただし絡み合いのない綺麗な1:1グループ付箋マスターは依然として区別不能な既知の限界が残る。
 * @param {Object} closed
 * @param {Object} open
 * @returns {{ isDaimon: boolean, groupIds: number[] }}
 */
function detectDaimonGroup(closed, open) {
  if (!Array.isArray(closed.actions) || closed.actions.length !== 4) return { isDaimon: false, groupIds: [] };
  if (!Array.isArray(open.actions)   || open.actions.length   !== 4) return { isDaimon: false, groupIds: [] };

  const hideActions = closed.actions.filter(act => act.action === 'Hide' && Array.isArray(act.targets));
  const showActions = closed.actions.filter(act => act.action === 'Show' && Array.isArray(act.targets));
  if (hideActions.length !== 2 || showActions.length !== 2) return { isDaimon: false, groupIds: [] };

  // 自己トグル用のHide/Showはtargetsが1件のみのため、要素数が多い方を「グループ側」とみなす
  const groupHideAction = hideActions[0].targets.length >= hideActions[1].targets.length ? hideActions[0] : hideActions[1];
  const groupShowAction = showActions[0].targets.length >= showActions[1].targets.length ? showActions[0] : showActions[1];

  const selfIds = new Set([closed._id, open._id]);
  const hideOthers = groupHideAction.targets.filter(id => !selfIds.has(id));
  const showOthers = groupShowAction.targets.filter(id => !selfIds.has(id));

  if (hideOthers.length !== showOthers.length) return { isDaimon: false, groupIds: [] };

  const groupIds = [...new Set([...hideOthers, ...showOthers])];
  return { isDaimon: groupIds.length >= 2, groupIds };
}


/**
 * 「拡張トグルネットワーク」（色分けボタン・ステップボタン等、1:1ペアやdetectDaimonGroupの
 * 形状に収まらない、3要素以上が絡むHide/Show構造）の閉包（connected component）を求める。
 * seedIdsから開始し、各要素のactions[].targetsに現れるidを再帰的に辿る。excludeIdsに含まれる
 * id（他の確立済みペア・他の大問ボタン・他のネットワークに既に取り込まれたid）は取り込まない
 * ことで、それらの領域への侵食を防ぐ。
 * @param {Array<number>} seedIds
 * @param {Map<number,Object>} byId
 * @param {Set<number>} excludeIds
 * @returns {Set<number>}
 */
function expandNetworkClosure(seedIds, byId, excludeIds) {
  const visited = new Set(seedIds);
  const queue = [...seedIds];
  while (queue.length) {
    const id = queue.shift();
    const annot = byId.get(id);
    if (!annot) continue;
    flattenTargets(annot.actions).forEach(t => {
      if (excludeIds.has(t) || visited.has(t)) return;
      visited.add(t);
      queue.push(t);
    });
  }
  return visited;
}


/**
 * 拡張トグルネットワークのメンバーidを、同一rectを共有する「スロット」単位にグルーピングする。
 * 色分けボタン・ステップボタンはいずれも「同一矩形に重なる1〜N枚の画像を切り替える」構造の
 * 繰り返しであるため、rectの一致でスロットを復元できる。
 * @param {Array<number>} memberIds
 * @param {Map<number,Object>} byId
 * @param {number} pageNum
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @param {string} networkId
 * @returns {{ pageNum:number, networkId:string, pageWidth:number, pageHeight:number,
 *   slots: Array<{rect:Array<number>, memberIds:Array<number>}>, members: Array<Object> }}
 */
function buildNetworkGroup(memberIds, byId, pageNum, pageWidth, pageHeight, networkId) {
  const members = memberIds.map(id => byId.get(id)).filter(Boolean);
  const slotMap = new Map(); // JSON化したrect -> スロット
  members.forEach(m => {
    const key = JSON.stringify(m.rect);
    if (!slotMap.has(key)) slotMap.set(key, { rect: m.rect, memberIds: [] });
    slotMap.get(key).memberIds.push(m._id);
  });
  return { pageNum, networkId, pageWidth, pageHeight, slots: [...slotMap.values()], members };
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
 * CRAFT自身が書き出したknown系アノテーション（annots[]要素にlibro-craft-metaを持つもの）の
 * 表示形式を、書き出し時のCRAFT上の見た目どおりに復元する。
 *
 * インポート時の既定処理（parseLibroBookZip末尾）は、元画像（annots/xxxx.png）が存在すれば
 * 表示タイプを「画像」（annDisplayType:'image' / .ann-image-obj）へ上書きする。これは
 * 他オーサリングツール由来bookの見た目をそのまま再現するための処理であり、CRAFTが
 * ラスタライズして書き出したアイコン・マーカーPNGに対しては誤変換になる。
 * メタがある＝CRAFT製と確定できるため、そちらを優先して元の表示形式へ戻す。
 *
 * 塗り色は、書き出し時のsavedData.annColor（選択肢インデックス）をメタのcolor-indexとして
 * 保持しているため、アイコン型はICON_COLOR_OPTIONS、マーカー型はANN_COLOR_OPTIONSの
 * 同インデックスから復元する（'existing'等の非数値・未設定はインデックス0へフォールバック）。
 * @param {Object} k - convertPageAnnotationsが生成したknownアノテーション（破壊的に更新する）
 * @param {Object} meta - annots[]要素のlibro-craft-meta
 */
function applyCraftMetaDisplayType(k, meta) {
  const displayType = meta['display-type'];

  let sd = {};
  try { sd = JSON.parse(k.savedData || '{}'); } catch (_) {}
  sd.annDisplayType = displayType;
  if (meta['color-index'] !== undefined) sd.annColor = String(meta['color-index']);
  if (meta.label) sd.annLabel = meta.label;
  k.savedData = JSON.stringify(sd);

  const colorIdx = parseInt(sd.annColor, 10);
  // convertPageAnnotationsがマーカー型用に埋め込んだ種別色背景を一旦外し、
  // 表示形式ごとの背景を付け直す
  const baseStyle = (k.style || '').replace(/background:[^;]*;?/, '');

  if (displayType === 'icon') {
    k.className = 'ann-icon-obj';
    k.style = baseStyle + `background:${ICON_COLOR_OPTIONS[colorIdx]?.value ?? ICON_COLOR_OPTIONS[0].value};`;
  } else if (displayType === 'page-color') {
    k.className = 'ann-object dt-page-color';
    k.style = baseStyle;
  } else {
    k.className = 'ann-object';
    k.style = baseStyle + `background:${ANN_COLOR_OPTIONS[colorIdx]?.value ?? ANN_COLOR_OPTIONS[0].value};`;
  }
}

/**
 * ページ内のannots[]を、ContentsBuilderの既知アノテーション（annotations.json互換オブジェクト）、
 * 付箋Hide/Showペア（togglePairs。位置・グループ編集および書き出しに対応）、
 * 編集不可アノテーション（未知パターンのみ。書き出し時は無変更のまま書き戻す）
 * とに分類・変換する。
 *
 * `libro-craft-meta` を持つ要素（CRAFT自身が書き出したbook由来）は最優先でグループ復元し、
 * それ以外（他システム由来、または未知の構造）のみ既存の構造ヒューリスティック
 * （findTogglePairs/detectDaimonGroup）にフォールバックする。
 *
 * known各要素の `_iconFilename`（元のannots/xxxx.pngファイル名）は本関数内では未解決のまま
 * 一時的にぶら下げるだけで、実際の画像読込・annDisplayType:'image'への上書きは
 * parseLibroBookZip側（loadAnnotPngBytesが使えるスコープ）でページループ後にまとめて行う。
 * @param {Object} pageJson - p####.json のパース済みオブジェクト
 * @param {number} pageNum - 1始まりのページ番号
 * @returns {{ known: Array<Object>, unknown: Array<Object>, togglePairs: Array<Object>, daimonPassthrough: Array<Object>, networks: Array<Object>, maxId: number }}
 */
function convertPageAnnotations(pageJson, pageNum) {
  // LIBRO+ビューアはHide/Showのtargetsを「annot-range[0] + annots配列内の位置」で解決する
  // 位置ベースモデルのため（buildLibroBookExportのID正規化と同じ前提）、内部IDの_idも
  // 位置ベースで採る。ファイル名（annots/XXXX.png）はあくまで画像素材の参照であり、
  // 数値がIDと一致する保証はない（重複・ずれのあるbookではファイル名由来の_idが重複し、
  // 付箋の解決先取り違え・書き出し時のtargets潰れを引き起こす）。
  // annot-rangeを持たないページ（旧データ・想定外構造）のみ従来のファイル名由来へフォールバックする。
  const range = pageJson['annot-range'];
  const rangeBase = Array.isArray(range) ? range[0] : null;
  const annots = (pageJson.annots || []).map((a, idx) => {
    if (rangeBase != null) return { ...a, _id: rangeBase + idx };
    const idMatch = (a.filename || '').match(/(\d+)\.\w+$/);
    return { ...a, _id: idMatch ? parseInt(idMatch[1], 10) : null };
  });

  const pageWidth  = pageJson.width;
  const pageHeight = pageJson.height;

  const metaResult = extractCraftMetaTogglePairs(annots);
  const remainingAnnots = annots.filter(a => a._id == null || !metaResult.consumedIds.has(a._id));
  const { pairs, pairedIds } = findTogglePairs(remainingAnnots);
  const byId = new Map();
  remainingAnnots.forEach(a => { if (a._id != null) byId.set(a._id, a); });

  const known  = [];
  const unknown = [];
  const togglePairs = [];
  // 大問ボタン（kind:'daimon'）は書き出し未対応のため、位置編集されていない限り
  // 元のannots[]を無変更のまま書き戻せるよう生データを保持する（closed/open2件1組）
  const daimonPassthrough = [];
  // 拡張トグルネットワーク（色分けボタン・ステップボタン等、1:1ペア/大問ボタンの形状に
  // 収まらない、3要素以上が絡むHide/Show構造）。位置・サイズ編集のみ対応し、書き出しは
  // 元のactionsを保持したまま生データをpassthroughする（buildNetworkGroup参照）。
  const networks = [];
  const networkConsumedIds = new Set();
  let maxId = 0;

  metaResult.pairs.forEach(({ closed, open, groupId, type, meta }) => {
    maxId = Math.max(maxId, closed._id || 0, open._id || 0);
    // 大問ボタン・答ボタンは付箋ではなくネイティブのボタン（.daimon-btn / .kotae-btn）として
    // 復元するため、メタの種別をそのままkindへ渡す。証明ボタン（shomei）は書き出し未対応で
    // メタが生成されないため到達しないが、想定外の値は安全側で付箋扱いにする。
    const kind = (type === 'daimon' || type === 'kotae') ? type : 'sticky';
    // 大問ボタン・答ボタンはrenderTogglePairsがtp.groupIds（紐付き付箋のid列）を見て
    // dataset.daimonId / dataset.kotaeIdをリンクするため、自身のactions[]から
    // 紐付きid（自己参照を除く）を算出する（detectDaimonGroupの構造ヒューリスティック判定と
    // 同じ抽出方法）。
    const groupIds = (kind === 'daimon' || kind === 'kotae')
      ? (() => {
          const selfIds = new Set([closed._id, open._id]);
          return [...new Set([...flattenTargets(closed.actions), ...flattenTargets(open.actions)])]
            .filter(id => !selfIds.has(id));
        })()
      : undefined;
    togglePairs.push({
      pageNum,
      closedId:   closed._id,
      openId:     open._id,
      closedFile: closed.filename,
      openFile:   open.filename,
      rect:       closed.rect,
      pageWidth,
      pageHeight,
      kind,
      groupId,
      groupIds,
      // CRAFT製の証（メタ本体）。renderTogglePairsがボタンの見た目（プリセット・拡大率・
      // 表示文言・画像素材）を復元し、リサイズ可否を分けるために使う。
      craftMeta: meta,
    });
    // CRAFT製の大問ボタンはpassthrough（生データの無変更書き戻し）対象にしない。
    // 位置・サイズ・見た目の編集を書き出しへ反映させるため、答ボタンと同じ
    // storage.jsの新規ボタン経路（convertDaimonButtonToLibroAnnots）で再生成する
    // （passthroughへ登録すると二重出力になる）。構造ヒューリスティックで検出した
    // LIBRO+製の大問ボタン（下の pairs.forEach 側）は従来どおりpassthroughのまま。
  });

  pairs.forEach(([a, b]) => {
    // hidden:false（初期表示）側を閉状態、hidden:true側を開状態とする
    const closed = a.hidden ? b : a;
    const open   = a.hidden ? a : b;
    maxId = Math.max(maxId, closed._id || 0, open._id || 0);
    const { isDaimon, groupIds } = detectDaimonGroup(closed, open);
    if (isDaimon) {
      togglePairs.push({
        pageNum,
        closedId:   closed._id,
        openId:     open._id,
        closedFile: closed.filename,
        openFile:   open.filename,
        rect:       closed.rect,
        pageWidth,
        pageHeight,
        kind:       'daimon',
        groupIds,
      });
      daimonPassthrough.push({ pageNum, closedId: closed._id, closed, open });
      return;
    }

    // 大問ボタンの形状に一致しないペア：自分自身以外に参照している「余剰target」が
    // あるかどうかで、通常の1:1トグル（sticky）か拡張トグルネットワークかを判定する。
    // 判定は「他ペアへの侵食を防ぐフィルタ前」のrawExtraで行う。もし余剰が他の
    // 確立済みペアに全て属していて絡み取り込むid（leftover）が0件になった場合でも、
    // 大問ボタンに似た「他の独立ペアを一括Hide/Showする remote control」構造である可能性が
    // あり、convertStickyGroupToLibroAnnotsの単純2アクション再生成に通すと元のactionsが
    // 破壊されるため、rawExtraが1件以上ある時点でsticky扱いにはせず必ずネットワーク
    // （最小の場合は自分自身2件のみ）として安全側にpassthroughする。
    const selfIds = new Set([closed._id, open._id]);
    const rawExtra = [...new Set(flattenTargets(closed.actions).concat(flattenTargets(open.actions)))]
      .filter(id => !selfIds.has(id));

    if (rawExtra.length === 0) {
      // 余剰なし＝綺麗な1:1トグル（通常の付箋・答・証明ボタン等）
      togglePairs.push({
        pageNum,
        closedId:   closed._id,
        openId:     open._id,
        closedFile: closed.filename,
        openFile:   open.filename,
        rect:       closed.rect,
        pageWidth,
        pageHeight,
        kind:       'sticky',
      });
      // 位置・グループ編集後に書き出し可能な既知アノテーションとして扱うため、
      // 未知アノテーションへは登録しない（convertStickyGroupToLibroAnnotsで再生成する）
      return;
    }

    // 余剰targetが残る＝色分けボタン・ステップボタン等の拡張トグルネットワーク。
    // 他の確立済みペア・大問・他ネットワークの領域には侵食しない（BFSのシードから除外）。
    const leftover = rawExtra
      .filter(id => !pairedIds.has(id))
      .filter(id => !networkConsumedIds.has(id));
    const excludeIds = new Set([...pairedIds, ...networkConsumedIds]);
    selfIds.forEach(id => excludeIds.delete(id));
    const memberIds = expandNetworkClosure([...selfIds, ...leftover], byId, excludeIds);
    memberIds.forEach(id => networkConsumedIds.add(id));
    networks.push(buildNetworkGroup([...memberIds], byId, pageNum, pageWidth, pageHeight, `net-${pageNum}-${closed._id}`));
  });

  annots.forEach(a => {
    if (a._id != null) maxId = Math.max(maxId, a._id);
    if (a._id != null && (pairedIds.has(a._id) || metaResult.consumedIds.has(a._id) || networkConsumedIds.has(a._id))) return; // 処理済み

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
        _iconFilename: a.filename,
        _craftMeta: a[CRAFT_META_KEY] || null,
      });
    } else if (kind === 'uri') {
      const uri = a.actions.find(ac => ac.action === 'URI');
      const uriValue = uri?.uri || '';
      // LIBROのURI actionは実URLだけでなく、ビューア側でeval実行される擬似関数呼び出し
      // （toAppendix=Plusファイル、toMovie/toMovieBNR=動画）も同じ枠に格納されている。
      // 引数の意味を全て解析できているわけではないため、既知の2種のみ判定し、
      // 残り（toFlashcard/toListening等、LIBRO CRAFTでは作成不可な機能）は外部リンク扱いのまま保持する。
      const call = parseLibroLinkFunction(uriValue);

      if (call?.fn === 'toAppendix') {
        const [dirName, showMode] = splitLibroCallArgs(call.args);
        known.push({
          className: 'ann-object',
          type: 'plusfile',
          id: a._id,
          page: pageNum,
          style: style + `background:${ANNOTATION_TYPE_CONFIG.plusfile.color};`,
          savedData: JSON.stringify({ annDisplayType: 'marker', annFile: dirName || '', annShowMode: showMode ?? '0' }),
          _iconFilename: a.filename,
          _craftMeta: a[CRAFT_META_KEY] || null,
        });
      } else if (call?.fn === 'toMovie' || call?.fn === 'toMovieBNR') {
        // toMovieBNR("ファイル名",表示モード) は内部ファイル指定（annVideoSrc:'0'）へ、
        // toMovie 3〜4引数はJ-stream指定（annVideoSrc:'2'、3フィールド＋表示モード）へ変換する。
        // どちらの形式にも当てはまらない引数構成は丸括弧内の生文字列のまま保持し
        // （annVideoFn/annVideoArg）、書き出し時も無変更で書き戻す。
        const bnrParts = call.fn === 'toMovieBNR' ? splitLibroCallArgs(call.args) : null;
        const jstream = parseJstreamArgs(call.fn, call.args);
        let vidData;
        if (bnrParts && bnrParts.length === 2) {
          vidData = { annDisplayType: 'marker', annVideoSrc: '0',
                      annFile: bnrParts[0], annShowMode: bnrParts[1] || '0' };
        } else if (jstream !== null) {
          vidData = { annDisplayType: 'marker', annVideoSrc: '2',
                      annJstreamDir: jstream.dir, annJstreamCorpId: jstream.corpId, annJstreamVideoId: jstream.videoId,
                      annShowMode: jstream.showMode };
        } else {
          vidData = { annDisplayType: 'marker', annVideoSrc: '2', annVideoFn: call.fn, annVideoArg: call.args };
        }
        known.push({
          className: 'ann-object',
          type: 'video',
          id: a._id,
          page: pageNum,
          style: style + `background:${ANNOTATION_TYPE_CONFIG.video.color};`,
          savedData: JSON.stringify(vidData),
          _iconFilename: a.filename,
          _craftMeta: a[CRAFT_META_KEY] || null,
        });
      } else {
        known.push({
          className: 'ann-object',
          type: 'externallink',
          id: a._id,
          page: pageNum,
          style: style + `background:${ANNOTATION_TYPE_CONFIG.externallink.color};`,
          savedData: JSON.stringify({ annDisplayType: 'marker', annUrl: uriValue }),
          _iconFilename: a.filename,
          _craftMeta: a[CRAFT_META_KEY] || null,
        });
      }
    } else if (kind === 'launch') {
      const launch = a.actions.find(ac => ac.action === 'Launch');
      const rawBaseName = (launch?.filename || '').split('/').pop().replace(/\.mp3$/i, '');
      const annPlayMode = /^in_/i.test(rawBaseName) ? '1' : '0';
      const baseName = stripAudioPrefix(rawBaseName);
      known.push({
        className: 'ann-object',
        type: 'audio',
        id: a._id,
        page: pageNum,
        style: style + `background:${ANNOTATION_TYPE_CONFIG.audio.color};`,
        savedData: JSON.stringify({ annDisplayType: 'marker', annFile: baseName, annPlayMode }),
        _iconFilename: a.filename,
        _craftMeta: a[CRAFT_META_KEY] || null,
      });
    } else {
      // 既知パターンに一致しない：編集不可・削除しない未知アノテーションとして保持のみ行う
      unknown.push({ pageNum, raw: a });
    }
  });

  return { known, unknown, togglePairs, daimonPassthrough, networks, maxId };
}


/**
 * LIBRO bookフォルダ形式のZIPを解析し、ページ画像・アノテーションデータを取り出す。
 * - ページ画像（p####-1.jpg等）・音声（sounds/*.mp3）はPbve2000復号する
 * - annots/*.png は通常平文のためそのままBlobURL化する
 * - 音声・annots画像はいずれも、別オーサリングツール由来で実際には暗号化されていない
 *   場合があるため、先頭の"Pbve2000"ヘッダー有無を判定してから復号する。ヘッダーが
 *   無かったファイルのzip内相対パスは unencryptedAssetPaths に記録し、
 *   buildLibroBookExport で書き出し時に強制的に暗号化し直すために使う
 * - annots[] は既知パターン（GoTo+FitPage / URI（うちtoAppendix=Plusファイル・toMovie系=動画・
 *   それ以外=外部リンク） / Launch / Hide+Show）を判定し、既知のものはContentsBuilderの
 *   内部データ形式へ変換、それ以外は未知アノテーションとして保持のみ行う
 * @param {JSZip} zip - JSZip.loadAsync 済みのZIPオブジェクト
 * @returns {Promise<{
 *   pages: Array<{pageNum:number, width:number, height:number, imageUrl:string, jsonPath:string}>,
 *   knownAnnotations: Array<Object>,
 *   togglePairs: Array<Object>,
 *   unknownAnnotations: Array<Object>,
 *   daimonPassthrough: Array<Object>,
 *   networkGroups: Array<Object>,
 *   maxAnnotId: number,
 *   baseDir: string,
 *   indexJson: Object,
 *   unencryptedAssetPaths: Set<string>,
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
  const daimonPassthrough = [];
  const networksRaw = [];
  let maxAnnotId = 0;
  // 別オーサリングツール由来などで本来Pbve2000暗号化されているべきなのに平文だった
  // ファイル（sounds/*.mp3、annots/*.png）のzip内相対パスを記録する。
  // 書き出し時、対応するアノテーションの編集有無にかかわらず強制的に暗号化し直すために使う。
  const unencryptedAssetPaths = new Set();

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
    // 別オーサリングツール由来で実際には暗号化されていない場合があるため、ヘッダーを見て判定する。
    const imageRel = pageMeta.images?.['1/1'] || Object.values(pageMeta.images || {})[0];
    let imageUrl = '';
    if (imageRel) {
      const imgEntry = zip.file(baseDir + imageRel);
      if (imgEntry) {
        const buf = await imgEntry.async('arraybuffer');
        let imageBytes;
        if (isPbve2000Encoded(buf)) {
          imageBytes = decodePbve2000(buf);
        } else {
          imageBytes = new Uint8Array(buf);
          unencryptedAssetPaths.add(baseDir + imageRel);
        }
        imageUrl = URL.createObjectURL(new Blob([imageBytes], { type: 'image/jpeg' }));
      }
    }
    // dpi はページ画像px↔物理サイズの換算に使う(新規ボタン・アイコンの既定サイズ算出)。
    // p####.json / index.json の pages[] のどちらにも入っているため width/height と同じ優先順で拾う。
    // subPages：見開き合成ページの p####.json が持つ "sub-pages"（各要素 {rect:[x,y,w,h], page:単ページ番号}）。
    // 見開き表示⇔単ページ表示の相互変換に使う。単ページ側は持たないため通常 null。
    pages.push({ pageNum, width: pageWidth, height: pageHeight, dpi: pageJson.dpi || pageMeta.dpi, imageUrl, jsonPath: pageMeta.json, subPages: pageJson['sub-pages'] || null });

    // 参照されている音声ファイルをPbve2000復号してmediaBlobsへキャッシュ
    // （resolveMediaSrc は "ファイル名.mp3" 形式のキーを参照するため、拡張子込みで格納する。
    // 実ファイル名先頭のex_/in_プレフィックスはLIBRO書き出し専用の変換でのみ使うため、
    // mediaBlobsのキーからは常に除去した本体名を使う）。
    // 別オーサリングツール由来で実際には暗号化されていない場合があるため、ヘッダーを見て判定する。
    for (const annot of (pageJson.annots || [])) {
      for (const action of (annot.actions || [])) {
        if (action.action === 'Launch' && action.filename) {
          const baseName = stripAudioPrefix(action.filename.split('/').pop());
          if (mediaBlobs[baseName]) continue;
          const entry = zip.file(baseDir + action.filename);
          if (!entry) continue;
          const buf = await entry.async('arraybuffer');
          let bytes;
          if (isPbve2000Encoded(buf)) {
            bytes = decodePbve2000(buf);
          } else {
            bytes = new Uint8Array(buf);
            unencryptedAssetPaths.add(baseDir + action.filename);
          }
          mediaBlobs[baseName] = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
        }
      }
    }

    // annots[] を既知/未知に分類・変換
    const { known, unknown, togglePairs, daimonPassthrough: pageDaimonPassthrough, networks, maxId } = convertPageAnnotations(pageJson, pageNum);
    knownAnnotations.push(...known);
    unknownAnnotations.push(...unknown);
    daimonPassthrough.push(...pageDaimonPassthrough);
    togglePairsRaw.push(...togglePairs.map(tp => ({ ...tp, baseDir })));
    networksRaw.push(...networks.map(net => ({ ...net, baseDir })));
    maxAnnotId = Math.max(maxAnnotId, maxId);
  }

  // sounds/ 配下の音声を全件BlobURL化して mediaBlobs へキャッシュする。
  // 上のページループでキャッシュされるのは「アノテーションから参照されている音声」だけのため、
  // 参照されていない音声は設定ポップアップのファイル名候補に出せない。候補提示のため
  // フォルダ内の *.mp3 をすべて対象にする（既にキャッシュ済みのキーは再処理しない）。
  // 各ファイルは独立して復号できるため Promise.all で並列実行する（逐次だと本数に比例して待ち時間が伸びる）。
  const soundEntries = [];
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    if (!relPath.startsWith(baseDir)) return;
    const rel = relPath.slice(baseDir.length);
    if (/^sounds\/[^/]+\.mp3$/i.test(rel)) soundEntries.push({ rel, entry });
  });
  await Promise.all(soundEntries.map(async ({ rel, entry }) => {
    const baseName = stripAudioPrefix(rel.split('/').pop());
    if (mediaBlobs[baseName]) return;
    const buf = await entry.async('arraybuffer');
    // どのアノテーションからも参照されていないファイルは書き出し対象にならないため、
    // 平文であっても unencryptedAssetPaths には登録しない
    // （登録すると書き出し時の強制暗号化対象が不必要に増える）。
    const bytes = isPbve2000Encoded(buf) ? decodePbve2000(buf) : new Uint8Array(buf);
    mediaBlobs[baseName] = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
  }));

  // annots画像を読み込んでBlobURL化する共通ヘルパー。
  // 通常は平文PNGだが、別オーサリングツール由来で実際にはPbve2000暗号化されている
  // 場合もあるため、ヘッダーを見て判定する（暗号化されていた場合のみ復号する）。
  async function loadAnnotPngBytes(path) {
    const entry = zip.file(path);
    if (!entry) return null;
    const buf = await entry.async('arraybuffer');
    if (isPbve2000Encoded(buf)) return decodePbve2000(buf);
    // annots/*.pngは仕様上「平文（暗号化対象外）」が正しいため、ページ画像・sounds/*.mp3とは異なり
    // unencryptedAssetPathsには登録しない（登録すると書き出し時に誤って強制暗号化されてしまう）。
    return new Uint8Array(buf);
  }

  // PNGバイト列が完全透過（全ピクセルのアルファ0）かどうかを判定する。
  // 別オーサリングツールは「紙面カラー（見た目なし・クリック領域のみ）」を表現するために
  // 実体を持たない透明PNGをannots画像として置くことがあり、これを「画像」表示タイプの
  // 元画像と誤認しないようにするための判定。
  async function isFullyTransparentPng(bytes) {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false;
    }
    return true;
  }

  // Hide/Showペア用のannots画像をBlobURL化する（各ペアは独立しているため並列実行する）
  const togglePairsResults = await Promise.all(togglePairsRaw.map(async (tp) => {
    const closedBytes = await loadAnnotPngBytes(tp.baseDir + tp.closedFile);
    const openBytes   = await loadAnnotPngBytes(tp.baseDir + tp.openFile);
    if (!closedBytes || !openBytes) return null;
    return {
      pageNum: tp.pageNum,
      rect: tp.rect,
      pageWidth: tp.pageWidth,
      pageHeight: tp.pageHeight,
      closedId:   tp.closedId,
      openId:     tp.openId,
      closedFile: tp.closedFile,
      openFile:   tp.openFile,
      kind:       tp.kind,
      groupIds:   tp.groupIds,
      groupId:    tp.groupId,
      craftMeta:  tp.craftMeta,
      closedImageUrl: URL.createObjectURL(new Blob([closedBytes], { type: 'image/png' })),
      openImageUrl:   URL.createObjectURL(new Blob([openBytes],   { type: 'image/png' })),
    };
  }));
  const togglePairs = togglePairsResults.filter(Boolean);

  // 拡張トグルネットワーク（色分けボタン・ステップボタン等）用のannots画像をBlobURL化する。
  // 生データ（member.raw、書き出し時にそのまま書き戻す）にはURLを書き込まず、
  // 表示専用のimagesテーブル（id -> blobUrl）として並置する。
  // ネットワーク単位・メンバー単位いずれも独立しているため並列実行する。
  const networkGroups = await Promise.all(networksRaw.map(async (net) => {
    const images = new Map();
    const memberResults = await Promise.all(net.members.map(async (m) => {
      const bytes = await loadAnnotPngBytes(net.baseDir + m.filename);
      return bytes ? { id: m._id, bytes } : null;
    }));
    memberResults.filter(Boolean).forEach(({ id, bytes }) => {
      images.set(id, URL.createObjectURL(new Blob([bytes], { type: 'image/png' })));
    });
    return { ...net, images };
  }));

  // pagelink/plusfile/externallink/audio/video の元画像（annots/xxxx.png）を読み込み、
  // 別オーサリングツール由来の見た目をそのまま再現できる場合は表示タイプを「画像」に上書きする。
  // 元画像が見つからない、または完全透過（別ツールが紙面カラー表示のつもりで見た目を
  // 持たない透明PNGを置いているだけのケース）の場合は各種別のデフォルト表示タイプ
  // （page-color/marker）のまま維持する。
  // ページ数が多いbookではannots画像も数千枚規模になり得るため、1件ずつawaitする
  // 逐次処理では10秒を超えるブロッキングになりうる（実測: 747枚で逐次2.4秒→6-8倍で14-19秒）。
  // Promise.allで並列化することで同規模でも5-6秒程度に収まる。
  await Promise.all(knownAnnotations.map(async (k) => {
    const iconFilename = k._iconFilename;
    const craftMeta    = k._craftMeta;
    delete k._iconFilename;
    delete k._craftMeta;
    // LIBRO+製（libro-craft-metaなし＝他オーサリングツール由来）のknown系は、元画像を
    // object-fit:fillで矩形へ引き伸ばして表示するため、リサイズすると元データの絵が歪む。
    // リサイズハンドルを出さないための目印を付ける（位置移動・設定ダイアログ編集は可能）。
    if (!craftMeta) k.libroLockedSize = '1';
    // CRAFT自身が書き出したアノテーション（libro-craft-metaあり）は、書き出し時の表示形式を
    // メタから復元する。表示形式「画像」（display-type:'image'）だけは、下の元画像読込パスで
    // annIconImage（mediaBlobsのキー）を解決する必要があるためここでは処理せず通す。
    if (craftMeta && craftMeta['display-type'] && craftMeta['display-type'] !== 'image') {
      applyCraftMetaDisplayType(k, craftMeta);
      return;
    }
    if (!iconFilename) return;
    const bytes = await loadAnnotPngBytes(baseDir + iconFilename);
    if (!bytes) return;
    if (await isFullyTransparentPng(bytes)) return;
    const baseName = iconFilename.split('/').pop();
    if (!mediaBlobs[baseName]) {
      mediaBlobs[baseName] = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    }
    let sd = {};
    try { sd = JSON.parse(k.savedData || '{}'); } catch (_) {}
    sd.annDisplayType = 'image';
    sd.annIconImage = baseName;
    k.savedData = JSON.stringify(sd);
    k.className = 'ann-image-obj';
    // マーカー型用に埋め込まれた種別色背景（plusfile/video/externallink/audio）は
    // 画像型では不要（元画像をそのまま透過表示するため）なので取り除く
    k.style = (k.style || '').replace(/background:[^;]*;?/, '');
  }));

  return { pages, knownAnnotations, togglePairs, unknownAnnotations, daimonPassthrough, networkGroups, maxAnnotId, baseDir, indexJson, unencryptedAssetPaths };
}


/**
 * Hide/Showペア（付箋・答え表示等の開閉）を、位置移動・リサイズ・グループ化・書き出しに対応した
 * インタラクティブな `.sticky-note.libro-toggle` 要素として#pageLeftに描画する。
 * 色（見た目）は元のPNG画像そのままとし変更不可（openAnnotationSettingsDialog/confirmAnnotationが
 * dataset.libroToggle を見て塗り色UIを無効化する）。クリック時の開閉・選択・グループ挙動は
 * 通常の付箋と同じ addStickyClickHandler をそのまま再利用する。
 *
 * ただし kind==='daimon'（複数の他トグルペアを一括Hide/Showする大問ボタン）は、
 * ネイティブの大問ボタン（.daimon-btn、buttons.js の createDaimonButton/addDaimonClickHandler）
 * としてそのまま描画する。編集メニュー（スタイル・拡大率・画像素材）を完全に共通化するためで、
 * 既存の閉/開2枚のPNGは「画像素材」として登録し（開側は押下時画像 pressed__ キーに割り当てる）、
 * 未変更であれば実物の画像がそのまま使われる。紐付く答ボタン群は dataset.daimonId で
 * リンクする（addDaimonClickHandler が閲覧モードでこのidを見て一括開閉する）。
 *
 * ボタン系（kind==='daimon' / 'kotae'）は、CRAFT製（tp.craftMetaあり）とLIBRO+製
 * （メタなし＝構造ヒューリスティックで検出した大問ボタン）で復元方法を分ける。
 *  - CRAFT製：メタに記録した見た目（btn-preset / btn-scale / btn-label / image-file）から
 *    savedDataを復元し、`.is-sized` 付き・dataset.libroToggleなしのネイティブボタンとして
 *    描画する。リサイズ可・プリセット/文言/拡大率/画像素材の再編集可で、書き出しは
 *    storage.jsの新規ボタン経路（Hide/Showペア再生成）を通る。押下時（open）idを
 *    再利用させるため dataset.daimonPressedId / dataset.kotaePressedId を設定する。
 *  - LIBRO+製：従来どおり `.daimon-btn.libro-toggle` として描画する（元PNGを画像素材として
 *    登録、リサイズ不可・プリセット再編集不可、書き出しは生データpassthrough）。
 *
 * `libro-craft-meta` の group-id により複数メンバーのグループ（CRAFT自身が書き出した付箋グループ）
 * であることが判明した場合は、通常のCRAFT付箋グループと同じ dataset.groupId を設定する。
 * これにより addStickyClickHandler の既存のグループ一括開閉ロジックがそのまま機能する。
 * @param {Array<Object>} togglePairs - parseLibroBookZip が返す togglePairs
 */
export function renderTogglePairs(togglePairs) {
  const page = document.getElementById('pageLeft');
  // getBoundingClientRect はCSS transform（ズーム）適用後の視覚座標を返すため、
  // ズーム中に読み込むとズーム倍率分だけ座標がずれる。アノテーションの
  // style.left/top/width/height はズーム前のベース座標系で保持する規約のため、
  // transformの影響を受けない offsetWidth/offsetHeight（getPageBaseSize）を使う。
  const base = getPageBaseSize();
  const pageRect = { width: base.w, height: base.h };
  const wrapByKey = new Map(); // `${pageNum}:${id}` -> 要素（closedId・openId両方をキーに登録。答ボタンリンク解決用）
  // 書き出し時のボタンgroup-id（libro-craft-metaのgroup-id）-> 復元したボタン要素
  const btnElByMetaGroupId = new Map();
  // メタに紐付け先ボタンのgroup-idを持つ付箋。ボタン要素の生成順に依存しないよう
  // 全要素の生成後にまとめて解決する。
  const stickyLinkRequests = [];

  // groupIdごとのメンバー数を数え、複数メンバーのグループのみdataset.groupIdを設定する
  // （ソロ付箋のgroup-idはCRAFT側のgrp-N形式と衝突しない合成値のため、単独では設定不要）
  // `__solo-` プレフィックスは書き出し側が単独付箋へ振る合成idであり、定義上グループには
  // なり得ない。過去データにはこの合成idの重複（複製付箋がdataset.idを共有していた時期の
  // もの）が残っており、そのまま数えると無関係な単独付箋どうしが1グループへ誤結合される。
  const groupMemberCounts = new Map();
  togglePairs.forEach(tp => {
    if (!tp.groupId || tp.groupId.startsWith('__solo-')) return;
    groupMemberCounts.set(tp.groupId, (groupMemberCounts.get(tp.groupId) || 0) + 1);
  });

  togglePairs.forEach(tp => {
    const [x, y, w, h] = tp.rect;
    // 通常の付箋・アノテーションと同じ px 座標系（scaleAnnotations / makeDraggable / makeResizable が
    // 前提とする形式）に変換して配置する
    const leftPx   = (x / tp.pageWidth)  * pageRect.width;
    const topPx    = (y / tp.pageHeight) * pageRect.height;
    const widthPx  = (w / tp.pageWidth)  * pageRect.width;
    const heightPx = (h / tp.pageHeight) * pageRect.height;

    if (tp.kind === 'daimon' || tp.kind === 'kotae') {
      const meta    = tp.craftMeta || null;
      const isCraft = !!meta;
      // CRAFT製で画像素材モードだった場合の、元のmediaBlobsキー（アップロード時のファイル名）
      const metaImageFile = (meta?.['image-file'] || '').trim();

      let savedData;
      if (isCraft) {
        // CRAFT製：書き出し時のsavedDataをメタから復元する。画像素材モードだった場合のみ、
        // 元のキーで閉/開PNGを登録し直す（プリセットモードへ戻す編集も可能なまま維持する）。
        if (metaImageFile) {
          mediaBlobs[metaImageFile] = tp.closedImageUrl;
          mediaBlobs[`pressed__${metaImageFile}`] = tp.openImageUrl;
        }
        savedData = {
          btnPreset: meta['btn-preset'] ?? (tp.kind === 'kotae' ? '1' : '0'),
          btnScale:  meta['btn-scale']  ?? '1',
        };
        if (meta['btn-label']) savedData.btnLabel     = meta['btn-label'];
        if (metaImageFile)     savedData.btnImageFile = metaImageFile;
      } else {
        // LIBRO+製：実物のPNG（閉/開）をネイティブボタンの「画像素材」として登録する
        mediaBlobs[tp.closedFile] = tp.closedImageUrl;
        mediaBlobs[`pressed__${tp.closedFile}`] = tp.openImageUrl;
        savedData = { btnPreset: '0', btnScale: '1', btnImageFile: tp.closedFile };
      }

      const el = document.createElement('div');
      // CRAFT製はネイティブ作成のボタンと同じ .is-sized（ページ座標系サイズ＋リサイズ可）。
      // LIBRO+製は従来どおり .libro-toggle（リサイズ不可・passthrough書き戻し対象）。
      el.className         = isCraft ? `${tp.kind}-btn is-sized` : `${tp.kind}-btn libro-toggle`;
      el.dataset.type      = tp.kind;
      el.dataset.id        = tp.closedId;
      if (!isCraft) el.dataset.libroToggle = '1';
      el.dataset.page      = tp.pageNum;
      if (tp.kind === 'daimon') {
        el.dataset.daimonId = `libro-daimon-${tp.pageNum}-${tp.closedId}`;
        // 再書き出し時に押下時（open）idを新規発行せず、元のペアidをそのまま再利用させる
        // （storage.jsのnewDaimonButtonsループが dataset.daimonPressedId を優先して使う）。
        // LIBRO+製はpassthroughのため不要。
        if (isCraft) el.dataset.daimonPressedId = String(tp.openId);
      } else {
        el.dataset.kotaeId = `libro-kotae-${tp.pageNum}-${tp.closedId}`;
        el.dataset.kotaePressedId = String(tp.openId);
      }
      el.dataset.savedData = JSON.stringify(savedData);
      el.style.cssText = `left:${leftPx}px; top:${topPx}px; width:${widthPx}px; height:${heightPx}px;`;
      renderButtonVisual(el, tp.kind, savedData);

      if (tp.kind === 'daimon') addDaimonClickHandler(el);
      else                      addKotaeClickHandler(el);
      makeDraggable(el);
      // renderButtonVisual() は子要素を全削除するため、その後にハンドルを付ける。
      // LIBRO+製は dataset.libroToggle により makeDaimonResizable 側で除外される。
      makeDaimonResizable(el);

      wrapByKey.set(`${tp.pageNum}:${tp.closedId}`, el);
      wrapByKey.set(`${tp.pageNum}:${tp.openId}`,   el);
      // メタ由来の紐付け解決用（付箋側の daimon-group-id / kotae-group-id と突き合わせる）
      const metaGroupId = meta?.['group-id'];
      if (metaGroupId) btnElByMetaGroupId.set(metaGroupId, el);
      page.appendChild(el);
      return;
    }

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
    if (tp.groupId && groupMemberCounts.get(tp.groupId) > 1) {
      wrap.dataset.groupId = tp.groupId;
    }
    if (tp.craftMeta) {
      // CRAFT自身が書き出した付箋（libro-craft-metaあり）：開閉方式（表示ボタン削除＝
      // open-locked）を復元する。dataset.libroToggleCraftはannotation-dialog.jsの
      // openEditPopup/buildSpecificFieldsが「開閉方式欄を表示してよいCRAFT製トグル付箋」か
      // どうかの判定に使う（色・元画像の編集不可制約はdataset.libroToggleのまま維持）。
      wrap.dataset.libroToggleCraft = '1';
      const openLocked = tp.craftMeta['open-locked'] === true;
      wrap.dataset.savedData = JSON.stringify({ annStickyOpenMode: openLocked ? '1' : '0' });
      wrap.classList.toggle('sticky-open-locked', openLocked);
      // 答ボタン紐付け前の開閉方式（答ボタン削除時の復帰値）。旧bookには無いキーのため
      // 未定義のときは何もしない（削除時は既定値へ戻すフォールバックが働く）。
      const kotaeOrigOpenMode = tp.craftMeta['kotae-orig-open-mode'];
      if (kotaeOrigOpenMode !== undefined) {
        wrap.dataset.kotaeOrigOpenMode = kotaeOrigOpenMode === '1' ? '1' : '0';
      }
      // 大問／答ボタンとの紐付け（数値idに依存しないメタ由来の情報）
      const daimonGroupId = tp.craftMeta['daimon-group-id'];
      const kotaeGroupId  = tp.craftMeta['kotae-group-id'];
      if (daimonGroupId || kotaeGroupId) {
        stickyLinkRequests.push({ el: wrap, daimonGroupId, kotaeGroupId });
      }
    }
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

    wrapByKey.set(`${tp.pageNum}:${tp.closedId}`, wrap);
    wrapByKey.set(`${tp.pageNum}:${tp.openId}`,   wrap);
    page.appendChild(wrap);
  });

  // 大問ボタン・答ボタンに紐付く付箋群を dataset.daimonId / dataset.kotaeId でリンクする
  // （ネイティブのボタン機能 addDaimonClickHandler / addKotaeClickHandler が閲覧モードで
  // このidを見て一括開閉する）
  togglePairs.forEach(tp => {
    if (tp.kind !== 'daimon' && tp.kind !== 'kotae') return;
    const leaderEl = wrapByKey.get(`${tp.pageNum}:${tp.closedId}`);
    if (!leaderEl) return;
    const linkKey = tp.kind === 'daimon' ? 'daimonId' : 'kotaeId';
    const did = leaderEl.dataset[linkKey];
    (tp.groupIds || []).forEach(gid => {
      const followerWrap = wrapByKey.get(`${tp.pageNum}:${gid}`);
      if (followerWrap && followerWrap !== leaderEl) followerWrap.dataset[linkKey] = did;
    });
  });

  // libro-craft-meta に明示記録された紐付け先ボタンのgroup-idから、付箋と大問／答ボタンの
  // 関係を復元する。Hide/Show targetsの数値idに一切依存しないため、ID正規化・ファイル名の
  // ずれ・ページ内順序変更の影響を受けない。上のtargets由来リンクより後に実行し、
  // メタの内容を優先させる。対応するボタンが書き出されていない場合は何もしない。
  stickyLinkRequests.forEach(({ el, daimonGroupId, kotaeGroupId }) => {
    const daimonEl = daimonGroupId ? btnElByMetaGroupId.get(daimonGroupId) : null;
    if (daimonEl && daimonEl.dataset.daimonId) el.dataset.daimonId = daimonEl.dataset.daimonId;
    const kotaeEl = kotaeGroupId ? btnElByMetaGroupId.get(kotaeGroupId) : null;
    if (kotaeEl && kotaeEl.dataset.kotaeId) el.dataset.kotaeId = kotaeEl.dataset.kotaeId;
  });
}


/**
 * 拡張トグルネットワーク（色分けボタン・ステップボタン等）のスロットに閲覧モード用の
 * クリック連動を設定する。クリック時、そのスロット内で現在表示中のフレームのうち
 * 最前面（DOM末尾＝最後にShowされたもの）が持つ元のactions[]（data-actions）をそのまま
 * 再生し、同一ページ内の対応する member-id を持つフレームのis-visibleを付け外しする
 * 汎用インタプリタ方式。actionsを持たない受動的なフレームはクリックしても何も起きない。
 *
 * 実データ（ステップボタン）ではShow時に以前のフレームを明示的にHideしない構造
 * （最新のフレームが手前に重なることを前提にしている）が存在するため、Showしたフレームは
 * 常に親スロットの末尾（最前面）へ移動する。これにより複数フレームが同時にis-visibleでも
 * 見た目・次クリック時の判定の両方で「最後に表示したもの」が正しく優先される。
 * 編集モードでは選択・ダイアログ等には対応せず、ドラッグ・リサイズのみ可能（何もしない）。
 * @param {HTMLElement} slotEl
 */
function addNetworkClickHandler(slotEl) {
  slotEl.addEventListener('click', () => {
    if (!document.body.classList.contains('is-view-mode')) return;
    const visibleFrames = slotEl.querySelectorAll('.libro-network-frame.is-visible');
    if (visibleFrames.length === 0) return;
    const visibleFrame = visibleFrames[visibleFrames.length - 1];
    let actions = [];
    try { actions = JSON.parse(visibleFrame.dataset.actions || '[]'); } catch (_) {}
    actions.forEach(act => {
      if (act.action !== 'Hide' && act.action !== 'Show') return;
      (Array.isArray(act.targets) ? act.targets : []).forEach(id => {
        document.querySelectorAll(`.libro-network-frame[data-member-id="${id}"]`).forEach(frame => {
          const show = act.action === 'Show';
          frame.classList.toggle('is-visible', show);
          if (show) frame.parentElement?.appendChild(frame);
        });
      });
    });
  });
}


/**
 * 拡張トグルネットワーク（色分けボタン・ステップボタン等）を、位置・サイズ編集に対応した
 * `.libro-network-slot` 要素として#pageLeftに描画する。1スロット＝同一矩形を共有する
 * 画像群（1〜N枚）で、内部の`.libro-network-frame`のうちis-visibleが付いた1枚のみ表示する。
 * 選択・削除・Undo・編集ダイアログには対応しない（位置・サイズ編集専用、既知の制限）。
 * @param {Array<Object>} networkGroups - parseLibroBookZip が返す networkGroups
 */
export function renderNetworkGroups(networkGroups) {
  const page = document.getElementById('pageLeft');
  // renderTogglePairs と同じ理由でベース座標系のサイズ（offsetWidth/offsetHeight）を使う。
  // getBoundingClientRect ではズーム中の読み込みで座標がずれる。
  const base = getPageBaseSize();
  const pageRect = { width: base.w, height: base.h };

  networkGroups.forEach(net => {
    const memberById = new Map(net.members.map(m => [m._id, m]));
    net.slots.forEach((slot, slotIndex) => {
      const [x, y, w, h] = slot.rect;
      const leftPx   = (x / net.pageWidth)  * pageRect.width;
      const topPx    = (y / net.pageHeight) * pageRect.height;
      const widthPx  = (w / net.pageWidth)  * pageRect.width;
      const heightPx = (h / net.pageHeight) * pageRect.height;

      const slotEl = document.createElement('div');
      slotEl.className = 'libro-network-slot';
      slotEl.dataset.type      = 'libro-network-node';
      slotEl.dataset.networkId = net.networkId;
      slotEl.dataset.slotIndex = String(slotIndex);
      slotEl.dataset.page      = net.pageNum;
      slotEl.style.cssText = `left:${leftPx}px; top:${topPx}px; width:${widthPx}px; height:${heightPx}px;`;

      slot.memberIds.forEach(id => {
        const member = memberById.get(id);
        if (!member) return;
        const frame = document.createElement('img');
        frame.className = 'libro-network-frame';
        frame.src = net.images.get(id) || '';
        frame.dataset.memberId = String(id);
        frame.dataset.actions  = JSON.stringify(member.actions || []);
        if (!member.hidden) frame.classList.add('is-visible');
        slotEl.appendChild(frame);
      });

      addNetworkClickHandler(slotEl);
      makeDraggable(slotEl);
      makeResizable(slotEl);
      page.appendChild(slotEl);
    });
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
 * annotのfilename（"annots/XXXX.png"形式）から数値IDを抽出する。
 * annots/ffff.png（見開き合成ページのページ内リンク等）のように数値で
 * ないfilenameの場合はnullを返す。
 * @param {{filename?:string}} annot
 * @returns {number|null}
 */
function filenameToNumericId(annot) {
  const m = (annot.filename || '').match(/(\d+)\.\w+$/);
  return m ? parseInt(m[1], 10) : null;
}


/**
 * 音声ファイル名（拡張子有無どちらでも可）先頭の ex_/in_ プレフィックス（大文字小文字問わず）を除去する。
 * annFile・mediaBlobsのキーは常にこの「プレフィックス無し」の状態で扱う。
 * @param {string} name
 * @returns {string}
 */
function stripAudioPrefix(name) {
  return (name || '').replace(/^(ex_|in_)/i, '');
}


/**
 * annFile（プレフィックス無しの本体名）とannPlayMode（'0'=コントローラーあり/'1'=なし）から、
 * LIBRO book書き出し時に実際にsounds/へ書き込むファイル名（ex_/in_プレフィックス＋拡張子込み）を組み立てる。
 * @param {string} annFile
 * @param {string} annPlayMode
 * @returns {string}
 */
function libroSoundFilename(annFile, annPlayMode) {
  const base = stripAudioPrefix((annFile || '').trim());
  const prefix = annPlayMode === '1' ? 'in_' : 'ex_';
  return `${prefix}${base}.mp3`;
}


/**
 * "left:x%;top:y%;width:w%;height:h%;" 形式のstyle文字列を、
 * ページ画像ピクセル座標系の rect（rectToStyleの逆変換）に変換する。
 * @param {string} style
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @returns {[number,number,number,number]} [x, y, width, height]
 */
export function styleToRect(style, pageWidth, pageHeight) {
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
async function rasterizeMarkerPng(type, pxWidth, pxHeight, annDisplayType, annColor) {
  const cfg = ANNOTATION_TYPE_CONFIG[type] || {};
  const w = Math.max(1, Math.min(1200, pxWidth));
  const h = Math.max(1, Math.min(1200, pxHeight));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // 紙面カラー型：完全透過画像
  if (annDisplayType === 'page-color') {
    // 空のcanvasをそのままPNG化（透明）
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  // アイコン型：円形グラデーション背景+白アイコン
  if (annDisplayType === 'icon') {
    // annColorはICON_COLOR_OPTIONSのインデックス（0=青, 1=緑, 2=黄）
    const iconColors = [
      { stops: [['#67d0ff', 0], ['#4c9ae2', 0.3], ['#366da0', 1]] },  // 青
      { stops: [['#7ddf8a', 0], ['#4cae5e', 0.3], ['#2d7a3d', 1]] },  // 緑
      { stops: [['#ffe066', 0], ['#e0b800', 0.3], ['#a07800', 1]] },  // 黄
    ];
    const colorIndex = Math.max(0, Math.min(2, parseInt(annColor, 10) || 0));
    const colors = iconColors[colorIndex];

    // 円形クリップを設定
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    ctx.clip();

    // グラデーション背景を描画（180deg = 上から下）
    const gradient = ctx.createLinearGradient(w / 2, 0, w / 2, h);
    colors.stops.forEach(([color, offset]) => {
      gradient.addColorStop(offset, color);
    });
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // 白いアイコンを60%サイズで中央配置
    const pathData = (cfg.iconSvg || '').match(/d="([^"]+)"/)?.[1];
    if (pathData) {
      // viewBoxの長辺をアイコン表示サイズ（短辺の60%）に合わせ、中央配置する
      const [vbX, vbY, vbW, vbH] = (cfg.iconViewBox || '0 0 24 24').split(/\s+/).map(Number);
      const iconSize = Math.min(w, h) * 0.6;
      const scale = iconSize / Math.max(vbW || 24, vbH || 24);
      ctx.save();
      ctx.translate((w - vbW * scale) / 2 - vbX * scale, (h - vbH * scale) / 2 - vbY * scale);
      ctx.scale(scale, scale);
      ctx.fillStyle = '#ffffff';
      ctx.fill(new Path2D(pathData));
      ctx.restore();
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  // マーカー型（既定値）：塗り色矩形+白アイコン
  ctx.fillStyle = cfg.color || 'rgba(120,120,120,0.6)';
  ctx.fillRect(0, 0, w, h);

  const pathData = (cfg.iconSvg || '').match(/d="([^"]+)"/)?.[1];
  if (pathData) {
    // viewBoxの長辺をアイコン表示サイズ（短辺の60%）に合わせ、中央配置する
    const [vbX, vbY, vbW, vbH] = (cfg.iconViewBox || '0 0 24 24').split(/\s+/).map(Number);
    const iconSize = Math.min(w, h) * 0.6;
    const scale = iconSize / Math.max(vbW || 24, vbH || 24);
    ctx.save();
    ctx.translate((w - vbW * scale) / 2 - vbX * scale, (h - vbH * scale) / 2 - vbY * scale);
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
async function rasterizeStickyClosedPng(color, pxWidth, pxHeight) {
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
async function rasterizeStickyOpenPng(pxWidth, pxHeight) {
  const w = Math.max(1, Math.min(1200, pxWidth));
  const h = Math.max(1, Math.min(1200, pxHeight));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}


/**
 * 大問ボタン（プリセットモード）の通常時PNGを、CRAFT上の見た目（プリセット背景色＋白文字ラベル）
 * どおりにラスタライズする。文言は savedData.btnLabel（環境設定で選んだ「大問」「ALL」「解答」を
 * ボタン作成時に保持したもの）を使い、未設定の既存データは従来どおり「大問」にフォールバックする。
 * カスタム画像モード（btnImageFileあり）はこの関数を使わず、
 * 呼び出し側でmediaBlobsの画像バイトをそのまま使用する。
 * @param {{btnPreset?:string, btnLabel?:string}} savedData
 * @param {number} pxWidth
 * @param {number} pxHeight
 * @returns {Promise<Uint8Array>}
 */
async function rasterizeDaimonNormalPng(savedData, pxWidth, pxHeight, fallbackLabel = '大問') {
  const w = Math.max(1, Math.min(1200, pxWidth));
  const h = Math.max(1, Math.min(1200, pxHeight));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const presetIdx = parseInt(savedData?.btnPreset, 10);
  const preset = BTN_COLOR_OPTIONS[Number.isInteger(presetIdx) ? presetIdx : 0] || BTN_COLOR_OPTIONS[0];
  ctx.fillStyle = preset.value;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(h * 0.45)}px 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelText = (savedData?.btnLabel || '').trim() || fallbackLabel;
  ctx.fillText(labelText, w / 2, h / 2 + 1);

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}


/**
 * 大問ボタンの押下時PNGを、グレーソリッド（DAIMON_PRESSED_COLOR、実データannots/0920.pngの
 * 実測色）で塗った矩形としてラスタライズする。実データは角がわずかに透明の角丸だが、
 * ソリッド矩形で十分とする（計画書参照）。
 * @param {number} pxWidth
 * @param {number} pxHeight
 * @returns {Promise<Uint8Array>}
 */
async function rasterizeDaimonPressedPng(pxWidth, pxHeight) {
  const w = Math.max(1, Math.min(1200, pxWidth));
  const h = Math.max(1, Math.min(1200, pxHeight));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = DAIMON_PRESSED_COLOR;
  ctx.fillRect(0, 0, w, h);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}


/**
 * 新規作成の大問ボタン1個を、LIBROのHide/Showペア（4アクション形式、実データp0004.json
 * ID920/921ペア準拠）に変換する。通常時（closed・visible・大ID側）は紐付き付箋を一括
 * Hide/Showして解答を表示させ、押下時（open・hidden・小ID側）はその逆操作で元に戻す。
 * targetsには紐付き付箋のclosed/open id列＋自身のペアidを実データ準拠の4アクション
 * （グループ一括Hide/Show 1組＋自己Hide/Show 1組）で設定する。
 * @param {{closedId:number, openId:number, style:string, savedData:Object, groupId:string,
 *   members:Array<{closedId:number, openId:number}>}} daimonData
 *   - closedId/openId: 大問ボタン自身のペアid（storage.jsでdataset.id/dataset.daimonPressedIdから解決）
 *   - members: 紐付く付箋（新規・LIBRO由来いずれも）のclosed/open idの配列
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @returns {Promise<{annotJsons:[Object,Object], newPngWrites:Array<{annot:Object, bytes:Uint8Array}>}>}
 *   annotJsonsは [closed(通常), open(押下)] の順。newPngWritesの扱いはconvertStickyGroupToLibroAnnots参照。
 */
async function convertDaimonButtonToLibroAnnots(daimonData, pageWidth, pageHeight) {
  const { closedId, openId, style, savedData, groupId, members, btnType = 'daimon' } = daimonData;
  // 再インポート用メタ種別と、ラベル未設定時のPNG焼き込み文言を種別ごとに決める。
  const BTN_META_FALLBACK_LABEL = { daimon: '大問', kotae: '答', shomei: '証明' };
  const fallbackLabel = BTN_META_FALLBACK_LABEL[btnType] || '大問';
  const rect = styleToRect(style, pageWidth, pageHeight);
  const closedFile = libroMarkerFilename(closedId);
  const openFile    = libroMarkerFilename(openId);

  const memberClosedIds = members.map(m => m.closedId);
  const memberOpenIds   = members.map(m => m.openId);

  // 再インポート時にネイティブボタンとして完全に復元（プリセット色・拡大率・表示文言・
  // 画像素材の再編集を可能に）するため、見た目を決めるsavedDataの内容をメタへ記録する。
  // 画像素材モードの場合は image-file（mediaBlobsのキー＝アップロード時のファイル名）も残し、
  // インポート側が閉/開PNGをそのキーで登録し直せるようにする。
  const imageFile = (savedData?.btnImageFile || '').trim();
  const btnMeta = { type: btnType, 'group-id': groupId };
  if (savedData?.btnPreset !== undefined && savedData.btnPreset !== '') btnMeta['btn-preset'] = String(savedData.btnPreset);
  if (savedData?.btnScale  !== undefined && savedData.btnScale  !== '') btnMeta['btn-scale']  = String(savedData.btnScale);
  if ((savedData?.btnLabel || '').trim()) btnMeta['btn-label'] = savedData.btnLabel.trim();
  if (imageFile) btnMeta['image-file'] = imageFile;

  const closedAnnot = {
    filename: closedFile,
    rect,
    _oldId: closedId,
    actions: [
      { action: 'Hide', targets: [...memberClosedIds, closedId] },
      { action: 'Show', targets: [...memberOpenIds, openId] },
      { action: 'Hide', targets: [closedId] },
      { action: 'Show', targets: [openId] },
    ],
    [CRAFT_META_KEY]: { ...btnMeta, role: 'closed' },
  };
  const openAnnot = {
    filename: openFile,
    rect,
    hidden: true,
    _oldId: openId,
    actions: [
      { action: 'Hide', targets: [...memberOpenIds, openId] },
      { action: 'Show', targets: [...memberClosedIds, closedId] },
      { action: 'Hide', targets: [openId] },
      { action: 'Show', targets: [closedId] },
    ],
    [CRAFT_META_KEY]: { ...btnMeta, role: 'open' },
  };

  const newPngWrites = [];
  if (imageFile && mediaBlobs[imageFile]) {
    // カスタム画像モード：既存の画像アイコン型書き出しと同じ方式で、mediaBlobsの画像バイトを
    // そのまま使用する（annots/*.pngは平文のためPbve2000エンコードしない）
    const buf = new Uint8Array(await (await fetch(mediaBlobs[imageFile])).arrayBuffer());
    newPngWrites.push({ annot: closedAnnot, bytes: buf });
  } else {
    const normalBytes = await rasterizeDaimonNormalPng(savedData, rect[2], rect[3], fallbackLabel);
    newPngWrites.push({ annot: closedAnnot, bytes: normalBytes });
  }
  const pressedBytes = await rasterizeDaimonPressedPng(rect[2], rect[3]);
  newPngWrites.push({ annot: openAnnot, bytes: pressedBytes });

  return { annotJsons: [closedAnnot, openAnnot], newPngWrites };
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
 *   closedMode:'reuse'|'color', openMode:'reuse'|'transparent', color?:string,
 *   btnDaimonGroupId?:string, btnKotaeGroupId?:string}>} members
 *   - btnDaimonGroupId/btnKotaeGroupId: 紐付く大問／答ボタンのgroup-id（storage.jsが解決）。
 *     libro-craft-metaへ daimon-group-id / kotae-group-id として埋め込み、再インポート時に
 *     Hide/Show targetsの数値idに依存せず紐付けを復元できるようにする。
 *   - style: 現在のDOM位置から算出した "left:x%;top:y%;width:w%;height:h%;" 形式
 *   - closedMode/openMode='reuse': closedFile/openFileの画像をそのまま再利用（新規PNG生成なし）
 *   - closedMode='color': colorをもとに新規PNGを生成（「閉」のみ）
 *   - openMode='transparent': 完全透明PNGを新規生成（「開」のみ。新規付箋のみで発生）
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @param {string} groupId - グループ内の全メンバーが共有する一意なid（storage.jsのdata-group-id、
 *   ソロ付箋は合成id）。libro-craft-metaの group-id としてメンバー全員の closed/open annotに
 *   埋め込み、再インポート時に構造ヒューリスティックに頼らずグループを確実に復元できるようにする。
 * @param {Array<{closedId:number, openId:number}>} [kotaePairs] - このグループに紐付く答ボタンの
 *   closed/openペアid。付箋の開閉アクションへ合流させ、LIBRO+でも付箋側の操作に答ボタンの
 *   押下見た目が追従するようにする（storage.jsが連動可否を判定済みのものだけを渡す）。
 * @returns {Promise<{annotJsons:Array<Object>, newPngWrites:Array<{annot:Object, bytes:Uint8Array}>}>}
 *   newPngWritesのannotは対応するannotJsons要素そのもの（同一オブジェクト参照）。呼び出し側が
 *   ID正規化でannot.filenameを書き換えた後、その最終filenameへ直接バイト列を書き込むため、
 *   ここではpathを組み立てず生成直後のannotJsonオブジェクトへの参照のみを渡す。
 */
async function convertStickyGroupToLibroAnnots(members, pageWidth, pageHeight, groupId, kotaePairs = []) {
  const closedIds = members.map(m => m.closedId);
  const openIds   = members.map(m => m.openId);
  // 紐付く答ボタンの通常時（closed）／押下時（open）idペア。付箋の開閉と同時に答ボタンの
  // 画像も入れ替えることで、LIBRO+でもCRAFTと同じく「付箋を閉じたら答ボタンも通常見た目へ戻る」
  // 挙動になる。連動対象の限定条件はstorage.js側で判定済み（ここでは渡された分をそのまま使う）。
  const kotaeClosedIds = kotaePairs.map(p => p.closedId);
  const kotaeOpenIds   = kotaePairs.map(p => p.openId);

  const annotJsons = [];
  const newPngWrites = [];

  for (const m of members) {
    const rect = styleToRect(m.style, pageWidth, pageHeight);
    const closedFile = m.closedFile || libroMarkerFilename(m.closedId);
    const openFile   = m.openFile   || libroMarkerFilename(m.openId);

    // 大問ボタン・答ボタンとの紐付けは、従来 Hide/Show targets の数値id経由でしか
    // 復元できなかった（renderTogglePairsのtp.groupIds経路）。ID正規化・ファイル名重複・
    // ページ内順序変更のいずれかでtargetsが壊れると紐付けが失われるため、
    // 付箋グループの group-id と同じく、紐付け先ボタンのgroup-idをメタへ明示記録する。
    const linkMeta = {};
    if (m.btnDaimonGroupId) linkMeta['daimon-group-id'] = m.btnDaimonGroupId;
    if (m.btnKotaeGroupId)  linkMeta['kotae-group-id']  = m.btnKotaeGroupId;

    const closedMeta = { type: 'sticky', role: 'closed', 'group-id': groupId, ...linkMeta };
    // 「開削除」：閉側は自己クリックでの「開く」動作を許可しない印
    if (m.openLocked) closedMeta['open-locked'] = true;
    // 答ボタン紐付け前の開閉方式（答ボタン削除時の復帰値）。値が無ければキー自体を出さない
    // （旧bookとの後方互換：読み込み側は未定義なら既定値へ戻すフォールバックに落ちる）。
    if (m.kotaeOrigOpenMode !== undefined) {
      closedMeta['kotae-orig-open-mode'] = m.kotaeOrigOpenMode === '1' ? '1' : '0';
    }
    const openMeta = { type: 'sticky', role: 'open', 'group-id': groupId, ...linkMeta };

    const closedAnnot = {
      filename: closedFile,
      rect,
      _oldId: m.closedId,
      // 「開削除」：閉側は自己クリックでの「開く」動作を許可しないため actions キー自体を
      // 出力しない。空配列 [] だとLIBRO+側でクリック可能領域が生成され、動作はしないのに
      // マウスカーソルだけが反応する（LIBRO+はactionsキーの無いannotを受動表示専用＝
      // クリック不可として扱う。JSON仕様書1-7節で確認済み）。
      // 「閉じる」動作（開側のactions）には影響しない。
      ...(m.openLocked ? {} : {
        actions: [
          // 付箋を開く：紐付く答ボタンも押下時（open）画像へ切り替える
          { action: 'Hide', targets: [...closedIds, ...kotaeClosedIds] },
          { action: 'Show', targets: [...openIds,   ...kotaeOpenIds] },
        ],
      }),
      [CRAFT_META_KEY]: closedMeta,
    };
    const openAnnot = {
      filename: openFile,
      rect,
      hidden: true,
      _oldId: m.openId,
      actions: [
        // 付箋を閉じる：紐付く答ボタンも通常時（closed）画像へ戻す
        { action: 'Hide', targets: [...openIds,   ...kotaeOpenIds] },
        { action: 'Show', targets: [...closedIds, ...kotaeClosedIds] },
      ],
      [CRAFT_META_KEY]: openMeta,
    };

    if (m.closedMode === 'color') {
      // 「開削除」：選択色に関わらず閉側を紙色（白）で塗る。
      const closedColor = m.openLocked ? '#ffffff' : m.color;
      const closedBytes = await rasterizeStickyClosedPng(closedColor, rect[2], rect[3]);
      newPngWrites.push({ annot: closedAnnot, bytes: closedBytes });
    }
    if (m.openMode === 'transparent') {
      const openBytes = await rasterizeStickyOpenPng(rect[2], rect[3]);
      newPngWrites.push({ annot: openAnnot, bytes: openBytes });
    }

    annotJsons.push(closedAnnot);
    annotJsons.push(openAnnot);
  }

  return { annotJsons, newPngWrites };
}


/**
 * ContentsBuilderのアノテーションオブジェクトをLIBROの annots[] 要素に変換する
 * （convertPageAnnotationsの逆変換）。対応する既存マーカーPNGがzip内に無い場合は
 * 新規マーカーPNGを生成する。画像アイコン型（annDisplayType:'image'）は、
 * id由来の元ファイル名と一致すれば無変更のまま維持し、一致しなければ
 * mediaBlobs内の画像バイトを平文のまま書き込む（ラスタライズ生成は行わない）。
 * @param {{id:number, type:string, style:string, savedData:string}} domData
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @param {JSZip} zip - 書き出し先zip（既存マーカーPNGの有無確認に使用）
 * @param {string} baseDir
 * @returns {Promise<{annotJson:Object, newPngBytes:Uint8Array|null}|null>} 対応外の種別は null
 */
async function convertAnnotationToLibroAnnot(domData, pageWidth, pageHeight, zip, baseDir) {
  const rect = styleToRect(domData.style, pageWidth, pageHeight);
  const filename = libroMarkerFilename(domData.id);

  let sd = {};
  try { sd = JSON.parse(domData.savedData || '{}'); } catch (_) {}

  // 動画の入力方式（annVideoSrc欠落データの補正込み）。動画以外の種別では使わない。
  const videoSrc = domData.type === 'video' ? resolveVideoSrc(sd) : null;

  let actions;
  if (domData.type === 'pagelink') {
    actions = [{ action: 'GoTo', page: Number(sd.annTarget) || 1 }, { action: 'FitPage' }];
  } else if (domData.type === 'externallink') {
    actions = [{ action: 'URI', uri: sd.annUrl || '' }];
  } else if (domData.type === 'audio') {
    actions = [{ action: 'Launch', filename: `sounds/${libroSoundFilename(sd.annFile, sd.annPlayMode)}` }];
  } else if (domData.type === 'plusfile') {
    actions = [{ action: 'URI', uri: `toAppendix("${(sd.annFile || '').trim()}",${sd.annShowMode || '0'})` }];
  } else if (domData.type === 'video' && (videoSrc === '0' || videoSrc === '2')) {
    // 内部ファイル（annVideoSrc:'0'）は toMovieBNR("ファイル名",表示モード) へ、
    // J-stream指定（annVideoSrc:'2'）は toMovie("dir","企業ID","難読化ID",表示モード)
    // へ変換する（表示モードは0=ページ内（モーダル）／1=別タブ）。
    // 引数構成が想定外で変換できなかったLIBRO由来リンク（annVideoArg保持分）は生文字列を
    // そのまま書き戻す（新形式のsavedDataにannVideoArgは入らないため一意に判別できる）。
    // 外部タグ指定（annVideoSrc: '1'）はLIBRO側に対応actionが無いため未対応のまま。
    if (videoSrc === '0') {
      actions = [{ action: 'URI', uri: `toMovieBNR("${(sd.annFile || '').trim()}",${sd.annShowMode || '0'})` }];
    } else if (sd.annVideoArg) {
      const fn = sd.annVideoFn === 'toMovieBNR' ? 'toMovieBNR' : 'toMovie';
      actions = [{ action: 'URI', uri: `${fn}(${sd.annVideoArg})` }];
    } else {
      actions = [{ action: 'URI', uri: `toMovie(${buildJstreamArgs(sd)})` }];
    }
  } else {
    return null; // LIBROに対応するactionが無い種別
  }

  let newPngBytes = null;
  if (sd.annDisplayType === 'image' && sd.annIconImage) {
    // 画像アイコン型：id由来の元ファイル名（annots/0000.png形式）と一致する場合は
    // LIBROインポート時のまま無変更＝zip内の既存ファイルをそのまま維持する。
    // 一致しない場合はCRAFT上でアップロード・差し替えされた画像のため、
    // 生バイトを取得して書き込む（既存ファイルがあっても上書きする）。
    // annots/*.pngは仕様上「平文（暗号化対象外）」であり、LIBRO+は平文PNGとして描画するため、
    // ここで暗号化してはならない（暗号化するとLIBRO+上でアイコンだけが表示されなくなる。
    // クリック・機能はp####.jsonのrect/actionsで動くため一見正常に見える）。
    // mediaBlobsの画像は取り込み時に復号済み／アップロード原本のためいずれも平文だが、
    // 想定外データへの安全側フォールバックとして暗号化済みなら復号してから書き込む。
    const expectedOrigBaseName = `${String(domData.id).padStart(4, '0')}.png`;
    if (sd.annIconImage !== expectedOrigBaseName) {
      const blobUrl = mediaBlobs[sd.annIconImage];
      if (blobUrl) {
        const buf = new Uint8Array(await (await fetch(blobUrl)).arrayBuffer());
        newPngBytes = isPbve2000Encoded(buf) ? decodePbve2000(buf) : buf;
      }
    }
  } else if (!zip.file(baseDir + filename)) {
    newPngBytes = await rasterizeMarkerPng(domData.type, rect[2], rect[3], sd.annDisplayType, sd.annColor);
  }

  // 再インポート時に表示形式（マーカー／アイコン／紙面カラー／画像）・塗り色・ラベルを
  // そのまま復元できるよう、CRAFT独自メタデータを付与する（LIBRO+側は未知キーを無視する。
  // 復元処理は applyCraftMetaDisplayType 参照）。付箋・ボタン系のメタと違いroleは持たない。
  // メタの有無は「CRAFT製かどうか」の判別にも使う（メタなしはリサイズ不可にする）。
  const craftMeta = {
    type: domData.type,
    'display-type': sd.annDisplayType || 'marker',
  };
  if (sd.annColor !== undefined && sd.annColor !== '') craftMeta['color-index'] = String(sd.annColor);
  if ((sd.annLabel || '').trim()) craftMeta.label = sd.annLabel.trim();

  // _oldId：ID正規化（buildLibroBookExport）が「このannotが旧IDいくつだったか」を
  // ファイル名から推測せず一意に決められるようにするための内部フィールド。
  // ページ処理の最後に必ず削除してから書き出す。
  return { annotJson: { filename, rect, actions, _oldId: domData.id, [CRAFT_META_KEY]: craftMeta }, newPngBytes };
}


/**
 * ContentsBuilderの現在の状態からLIBRO book zipを書き出す。
 * state.libroBook（zip・indexJson・unencryptedAssetPaths）は一切変更しない非破壊処理：
 * 冒頭でzip・indexJson・unencryptedAssetPathsをすべて作業用にコピーし、以降の変更は
 * このコピーに対してのみ行う。同一セッションで何度呼び出しても結果は決定論的になる
 * （呼び出し元のDOM dataset等が常に「元zipのファイル名」を指し続けられるため）。
 * コピーに対し、annots[]が変わったページのp####.jsonと、新規マーカーPNG・新規音声
 * （Pbve2000暗号化）のみを上書き・追加する。
 * ページ画像・既存のannots PNG・既存の音声は基本的に書き換えないが、
 * unencryptedAssetPaths に記録されたファイル（別オーサリングツール由来で
 * 元々暗号化されていなかったsounds/*.mp3・annots/*.png）だけは、対応するアノテーションの
 * 編集有無にかかわらず強制的にPbve2000暗号化して上書きする。
 * index.jsonは configs.libro-craft-meta（book全体マーカー、docs/libro_integration_計画書.md 4-3b参照）
 * の追記に加え、実bookの構造（LIBROプラスはindex.json側を参照する）に合わせ、各ページの
 * annots/annot-rangeをp####.json側と同一内容でpages[]側にもミラーする（0件になった場合は
 * 両方から削除し、空配列を残さない）。既存のoutline等は変更しない。
 * ページ単位のアノテーションID正規化：LIBRO+ビューアはHide/Showのtargetsを
 * 「annot-range[0] + annots配列内の位置」で解決する位置ベースモデルであるため
 * （.claude/skills/libro-integration/SKILL.md参照）、各ページのannots確定後、
 * 配列順に応じてID・filename（annots/XXXX.png）・targetsを連番・穴なしへ再採番する。
 * 付箋の閉/開ペア（グループ付箋は各メンバーのペア）は隣接ID（開＝小ID、閉＝大ID）になるよう
 * ユニット化してソートし、それ以外（passthrough・converted・大問ペア等）は1annot=1ユニットとする。
 * ファイル名が変わるannotはannots/*.pngをリネームする（zip内の旧ファイルは削除）。
 * @param {{zip:JSZip, baseDir:string, indexJson:Object, unencryptedAssetPaths?:Set<string>}} libroBook - state.libroBook
 * @param {Array<{id:number, page:number, type:string, style:string, savedData:string}>} domAnnotations
 *   - LIBROに変換可能な種別（pagelink/externallink/audio）のDOM由来アノテーションデータ
 * @param {Array<{pageNum:number, raw:Object}>} passthroughAnnotations - 無変更のまま書き戻すアノテーション
 *   （state.libroUnknownAnnotations＝真に未知のもの、および削除・位置編集されていない大問ボタンの
 *   closed/open生データを合流させたもの）
 * @param {Array<{pageNum:number, members:Array<Object>, groupId:string, kotaePairs?:Array<Object>}>} [domStickyGroups]
 *   - 付箋のグループ一覧（groupId未設定の付箋は単独1件のグループとして渡す。groupIdはlibro-craft-metaの
 *   group-idとして埋め込まれ、再インポート時のグループ復元に使う。kotaePairsは紐付く答ボタンの
 *   closed/openペアid。members・kotaePairsの仕様は convertStickyGroupToLibroAnnots 参照）
 * @param {Array<Object>} [domDaimonButtons] - 新規作成の大問ボタン一覧（storage.jsが紐付き付箋の
 *   closed/open idを解決済みのデータ。仕様は convertDaimonButtonToLibroAnnots 参照）
 * @returns {Promise<JSZip>}
 */
export async function buildLibroBookExport(libroBook, domAnnotations, passthroughAnnotations, domStickyGroups = [], domDaimonButtons = []) {
  const { baseDir } = libroBook;

  // ============================================================
  // セッション状態（state.libroBook）を一切変更しない非破壊エクスポートにするため、
  // zip・indexJson・unencryptedAssetPathsをすべて作業用にコピーしてから処理する。
  // ID正規化（リネーム・削除）はこのコピーに対してのみ行い、元のzip/indexJsonは不変に保つ。
  // これによりDOM側dataset（closedFile/openFile等）は常に「元zipのファイル名」を
  // 指し続けるため、同一セッションで何度書き出しても結果は決定論的になる。
  //
  // JSZip（vendor固定版 3.10.1）にはfiles辞書を独立複製する公式APIが無く、
  // clone()はfolder()参照用の浅いビューでfiles辞書自体を共有してしまうため使えない
  // （確認済み）。代わりに、ZipObjectそのものは.file()/.remove()で置換・削除されるだけで
  // in-place変更されない（3.10.1のJSZip.prototype.file実装で確認済み）ことを利用し、
  // files辞書のエントリ（ZipObject参照）だけを新しいJSZipインスタンスへコピーする。
  // バイト列の複製は発生しないためコストはほぼゼロ。
  const zip = new JSZip();
  Object.keys(libroBook.zip.files).forEach(k => { zip.files[k] = libroBook.zip.files[k]; });

  const indexJson = JSON.parse(JSON.stringify(libroBook.indexJson));
  const unencryptedAssetPaths = new Set(libroBook.unencryptedAssetPaths || []);

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
  const daimonButtonsByPage = new Map();
  domDaimonButtons.forEach(d => {
    if (!daimonButtonsByPage.has(d.pageNum)) daimonButtonsByPage.set(d.pageNum, []);
    daimonButtonsByPage.get(d.pageNum).push(d);
  });

  // annots/は全ページ共有の名前空間で、かつアノテーションIDはグローバル採番のため、
  // 「後続ページの旧IDパス」が「処理済みページの新パス」と偶然一致し得る。ページ単位で
  // 即時にzip読み書き・削除を行うと、その一致により中身の取り違え・誤削除が起こるため、
  // ページループ内では「annotごとの最終filename」と「内容ソース」の収集のみ行い、
  // 実際のzip読み書き・削除は全ページ処理後（ループの外）で一括して行う。
  const pendingCopies = [];             // { annot, oldPath } - 旧パスの既存内容を最終filenameへコピーする
  const pendingNewWrites = [];          // { annot, bytes } - 新規生成バイト列を最終filenameへ書き込む
  const annotsWithNewBytes = new Set(); // pendingNewWritesに載っているannotオブジェクトの集合（重複判定用）
  const allOldPaths = new Set();        // リネームで不要になり得る旧パス（全ページ分の和集合）
  const allFinalPaths = new Set();      // 全ページの最終filename（全annots pngの和集合）
  const unencryptedRepaths = [];        // { oldPath, newPath } - unencryptedAssetPathsの付け替え（全ページ分）

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

    // 未知アノテーションの生データは無変更のまま書き戻す（内部管理用の_idは_oldIdへ移す）。
    // state.libroUnknownAnnotations/libroDaimonPassthrough/libroNetworkPassthrough等の
    // state上のオブジェクトを直接参照しているため、後段のID正規化で書き換える前提として
    // deep copyする（{_id,...clean}の分割は浅いコピーでactions配列等は元オブジェクトと
    // 共有されたままのため、そのままでは再エクスポート時に二重変換されてしまう）。
    // _oldId は「このannotが読込時に持っていた位置ベースID」で、ID正規化の同一性キーに使う
    // （出力直前に削除する）。
    const passthrough = (passthroughByPage.get(pageNum) || [])
      .map(({ _id, ...clean }) => {
        const copy = JSON.parse(JSON.stringify(clean));
        if (_id != null) copy._oldId = _id;
        return copy;
      });

    // 各アノテーションのfilenameは既存のdata-idベースで一意に決まっており、
    // 変換処理も互いに独立しているため並列実行する。
    const convertedResults = await Promise.all(
      (byPage.get(pageNum) || []).map(domData => convertAnnotationToLibroAnnot(domData, pageWidth, pageHeight, zip, baseDir))
    );
    const converted = [];
    convertedResults.forEach(result => {
      if (!result) return;
      converted.push(result.annotJson);
      if (result.newPngBytes) {
        pendingNewWrites.push({ annot: result.annotJson, bytes: result.newPngBytes });
        annotsWithNewBytes.add(result.annotJson);
      }
    });

    const stickyGroupResults = await Promise.all(
      (stickyGroupsByPage.get(pageNum) || []).map(group => convertStickyGroupToLibroAnnots(group.members, pageWidth, pageHeight, group.groupId, group.kotaePairs || []))
    );
    stickyGroupResults.forEach(({ newPngWrites }) => {
      newPngWrites.forEach(({ annot, bytes }) => {
        pendingNewWrites.push({ annot, bytes });
        annotsWithNewBytes.add(annot);
      });
    });
    // convertStickyGroupToLibroAnnotsはメンバーごとに[閉,開]の順でannotJsonsへpushしているため、
    // 2件ずつ組にすれば元のペア関係を復元できる。ID正規化パスでは新しい実データ準拠の並び
    // （開＝hiddenが先、閉が後）にするため、組にする際に順序を入れ替える。
    const stickyUnits = [];
    stickyGroupResults.forEach(({ annotJsons }) => {
      for (let k = 0; k < annotJsons.length; k += 2) {
        stickyUnits.push([annotJsons[k + 1], annotJsons[k]]); // [開, 閉]
      }
    });

    // 新規作成の大問ボタン：紐付き付箋のclosed/open idを使ったHide/Showペアへ変換する。
    // convertDaimonButtonToLibroAnnotsは[closed(通常), open(押下)]の順でannotJsonsを返すため、
    // 実データ準拠の並び（押下＝hiddenが先、通常が後）にするためユニット化時に順序を入れ替える。
    const daimonResults = await Promise.all(
      (daimonButtonsByPage.get(pageNum) || []).map(d => convertDaimonButtonToLibroAnnots(d, pageWidth, pageHeight))
    );
    daimonResults.forEach(({ newPngWrites }) => {
      newPngWrites.forEach(({ annot, bytes }) => {
        pendingNewWrites.push({ annot, bytes });
        annotsWithNewBytes.add(annot);
      });
    });
    const daimonUnits = daimonResults.map(({ annotJsons }) => [annotJsons[1], annotJsons[0]]); // [押下, 通常]

    // ============================================================
    // ページ単位のアノテーションID正規化。
    // LIBRO+ビューアはHide/Showのtargetsを「annot-range[0] + annots配列内の位置」で
    // 解決する位置ベースモデルであることが実機検証で確定しているため、書き出し時に
    // 各ページのIDを「連番・穴なし・交錯なし」へ正規化しないと、新規付箋の開閉が
    // 別のアノテーションを指してしまう等の誤動作が起こる。
    // ============================================================

    // 元のannot-range（この後pageJsonを上書きする前の値。無ければundefined）
    const originalRange = pageJson['annot-range'];

    // 論理ユニット：CRAFT管理の付箋（メンバー単位の閉/開ペア）・新規大問ボタン（自身のペア）は
    // それぞれ2件で1ユニット、それ以外（passthrough・converted・LIBRO由来大問ペアの各raw等）は
    // 1annot=1ユニットとする。
    const units = [
      ...passthrough.map(a => [a]),
      ...converted.map(a => [a]),
      ...stickyUnits,
      ...daimonUnits,
    ];

    // 正規化前の配列順（従来の生成順＝passthrough→converted→付箋[閉,開]→大問[通常,押下]）における
    // 各annotの位置。数値filenameを持たないannot（annots/ffff.png等）のソートキー算出に使う。
    const legacyOrderAnnots = [
      ...passthrough,
      ...converted,
      ...stickyGroupResults.flatMap(r => r.annotJsons),
      ...daimonResults.flatMap(r => r.annotJsons),
    ];
    const origIndexByAnnot = new Map(legacyOrderAnnots.map((a, idx) => [a, idx]));
    const rangeBase0 = originalRange ? originalRange[0] : 0;

    // 各annotの「旧ID」＝ _oldId（DOM側／読込時の実ID。targetsが参照するのと同じ値）。
    // 従来はfilenameの数値を旧IDとみなしていたが、targetsに書かれるのはDOM側のidであり
    // 二重基準になっていた。ファイル名が重複・ずれているbook（過去のCRAFT書き出し由来）では
    // 旧IDが潰れてtargetsが壊れ、大問ボタンと付箋の紐付けが失われる原因になっていた。
    // _oldIdが無い想定外annotのみ、従来どおりfilename→配列位置の順にフォールバックする。
    const oldIdOf = (annot) =>
      annot._oldId ?? filenameToNumericId(annot) ?? (rangeBase0 + (origIndexByAnnot.get(annot) ?? 0));

    // ユニットの並び替えキー＝ユニット内の最小「旧ID」。
    const unitKey = (unit) => {
      const ids = unit.map(oldIdOf).filter(id => id != null);
      if (ids.length) return Math.min(...ids);
      return rangeBase0 + (origIndexByAnnot.get(unit[0]) ?? 0);
    };

    // 安定ソート（キーが同値の場合は元の並び順を維持する）
    const sortedAnnots = units
      .map((unit, idx) => ({ unit, key: unitKey(unit), idx }))
      .sort((a, b) => a.key - b.key || a.idx - b.idx)
      .flatMap(x => x.unit);

    // base：元のannot-rangeがあればその先頭を踏襲し、無い新規annotationページは
    // 「ページ1のbase=1、それ以外は(pageNum-1)*annot-id-block-size」で新規発行する
    // （ページ1のbase=1は実機検証済み。0は未検証のため使わない）。
    const blockSize = indexJson.configs?.['annot-id-block-size'] ?? 300;
    const base = originalRange ? originalRange[0] : (pageNum === 1 ? 1 : (pageNum - 1) * blockSize);

    // 旧ID→新IDのマップを構築する。旧IDが重複した場合（想定外のDOM状態）は先勝ちで採用し、
    // 警告のみ出す（後勝ちにすると先に現れたannotのtargetsが黙って壊れるため）。
    const oldToNewId = new Map();
    sortedAnnots.forEach((annot, idx) => {
      const oldId = oldIdOf(annot);
      if (oldId == null) return;
      if (oldToNewId.has(oldId)) {
        console.warn(`LIBRO書き出し: page ${pageNum} で旧ID ${oldId} が重複しています（先に現れたannotを優先します）`);
        return;
      }
      oldToNewId.set(oldId, base + idx);
    });

    // filenameの改名対象（数値filenameを持ち、かつ最終IDと一致しないannot）を洗い出す。
    // 判定は「新IDから決まる正規ファイル名と現filenameが違うか」で行う（従来の
    // 「旧ID===新IDならスキップ」はファイル名重複時に不整合を温存してしまうため）。
    // annots/ffff.png のような数値でないfilenameは従来どおり改名対象外（共有素材のため）。
    // 実際のzip読み書き・削除はここでは行わず、annot.filenameの更新と内容ソースの記録のみ行う
    // （実際の読み書き・削除はループの外で全ページ分まとめて行う。クロスページ衝突対策）。
    sortedAnnots.forEach((annot, idx) => {
      if (filenameToNumericId(annot) == null) return;
      const newFilename = libroMarkerFilename(base + idx);
      if (annot.filename === newFilename) return;
      const oldPath = baseDir + annot.filename;
      allOldPaths.add(oldPath);
      // 別オーサリングツール由来などで元々暗号化されていなかったファイル（unencryptedAssetPaths）を
      // リネームする場合は、書き出し末尾の強制暗号化パスが新パスを見つけられるよう付け替える。
      if (unencryptedAssetPaths.has(oldPath)) {
        unencryptedRepaths.push({ oldPath, newPath: baseDir + newFilename });
      }
      annot.filename = newFilename;
      // 新規生成バイト列が既にある場合（新規付箋・新規マーカー等）は、そのバイト列を
      // 最終filenameへ直接書き込むだけでよく、旧パスからの内容コピーは不要。
      if (!annotsWithNewBytes.has(annot)) pendingCopies.push({ annot, oldPath });
    });

    // Hide/Show targetsを新IDへ書き換える。対応が見つからないtargetは変更せず警告のみ出す
    // （ページを跨ぐ参照等、想定外の構造に対する安全側フォールバック）。
    sortedAnnots.forEach(annot => {
      (annot.actions || []).forEach(action => {
        if (!Array.isArray(action.targets)) return;
        action.targets = action.targets.map(t => {
          if (oldToNewId.has(t)) return oldToNewId.get(t);
          console.warn(`LIBRO書き出し: page ${pageNum} のtarget id ${t} に対応する新IDが見つからないため変更せず残します`);
          return t;
        });
      });
    });

    // 内部管理用フィールドは出力JSONへ混入させない
    sortedAnnots.forEach(annot => { delete annot._oldId; });

    pageJson.annots = sortedAnnots;
    sortedAnnots.forEach(a => allFinalPaths.add(baseDir + a.filename));

    // LIBROプラスはindex.json側のpages[].annots/annot-rangeを参照するため、
    // p####.json側と完全同一の内容をindex.json側にもミラーする（実bookの構造に準拠）。
    if (sortedAnnots.length) {
      pageJson['annot-range'] = [base, base + sortedAnnots.length];
      pageMeta.annots = pageJson.annots;
      pageMeta['annot-range'] = pageJson['annot-range'];
    } else {
      delete pageJson.annots;
      delete pageJson['annot-range'];
      delete pageMeta.annots;
      delete pageMeta['annot-range'];
    }

    zip.file(pageJsonPath, JSON.stringify(pageJson));
  }

  // ============================================================
  // annots pngの実際のzip読み書き・削除を、全ページのfilename確定後に一括して行う
  // （クロスページ衝突対策。詳細は.claude/skills/libro-integration/SKILL.md参照）。
  // Pass1で「旧パス由来」の内容を全ページ分読み切ってから（この時点ではまだ1件も
  // 書き込んでいないため、後続ページの旧パスが処理済みページの新内容で上書きされていることはない）、
  // Pass2で全annotの最終filenameへ書き込む。削除は最後に、全ページの旧パス集合から
  // 全ページの最終filename集合を差し引いた残りだけを対象にする。
  // ============================================================
  const copyBytesByOldPath = new Map();
  for (const { oldPath } of pendingCopies) {
    if (copyBytesByOldPath.has(oldPath)) continue;
    const entry = zip.file(oldPath);
    if (entry) copyBytesByOldPath.set(oldPath, await entry.async('uint8array'));
  }
  pendingCopies.forEach(({ annot, oldPath }) => {
    const bytes = copyBytesByOldPath.get(oldPath);
    if (bytes) zip.file(baseDir + annot.filename, bytes);
  });
  pendingNewWrites.forEach(({ annot, bytes }) => {
    zip.file(baseDir + annot.filename, bytes);
  });
  unencryptedRepaths.forEach(({ oldPath, newPath }) => {
    unencryptedAssetPaths.delete(oldPath);
    unencryptedAssetPaths.add(newPath);
  });
  allOldPaths.forEach(oldPath => {
    if (!allFinalPaths.has(oldPath)) zip.remove(oldPath);
  });

  // book全体マーカー：このbookが（少なくとも一度）CRAFTで書き出されたことを示す。
  // 既存の configs（generator等）は上書きせず併存させる。
  //
  // settings：環境設定のbook単位保存。Jストリーム設定・大問ボタン文言は教材（出版社）ごとに
  // 固定される値のため、書き出し時点の値をbookへ記録し、次回読込時に自動適用する
  // （settings.js の applyBookSettings 参照）。書き出し時のみ記録し、環境設定モーダルの
  // OK押下では書き込まない（localStorage への保存は従来どおり settings.js 側で行う）。
  indexJson.configs = indexJson.configs || {};
  indexJson.configs[CRAFT_META_KEY] = {
    editor: 'libro_craft',
    'schema-version': CRAFT_META_SCHEMA_VERSION,
    settings: {
      stickyDefaultColor: state.settingsStickyDefaultColor,
      customStickyColors: [...state.settingsCustomStickyColors],
      daimonLabel:        state.settingsDaimonLabel,
      jstreamDir:         state.settingsJstreamDir,
      jstreamCorpId:      state.settingsJstreamCorpId,
    },
  };
  zip.file(baseDir + 'index.json', JSON.stringify(indexJson));

  // 新規追加された音声ファイル（元zipにまだ存在しないもの）のみPbve2000暗号化して追加
  // キー：実際にzipへ書き込むファイル名（ex_/in_プレフィックス込み）→ mediaBlobs参照キー（プレフィックス無し）
  const referencedAudio = new Map();
  domAnnotations.forEach(a => {
    if (a.type !== 'audio') return;
    try {
      const sd = JSON.parse(a.savedData || '{}');
      const baseName = stripAudioPrefix((sd.annFile || '').trim());
      if (!baseName) return;
      referencedAudio.set(libroSoundFilename(sd.annFile, sd.annPlayMode), `${baseName}.mp3`);
    } catch (_) {}
  });
  // 各音声ファイルは互いに独立して読込・暗号化できるため並列実行する
  await Promise.all([...referencedAudio].map(async ([zipFileName, mediaKey]) => {
    const soundPath = baseDir + 'sounds/' + zipFileName;
    if (zip.file(soundPath)) return; // 既存音声は無変更
    const blobUrl = mediaBlobs[mediaKey];
    if (!blobUrl) return;
    const res = await fetch(blobUrl);
    const buf = new Uint8Array(await res.arrayBuffer());
    zip.file(soundPath, encodePbve2000(buf));
  }));

  // 別オーサリングツール由来などで元々暗号化されていなかったファイル（ページ画像、sounds/*.mp3、
  // annots/*.png）は、対応するアノテーションの編集有無にかかわらず必ず暗号化して保存する
  // （インポート時にlibroBook.unencryptedAssetPathsへ記録済み。編集により新規生成された
  // ファイルが既に暗号化済みの場合はスキップする）。各ファイルは互いに独立しているため並列実行する。
  await Promise.all([...unencryptedAssetPaths].map(async (path) => {
    const entry = zip.file(path);
    if (!entry) return;
    const buf = await entry.async('arraybuffer');
    if (isPbve2000Encoded(buf)) return;
    zip.file(path, encodePbve2000(buf));
  }));

  return zip;
}
