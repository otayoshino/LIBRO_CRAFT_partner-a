import { syncJstreamDefaults, syncStickyDefaultColor } from './annotation-dialog.js';
import { validateJstreamCorpId, validateJstreamDir } from './jstream-validate.js';
import { state } from './state.js';

/* =========================================================
   環境設定モーダル

   - 付箋のデフォルトカラー・大問ボタン作成メニューのラベル文言・
     J-stream動画のデフォルト値（Jストリームディレクトリ／企業ID）を設定する。
   - 設定値は state に保持し、OK押下時に localStorage（SETTINGS_STORAGE_KEY）へ
     永続化する。起動時は main.js が loadSettings() を呼んで復元する。
   ========================================================= */

/** 環境設定の永続化に使う localStorage キー */
const SETTINGS_STORAGE_KEY = 'ContentsBuilderSettings';

/** 付箋デフォルトカラーとして許容する値（STICKY_COLOR_MAP のインデックス文字列） */
const STICKY_COLOR_VALUES = ['0', '1', '2', '3'];

/** 大問ボタン作成メニューのラベルとして許容する値 */
const DAIMON_LABEL_VALUES = ['大問', 'ALL', '解答'];

/**
 * localStorage に保存された環境設定を state へ復元する（起動時に1度だけ呼ぶ）。
 * 保存値が壊れている・想定外の値の場合はその項目を無視し、state 側の初期値を使う。
 */
export function loadSettings() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || 'null');
  } catch (_) {
    saved = null;
  }
  if (!saved || typeof saved !== 'object') return;

  if (STICKY_COLOR_VALUES.includes(saved.stickyDefaultColor)) {
    state.settingsStickyDefaultColor = saved.stickyDefaultColor;
  }
  if (DAIMON_LABEL_VALUES.includes(saved.daimonLabel)) {
    state.settingsDaimonLabel = saved.daimonLabel;
  }
  if (typeof saved.jstreamDir === 'string') {
    state.settingsJstreamDir = saved.jstreamDir;
  }
  if (typeof saved.jstreamCorpId === 'string') {
    state.settingsJstreamCorpId = saved.jstreamCorpId;
  }
}

/**
 * 現在の state の環境設定値を localStorage へ保存する。
 * プライベートモード等で localStorage が使えない場合は永続化のみ諦め、
 * セッション内の設定（state）はそのまま有効にする。
 */
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      stickyDefaultColor: state.settingsStickyDefaultColor,
      daimonLabel:        state.settingsDaimonLabel,
      jstreamDir:         state.settingsJstreamDir,
      jstreamCorpId:      state.settingsJstreamCorpId,
    }));
  } catch (_) {
    /* 保存できない環境では何もしない */
  }
}

/**
 * 検証結果に応じてエラー表示・確認ダイアログを出し、設定の反映を続行してよいかを返す。
 * - error：反映不可。動画再生タブへ切り替え、該当欄にフォーカスしてエラーメッセージを表示する。
 * - warn ：confirm でユーザーがOKを選んだ場合のみ続行する。
 * @param {{level:'ok'|'warn'|'error', message:string}} result
 * @param {HTMLInputElement} input - 検証対象の入力欄
 * @returns {boolean} true なら反映を続行してよい
 */
function confirmJstreamValue(result, input) {
  const el = document.getElementById('settingsJstreamError');
  if (result.level === 'error') {
    if (el) {
      el.textContent = result.message;
      el.classList.add('is-shown');
    }
    switchSettingsTab('video');
    input.focus();
    return false;
  }
  // errorでなくなった時点で、前回表示したエラーメッセージは解消済みなのでクリアする
  // （警告confirmをキャンセルして early return する場合に古い文言が残らないようにする）
  if (el) {
    el.textContent = '';
    el.classList.remove('is-shown');
  }
  if (result.level === 'warn' && !window.confirm(result.message)) {
    switchSettingsTab('video');
    input.focus();
    return false;
  }
  return true;
}

/**
 * 環境設定モーダルを開く。現在のstate値をフォームへ反映してから表示する。
 */
export function openSettingsModal() {
  document.getElementById('settingsStickyColorSelect').value = state.settingsStickyDefaultColor;
  document.getElementById('settingsDaimonLabelSelect').value = state.settingsDaimonLabel;
  document.getElementById('settingsJstreamDirInput').value    = state.settingsJstreamDir;
  document.getElementById('settingsJstreamCorpIdInput').value = state.settingsJstreamCorpId;
  // 前回開いたときのエラー表示は持ち越さない
  const errEl = document.getElementById('settingsJstreamError');
  if (errEl) {
    errEl.textContent = '';
    errEl.classList.remove('is-shown');
  }
  document.getElementById('settingsOverlay').classList.add('is-open');
}

/**
 * 環境設定モーダルを閉じる。
 * @param {boolean} save - trueならフォーム値をstateへ反映し、大問ボタン作成メニューのラベルを更新して localStorage へ保存する。
 */
export function closeSettingsModal(save) {
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay || !overlay.classList.contains('is-open')) return;

  if (save) {
    // J-streamのデフォルト値は書き出し時にそのまま toMovie の引数となるため、
    // 反映前にJ-Streamの想定入力値かを検証する。形式としてありえない値（error）は
    // 反映せずモーダルを開いたままにし、想定パターン外だが形式は成立する値（warn）は
    // confirm で確認のうえ反映する。空欄（未設定）は常に許容する。
    // 前後の空白は検証・保持のいずれでも除去する（意図しない空白混入を防ぐ）。
    const dirInput   = document.getElementById('settingsJstreamDirInput');
    const corpInput  = document.getElementById('settingsJstreamCorpIdInput');
    const dirValue   = dirInput.value.trim();
    const corpValue  = corpInput.value.trim();
    if (!confirmJstreamValue(validateJstreamDir(dirValue), dirInput)) return;
    if (!confirmJstreamValue(validateJstreamCorpId(corpValue), corpInput)) return;

    state.settingsStickyDefaultColor = document.getElementById('settingsStickyColorSelect').value;
    state.settingsDaimonLabel        = document.getElementById('settingsDaimonLabelSelect').value;
    state.settingsJstreamDir    = dirValue;
    state.settingsJstreamCorpId = corpValue;
    // 連続作成用の前回設定（lastNewAnnData.sticky）の色も新デフォルトへ揃える。
    // これをしないと、既に付箋を作成済みのセッションで設定変更が反映されない。
    syncStickyDefaultColor(state.settingsStickyDefaultColor);
    // 同様に、連続作成用の前回設定（lastNewAnnData.video）のJ-stream値も新デフォルトへ揃える。
    syncJstreamDefaults(state.settingsJstreamDir, state.settingsJstreamCorpId);
    // 付箋の描画モード中は、生成済みのサイドバー色セレクトも新デフォルトへ追従させる。
    // ただしオブジェクト選択中は同じセレクトが「選択中付箋の色編集用」として使われているため、
    // 書き換えると選択中の付箋の色を意図せず変えてしまう。選択中は追従させない。
    const liveColorSel = document.getElementById('annColor');
    const hasSelection = !!document.querySelector('.is-selected');
    if (liveColorSel && state.currentDrawType === 'sticky' && !hasSelection) {
      liveColorSel.value = String(state.settingsStickyDefaultColor);
    }
    applyDaimonMenuLabel();
    saveSettings();
  }

  overlay.classList.remove('is-open');
}

/** サイドバーの大問ボタン作成メニューのラベルを state.settingsDaimonLabel から反映する。 */
export function applyDaimonMenuLabel() {
  const el = document.getElementById('daimonMenuLabel');
  if (el) el.textContent = `${state.settingsDaimonLabel}ボタン`;
}


/**
 * 環境設定モーダルのサイドタブを切り替える。
 * タブ（.settings-tab[data-settings-tab]）と内容ペイン（.settings-pane[data-settings-pane]）を
 * 同じキー文字列で対応付けており、タブを増やす場合はHTML側に対を追加するだけでよい。
 * @param {string} tabKey - data-settings-tab / data-settings-pane の値
 */
function switchSettingsTab(tabKey) {
  document.querySelectorAll('#settingsOverlay .settings-tab').forEach(tab => {
    tab.classList.toggle('is-active', tab.dataset.settingsTab === tabKey);
  });
  document.querySelectorAll('#settingsOverlay .settings-pane').forEach(pane => {
    pane.classList.toggle('is-active', pane.dataset.settingsPane === tabKey);
  });
}


/**
 * サイドタブのクリックハンドラを設定する（初期化時に1度だけ呼ぶ）。
 * タブコンテナへのイベント委譲にしてあるため、将来タブを追加しても配線の変更は不要。
 */
export function initSettingsTabs() {
  const tabs = document.getElementById('settingsTabs');
  if (!tabs) return;
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.settings-tab');
    if (!btn || !btn.dataset.settingsTab) return;
    switchSettingsTab(btn.dataset.settingsTab);
  });
}
