import { updateAlignPanel, updateDaimonGroupHighlight } from './annotation-interaction.js';
import { state } from './state.js';

    /** トースト非表示用タイマー */
    let _toastTimer = null;

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

    /**
     * ZIP読込中ローディングオーバーレイを表示する。
     */
    export function showLoader() {
      document.getElementById('loaderOverlay').classList.add('is-visible');
    }

    /**
     * ZIP読込中ローディングオーバーレイを非表示にする。
     */
    export function hideLoader() {
      document.getElementById('loaderOverlay').classList.remove('is-visible');
    }

    export function toggleAcc(bodyId, btn) {
      const body = document.getElementById(bodyId);
      if (!body) return;
      const closing = !body.classList.contains('is-closed');
      body.classList.toggle('is-closed', closing);
      btn.classList.toggle('is-closed', closing);
    }

    /**
     * ZIP（book）の読み込み状態に応じてサイドバー（オーサリング）全体の
     * 活性/非活性を切り替える。未読み込み時は inert 属性でマウス・キーボード
     * 操作を無効化し、CSS（.side.authoring[inert]）でグレーアウト表示する。
     */
    export function updateAuthoringSideState() {
      const aside = document.querySelector('.side.authoring');
      if (!aside) return;
      aside.toggleAttribute('inert', !state.currentBookId);
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


    export function updateStatus() {
      // 選択数に応じて整列パネルの活性状態を更新
      updateAlignPanel();
      // 大問ボタングループの選択枠を更新
      updateDaimonGroupHighlight();
    }
