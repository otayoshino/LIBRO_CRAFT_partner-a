import { updateAlignPanel } from './annotation-interaction.js';
import { state } from './state.js';

    /** トースト非表示用タイマー */
    let _toastTimer = null;

    /**
     * 要素へ戻す className を、選択表示（is-selected）だけは要素の現在の状態に合わせて返す。
     * 取り消し・やり直しでスナップショットの className を丸ごと戻すと、操作時点の選択表示まで
     * 戻ってしまう。付箋は選択を selectedStickySet でも管理しているため、Set に入っていないのに
     * is-selected だけ付いた状態になり、紙面をクリックしても選択が外れなくなる。
     * @param {HTMLElement} el        - 対象要素（現在の選択状態を読む）
     * @param {string}      className - 戻したい className
     * @returns {string}
     */
    export function classNameKeepingSelection(el, className) {
      const base = String(className).replace(/\bis-selected\b/g, ' ').replace(/\s+/g, ' ').trim();
      return el.classList.contains('is-selected') ? `${base} is-selected`.trim() : base;
    }


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
     * HTML特殊文字をエスケープする。
     * innerHTML のテンプレートリテラルへ外部データ由来の値（book由来のファイル名・
     * ディレクトリ名・BlobURL・savedDataの保存値）を埋め込む箇所で使う。
     * 属性値・テキストのどちらにも使える。
     *
     * 注意：showToast() は内部で textContent を使うため、トースト文言には適用しない。
     * また cfg.iconSvg のような「値がマークアップそのもの」の箇所にも適用しない。
     * @param {string} str
     * @returns {string}
     */
    export function escapeHtml(str) {
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
      // 開いた側を最前面にする（閉じた側は最前面指定を外す）
      if (closing) {
        body.classList.remove('is-front');
      } else {
        bringHdrInlineToFront(body);
      }
    }

    /**
     * 指定した .hdr-inline パネルを最前面（is-front）にし、他のパネルからは外す。
     * 詳細設定・整列のドロップダウンが重なったとき、アクティブな方を前面に表示するために使う。
     */
    function bringHdrInlineToFront(target) {
      document.querySelectorAll('.hdr-inline.is-front').forEach(el => {
        if (el !== target) el.classList.remove('is-front');
      });
      target.classList.add('is-front');
    }

    /**
     * ZIP（book）の読み込み状態に応じて、オーサリングパネル
     * （#accAuthoring .panel-stack）内の各アノテーション追加ボタンと
     * モード切替ボタン（#modeSwitchBtn）の活性/非活性を切り替える。
     * 未読み込み時は is_disabled クラスによりグレーアウト表示＋
     * クリック無効（pointer-events: none）となる。
     * ※ #accStickyOps 側の is_disabled は選択状態連動
     *   （updateStickyOpsPanel）が管理するため、ここでは触らない。
     */
    export function updateAuthoringPanelState() {
      const items = document.querySelectorAll('#accAuthoring .panel-stack > li');
      const disabled = !state.currentBookId;
      items.forEach(li => li.classList.toggle('is_disabled', disabled));
      document.getElementById('modeSwitchBtn')?.classList.toggle('is_disabled', disabled);
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
      // （大問ボタングループの選択枠も updateAlignPanel() 内で更新される）
      updateAlignPanel();
    }

    /* 詳細設定・整列パネルの内部をクリック（ポインタ押下）したときも、そのパネルを最前面にする。
       キャプチャフェーズで拾うため、パネル内のボタン処理より先に前面化が確定する。 */
    document.addEventListener('pointerdown', (e) => {
      const panel = e.target.closest?.('.hdr-inline');
      if (!panel || panel.classList.contains('is-closed')) return;
      bringHdrInlineToFront(panel);
    }, true);
