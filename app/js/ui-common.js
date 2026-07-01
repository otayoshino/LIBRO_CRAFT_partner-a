import { updateAlignPanel } from './annotation-interaction.js';


    /**
     * 画面中央にトーストメッセージを表示する。
     * @param {string} msg - 表示メッセージ
     * @param {number} [duration=2000] - 表示時間（ms）
     */
    export function showToast(msg, duration = 2000) {
      const el = document.getElementById('toastMsg');
      el.textContent = msg;
      el.classList.add('is-visible');
      clearTimeout(_toastTimer);
      _toastTimer = setTimeout(() => el.classList.remove('is-visible'), duration);
    }

    export function toggleAcc(bodyId, btn) {
      const body = document.getElementById(bodyId);
      if (!body) return;
      const closing = !body.classList.contains('is-closed');
      body.classList.toggle('is-closed', closing);
      btn.classList.toggle('is-closed', closing);
    }


    /**
     * ナビゲーションバーの表示切替。
     */
    export function toggleNav() {
      // ヘッダーの表示/非表示をトグルする
      const nav = document.querySelector('.nav');
      const revealBtn = document.getElementById('navRevealBtn');
      const toggleBtn = nav.querySelector('[onclick="toggleNav()"]');
      const isHidden = nav.classList.toggle('is-hidden');

      // 展開ボタンの表示切替
      if (revealBtn) revealBtn.style.display = isHidden ? 'flex' : 'none';

      // ナビ内ボタンのツールチップ更新
      if (toggleBtn) toggleBtn.dataset.tip = isHidden ? 'ナビを展開する' : 'ナビを折りたたむ';
    }

    /* ============================
       ステータス更新
    ============================ */


    export function updateStatus(msg) {
      // 選択数に応じて整列パネルの活性状態を更新
      updateAlignPanel();
    }
