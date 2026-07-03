import { addAnnClickHandler } from './annotation-actions.js';
import { applyLiveUpdate, openAnnotationSettingsDialog } from './annotation-dialog.js';
import { scheduleAutoSave } from './autosave.js';
import { addDaimonClickHandler, addKotaeClickHandler, addShomeiClickHandler, renderButtonVisual } from './buttons.js';
import { ANNOTATION_TYPE_CONFIG, UNDO_MAX, renderAnnObjectContent } from './config.js';
import { deselectAllObjects, getSelectedObjects, makeDraggable, makeResizable, reinitElement, updateAlignPanel } from './annotation-interaction.js';
import { updateAnnotationVisibility } from './page-view.js';
import { redoStack, undoStack } from './state.js';
import { addStickyClickHandler, applyStickyHideUndo } from './sticky.js';
import { closeDialog } from './storage.js';
import { showToast, updateStatus } from './ui-common.js';


    /* ============================
       Undo / Redo（操作履歴）
    ============================ */


    /**
     * Undo スタックに操作を積む。
     * 新しい操作が発生したときは Redo スタックをクリアする。
     * @param {Object} op - 操作スナップショット
     */
    export function pushUndo(op) {
      undoStack.push(op);
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      // 新しい操作が発生したので Redo 履歴をリセット
      redoStack.length = 0;
      // 状態が変化したのでオートセーブを予約する
      scheduleAutoSave();
    }


    /**
     * 直前の操作を取り消す。
     * op.type ごとに逆操作を実行する。
     */
    export function undo() {
      try {
        if (undoStack.length === 0) return;
        const op = undoStack.pop();
        const page = document.getElementById('pageLeft');
        switch (op.type) {
          // --- 付箋非表示（白色化）の取り消し ---
          case 'sticky-hide': {
            applyStickyHideUndo(op.targets, false);
            break;
          }
          // --- 作成の取り消し：要素を削除 ---
          case 'create': {
            op.elements.forEach(el => el.remove());
            deselectAllObjects();
            closeDialog();
            break;
          }
          // --- 削除の取り消し：要素を復元 ---
          case 'delete': {
            op.snapshots.forEach(snap => {
              const el = document.createElement('div');
              el.className = snap.className;
              el.dataset.id = snap.id;
              el.dataset.type = snap.type || '';
              if (snap.savedData)   el.dataset.savedData = snap.savedData;
              if (snap.groupId)     el.dataset.groupId   = snap.groupId;
              if (snap.daimonId)    el.dataset.daimonId  = snap.daimonId;
              if (snap.kotaeId)     el.dataset.kotaeId   = snap.kotaeId;
              if (snap.kotaeOrigBg !== undefined) el.dataset.kotaeOrigBg = snap.kotaeOrigBg;
              if (snap.zuId)        el.dataset.zuId      = snap.zuId;
              if (snap.shomeiId)    el.dataset.shomeiId  = snap.shomeiId;
              el.dataset.page = snap.pageNum || '1';
              el.style.cssText = snap.styleCssText;
              // LIBRO由来の既存付箋（.libro-toggle）は子要素（画像2枚）と専用datasetを復元する
              if (snap.libroToggle) {
                el.dataset.libroToggle = snap.libroToggle;
                if (snap.closedId)   el.dataset.closedId   = snap.closedId;
                if (snap.openId)     el.dataset.openId     = snap.openId;
                if (snap.closedFile) el.dataset.closedFile = snap.closedFile;
                if (snap.openFile)   el.dataset.openFile   = snap.openFile;
                if (snap.innerHTML !== undefined) el.innerHTML = snap.innerHTML;
              }
              // 種別に応じてハンドラ・内容を設定
              if (el.classList.contains('sticky-note')) {
                addStickyClickHandler(el);
                makeResizable(el);
              } else if (el.classList.contains('daimon-btn')) {
                addDaimonClickHandler(el);
                let daimonSd = {};
                try { daimonSd = JSON.parse(snap.savedData || '{}'); } catch (_) {}
                renderButtonVisual(el, 'daimon', daimonSd);
              } else if (el.classList.contains('kotae-btn')) {
                addKotaeClickHandler(el);
                let kotaeSd = {};
                try { kotaeSd = JSON.parse(snap.savedData || '{}'); } catch (_) {}
                renderButtonVisual(el, 'kotae', kotaeSd);
              } else if (el.classList.contains('shomei-btn')) {
                addShomeiClickHandler(el);
                let shomeiSd = {};
                try { shomeiSd = JSON.parse(snap.savedData || '{}'); } catch (_) {}
                renderButtonVisual(el, 'shomei', shomeiSd);
              } else {
                // ann-object / ann-icon-obj
                // savedData からラベル・種別アイコンを再構築
                try {
                  const sd  = JSON.parse(snap.savedData || '{}');
                  const cfg = ANNOTATION_TYPE_CONFIG?.[snap.type];
                  if (el.classList.contains('ann-icon-obj')) {
                    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${cfg?.iconSvg || ''}</svg>`;
                  } else if (el.classList.contains('ann-object')) {
                    const displayType = el.classList.contains('dt-page-color') ? 'page-color' : 'marker';
                    renderAnnObjectContent(el, snap.type, displayType, sd.annLabel);
                  }
                } catch (_) {}
                addAnnClickHandler(el);
                if (el.classList.contains('ann-object')) makeResizable(el);
              }
              makeDraggable(el);
              page.appendChild(el);
            });
            // 削除時に解除した daimonId / kotaeId / shomeiId を付箋に再付与
            if (op.linkedStickyChanges) {
              op.linkedStickyChanges.forEach(({ el, daimonId, kotaeId, kotaeOrigBg, shomeiId, shomeiOrigBg, shomeiOutline, background, outline }) => {
                if (daimonId    !== undefined) el.dataset.daimonId    = daimonId;
                if (kotaeId     !== undefined) el.dataset.kotaeId     = kotaeId;
                if (kotaeOrigBg !== undefined) el.dataset.kotaeOrigBg = kotaeOrigBg;
                if (shomeiId    !== undefined) el.dataset.shomeiId    = shomeiId;
                if (shomeiOrigBg !== undefined) el.dataset.shomeiOrigBg = shomeiOrigBg;
                if (shomeiOutline !== undefined) el.dataset.shomeiOutline = shomeiOutline;
                if (background  !== undefined) el.style.background   = background;
                if (outline     !== undefined) el.style.outline      = outline;
              });
            }
            break;
          }
          // --- 移動の取り消し：位置を元に戻す ---
          case 'move': {
            op.targets.forEach(({ el, prevLeft, prevTop }) => {
              el.style.left = prevLeft + 'px';
              el.style.top  = prevTop  + 'px';
            });
            // Undo直後のapplyLiveUpdateキャッシュをリセット
            applyLiveUpdate._prevX = parseFloat(document.getElementById('annPosX')?.value)  ?? undefined;
            applyLiveUpdate._prevY = parseFloat(document.getElementById('annPosY')?.value)  ?? undefined;
            applyLiveUpdate._prevW = parseFloat(document.getElementById('annWidth')?.value)  ?? undefined;
            applyLiveUpdate._prevH = parseFloat(document.getElementById('annHeight')?.value) ?? undefined;
            // 選択中のオブジェクトがあればサイドメニューを最新状態で再描画
            const selected = getSelectedObjects?.();
            if (selected && selected.length === 1) {
              openAnnotationSettingsDialog(selected[0].dataset.type || 'sticky', selected[0]);
            }
            updateAlignPanel();
            break;
          }
          // --- リサイズの取り消し ---
          case 'resize': {
            const { el, prevLeft, prevTop, prevWidth, prevHeight } = op;
            el.style.left   = prevLeft   + 'px';
            el.style.top    = prevTop    + 'px';
            el.style.width  = prevWidth  + 'px';
            el.style.height = prevHeight + 'px';
            updateAlignPanel();
            break;
          }
          // --- プロパティ変更の取り消し（複数対応） ---
          case 'prop': {
            // stickyColorOverrideはconfirmAnnotationの付箋色変更時のみスナップショットに含まれるため、
            // 含まれる場合のみ復元する（他の呼び出し元のUndoで誤って消してしまわないようhasOwnPropertyで判定）
            const restoreOne = (snap) => {
              const { el, prevSavedData, prevStyleCssText, prevClassName, prevInnerHTML } = snap;
              if (prevSavedData    !== undefined) el.dataset.savedData = prevSavedData;
              if (prevStyleCssText !== undefined) el.style.cssText = prevStyleCssText;
              if (prevClassName    !== undefined) el.className = prevClassName;
              if (prevInnerHTML    !== undefined) el.innerHTML = prevInnerHTML;
              if (Object.prototype.hasOwnProperty.call(snap, 'prevStickyColorOverride')) {
                if (snap.prevStickyColorOverride !== undefined) el.dataset.stickyColorOverride = snap.prevStickyColorOverride;
                else delete el.dataset.stickyColorOverride;
              }
              reinitElement(el);
            };
            if (Array.isArray(op.targets)) {
              op.targets.forEach(restoreOne);
            } else {
              restoreOne(op);
            }
            // Undo直後のapplyLiveUpdateキャッシュをリセット
            applyLiveUpdate._prevX = parseFloat(document.getElementById('annPosX')?.value)  ?? undefined;
            applyLiveUpdate._prevY = parseFloat(document.getElementById('annPosY')?.value)  ?? undefined;
            applyLiveUpdate._prevW = parseFloat(document.getElementById('annWidth')?.value)  ?? undefined;
            applyLiveUpdate._prevH = parseFloat(document.getElementById('annHeight')?.value) ?? undefined;
            break;
          }
          // --- グループ化/解除の取り消し ---
          case 'group': {
            op.targets.forEach(({ el, prevGroupId }) => {
              if (prevGroupId === undefined) delete el.dataset.groupId;
              else                           el.dataset.groupId = prevGroupId;
            });
            break;
          }
          // --- 大問ボタン作成の取り消し ---
          case 'daimon-create': {
            op.btn.remove();
            // 紐付けたすべての要素のdaimonIdを作成前の値に戻す
            (op.linkedAll || []).forEach(({ el, prevDaimonId }) => {
              if (prevDaimonId == null || prevDaimonId === '') delete el.dataset.daimonId;
              else el.dataset.daimonId = prevDaimonId;
            });
            break;
          }
          // --- 答ボタン作成の取り消し ---
          case 'kotae-create': {
            op.btn.remove();
            op.linkedStickies.forEach(({ el, prevKotaeId, prevBackground }) => {
              if (prevKotaeId === undefined) delete el.dataset.kotaeId;
              else                           el.dataset.kotaeId = prevKotaeId;
              delete el.dataset.kotaeOrigBg;
              el.style.background = prevBackground;
            });
            break;
          }
          // --- 証明ボタン作成の取り消し ---
          case 'shomei-create': {
            op.btn.remove();
            op.linkedStickies.forEach(({ el, prevShomeiId, prevBackground }) => {
              if (prevShomeiId === undefined) delete el.dataset.shomeiId;
              else                            el.dataset.shomeiId = prevShomeiId;
              delete el.dataset.shomeiOrigBg;
              el.style.outline = '';
              delete el.dataset.shomeiOutline;
              el.style.background = prevBackground;
            });
            break;
          }
        }
        updateAnnotationVisibility();
        updateStatus('操作を取り消しました');
        // Undo の逆操作を Redo スタックに積む
        redoStack.push(op);
        if (redoStack.length > UNDO_MAX) redoStack.shift();
        // 状態が変化したのでオートセーブを予約する
        scheduleAutoSave();
      } catch (err) {
        // エラー内容を右下デバッグUIに表示
        const el = document.getElementById('undoDebug');
        if (el) {
          el.innerHTML += `<br><span style='color:#ff8888'>[Undo Error] ${err && err.message ? err.message : err}</span>`;
          el.style.display = 'block';
        }
        throw err;
      }
    }


    /**
     * 取り消した操作をやり直す。
     * Redo スタックの op.type に応じて再適用する。
     */
    export function redo() {
      if (redoStack.length === 0) { showToast('これ以上Redoできません。'); return; }
      const op = redoStack.pop();
      const page = document.getElementById('pageLeft');

      switch (op.type) {
        // --- 付箋非表示（白色化）のやり直し ---
        case 'sticky-hide': {
          applyStickyHideUndo(op.targets, true);
          break;
        }
        // --- 作成の再適用：要素を再追加 ---
        case 'create': {
          op.elements.forEach(el => page.appendChild(el));
          break;
        }
        // --- 削除の再適用：要素を再削除 ---
        case 'delete': {
          op.snapshots.forEach(snap => {
            const el = page.querySelector(`[data-id="${snap.id}"]`);
            if (el) el.remove();
          });
          deselectAllObjects();
          closeDialog();
          break;
        }
        // --- 移動の再適用 ---
        case 'move': {
          op.targets.forEach(({ el, afterLeft, afterTop }) => {
            if (afterLeft !== undefined) el.style.left = afterLeft + 'px';
            if (afterTop  !== undefined) el.style.top  = afterTop  + 'px';
          });
          updateAlignPanel();
          break;
        }
        // --- グループ化/解除の再適用 ---
        case 'group': {
          // group op は before のみ保持のためスキップ
          break;
        }
        // --- 大問ボタン作成の再適用 ---
        case 'daimon-create': {
          page.appendChild(op.btn);
          (op.linkedAll || []).forEach(({ el, prevDaimonId }) => {
            el.dataset.daimonId = op.btn.dataset.daimonId;
          });
          break;
        }
        // --- 答ボタン作成の再適用 ---
        case 'kotae-create': {
          page.appendChild(op.btn);
          op.linkedStickies.forEach(({ el }) => {
            el.dataset.kotaeId  = op.btn.dataset.kotaeId;
            el.style.background = '#ffffff';
          });
          break;
        }
        // --- 証明ボタン作成の再適用 ---
        case 'shomei-create': {
          page.appendChild(op.btn);
          op.linkedStickies.forEach(({ el }) => {
            el.dataset.shomeiId = op.btn.dataset.shomeiId;
            el.style.background = '#ffffff';
            el.style.outline    = '';
          });
          break;
        }
        default: break;
      }

      // Redo 履歴を Undo スタックに戻す（redoStack はクリアしない）
      undoStack.push(op);
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      // 状態が変化したのでオートセーブを予約する
      scheduleAutoSave();
      updateAnnotationVisibility();
      updateStatus('操作をやり直しました');
      updateAlignPanel();
      // Redo直後のapplyLiveUpdateキャッシュをサイドメニュー入力欄の値で初期化
      applyLiveUpdate._prevX = parseFloat(document.getElementById('annPosX')?.value)  ?? undefined;
      applyLiveUpdate._prevY = parseFloat(document.getElementById('annPosY')?.value)  ?? undefined;
      applyLiveUpdate._prevW = parseFloat(document.getElementById('annWidth')?.value)  ?? undefined;
      applyLiveUpdate._prevH = parseFloat(document.getElementById('annHeight')?.value) ?? undefined;
      // 選択中のオブジェクトがあればサイドメニューを最新状態で再描画
      const selected = getSelectedObjects?.();
      if (selected && selected.length === 1) {
        openAnnotationSettingsDialog(selected[0].dataset.type || 'sticky', selected[0]);
      }
    }
