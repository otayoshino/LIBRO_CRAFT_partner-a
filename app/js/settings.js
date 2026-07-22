import { syncStickyDefaultColor } from './annotation-dialog.js';
import { state } from './state.js';

/* =========================================================
   環境設定モーダル

   - 付箋のデフォルトカラー・大問ボタン作成メニューのラベル文言を設定する。
   - 設定値はstateにのみ保持し、永続化は行わない（ページ再読み込みで初期値に戻る）。
   ========================================================= */

/**
 * 環境設定モーダルを開く。現在のstate値をフォームへ反映してから表示する。
 */
export function openSettingsModal() {
  document.getElementById('settingsStickyColorSelect').value = state.settingsStickyDefaultColor;
  document.getElementById('settingsDaimonLabelSelect').value = state.settingsDaimonLabel;
  document.getElementById('settingsOverlay').classList.add('is-open');
}

/**
 * 環境設定モーダルを閉じる。
 * @param {boolean} save - trueならフォーム値をstateへ反映し、大問ボタン作成メニューのラベルを更新する。
 */
export function closeSettingsModal(save) {
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay || !overlay.classList.contains('is-open')) return;

  if (save) {
    state.settingsStickyDefaultColor = document.getElementById('settingsStickyColorSelect').value;
    state.settingsDaimonLabel        = document.getElementById('settingsDaimonLabelSelect').value;
    // 連続作成用の前回設定（lastNewAnnData.sticky）の色も新デフォルトへ揃える。
    // これをしないと、既に付箋を作成済みのセッションで設定変更が反映されない。
    syncStickyDefaultColor(state.settingsStickyDefaultColor);
    // 付箋の描画モード中は、生成済みのサイドバー色セレクトも新デフォルトへ追従させる。
    // ただしオブジェクト選択中は同じセレクトが「選択中付箋の色編集用」として使われているため、
    // 書き換えると選択中の付箋の色を意図せず変えてしまう。選択中は追従させない。
    const liveColorSel = document.getElementById('annColor');
    const hasSelection = !!document.querySelector('.is-selected');
    if (liveColorSel && state.currentDrawType === 'sticky' && !hasSelection) {
      liveColorSel.value = String(state.settingsStickyDefaultColor);
    }
    applyDaimonMenuLabel();
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
