import { closeQuickCreateDialog, confirmAnnotation, openQuickCreateDialog } from './annotation-dialog.js';
import { startAutoSaveInterval } from './autosave.js';
import { createDaimonButton, createKotaeButton, createShomeiButton } from './buttons.js';
import { activateAnnotationMode, alignObjects, cancelDragSelect, copySelectedObjects, cutSelectedObjects, deactivateAnnotationMode, deleteSelectedObjects, finalizeDragSelect, getPageRelativePos, onDragSelectMove, onDrawPreviewMove, onPageMouseDown, onPageMouseMove, onPageMouseUp, pasteClipboard, selectAllObjects } from './annotation-interaction.js';
import { switchToViewMode } from './mode.js';
import { addIndexRow, closeIndexEditor, openIndexEditor } from './index-outline.js';
import { applyZoomChange, goFirstPage, goLastPage, goTocPage, nextPage, prevPage, resizePage, setFit, updatePageDisplay, zoomIn, zoomOut } from './page-view.js';
import { state } from './state.js';
import { onMisetteiBtnClick, toggleStickyGroup } from './sticky.js';
import { closeDialog, handleZipFile, loadAnnotationsFromZip, saveAnnotations, saveAnnotationsAsLibroBook, saveAnnotationsAsZip, saveDialog, toggleSaveDropdown } from './storage.js';
import { toggleAcc, toggleNav, updateStatus } from './ui-common.js';
import { redo, undo } from './undo-redo.js';


    /* キーボードイベント（Esc / Delete / Space / Cmd+C / Cmd+V / Cmd+X） */
    document.addEventListener('keydown', (e) => {
      // インデックス編集モーダル表示中は紙面向けショートカット
      // （矢印ページ移動・Delete削除・Ctrl+Z等）を全て抑止し、Escapeで閉じるのみ受け付ける
      if (document.getElementById('indexEditorOverlay')?.classList.contains('is-open')) {
        if (e.key === 'Escape') closeIndexEditor(false);
        return;
      }

      if (e.key === 'Escape') {
        cancelDragSelect();
        closeQuickCreateDialog();
        if (state.currentDrawType) deactivateAnnotationMode();
        closeDialog();
        document.querySelector('.dialog-btn.ok').onclick = saveDialog;
        updateStatus();
      }

      // Delete/Backspaceキー：選択中のオブジェクトを削除（入力フィールドにフォーカス中は無効）
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (document.body.classList.contains('is-view-mode')) return;
        deleteSelectedObjects();
      }

      // Cmd+Z / Ctrl+Z：操作を1つ取り消す
      if (e.key.toLowerCase() === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        undo();
      }

      // Cmd+Shift+Z / Ctrl+Shift+Z：取り消した操作をやり直す（Redo）
      if (e.key.toLowerCase() === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        redo();
      }

      // Cmd+A / Ctrl+A：ページ内の全オブジェクトを選択
      if (e.key.toLowerCase() === 'a' && (e.metaKey || e.ctrlKey)) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        selectAllObjects();
      }

      // Cmd+C / Ctrl+C：選択中オブジェクトをコピー
      if (e.key.toLowerCase() === 'c' && (e.metaKey || e.ctrlKey)) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        copySelectedObjects();
      }

      // Cmd+V / Ctrl+V：クリップボードからペースト
      if (e.key.toLowerCase() === 'v' && (e.metaKey || e.ctrlKey)) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        pasteClipboard();
      }

      // Cmd+X / Ctrl+X：選択中オブジェクトを切り取り（コピー＋削除）
      if (e.key.toLowerCase() === 'x' && (e.metaKey || e.ctrlKey)) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (document.body.classList.contains('is-view-mode')) return;
        e.preventDefault();
        cutSelectedObjects();
      }

      // 矢印キー（右/下：次ページ、左/上：前ページ）でページ移動
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        nextPage();
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        prevPage();
      }

      // Spaceキー：パンモードを開始（入力フィールドにフォーカス中は無効）
      if (e.code === 'Space') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault(); // ブラウザのページスクロールを防ぐ
        if (!state.isSpaceHeld) {
          state.isSpaceHeld = true;
          document.getElementById('viewArea').classList.add('space-pan-mode');
        }
      }
    });

    /* Spaceキー離し：パンモードを解除 */
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        state.isSpaceHeld = false;
        state.isPanning   = false;
        document.getElementById('viewArea').classList.remove('space-pan-mode', 'is-panning');
      }
    });

    /* ==================================
       Spaceキー＋ドラッグによるページパン
    ================================== */

    /**
     * パン操作を開始する。
     * viewArea 上でのマウスダウン時にスペースキーが押されていれば呼び出される。
     */
    document.getElementById('viewArea').addEventListener('mousedown', (e) => {
      if (!state.isSpaceHeld) return;
      e.preventDefault();
      state.isPanning  = true;
      state.panStartX  = e.clientX - state.panOffsetX;
      state.panStartY  = e.clientY - state.panOffsetY;
      document.getElementById('viewArea').classList.add('is-panning');
    });

    /**
     * ページ外（グレーエリア）からドラッグ選択を開始する。
     * ページ内のクリックはバブリングで到達するが、#pageLeft 発火のインラインハンドラに委ねる。
     */
    document.getElementById('viewArea').addEventListener('mousedown', (e) => {
      if (state.isSpaceHeld)    return; // パンモード中はスキップ
      if (document.body.classList.contains('is-view-mode')) return; // 閲覧モード中はドラッグ選択を禁止
      if (state.currentDrawType) return; // 描画モード中はページ内からのみ許可
      if (e.target.closest('#pageLeft')) return; // ページ内のクリックは onPageMouseDown に任せる
      // オブジェクト上のクリックはスキップ
      if (e.target.closest('.sticky-note') ||
          e.target.closest('.ann-object')  ||
          e.target.closest('.ann-icon-obj') ||
          e.target.closest('.ann-image-obj') ||
          e.target.closest('.daimon-btn')  ||
          e.target.closest('.kotae-btn')   ||
          e.target.closest('.shomei-btn')) return;
      e.preventDefault();
      state.dragSelectStartPos    = getPageRelativePos(e);
      state.dragSelectClientStart = { x: e.clientX, y: e.clientY };
      state.isDragSelecting = true;
      // state.dragSelectPreviewEl は onDragSelectMove 内で閾値超過後に遅延作成する
      document.addEventListener('mousemove', onDragSelectMove);
    });

    /**
     * パン中のマウス移動でページコンテナを平行移動する。
     */
    document.addEventListener('mousemove', (e) => {
      if (!state.isPanning) return;
      state.panOffsetX = e.clientX - state.panStartX;
      state.panOffsetY = e.clientY - state.panStartY;
      document.getElementById('pageContainer').style.transform =
        `translate(${state.panOffsetX}px, ${state.panOffsetY}px)`;
    });

    /**
     * 右クリックメニュー表示時にドラッグ選択をキャンセルする。
     * 右クリックは mouseup が発火しないブラウザがあるため contextmenu で補完する。
     */
    document.addEventListener('contextmenu', () => {
      cancelDragSelect();
    });

    /**
     * ウィンドウがフォーカスを失ったとき（他のアプリへの切り替えなど）に
     * ドラッグ選択をキャンセルする。
     */
    window.addEventListener('blur', () => {
      cancelDragSelect();
    });

    /**
     * マウスボタンを離したらパンを終了する。
     */
    document.addEventListener('mouseup', () => {
      if (!state.isPanning) return;
      state.isPanning = false;
      document.getElementById('viewArea').classList.remove('is-panning');
    });

    /**
     * ページ外でマウスボタンを離したとき、ドラッグ選択をクリーンアップし必要に応じて確定する。
     * onPageMouseUp は #pageLeft 上でのみ発火するため、
     * document レベルで補足する。ページ内リリース時は onPageMouseUp が先に確定するため、
     * state.isDragSelecting が false になっているからここではスキップされる。
     */
    document.addEventListener('mouseup', (e) => {
      if (!state.isDragSelecting) return;
      state.isDragSelecting = false;
      document.removeEventListener('mousemove', onDragSelectMove);
      state.dragSelectPreviewEl?.remove();
      state.dragSelectPreviewEl   = null;
      state.dragSelectClientStart = null;
      const start = state.dragSelectStartPos;
      state.dragSelectStartPos = null;
      if (start) {
        const endPos = getPageRelativePos(e);
        const x = Math.min(endPos.x, start.x);
        const y = Math.min(endPos.y, start.y);
        const w = Math.abs(endPos.x - start.x);
        const h = Math.abs(endPos.y - start.y);
        if (w >= 5 || h >= 5) {
          // 十分な大きさの矩形であれば選択確定
          finalizeDragSelect(x, y, w, h, e.shiftKey);
        }
        // w < 5 && h < 5 はクリック扱い：グレーエリアでの単クリックで誤って選択解除しないよう何もしない
      }
    });

    /**
     * ページ外でマウスボタンを離したとき、描画プレビューをクリーンアップし必要に応じて確定する。
     * onPageMouseUp は #pageLeft 上でのみ発火するため、document レベルで補足する。
     * ページ内リリース時は onPageMouseUp が先に state.drawStartPos = null にするためここではスキップされる。
     */
    document.addEventListener('mouseup', (e) => {
      if (!state.currentDrawType || !state.drawStartPos) return;
      document.removeEventListener('mousemove', onDrawPreviewMove);
      state.drawPreviewEl?.remove();
      state.drawPreviewEl   = null;
      state.drawClientStart = null;
      const start = state.drawStartPos;
      state.drawStartPos = null;
      const endPos = getPageRelativePos(e);
      const x = Math.min(endPos.x, start.x);
      const y = Math.min(endPos.y, start.y);
      const w = Math.abs(endPos.x - start.x);
      const h = Math.abs(endPos.y - start.y);
      if (w < 10 && h < 10) {
        // クリック扱い：クイック作成ポップアップを表示
        openQuickCreateDialog(state.currentDrawType, start.x, start.y, e.clientX, e.clientY);
        return;
      }
      // ドラッグ作成：マーカー形式で即時作成
      state.pendingRect = { x, y, w, h };
      const _specForm = document.getElementById('dialogFormSpecific');
      if (_specForm) {
        const _dtEl = _specForm.querySelector('#annDisplayType');
        if (_dtEl) {
          _dtEl.value = 'marker';
        } else {
          const _inp = document.createElement('input');
          _inp.type = 'hidden'; _inp.id = 'annDisplayType'; _inp.value = 'marker';
          _inp.dataset.qcInject = '1';
          _specForm.appendChild(_inp);
        }
      }
      confirmAnnotation(state.currentDrawType);
      if (_specForm) _specForm.querySelectorAll('[data-qc-inject]').forEach(el => el.remove());
    });


    /* ============================
       初期表示・リサイズ対応
    ============================ */
    // 高さフィットボタンを初期選択状態にする
    document.querySelectorAll('.fit-btn').forEach(b => b.classList.remove('selected'));
    document.querySelectorAll('.fit-btn')[1].classList.add('selected');

    // 初回リサイズ
    resizePage();

    // 紙面はユーザが指定した拡大率・フィットモードで表示し、ウィンドウリサイズでは変更しない。
    // ウィンドウ幅が狭い場合は overflow: hidden により見切れ、パン操作で移動して閲覧する。

    /* ============================
       マウスホイールによるズーム
    ============================ */

    /**
     * ビューエリア上でホイール操作を行うとページを拡大・縮小する。
     * マウスカーソルの位置を中心にズームする。
     * パンモード中（Space キー押下時）は縮小・拡大を行わない。
     */
    document.getElementById('viewArea').addEventListener('wheel', (e) => {
      e.preventDefault();

      // パンモード中はホイールを無視する
      if (state.isSpaceHeld) return;

      // ズームステップ：ホイール1ノッチあたり10%
      const delta = e.deltaY < 0 ? 10 : -10;
      const newZoom = Math.min(200, Math.max(50, state.zoomLevel + delta));
      // マウスカーソル位置を中心としてズームを適用する
      applyZoomChange(newZoom, e.clientX, e.clientY);
    }, { passive: false });

    /* ============================
       ページ入力イベント
    ============================ */
    document.getElementById('pageInput').addEventListener('change', function() {
      const max = parseInt(this.dataset.max || state.totalPages, 10);
      const v = parseInt(this.value, 10);
      if (!isNaN(v) && v >= 1 && v <= max) {
        state.currentPage = v;
        updatePageDisplay();
      } else {
        this.value = state.currentPage;
      }
    });

    // 初期ページ表示を 0/0 に初期化する
    updatePageDisplay();

    /* ============================
       編集状態のオートセーブ（IndexedDB）
    ============================ */
    // オートセーブ復元確認は、対応するbookのzipを読み込んだタイミングで行う（storage.js側）
    // デバウンス保存が先延ばしになり続けるケースの保険として、一定間隔でも保存する
    startAutoSaveInterval();



// index.html 内のインラインイベントハンドラ（onclick等）から呼べるように window に公開する
Object.assign(window, {
  goTocPage,
  goFirstPage,
  prevPage,
  nextPage,
  goLastPage,
  zoomIn,
  zoomOut,
  setFit,
  toggleSaveDropdown,
  saveAnnotations,
  saveAnnotationsAsZip,
  saveAnnotationsAsLibroBook,
  handleZipFile,
  loadAnnotationsFromZip,
  toggleNav,
  switchToViewMode,
  toggleAcc,
  activateAnnotationMode,
  createDaimonButton,
  toggleStickyGroup,
  onMisetteiBtnClick,
  createKotaeButton,
  createShomeiButton,
  alignObjects,
  onPageMouseDown,
  onPageMouseMove,
  onPageMouseUp,
  openIndexEditor,
  closeIndexEditor,
  addIndexRow
});
