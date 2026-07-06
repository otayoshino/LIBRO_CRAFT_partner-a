import { mediaBlobs } from './state.js';
import { ANNOTATION_TYPE_CONFIG } from './config.js';
import { addStickyClickHandler } from './sticky.js';
import { makeDraggable, makeResizable } from './annotation-interaction.js';
import { addDaimonClickHandler, renderButtonVisual } from './buttons.js';

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

/** libro-craft-meta のスキーマバージョン（互換性が必要な変更をする際に上げる） */
const CRAFT_META_SCHEMA_VERSION = 1;

/**
 * annots[] 単位のlibro-craft-metaを付与しうる種別（Hide/Showトグル系のみ。
 * pagelink/uri/launchはactions構成のみで一意判定できるため対象外）。
 */
const CRAFT_META_TOGGLE_TYPES = new Set(['sticky', 'kotae', 'daimon', 'shomei', 'zu']);

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
 * @returns {{ pairs: Array<{closed:Object, open:Object, groupId:string, type:string}>, consumedIds: Set<number> }}
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
      pairs.push({ closed, open, groupId, type: closed[CRAFT_META_KEY].type });
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
 * ページ内のannots[]を、ContentsBuilderの既知アノテーション（annotations.json互換オブジェクト）、
 * 付箋Hide/Showペア（togglePairs。位置・グループ編集および書き出しに対応）、
 * 編集不可アノテーション（未知パターンのみ。書き出し時は無変更のまま書き戻す）
 * とに分類・変換する。
 *
 * `libro-craft-meta` を持つ要素（CRAFT自身が書き出したbook由来）は最優先でグループ復元し、
 * それ以外（他システム由来、または未知の構造）のみ既存の構造ヒューリスティック
 * （findTogglePairs/detectDaimonGroup）にフォールバックする。
 * @param {Object} pageJson - p####.json のパース済みオブジェクト
 * @param {number} pageNum - 1始まりのページ番号
 * @returns {{ known: Array<Object>, unknown: Array<Object>, togglePairs: Array<Object>, daimonPassthrough: Array<Object>, networks: Array<Object>, maxId: number }}
 */
function convertPageAnnotations(pageJson, pageNum) {
  const annots = (pageJson.annots || []).map(a => {
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

  metaResult.pairs.forEach(({ closed, open, groupId, type }) => {
    maxId = Math.max(maxId, closed._id || 0, open._id || 0);
    const kind = type === 'daimon' ? 'daimon' : 'sticky';
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
    });
    if (kind === 'daimon') daimonPassthrough.push({ pageNum, closedId: closed._id, closed, open });
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
        });
      } else if (call?.fn === 'toMovie' || call?.fn === 'toMovieBNR') {
        known.push({
          className: 'ann-object',
          type: 'video',
          id: a._id,
          page: pageNum,
          style: style + `background:${ANNOTATION_TYPE_CONFIG.video.color};`,
          savedData: JSON.stringify({ annDisplayType: 'marker', annVideoSrc: '2', annVideoFn: call.fn, annVideoArg: call.args }),
        });
      } else {
        known.push({
          className: 'ann-object',
          type: 'externallink',
          id: a._id,
          page: pageNum,
          style: style + `background:${ANNOTATION_TYPE_CONFIG.externallink.color};`,
          savedData: JSON.stringify({ annDisplayType: 'marker', annUrl: uriValue }),
        });
      }
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
    // （resolveMediaSrc は "ファイル名.mp3" 形式のキーを参照するため、拡張子込みで格納する）。
    // 別オーサリングツール由来で実際には暗号化されていない場合があるため、ヘッダーを見て判定する。
    for (const annot of (pageJson.annots || [])) {
      for (const action of (annot.actions || [])) {
        if (action.action === 'Launch' && action.filename) {
          const baseName = action.filename.split('/').pop();
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

  // annots画像を読み込んでBlobURL化する共通ヘルパー。
  // 通常は平文PNGだが、別オーサリングツール由来で実際にはPbve2000暗号化されている
  // 場合もあるため、ヘッダーを見て判定する（暗号化されていた場合のみ復号する）。
  async function loadAnnotPngBytes(path) {
    const entry = zip.file(path);
    if (!entry) return null;
    const buf = await entry.async('arraybuffer');
    if (isPbve2000Encoded(buf)) return decodePbve2000(buf);
    unencryptedAssetPaths.add(path);
    return new Uint8Array(buf);
  }

  // Hide/Showペア用のannots画像をBlobURL化する
  const togglePairs = [];
  for (const tp of togglePairsRaw) {
    const closedBytes = await loadAnnotPngBytes(tp.baseDir + tp.closedFile);
    const openBytes   = await loadAnnotPngBytes(tp.baseDir + tp.openFile);
    if (!closedBytes || !openBytes) continue;
    togglePairs.push({
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
      closedImageUrl: URL.createObjectURL(new Blob([closedBytes], { type: 'image/png' })),
      openImageUrl:   URL.createObjectURL(new Blob([openBytes],   { type: 'image/png' })),
    });
  }

  // 拡張トグルネットワーク（色分けボタン・ステップボタン等）用のannots画像をBlobURL化する。
  // 生データ（member.raw、書き出し時にそのまま書き戻す）にはURLを書き込まず、
  // 表示専用のimagesテーブル（id -> blobUrl）として並置する。
  const networkGroups = [];
  for (const net of networksRaw) {
    const images = new Map();
    for (const m of net.members) {
      const bytes = await loadAnnotPngBytes(net.baseDir + m.filename);
      if (!bytes) continue;
      images.set(m._id, URL.createObjectURL(new Blob([bytes], { type: 'image/png' })));
    }
    networkGroups.push({ ...net, images });
  }

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
 * `libro-craft-meta` の group-id により複数メンバーのグループ（CRAFT自身が書き出した付箋グループ）
 * であることが判明した場合は、通常のCRAFT付箋グループと同じ dataset.groupId を設定する。
 * これにより addStickyClickHandler の既存のグループ一括開閉ロジックがそのまま機能する。
 * @param {Array<Object>} togglePairs - parseLibroBookZip が返す togglePairs
 */
export function renderTogglePairs(togglePairs) {
  const page = document.getElementById('pageLeft');
  const pageRect = page.getBoundingClientRect();
  const wrapByKey = new Map(); // `${pageNum}:${id}` -> 要素（closedId・openId両方をキーに登録。答ボタンリンク解決用）

  // groupIdごとのメンバー数を数え、複数メンバーのグループのみdataset.groupIdを設定する
  // （ソロ付箋のgroup-idはCRAFT側のgrp-N形式と衝突しない合成値のため、単独では設定不要）
  const groupMemberCounts = new Map();
  togglePairs.forEach(tp => {
    if (!tp.groupId) return;
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

    if (tp.kind === 'daimon') {
      // 実物のPNG（閉/開）をネイティブ大問ボタンの「画像素材」として登録する
      mediaBlobs[tp.closedFile] = tp.closedImageUrl;
      mediaBlobs[`pressed__${tp.closedFile}`] = tp.openImageUrl;

      const savedData = { btnPreset: '0', btnScale: '1', btnImageFile: tp.closedFile };
      const el = document.createElement('div');
      el.className        = 'daimon-btn libro-toggle';
      el.dataset.type      = 'daimon';
      el.dataset.id        = tp.closedId;
      el.dataset.libroToggle = '1';
      el.dataset.daimonId  = `libro-daimon-${tp.pageNum}-${tp.closedId}`;
      el.dataset.page      = tp.pageNum;
      el.dataset.savedData = JSON.stringify(savedData);
      el.style.cssText = `left:${leftPx}px; top:${topPx}px; width:${widthPx}px; height:${heightPx}px;`;
      renderButtonVisual(el, 'daimon', savedData);

      addDaimonClickHandler(el);
      makeDraggable(el);

      wrapByKey.set(`${tp.pageNum}:${tp.closedId}`, el);
      wrapByKey.set(`${tp.pageNum}:${tp.openId}`,   el);
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

  // 大問ボタンに紐付く答ボタン群を dataset.daimonId でリンクする
  // （ネイティブの大問ボタン機能 addDaimonClickHandler が閲覧モードでこのidを見て一括開閉する）
  togglePairs.forEach(tp => {
    if (tp.kind !== 'daimon') return;
    const leaderEl = wrapByKey.get(`${tp.pageNum}:${tp.closedId}`);
    if (!leaderEl) return;
    const did = leaderEl.dataset.daimonId;
    (tp.groupIds || []).forEach(gid => {
      const followerWrap = wrapByKey.get(`${tp.pageNum}:${gid}`);
      if (followerWrap && followerWrap !== leaderEl) followerWrap.dataset.daimonId = did;
    });
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
  const pageRect = page.getBoundingClientRect();

  networkGroups.forEach(net => {
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
        const member = net.members.find(m => m._id === id);
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
 * @param {string} groupId - グループ内の全メンバーが共有する一意なid（storage.jsのdata-group-id、
 *   ソロ付箋は合成id）。libro-craft-metaの group-id としてメンバー全員の closed/open annotに
 *   埋め込み、再インポート時に構造ヒューリスティックに頼らずグループを確実に復元できるようにする。
 * @returns {Promise<{annotJsons:Array<Object>, newPngWrites:Array<{path:string, bytes:Uint8Array}>}>}
 */
export async function convertStickyGroupToLibroAnnots(members, pageWidth, pageHeight, zip, baseDir, groupId) {
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
      [CRAFT_META_KEY]: { type: 'sticky', role: 'closed', 'group-id': groupId },
    });
    annotJsons.push({
      filename: openFile,
      rect,
      hidden: true,
      actions: [
        { action: 'Hide', targets: openIds },
        { action: 'Show', targets: closedIds },
      ],
      [CRAFT_META_KEY]: { type: 'sticky', role: 'open', 'group-id': groupId },
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
  } else if (domData.type === 'plusfile') {
    actions = [{ action: 'URI', uri: `toAppendix("${(sd.annFile || '').trim()}",${sd.annShowMode || '0'})` }];
  } else if (domData.type === 'video' && sd.annVideoSrc === '2') {
    // LIBRO由来のtoMovie/toMovieBNRリンクのみ対応（引数の意味は未解析のため生文字列をそのまま書き戻す）。
    // 内部ファイル/外部タグ指定（annVideoSrc: '0'/'1'）はLIBRO側に対応actionが無いため未対応のまま。
    const fn = sd.annVideoFn === 'toMovieBNR' ? 'toMovieBNR' : 'toMovie';
    actions = [{ action: 'URI', uri: `${fn}(${sd.annVideoArg || ''})` }];
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
 * ページ画像・既存のannots PNG・既存の音声は基本的に書き換えないが、
 * libroBook.unencryptedAssetPaths に記録されたファイル（別オーサリングツール由来で
 * 元々暗号化されていなかったsounds/*.mp3・annots/*.png）だけは、対応するアノテーションの
 * 編集有無にかかわらず強制的にPbve2000暗号化して上書きする。
 * index.jsonは configs.libro-craft-meta（book全体マーカー、docs/libro_integration_計画書.md 4-3b参照）
 * の追記のみ行い、既存のoutline等は変更しない。
 * @param {{zip:JSZip, baseDir:string, indexJson:Object, unencryptedAssetPaths?:Set<string>}} libroBook - state.libroBook
 * @param {Array<{id:number, page:number, type:string, style:string, savedData:string}>} domAnnotations
 *   - LIBROに変換可能な種別（pagelink/externallink/audio）のDOM由来アノテーションデータ
 * @param {Array<{pageNum:number, raw:Object}>} passthroughAnnotations - 無変更のまま書き戻すアノテーション
 *   （state.libroUnknownAnnotations＝真に未知のもの、および削除・位置編集されていない大問ボタンの
 *   closed/open生データを合流させたもの）
 * @param {Array<{pageNum:number, members:Array<Object>, groupId:string}>} [domStickyGroups] - 付箋のグループ一覧
 *   （groupId未設定の付箋は単独1件のグループとして渡す。groupIdはlibro-craft-metaのgroup-idとして
 *   埋め込まれ、再インポート時のグループ復元に使う。members仕様は convertStickyGroupToLibroAnnots 参照）
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
      const { annotJsons, newPngWrites } = await convertStickyGroupToLibroAnnots(group.members, pageWidth, pageHeight, zip, baseDir, group.groupId);
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

  // book全体マーカー：このbookが（少なくとも一度）CRAFTで書き出されたことを示す。
  // 既存の configs（generator等）は上書きせず併存させる。
  indexJson.configs = indexJson.configs || {};
  indexJson.configs[CRAFT_META_KEY] = { editor: 'libro_craft', 'schema-version': CRAFT_META_SCHEMA_VERSION };
  zip.file(baseDir + 'index.json', JSON.stringify(indexJson));

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

  // 別オーサリングツール由来などで元々暗号化されていなかったファイル（sounds/*.mp3、
  // annots/*.png）は、対応するアノテーションの編集有無にかかわらず必ず暗号化して保存する
  // （インポート時にlibroBook.unencryptedAssetPathsへ記録済み。編集により新規生成された
  // ファイルが既に暗号化済みの場合はスキップする）。
  for (const path of (libroBook.unencryptedAssetPaths || [])) {
    const entry = zip.file(path);
    if (!entry) continue;
    const buf = await entry.async('arraybuffer');
    if (isPbve2000Encoded(buf)) continue;
    zip.file(path, encodePbve2000(buf));
  }

  return zip;
}
