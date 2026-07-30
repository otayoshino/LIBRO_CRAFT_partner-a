import { deselectAllObjects, updateAlignPanel } from './annotation-interaction.js';
import { updateLibroBookBtnStates } from './index-outline.js';
import { state } from './state.js';
import { updateStatus } from './ui-common.js';


    /**
     * index.json の configs['rl-reading-order'] が "right"（右綴じ）かどうかを判定する。
     * LIBRO book未読込時・独自ZIP形式読込時・値未設定時は false（左綴じ扱い、従来動作）を返す。
     * @returns {boolean}
     */
    function isRightBoundBook() {
      return state.libroBook?.indexJson?.configs?.['rl-reading-order'] === 'right';
    }


    /**
     * ページを次へ進める（「次へ」ボタン・スライドナビ右側・矢印キー右/下から呼ばれる、画面右側固定の操作）。
     * 右綴じbookでは読み進め方向が逆になるため、ページ番号を減らす。
     */
    export function nextPage() {
      if (isRightBoundBook()) {
        if (state.currentPage > 1) {
          state.currentPage--;
          updatePageDisplay();
        }
        return;
      }
      if (state.currentPage < state.totalPages) {
        state.currentPage++;
        updatePageDisplay();
      }
    }


    /**
     * ページを前へ戻る（「前へ」ボタン・スライドナビ左側・矢印キー左/上から呼ばれる、画面左側固定の操作）。
     * 右綴じbookでは読み進め方向が逆になるため、ページ番号を増やす。
     */
    export function prevPage() {
      if (isRightBoundBook()) {
        if (state.currentPage < state.totalPages) {
          state.currentPage++;
          updatePageDisplay();
        }
        return;
      }
      if (state.currentPage > 1) {
        state.currentPage--;
        updatePageDisplay();
      }
    }


    /**
     * 先頭ページボタン（画面左端固定）で呼ばれる。
     * 右綴じbookでは画面左端＝読み進めた末尾側になるため、最終ページへ移動する。
     */
    export function goFirstPage() {
      state.currentPage = isRightBoundBook() ? state.totalPages : 1;
      updatePageDisplay();
    }


    /**
     * 末尾ページボタン（画面右端固定）で呼ばれる。
     * 右綴じbookでは画面右端＝読み進めた先頭側になるため、先頭ページへ移動する。
     */
    export function goLastPage() {
      state.currentPage = isRightBoundBook() ? 1 : state.totalPages;
      updatePageDisplay();
    }


    /**
     * index.json の configs['toc-page'] が指す目次ページへ移動する。
     * LIBRO book以外（独自ZIP形式）読込時やtoc-page未設定時はTOCボタン自体が
     * 無効化されているため呼ばれない想定だが、念のため無効値は無視する。
     */
    export function goTocPage() {
      const tocPage = getTocPageNumber();
      if (tocPage === null) return;
      state.currentPage = tocPage;
      updatePageDisplay();
    }


    /**
     * index.json の configs['toc-page'] を取得する。LIBRO book未読込・値未設定・
     * 現在の総ページ数の範囲外の場合は null を返す。
     * @returns {number|null}
     */
    function getTocPageNumber() {
      const tocPage = state.libroBook?.indexJson?.configs?.['toc-page'];
      if (!Number.isInteger(tocPage) || tocPage < 1 || tocPage > state.totalPages) return null;
      return tocPage;
    }


    /**
     * TOCボタンの活性・非活性をindex.jsonのtoc-page有無に応じて更新する。
     */
    export function updateTocButtonState() {
      document.getElementById('tocBtn')?.classList.toggle('disabled', getTocPageNumber() === null);
    }


    /**
     * ページ表示を更新する。
     */
    export function updatePageDisplay() {

      // LIBRO book 未読み込み時は 0/0 を表示
      if (!state.bookPages) {
        document.getElementById('pageInput').value = 0;
        const totalPagesText = document.getElementById('totalPagesText');
        if (totalPagesText) totalPagesText.textContent = '/ 0';
        updateSpreadBadge();
        document.getElementById('slideNavPrev')?.classList.add('is-hidden');
        document.getElementById('slideNavNext')?.classList.add('is-hidden');
        return;
      }

      document.getElementById('pageInput').value = state.currentPage;
      // 合計ページ数表示を更新
      const totalPagesText = document.getElementById('totalPagesText');
      if (totalPagesText) {
        totalPagesText.textContent = `/ ${state.totalPages}`;
      }
      // 見開き（real-page-count超過ページ）バッジの表示更新
      updateSpreadBadge();
      // TOCボタンの活性状態を更新
      updateTocButtonState();
      // インデックス編集・LIBRO書き出しボタンの活性状態を更新
      updateLibroBookBtnStates();

      // ページ移動時に選択を全解除する
      deselectAllObjects();

      // LIBRO book ページを描画
      if (state.bookPages) renderPage(state.currentPage);

      // 前ページ・最初ページのボタン活性制御（右綴じ時は左右の意味が入れ替わるため関数化）
      updateNavButtonStates();
      // 現在ページのアノテーションのみ表示する
      updateAnnotationVisibility();
    }


    /**
     * ページ送り関連ボタン（先頭/前/次/末尾・スライドナビ）の活性状態を更新する。
     * 右綴じbookでは nextPage/prevPage/goFirstPage/goLastPage の意味が反転するため、
     * 画面左側のコントロール（first/prev/slideNavPrev）は「終端到達で無効化」、
     * 画面右側のコントロール（next/last/slideNavNext）は「先頭到達で無効化」に判定を入れ替える。
     * state.libroBook 設定直後（storage.js）からも呼び直されるため、updatePageDisplay 本体とは
     * 独立した関数としてexportする（updateTocButtonStateと同じ理由）。
     */
    export function updateNavButtonStates() {
      const navBtns = document.querySelectorAll('.blk.page-nav .nav-btn');
      const firstBtn = navBtns[0];
      const prevBtn  = navBtns[1];
      const nextBtn  = navBtns[2];
      const lastBtn  = navBtns[3];
      const slideNavPrev = document.getElementById('slideNavPrev');
      const slideNavNext = document.getElementById('slideNavNext');

      const atStart = state.currentPage <= 1;
      const atEnd = state.currentPage >= state.totalPages;
      const rightBound = isRightBoundBook();
      const leftDisabled  = rightBound ? atEnd : atStart;
      const rightDisabled = rightBound ? atStart : atEnd;

      if (leftDisabled) {
        prevBtn?.classList.add('disabled');
        firstBtn?.classList.add('disabled');
        slideNavPrev?.classList.add('is-hidden');
      } else {
        prevBtn?.classList.remove('disabled');
        firstBtn?.classList.remove('disabled');
        slideNavPrev?.classList.remove('is-hidden');
      }
      if (rightDisabled) {
        nextBtn?.classList.add('disabled');
        lastBtn?.classList.add('disabled');
        slideNavNext?.classList.add('is-hidden');
      } else {
        nextBtn?.classList.remove('disabled');
        lastBtn?.classList.remove('disabled');
        slideNavNext?.classList.remove('is-hidden');
      }
    }


    /**
     * 見開きページ（real-page-count超過ページ）を表示中であることを示すバッジの表示を更新する。
     */
    function updateSpreadBadge() {
      const isSpread = state.realPageCount != null && state.currentPage > state.realPageCount;
      const badge = document.getElementById('spreadBadge');
      if (badge) {
        badge.classList.toggle('show', isSpread);
        if (isSpread) badge.dataset.tip = `${state.realPageCount + 1}ページ目から見開き表示`;
      }
      // 見開きページ表示中はグレーアウトオーバーレイを表示し、編集不可を明示する（編集モードのみ）
      document.getElementById('spreadLockOverlay')?.classList.toggle('show', isSpread);
    }


    /**
     * 現在ページに属するアノテーションのみ表示し、他ページのアノテーションを非表示にする。
     */
    export function updateAnnotationVisibility() {
      document.querySelectorAll(
        '#pageLeft .sticky-note, #pageLeft .ann-object, #pageLeft .ann-icon-obj, #pageLeft .ann-image-obj, ' +
        '#pageLeft .daimon-btn, ' +
        '#pageLeft .kotae-btn, #pageLeft .shomei-btn, ' +
        '#pageLeft .libro-toggle, #pageLeft .libro-network-slot'
      ).forEach(el => {
        const elPage = parseInt(el.dataset.page || '1', 10);
        el.classList.toggle('ann-hidden-page', elPage !== state.currentPage);
      });
    }


    /**
     * LIBRO bookフォルダのページ画像一覧を読み込んで最初のページを表示する。
     * @param {Array<{pageNum:number, width:number, height:number, imageUrl:string}>} pages
     * @param {number|null} [realPageCount] - index.json の configs['real-page-count']。
     *   このページ数を超えるページは見開きであることを示す。未指定時はnull。
     */
    export function loadLibroBookPages(pages, realPageCount = null) {
      state.bookPages = pages;
      state.totalPages = pages.length;
      state.realPageCount = realPageCount;
      const pageInput = document.getElementById('pageInput');
      if (pageInput) pageInput.dataset.max = state.totalPages;
      state.currentPage = 1;
      const first = pages[0];
      if (first && first.width && first.height) {
        state.PAGE_ASPECT = first.width / first.height;
      }
      resizePage();
      updatePageDisplay();
      // 読込成功後にドロップオーバーレイを非表示にし、.pageの白背景・影を表示する
      document.getElementById('pageDropOverlay').classList.add('hidden');
      document.getElementById('pageLeft').classList.remove('no-book');
    }


    /**
     * ページ画像（Imageオブジェクト）を読み込む。1度読み込んだ画像はpageDataにキャッシュする。
     * @param {{imageUrl:string, _img?:HTMLImageElement}} pageData
     * @returns {Promise<HTMLImageElement>}
     */
    function loadBookPageImage(pageData) {
      if (pageData._img) return Promise.resolve(pageData._img);
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload  = () => { pageData._img = img; resolve(img); };
        img.onerror = reject;
        img.src = pageData.imageUrl;
      });
    }


    /**
     * LIBRO bookのページ画像をcanvasに描画する。
     * @param {number} num - 描画するページ番号（1始まり）
     */
    export async function renderPage(num) {
      const pageData = state.bookPages[num - 1];
      if (!pageData || !pageData.imageUrl) return;

      const renderVersion = ++state._renderVersion;
      let img;
      try {
        img = await loadBookPageImage(pageData);
      } catch (err) {
        console.error('bookページ画像読込エラー:', err);
        return;
      }
      if (renderVersion !== state._renderVersion) return;

      const canvas = document.getElementById('pageCanvas');
      const pageEl  = document.getElementById('pageLeft');
      const pageAspect = pageData.width / pageData.height;
      if (Math.abs(pageAspect - state.PAGE_ASPECT) > 0.001) {
        // 紙面サイズ（縦横比)の異なるページ（表紙・見開きページ等）へ移動すると、
        // resizePage() が #pageLeft のベースサイズ（offsetWidth/offsetHeight）を変える。
        // アノテーションの style.left/top/width/height はこのベースサイズを座標系とする px 値のため、
        // 変換しないと「座標系だけが変わってオブジェクトが取り残される」状態になり、
        // 書き出し（%換算）・自動保存・別サイズページ上の表示位置がすべてずれる。
        // リサイズ前後のベースサイズ比で全アノテーションを変換し、座標系との整合を保つ。
        const oldBaseW = pageEl.offsetWidth;
        const oldBaseH = pageEl.offsetHeight;
        state.PAGE_ASPECT = pageAspect;
        resizePage();
        rebaseAnnotations(oldBaseW, oldBaseH, pageEl.offsetWidth, pageEl.offsetHeight);
      }

      const dpr   = window.devicePixelRatio || 1;
      const scale = (pageEl.offsetWidth / pageData.width) * dpr * (state.zoomLevel / 100);
      const newW  = Math.round(pageData.width  * scale);
      const newH  = Math.round(pageData.height * scale);
      canvas.width  = newW;
      canvas.height = newH;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, newW, newH);
      canvas.style.width  = pageEl.offsetWidth  + 'px';
      canvas.style.height = pageEl.offsetHeight + 'px';
      ctx.drawImage(img, 0, 0, newW, newH);
    }

    /* ============================
       拡大縮小
    ============================ */


    /**
     * ページ内の全アノテーションの位置・サイズをズーム比率に合わせてスケールする。
     * @param {number} ratio - 新旧ズームの比率（newZoom / oldZoom）
     */
    export function scaleAnnotations(ratio) {
      if (ratio === 1) return;
      // ページ座標系の矩形にひもづくボタン（LIBRO+由来の .daimon-btn.libro-toggle と、
      // LIBRO実データ基準の既定サイズを持つ .is-sized の大問/答/証明ボタン）は、通常の付箋・
      // アノテーションと同様に追従させる。インラインの width/height を持たない
      // CSS固定サイズのボタン（本改修以前に作成されたもの）は現行仕様のまま対象外とする。
      document.querySelectorAll('#pageLeft .sticky-note, #pageLeft .ann-object, #pageLeft .ann-icon-obj, #pageLeft .ann-image-obj, #pageLeft .daimon-btn.libro-toggle, #pageLeft .daimon-btn.is-sized, #pageLeft .kotae-btn.is-sized, #pageLeft .shomei-btn.is-sized, #pageLeft .libro-network-slot').forEach(el => {
        el.style.left = ((parseFloat(el.style.left) || 0) * ratio) + 'px';
        el.style.top  = ((parseFloat(el.style.top)  || 0) * ratio) + 'px';
        const w = parseFloat(el.style.width)  || el.offsetWidth;
        const h = parseFloat(el.style.height) || el.offsetHeight;
        el.style.width  = (w * ratio) + 'px';
        el.style.height = (h * ratio) + 'px';
      });
    }


    /**
     * ページのベースサイズ（#pageLeft の offsetWidth/offsetHeight）が変わったとき、
     * 全アノテーションのページ座標（px）を新しいベースサイズの座標系へ変換する。
     *
     * scaleAnnotations() との違い：
     *  - scaleAnnotations() はフィット変更用で、縦横比が変わらない前提の単一比率スケール。
     *  - 本関数は表紙・見開きページのように「縦横比そのものが変わる」ケース用で、横（rx）と縦（ry）に
     *    別々の比率を掛ける。
     *  - 対象は「ページ座標系の left/top を持つ全アノテーション」。CSS固定サイズのボタン
     *    （インラインの width/height を持たない .daimon-btn / .kotae-btn / .shomei-btn）も
     *    left/top はページ座標系の px なので変換対象に含める。width/height は
     *    インライン値がある要素のみ変換する（CSS固定サイズを px で上書きしないため）。
     *  - 非表示ページの要素（.ann-hidden-page＝display:none）は offsetWidth/offsetHeight が 0 に
     *    なるため、実寸へのフォールバックは行わずインライン値の有無だけで判定する。
     *
     * @param {number} oldW - 変更前のベース幅
     * @param {number} oldH - 変更前のベース高さ
     * @param {number} newW - 変更後のベース幅
     * @param {number} newH - 変更後のベース高さ
     */
    export function rebaseAnnotations(oldW, oldH, newW, newH) {
      if (!oldW || !oldH || !newW || !newH) return;
      const rx = newW / oldW;
      const ry = newH / oldH;
      if (rx === 1 && ry === 1) return;
      document.querySelectorAll(
        '#pageLeft .sticky-note, #pageLeft .ann-object, #pageLeft .ann-icon-obj, #pageLeft .ann-image-obj, ' +
        '#pageLeft .daimon-btn, #pageLeft .kotae-btn, #pageLeft .shomei-btn, #pageLeft .libro-network-slot'
      ).forEach(el => {
        el.style.left = ((parseFloat(el.style.left) || 0) * rx) + 'px';
        el.style.top  = ((parseFloat(el.style.top)  || 0) * ry) + 'px';
        const w = parseFloat(el.style.width);
        const h = parseFloat(el.style.height);
        if (!isNaN(w)) el.style.width  = (w * rx) + 'px';
        if (!isNaN(h)) el.style.height = (h * ry) + 'px';
      });
    }


    /**
     * ズームレベルを変更し、アノテーションの位置・サイズを追従させる。
     * マウス座標が指定された場合はその点を中心にズームする。
     * 座標が未指定の場合はビュー中心を基準にズームする。
     * @param {number}  newZoom       - 新しいズームレベル（50〜400）
     * @param {number} [mouseClientX] - マウスのビューポートX座標
     * @param {number} [mouseClientY] - マウスのビューポートY座標
     */
    export function applyZoomChange(newZoom, mouseClientX, mouseClientY) {
      const oldZoom = state.zoomLevel;
      if (newZoom === oldZoom) return;

      const ratio = newZoom / oldZoom;

      // ズームレベルを更新してCSS scaleを適用する（オブジェクト座標・.pageLeftの基準サイズは変更しない）
      state.zoomLevel = newZoom;
      applyZoomTransform();

      // パンオフセットを調整（マウス中心 or ビュー中心）
      // 公式: newPan = (M - viewCenter) * (1 - ratio) + oldPan * ratio
      const viewRect   = document.getElementById('viewArea').getBoundingClientRect();
      const viewCenterX = viewRect.left + viewRect.width  / 2;
      const viewCenterY = viewRect.top  + viewRect.height / 2;
      const mX = (mouseClientX !== undefined) ? mouseClientX : viewCenterX;
      const mY = (mouseClientY !== undefined) ? mouseClientY : viewCenterY;

      state.panOffsetX = (mX - viewCenterX) * (1 - ratio) + state.panOffsetX * ratio;
      state.panOffsetY = (mY - viewCenterY) * (1 - ratio) + state.panOffsetY * ratio;
      document.getElementById('pageContainer').style.transform =
        `translate(${state.panOffsetX}px, ${state.panOffsetY}px)`;

      // 複数選択バウンディングボックスを更新
      updateAlignPanel();

      // ズームが止まってから300ms後に高解像度で再描画する（連続ホイール操作中は再描画を遅延）
      clearTimeout(state._reRenderTimer);
      state._reRenderTimer = setTimeout(() => renderPage(state.currentPage), 300);
    }


    /**
     * ズームインする。
     */
    export function zoomIn() {
      if (state.zoomLevel < 400) {
        applyZoomChange(Math.min(400, state.zoomLevel + 10));
      }
    }


    /**
     * ズームアウトする。
     */
    export function zoomOut() {
      if (state.zoomLevel > 50) {
        applyZoomChange(Math.max(50, state.zoomLevel - 10));
      }
    }


    /**
     * ビューエリアのサイズに合わせてページをリサイズする。
     */
    export function resizePage() {
      const view = document.getElementById('viewArea');
      const page = document.getElementById('pageLeft');
      const padding = 48;

      // ベースサイズ（ズーム100%相当）を計算する。ズームはCSS transformで適用するため除外。
      // ビュー幅・高さの両方を考慮し、はみ出す場合は収まる方の辺に合わせてアスペクト比を保つ。
      if (state.fitMode === 'height') {
        const viewW = view.clientWidth  - padding;
        const viewH = view.clientHeight - padding;
        let h = viewH;
        let w = h * state.PAGE_ASPECT;
        if (w > viewW) {
          w = viewW;
          h = w / state.PAGE_ASPECT;
        }
        page.style.height = h + 'px';
        page.style.width  = w + 'px';
      } else if (state.fitMode === 'width') {
        const viewW = view.clientWidth  - padding;
        const w = viewW;
        const h = w / state.PAGE_ASPECT;
        page.style.width  = w + 'px';
        page.style.height = h + 'px';
      } else if (state.fitMode === 'page') {
        const viewW = view.clientWidth  - padding;
        const viewH = view.clientHeight - padding;
        let w, h;
        if (viewW / viewH < state.PAGE_ASPECT) {
          w = viewW;
          h = w / state.PAGE_ASPECT;
        } else {
          h = viewH;
          w = h * state.PAGE_ASPECT;
        }
        page.style.width  = w + 'px';
        page.style.height = h + 'px';
      }
      // ズームをCSS scaleで適用する（オブジェクトのleft/top/width/heightは変化しない）
      applyZoomTransform();
    }


    /**
     * 現在のズームレベルに応じたCSS transform（scale）のみを.pageLeftへ適用する。
     * .pageLeftの基準サイズ（フィット計算結果のwidth/height）には触れないため、
     * アノテーション座標系とのズレを起こさずにズームだけを反映できる。
     * ホイールズーム等、頻繁に呼ばれる操作から利用する想定。
     */
    function applyZoomTransform() {
      const page = document.getElementById('pageLeft');
      const scale = state.zoomLevel / 100;
      page.style.transform       = `scale(${scale})`;
      page.style.transformOrigin = 'center center';
      // アノテーション矩形の枠線・破線幅がズームに連動して太く/細くなるのを防ぐため、
      // 逆数スケールをCSS変数として渡す（各borderWidth等はcalc(値 * var(--zoom-inv-scale))で参照）
      page.style.setProperty('--zoom-inv-scale', 1 / scale);
    }


    /* ============================
       フィット設定
    ============================ */


    /**
     * フィット方法を変更する。
     * フィット変更時はアノテーションを新しいページサイズに追従させ、パンもリセットする。
     * @param {string} mode - フィットモード（'page'|'height'|'width'）
     */
    export function setFit(mode) {
      const page = document.getElementById('pageLeft');
      const oldW = page.offsetWidth;

      state.fitMode   = mode;
      state.zoomLevel = 100;
      document.querySelectorAll('.fit-btn').forEach(b => b.classList.remove('selected'));
      event.currentTarget.classList.add('selected');
      resizePage();

      const newW = page.offsetWidth;
      if (oldW > 0 && newW !== oldW) {
        scaleAnnotations(newW / oldW);
      }

      // パンオフセットをリセットしてページを中央に戻す
      state.panOffsetX = 0;
      state.panOffsetY = 0;
      document.getElementById('pageContainer').style.transform = 'none';

      // フィット変更後にページサイズが変わるため book を再描画してcanvasサイズを合わせる
      if (state.bookPages) renderPage(state.currentPage);

      updateAlignPanel();
      updateStatus();
    }

    /* ============================
       ナビゲーション折りたたみ
    ============================ */
