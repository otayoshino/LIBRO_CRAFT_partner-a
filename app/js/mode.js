import { deactivateAnnotationMode, deselectAllObjects } from './annotation-interaction.js';
import { state } from './state.js';
import { updateStatus } from './ui-common.js';


    export function switchToViewMode() {
      // 描画モード中ならキャンセル
      if (state.currentDrawType) deactivateAnnotationMode();

      // オブジェクトの選択を全解除
      deselectAllObjects();

      document.body.classList.add('is-view-mode');

      // ボタンを「編集モードに切替」に変更
      const btn = document.getElementById('modeSwitchBtn');
      btn.classList.replace('toDisplay', 'toEdit');
      btn.querySelector('svg path').setAttribute('d',
        'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z');
      document.getElementById('modeSwitchBtnLabel').textContent = '編集モードに切替';
      btn.onclick = switchToEditMode;

      updateStatus('閲覧モードに切り替えました');
    }


    /**
     * 編集モードに戻る。
     * - オーサリングパネル・付箋パーツ操作を再表示
     */
    export function switchToEditMode() {
      document.body.classList.remove('is-view-mode');

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

      // 図ボタンによって変更された図オブジェクトの表示状態を元に戻す
      document.querySelectorAll('.zu-obj').forEach(obj => {
        obj.classList.remove('state-hidden');
        obj.classList.add('state-visible');
      });

      const btn = document.getElementById('modeSwitchBtn');
      btn.classList.replace('toEdit', 'toDisplay');
      btn.querySelector('svg path').setAttribute('d',
        'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z');
      document.getElementById('modeSwitchBtnLabel').textContent = '閲覧モードに切替';
      btn.onclick = switchToViewMode;

      updateStatus('編集モードに戻りました');
    }
