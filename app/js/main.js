import { closeQuickCreateDialog, confirmAnnotation, openQuickCreateDialog } from './annotation-dialog.js';
import { createDaimonButton, createKotaeButton, createShomeiButton } from './buttons.js';
import { activateAnnotationMode, alignObjects, cancelDragSelect, copySelectedObjects, deactivateAnnotationMode, finalizeDragSelect, getPageRelativePos, onDragSelectMove, onDrawPreviewMove, onPageMouseDown, onPageMouseMove, onPageMouseUp, pasteClipboard, selectAllObjects } from './annotation-interaction.js';
import { switchToViewMode } from './mode.js';
import { applyZoomChange, goFirstPage, goLastPage, nextPage, prevPage, renderPage, resizePage, scaleAnnotations, setFit, updatePageDisplay, zoomIn, zoomOut } from './pdf-view.js';
import { selectedStickySet, state } from './state.js';
import { onMisetteiBtnClick, toggleStickyGroup } from './sticky.js';
import { closeDialog, handleAnnotationFile, handleZipFile, loadAnnotations, loadAnnotationsFromZip, saveAnnotations, saveAnnotationsAsLibroBook, saveAnnotationsAsZip, saveDialog, toggleSaveDropdown } from './storage.js';
import { toggleAcc, toggleNav, updateStatus } from './ui-common.js';
import { pushUndo, redo, undo } from './undo-redo.js';


    /* キーボードイベント（Esc / Delete / Space / Cmd+C / Cmd+V） */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        cancelDragSelect();
        closeQuickCreateDialog();
        if (state.currentDrawType) deactivateAnnotationMode();
        closeDialog();
        document.querySelector('.dialog-btn.ok').onclick = saveDialog;
        updateStatus('描画をキャンセルしました');
      }

      // Deleteキー：選択中のオブジェクトを削除（入力フィールドにフォーカス中は無効）
      if (e.key === 'Delete') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (document.body.classList.contains('is-view-mode')) return;

        let deleted = 0;

        // 削除前にスナップショットを取得して Undo スタックに積む
        const deleteSnapshots = [];
        const linkedStickyChanges = [];

        // 付箋のスナップショット
        selectedStickySet.forEach(note => {
          deleteSnapshots.push({
            className:   note.className.replace(/\bis-selected\b/g, '').trim(),
            id:          note.dataset.id,
            type:        note.dataset.type || 'sticky',
            savedData:   note.dataset.savedData,
            groupId:     note.dataset.groupId,
            daimonId:    note.dataset.daimonId,
            kotaeId:     note.dataset.kotaeId,
            kotaeOrigBg: note.dataset.kotaeOrigBg,
            styleCssText: note.style.cssText,
            pageNum:     note.dataset.page || '1',
            // LIBRO由来の既存付箋（.libro-toggle）は子要素（画像2枚）と専用datasetの復元が必要
            innerHTML:   note.dataset.libroToggle === '1' ? note.innerHTML : undefined,
            libroToggle: note.dataset.libroToggle,
            closedId:    note.dataset.closedId,
            openId:      note.dataset.openId,
            closedFile:  note.dataset.closedFile,
            openFile:    note.dataset.openFile,
          });
        });

        // アノテーションのスナップショット
        document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected').forEach(ann => {
          deleteSnapshots.push({
            className:   ann.className.replace(/\bis-selected\b/g, '').trim(),
            id:          ann.dataset.id,
            type:        ann.dataset.type,
            savedData:   ann.dataset.savedData,
            styleCssText: ann.style.cssText,
            pageNum:     ann.dataset.page || '1',
          });
        });

        // 各種ボタンのスナップショット
        document.querySelectorAll('.daimon-btn.is-selected.is-selected.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').forEach(btn => {
          deleteSnapshots.push({
            className:   btn.className.replace(/\bis-selected\b/g, '').trim(),
            id:          btn.dataset.id,
            type:        btn.dataset.type,
            daimonId:    btn.dataset.daimonId,
            kotaeId:     btn.dataset.kotaeId,
            shomeiId:    btn.dataset.shomeiId,
            zuId:        btn.dataset.zuId,
            styleCssText: btn.style.cssText,
            pageNum:     btn.dataset.page || '1',
          });
          // 大問ボタン削除に伴う付箋の daimonId 変化を記録
          if (btn.classList.contains('daimon-btn')) {
            const did = btn.dataset.daimonId;
            if (did) {
              document.querySelectorAll(`.sticky-note[data-daimon-id="${did}"]`).forEach(n => {
                linkedStickyChanges.push({ el: n, daimonId: did });
              });
            }
          }
          // 答ボタン削除に伴う付箋の kotaeId・背景色変化を記録
          if (btn.classList.contains('kotae-btn')) {
            const kid = btn.dataset.kotaeId;
            if (kid) {
              document.querySelectorAll(`.sticky-note[data-kotae-id="${kid}"]`).forEach(n => {
                linkedStickyChanges.push({
                  el: n, kotaeId: kid,
                  kotaeOrigBg: n.dataset.kotaeOrigBg,
                  background:  n.style.background,
                });
              });
            }
          }
          // 証明ボタン削除に伴う付箋の shomeiId・背景色・枠線変化を記録
          if (btn.classList.contains('shomei-btn')) {
            const sid = btn.dataset.shomeiId;
            if (sid) {
              document.querySelectorAll(`.sticky-note[data-shomei-id="${sid}"]`).forEach(n => {
                linkedStickyChanges.push({
                  el: n, shomeiId: sid,
                  shomeiOrigBg:     n.dataset.shomeiOrigBg,
                  shomeiOutline:    n.dataset.shomeiOutline,
                  background:       n.style.background,
                  outline:          n.style.outline,
                });
              });
            }
          }
        });

        if (deleteSnapshots.length > 0) {
          pushUndo({ type: 'delete', snapshots: deleteSnapshots, linkedStickyChanges });
        }

        // 選択中の付箋を削除
        selectedStickySet.forEach(note => {
          note.remove();
          deleted++;
        });
        selectedStickySet.clear();

        // 選択中のアノテーションを削除
        document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected').forEach(ann => {
          ann.remove();
          deleted++;
        });

        // 選択中の大問ボタンを削除（紐付き付箋の daimon-id も解除）
        document.querySelectorAll('.daimon-btn.is-selected').forEach(btn => {
          const did = btn.dataset.daimonId;
          if (did) {
            document.querySelectorAll(`.sticky-note[data-daimon-id="${did}"]`)
              .forEach(n => { delete n.dataset.daimonId; });
          }
          btn.remove();
          deleted++;
        });

        // 選択中の図ボタンを削除（紐付き図オブジェクトも続けて削除）
        document.querySelectorAll('.zu-btn.is-selected').forEach(btn => {
          const zid = btn.dataset.zuId;
          if (zid) {
            const obj = document.querySelector(`.zu-obj[data-zu-id="${zid}"]`);
            if (obj) { obj.remove(); deleted++; }
          }
          btn.remove();
          deleted++;
        });

        // 選択中の図オブジェクトを削除（紐付き図ボタンも続けて削除）
        document.querySelectorAll('.zu-obj.is-selected').forEach(obj => {
          const zid = obj.dataset.zuId;
          if (zid) {
            const btn = document.querySelector(`.zu-btn[data-zu-id="${zid}"]`);
            if (btn) { btn.remove(); deleted++; }
          }
          obj.remove();
          deleted++;
        });

        // 選択中の答ボタンを削除（紐付き付箋の元色を復元）
        document.querySelectorAll('.kotae-btn.is-selected').forEach(btn => {
          const kid = btn.dataset.kotaeId;
          if (kid) {
            document.querySelectorAll(`.sticky-note[data-kotae-id="${kid}"]`).forEach(n => {
              if (n.dataset.kotaeOrigBg !== undefined) {
                n.style.background = n.dataset.kotaeOrigBg;
                delete n.dataset.kotaeOrigBg;
              }
              delete n.dataset.kotaeId;
            });
          }
          btn.remove();
          deleted++;
        });

        // 選択中の証明ボタンを削除（紐付き付箋の shomei-id・枠線・元色を復元）
        document.querySelectorAll('.shomei-btn.is-selected').forEach(btn => {
          const sid = btn.dataset.shomeiId;
          if (sid) {
            document.querySelectorAll(`.sticky-note[data-shomei-id="${sid}"]`).forEach(n => {
              if (n.dataset.shomeiOrigBg !== undefined) {
                n.style.background = n.dataset.shomeiOrigBg;
                delete n.dataset.shomeiOrigBg;
              }
              n.style.outline = '';
              delete n.dataset.shomeiOutline;
              delete n.dataset.shomeiId;
            });
          }
          btn.remove();
          deleted++;
        });

        if (deleted > 0) {
          closeDialog();
          updateStatus(`${deleted} 件のオブジェクトを削除しました`);
        }
      }

      // Cmd+Z / Ctrl+Z：操作を1つ取り消す
      if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        undo();
      }

      // Cmd+Shift+Z / Ctrl+Shift+Z：取り消した操作をやり直す（Redo）
      if (e.key === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        redo();
      }

      // Cmd+A / Ctrl+A：ページ内の全オブジェクトを選択
      if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        selectAllObjects();
      }

      // Cmd+C / Ctrl+C：選択中オブジェクトをコピー
      if (e.key === 'c' && (e.metaKey || e.ctrlKey)) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        copySelectedObjects();
      }

      // Cmd+V / Ctrl+V：クリップボードからペースト
      if (e.key === 'v' && (e.metaKey || e.ctrlKey)) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        pasteClipboard();
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
          e.target.closest('.daimon-btn')  ||
          e.target.closest('.zu-btn')      ||
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

    // ウィンドウリサイズ時に追従（アノテーションもページサイズ変化に追従する）
    // ウィンドウリサイズ時は連続発火を抑えるためデバウンス処理を行う
    let _resizeTimer = null;
    window.addEventListener('resize', () => {
      const page = document.getElementById('pageLeft');
      const oldW = page.offsetWidth;
      resizePage();
      const newW = page.offsetWidth;
      if (oldW > 0 && newW !== oldW) {
        scaleAnnotations(newW / oldW);
      }
      // ページサイズ変化後にcanvasサイズを同期するため book を再描画する
      if (state.bookPages) {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => renderPage(state.currentPage), 150);
      }
    });

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



// index.html 内のインラインイベントハンドラ（onclick等）から呼べるように window に公開する
Object.assign(window, {
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
  handleAnnotationFile,
  handleZipFile,
  loadAnnotations,
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
  onPageMouseUp
});
