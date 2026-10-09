import { deactivateAnnotationMode, deselectAllObjects } from './annotation-interaction.js';
import { resetAllButtonPressedImages } from './buttons.js';
import { stopAllAudio } from './annotation-actions.js';
import { state } from './state.js';
import { updateStatus } from './ui-common.js';
import { trackEvent } from './analytics.js';


    export function switchToViewMode() {
      trackEvent('mode_switch', { mode: 'view' });
      // 描画モード中ならキャンセル
      if (state.currentDrawType) deactivateAnnotationMode();

      // オブジェクトの選択を全解除
      deselectAllObjects();

      document.body.classList.add('is-view-mode');

      // ボタンを「編集モードに切替」に変更
      const btn = document.getElementById('modeSwitchBtn');
      btn.classList.replace('toDisplay', 'toEdit');
      btn.querySelector('svg use').setAttribute('href', 'icons/sprite.svg#icon-edit');
      document.getElementById('modeSwitchBtnLabel').textContent = '編集モードに切替';
      btn.onclick = switchToEditMode;

      updateStatus();
    }


    /**
     * 編集モードに戻る。
     * - オーサリングパネル・付箋パーツ操作を再表示
     */
    function switchToEditMode() {
      trackEvent('mode_switch', { mode: 'edit' });
      document.body.classList.remove('is-view-mode');

      // 閲覧モードで鳴らした音声をすべて止め、コントローラーを消す（2026-10-09 音声の修正 G）
      stopAllAudio();

      // 閲覧モード中に各ボタンによって変更された付箋の状態をすべて元に戻す
      document.querySelectorAll('.sticky-note').forEach(note => {
        // 大問ボタン・答ボタンによる表示/非表示状態を元に戻す
        note.classList.remove('state-hidden');
        note.classList.add('state-visible');
        // 証明ボタンによるアウトライン・背景色の変更を元に戻す
        if (note.dataset.shomeiOutline === '1') {
          note.style.background = '#ffffff';
          note.style.outline = '';
          delete note.dataset.shomeiOutline;
        }
      });

      // 閲覧モード中に押下された大問/答/証明ボタンの見た目を通常時画像へ戻す
      resetAllButtonPressedImages();

      const btn = document.getElementById('modeSwitchBtn');
      btn.classList.replace('toEdit', 'toDisplay');
      btn.querySelector('svg use').setAttribute('href', 'icons/sprite.svg#icon-mode-switch');
      document.getElementById('modeSwitchBtnLabel').textContent = '閲覧モードに切替';
      btn.onclick = switchToViewMode;

      updateStatus();
    }
