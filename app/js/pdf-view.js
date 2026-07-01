import { deselectAllObjects, updateAlignPanel } from './annotation-interaction.js';
import { state } from './state.js';
import { updateStatus } from './ui-common.js';


    /**
     * ページを次へ進める。
     */
    export function nextPage() {
      if (state.currentPage < state.totalPages) {
        state.currentPage++;
        updatePageDisplay();
      }
    }


    /**
     * ページを前へ戻る。
     */
    export function prevPage() {
      if (state.currentPage > 1) {
        state.currentPage--;
        updatePageDisplay();
      }
    }


    /**
     * 最初のページへ移動する。
     */
    export function goFirstPage() {
      state.currentPage = 1;
      updatePageDisplay();
    }


    /**
     * 最後のページへ移動する。
     */
    export function goLastPage() {
      state.currentPage = state.totalPages;
      updatePageDisplay();
    }


    /**
     * ページ表示を更新する。
     */
    export function updatePageDisplay() {

      // PDF・LIBRO book いずれも未読み込み時は 0/0 を表示
      if (!state.pdfDoc && !state.bookPages) {
        document.getElementById('pageInput').value = 0;
        const totalPagesText = document.getElementById('totalPagesText');
        if (totalPagesText) totalPagesText.textContent = '/ 0';
        updateSpreadBadge();
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

      // ページ移動時に選択を全解除する
      deselectAllObjects();

      // PDF・LIBRO book ページを描画
      if (state.pdfDoc || state.bookPages) renderPage(state.currentPage);

      // 前ページ・最初ページのボタン活性制御
      const navBtns = document.querySelectorAll('.nav-btn');
      const firstBtn = navBtns[0];
      const prevBtn  = navBtns[1];
      const nextBtn  = navBtns[2];
      const lastBtn  = navBtns[3];
      if (state.currentPage <= 1) {
        prevBtn?.classList.add('disabled');
        firstBtn?.classList.add('disabled');
      } else {
        prevBtn?.classList.remove('disabled');
        firstBtn?.classList.remove('disabled');
      }
      if (state.currentPage >= state.totalPages) {
        nextBtn?.classList.add('disabled');
        lastBtn?.classList.add('disabled');
      } else {
        nextBtn?.classList.remove('disabled');
        lastBtn?.classList.remove('disabled');
      }
      // 現在ページのアノテーションのみ表示する
      updateAnnotationVisibility();
    }


    /**
     * 見開きページ（real-page-count超過ページ）を表示中であることを示すバッジの表示を更新する。
     */
    function updateSpreadBadge() {
      const badge = document.getElementById('spreadBadge');
      if (!badge) return;
      const isSpread = state.realPageCount != null && state.currentPage > state.realPageCount;
      badge.classList.toggle('show', isSpread);
      if (isSpread) badge.dataset.tip = `${state.realPageCount + 1}ページ目から見開き表示`;
    }


    /**
     * 現在ページに属するアノテーションのみ表示し、他ページのアノテーションを非表示にする。
     */
    export function updateAnnotationVisibility() {
      document.querySelectorAll(
        '#pageLeft .sticky-note, #pageLeft .ann-object, #pageLeft .ann-icon-obj, ' +
        '#pageLeft .daimon-btn, ' +
        '#pageLeft .kotae-btn, #pageLeft .shomei-btn, ' +
        '#pageLeft .libro-toggle'
      ).forEach(el => {
        const elPage = parseInt(el.dataset.page || '1', 10);
        el.classList.toggle('ann-hidden-page', elPage !== state.currentPage);
      });
    }


    /**
     * PDFを読み込んで最初のページを表示する。
     * @param {string|ArrayBuffer} source - PDFファイルのURLまたはArrayBuffer
     */
    export async function loadPDF(source) {
      try {
        // cMapUrl：日本語など CID フォントの文字マッピングに必須
        // standardFontDataUrl：埋め込みフォントがない場合の代替フォントデータ
        const BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
        // URLとArrayBufferの両方に対応
        const loadOption = typeof source === 'string'
          ? { url: source }
          : { data: source };
        state.pdfDoc = await pdfjsLib.getDocument({
          ...loadOption,
          cMapUrl:             BASE + 'cmaps/',
          cMapPacked:          true,
          standardFontDataUrl: BASE + 'standard_fonts/',
        }).promise;
        state.totalPages = state.pdfDoc.numPages;
        state.realPageCount = null;
        const pageInput = document.getElementById('pageInput');
        if (pageInput) pageInput.dataset.max = state.totalPages;
        state.currentPage = 1;
        // 最初のページのアスペクト比を取得して state.PAGE_ASPECT を更新
        const firstPage = await state.pdfDoc.getPage(1);
        const vp = firstPage.getViewport({ scale: 1 });
        state.PAGE_ASPECT = vp.width / vp.height;
        resizePage();
        updatePageDisplay();
        // PDF読み込み成功後にドロップオーバーレイを非表示にする
        document.getElementById('pdfDropOverlay').classList.add('hidden');
      } catch (err) {
        console.error('PDF読み込みエラー:', err);
      }
    }


    /**
     * LIBRO bookフォルダのページ画像一覧を読み込んで最初のページを表示する。
     * loadPDF の LIBRO book版。pdfDoc とは排他利用（読込時に pdfDoc を null にする）。
     * @param {Array<{pageNum:number, width:number, height:number, imageUrl:string}>} pages
     * @param {number|null} [realPageCount] - index.json の configs['real-page-count']。
     *   このページ数を超えるページは見開きであることを示す。未指定時はnull。
     */
    export function loadLibroBookPages(pages, realPageCount = null) {
      state.pdfDoc = null;
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
      // 読込成功後にドロップオーバーレイを非表示にする
      document.getElementById('pdfDropOverlay').classList.add('hidden');
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
     * LIBRO bookのページ画像をcanvasに描画する。renderPage の book版。
     * @param {number} num - 描画するページ番号（1始まり）
     */
    async function renderBookPage(num) {
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

      const canvas = document.getElementById('pdfCanvas');
      const pageEl  = document.getElementById('pageLeft');
      const pageAspect = pageData.width / pageData.height;
      if (Math.abs(pageAspect - state.PAGE_ASPECT) > 0.001) {
        state.PAGE_ASPECT = pageAspect;
        resizePage();
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


    /**
     * 指定ページをcanvasに描画する。
     * @param {number} num - 描画するページ番号（1始まり）
     */
    export async function renderPage(num) {
      // LIBRO book読込時はページ画像を描画する（PDF描画とは排他）
      if (state.bookPages) { await renderBookPage(num); return; }

      if (!state.pdfDoc) return;

      // 前の描画タスクをキャンセルして競合（ページ混じり）を防ぐ
      if (state._currentRenderTask) {
        state._currentRenderTask.cancel();
        state._currentRenderTask = null;
      }

      // 世代番号を取得（await 中に新しい renderPage が呼ばれたら中断する）
      const renderVersion = ++state._renderVersion;

      const pdfPage = await state.pdfDoc.getPage(num);

      // より新しい renderPage が呼ばれていた場合は描画をスキップ
      if (renderVersion !== state._renderVersion) return;

      const canvas  = document.getElementById('pdfCanvas');
      const pageEl  = document.getElementById('pageLeft');
      // 表示サイズに合わせてスケールを計算する（高解像度のためデバイスピクセル比を考慮）
      const baseViewport = pdfPage.getViewport({ scale: 1 });

      // ページごとにアスペクト比を更新（ページサイズが異なる PDF に対応）
      const pageAspect = baseViewport.width / baseViewport.height;
      if (Math.abs(pageAspect - state.PAGE_ASPECT) > 0.001) {
        state.PAGE_ASPECT = pageAspect;
        resizePage();
      }

      const dpr   = window.devicePixelRatio || 1;
      // ズームレベルを乗算することで、拡大時も常に高解像度でレンダリングする
      const scale = (pageEl.offsetWidth / baseViewport.width) * dpr * (state.zoomLevel / 100);
      const viewport = pdfPage.getViewport({ scale });

      // canvas サイズを更新し、確実にクリアする
      // （同じサイズの場合 canvas.width 代入でもリセットされないため clearRect で明示クリア）
      const newW = Math.round(viewport.width);
      const newH = Math.round(viewport.height);
      canvas.width  = newW;
      canvas.height = newH;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, newW, newH);

      // CSS サイズはCSS transformで拡大される前のページサイズに合わせる
      // （Canvas物理ピクセルはズームレベル分増えているが、表示CSSサイズはtransform前に揃える）
      canvas.style.width  = pageEl.offsetWidth  + 'px';
      canvas.style.height = pageEl.offsetHeight + 'px';

      try {
        state._currentRenderTask = pdfPage.render({
          canvasContext: ctx,
          viewport,
          // 'print' インテントは特色（Separation/DeviceN 色空間）や高精度フォント配置に対応
          intent: 'print',
        });
        await state._currentRenderTask.promise;
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error('PDF描画エラー:', err);
        }
      } finally {
        state._currentRenderTask = null;
      }
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
      document.querySelectorAll('#pageLeft .sticky-note, #pageLeft .ann-object, #pageLeft .ann-icon-obj').forEach(el => {
        el.style.left = ((parseFloat(el.style.left) || 0) * ratio) + 'px';
        el.style.top  = ((parseFloat(el.style.top)  || 0) * ratio) + 'px';
        const w = parseFloat(el.style.width)  || el.offsetWidth;
        const h = parseFloat(el.style.height) || el.offsetHeight;
        el.style.width  = (w * ratio) + 'px';
        el.style.height = (h * ratio) + 'px';
      });
    }


    /**
     * ズームレベルを変更し、アノテーションの位置・サイズを追従させる。
     * マウス座標が指定された場合はその点を中心にズームする。
     * 座標が未指定の場合はビュー中心を基準にズームする。
     * @param {number}  newZoom       - 新しいズームレベル（50〜200）
     * @param {number} [mouseClientX] - マウスのビューポートX座標
     * @param {number} [mouseClientY] - マウスのビューポートY座標
     */
    export function applyZoomChange(newZoom, mouseClientX, mouseClientY) {
      const oldZoom = state.zoomLevel;
      if (newZoom === oldZoom) return;

      const ratio = newZoom / oldZoom;

      // ズームレベルを更新してページをリサイズ（CSS scaleを更新するのみ。オブジェクト座標は変更しない）
      state.zoomLevel = newZoom;
      resizePage();

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
      if (state.zoomLevel < 200) {
        applyZoomChange(Math.min(200, state.zoomLevel + 10));
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
      if (state.fitMode === 'height') {
        const h = view.clientHeight - padding;
        const w = h * state.PAGE_ASPECT;
        page.style.height = h + 'px';
        page.style.width  = w + 'px';
      } else if (state.fitMode === 'width') {
        const w = view.clientWidth - padding;
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
      page.style.transform       = `scale(${state.zoomLevel / 100})`;
      page.style.transformOrigin = 'center center';
    }


    /**
     * ズームを適用する。
     */
    export function applyZoom() {
      resizePage();
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

      // フィット変更後にページサイズが変わるため PDF・book を再描画してcanvasサイズを合わせる
      if (state.pdfDoc || state.bookPages) renderPage(state.currentPage);

      updateAlignPanel();
      updateStatus('表示フィット: ' + { page: 'ページ全体', height: '高さ', width: '幅' }[mode]);
    }

    /* ============================
       ナビゲーション折りたたみ
    ============================ */
