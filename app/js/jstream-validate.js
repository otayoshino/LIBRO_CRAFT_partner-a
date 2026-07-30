/* =========================================================
   J-stream入力値の検証

   - 環境設定モーダル（settings.js）とクイック作成／編集ポップアップ
     （annotation-dialog.js）の双方から使う判定ロジック。
   - 判定は引数の文字列のみで完結し、DOM・stateには一切触れない
     （settings.js ⇔ annotation-dialog.js の循環参照を避けるための末端モジュール）。
   - 判定基準はJ-Stream Equipmediaの貼付タグ（b＝プレイヤー構成ファイルのパス、
     c＝お客様ID（難読化形式）、m＝動画ID（難読化形式））と実データに基づく。
   ========================================================= */

/**
 * Jストリームディレクトリの想定形式。J-Stream Equipmediaの顧客ディレクトリ名は
 * 貼付タグのパラメータ「b」のホスト名先頭にあたり、実データ・公式ドキュメントとも
 * `eq` ＋ 半角英小文字/数字8桁。
 */
const JSTREAM_DIR_PATTERN = /^eq[0-9a-z]{8}$/;

/** 難読化ID（企業ID・動画ID）がBase64として成立するかの文字集合判定 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;


/**
 * Base64文字列を復号する。J-Streamの難読化ID（企業ID・動画ID）は数値のASCII文字列を
 * Base64化したものであり、復号結果もASCII前提のため atob の戻り値をそのまま扱う。
 * 形式が不正で復号できない場合は null を返す。
 * @param {string} v
 * @returns {string|null}
 */
function decodeBase64(v) {
  if (!BASE64_PATTERN.test(v) || v.length % 4 !== 0) return null;
  try {
    return atob(v);
  } catch (_) {
    return null;
  }
}


/**
 * Jストリームディレクトリの入力値がJ-Streamの想定入力値かを判定する。
 * 空文字（未入力）は許容する。想定外の値はすべて error とし、確認ダイアログは出さない。
 * @param {string} v - トリム済みの入力値
 * @returns {{level:'ok'|'error', message:string}}
 */
export function validateJstreamDir(v) {
  if (v === '') return { level: 'ok', message: '' };
  if (!/^[0-9a-zA-Z]+$/.test(v)) {
    return {
      level: 'error',
      message: 'Jストリームディレクトリは半角英数字のみで入力してください。\nURLや貼付タグ全体ではなく、ディレクトリ名だけを入力します。',
    };
  }
  if (!JSTREAM_DIR_PATTERN.test(v)) {
    return {
      level: 'error',
      message: 'Jストリームディレクトリの想定形式（「eq」＋半角英小文字・数字8桁）と異なります。',
    };
  }
  return { level: 'ok', message: '' };
}


/**
 * 難読化ID（企業ID・Jストリーム難読化ID）の入力値がJ-Streamの想定入力値かを判定する。
 * 企業ID＝貼付タグのパラメータ「c」、難読化ID＝同「m」で、いずれも数値をBase64化した
 * 同一形式のため判定基準を共有し、文言だけを差し替える。
 * 空文字（未入力）は許容する。想定外の値はすべて error とし、確認ダイアログは出さない。
 * @param {string} v - トリム済みの入力値
 * @param {{label:string, param:string, plainLabel:string}} labels - 項目名／貼付タグのパラメータ名／平文値の呼称
 * @returns {{level:'ok'|'error', message:string}}
 */
function validateObfuscatedId(v, labels) {
  if (v === '') return { level: 'ok', message: '' };
  if (/^[0-9]+$/.test(v)) {
    return {
      level: 'error',
      message: `${labels.label}は難読化（Base64）形式で入力してください。\n${labels.plainLabel}ではなく、貼付タグのパラメータ「${labels.param}」の値をそのまま貼り付けます。`,
    };
  }
  const decoded = decodeBase64(v);
  if (decoded === null) {
    return {
      level: 'error',
      message: `${labels.label}は難読化（Base64）形式で入力してください。\nJ-Stream管理画面の貼付タグのパラメータ「${labels.param}」の値をそのまま貼り付けます。`,
    };
  }
  if (!/^[0-9]{1,10}$/.test(decoded)) {
    return {
      level: 'error',
      message: `${labels.label}の想定形式（数値をBase64化した難読化文字列）と異なります。`,
    };
  }
  return { level: 'ok', message: '' };
}


/**
 * 企業ID（難読化形式・貼付タグのパラメータ「c」）の入力値を判定する。
 * @param {string} v - トリム済みの入力値
 * @returns {{level:'ok'|'error', message:string}}
 */
export function validateJstreamCorpId(v) {
  return validateObfuscatedId(v, { label: '企業ID', param: 'c', plainLabel: '平文の企業ID' });
}


/**
 * Jストリーム難読化ID（動画ID・貼付タグのパラメータ「m」）の入力値を判定する。
 * @param {string} v - トリム済みの入力値
 * @returns {{level:'ok'|'error', message:string}}
 */
export function validateJstreamVideoId(v) {
  return validateObfuscatedId(v, { label: 'Jストリーム難読化ID', param: 'm', plainLabel: '平文の動画ID' });
}
