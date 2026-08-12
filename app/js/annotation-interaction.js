import { addAnnClickHandler } from './annotation-actions.js';
import { confirmAnnotation, openAnnotationSettingsDialog, openQuickCreateDialog, refreshMultiSelectionPanel, refreshPosFieldsLive } from './annotation-dialog.js';
import { addDaimonClickHandler, addKotaeClickHandler, addShomeiClickHandler, makeDaimonResizable, renderButtonVisual } from './buttons.js';
import { ANNOTATION_TYPE_CONFIG, STICKY_COLOR_MAP, STICKY_MIN_SIZE_PX, renderAnnObjectContent, renderAnnImageContent } from './config.js';
import { selectedStickySet, state } from './state.js';
import { addStickyClickHandler, applyStickyOpenMode } from './sticky.js';
import { closeDialog } from './storage.js';
import { showToast, updateStatus } from './ui-common.js';
import { pushUndo } from './undo-redo.js';


    /**
     * ページ内の全オブジェクトを選択状態にする。
     * オーサリングモード時のみ有効。
     */
    export function selectAllObjects() {
      if (document.body.classList.contains('is-view-mode')) return;
      const page = document.getElementById('pageLeft');
      // 付箋
      page.querySelectorAll('.sticky-note:not(.ann-hidden-page)').forEach(n => {
        selectedStickySet.add(n);
        n.classList.add('is-selected');
      });
      // その他オブジェクト
      page.querySelectorAll('.ann-object:not(.ann-hidden-page), .ann-icon-obj:not(.ann-hidden-page), .ann-image-obj:not(.ann-hidden-page), .daimon-btn:not(.ann-hidden-page), .kotae-btn:not(.ann-hidden-page), .shomei-btn:not(.ann-hidden-page)')
        .forEach(a => a.classList.add('is-selected'));
      const total = page.querySelectorAll('.sticky-note:not(.ann-hidden-page), .ann-object:not(.ann-hidden-page), .ann-icon-obj:not(.ann-hidden-page), .ann-image-obj:not(.ann-hidden-page), .daimon-btn:not(.ann-hidden-page), .kotae-btn:not(.ann-hidden-page), .shomei-btn:not(.ann-hidden-page)').length;
      updateStatus();
      updateAlignPanel();
    }


    /**
     * ドラッグ選択中のマウス移動をドキュメントレベルで追跡し、破線矩形を更新する。
     * position:fixed で body に貼り付けるためページ外でも描画される。
     * @param {MouseEvent} e
     */
    export function onDragSelectMove(e) {
      if (!state.isDragSelecting || !state.dragSelectClientStart) return;
      const DRAG_THRESHOLD = 4;
      const dx = Math.abs(e.clientX - state.dragSelectClientStart.x);
      const dy = Math.abs(e.clientY - state.dragSelectClientStart.y);
      // 閾値未満はまだクリック扱い：破線を表示しない
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      // 一度閾値を超えたら破線要素を作成（まだ存在しない場合のみ）
      if (!state.dragSelectPreviewEl) {
        state.dragSelectPreviewEl = document.createElement('div');
        state.dragSelectPreviewEl.className = 'drag-select-rect';
        state.dragSelectPreviewEl.style.position      = 'fixed';
        state.dragSelectPreviewEl.style.pointerEvents = 'none';
        document.body.appendChild(state.dragSelectPreviewEl);
      }
      state.dragSelectPreviewEl.style.left   = Math.min(e.clientX, state.dragSelectClientStart.x) + 'px';
      state.dragSelectPreviewEl.style.top    = Math.min(e.clientY, state.dragSelectClientStart.y) + 'px';
      state.dragSelectPreviewEl.style.width  = Math.abs(e.clientX - state.dragSelectClientStart.x) + 'px';
      state.dragSelectPreviewEl.style.height = Math.abs(e.clientY - state.dragSelectClientStart.y) + 'px';
    }


    /**
     * ドラッグ選択を強制的にキャンセルし、破線プレビューを除去する。
     * 右クリック・ESCキー・ウィンドウのフォーカス喪失など、
     * mouseup 以外の割り込みで中断された場合に呼ぶ。
     */
    export function cancelDragSelect() {
      if (!state.isDragSelecting) return;
      state.isDragSelecting = false;
      document.removeEventListener('mousemove', onDragSelectMove);
      state.dragSelectPreviewEl?.remove();
      state.dragSelectPreviewEl   = null;
      state.dragSelectClientStart = null;
      state.dragSelectStartPos    = null;
    }


    /**
     * 描画ドラッグ中のマウス移動をドキュメントレベルで追跡し、プレビュー矩形を更新する。
     * position:fixed で body に貼り付けるためページ外でも描画される。
     * @param {MouseEvent} e
     */
    export function onDrawPreviewMove(e) {
      if (!state.drawStartPos || !state.drawPreviewEl || !state.drawClientStart) return;
      // 実際に作成される矩形は getPageRelativePos() で紙面内にクランプされるため、
      // プレビュー破線も紙面の可視範囲でクランプして見た目と結果を一致させる
      const rect = document.getElementById('pageLeft').getBoundingClientRect();
      const cx = Math.min(Math.max(e.clientX, rect.left), rect.right);
      const cy = Math.min(Math.max(e.clientY, rect.top),  rect.bottom);
      state.drawPreviewEl.style.left   = Math.min(cx, state.drawClientStart.x) + 'px';
      state.drawPreviewEl.style.top    = Math.min(cy, state.drawClientStart.y) + 'px';
      state.drawPreviewEl.style.width  = Math.abs(cx - state.drawClientStart.x) + 'px';
      state.drawPreviewEl.style.height = Math.abs(cy - state.drawClientStart.y) + 'px';
    }


    /**
     * 選択中の全オブジェクト（付箋・アノテーション）をクリップボードにコピーする。
     * 実際の配置は行わず、パラメータをスナップショットとして保存するだけ。
     */
    export function copySelectedObjects() {
      if (document.body.classList.contains('is-view-mode')) return;
      const targets = getSelectedObjects();
      if (targets.length === 0) { showToast('コピーするオブジェクトを選択してください。'); return; }

      state.annClipboard = targets.map(el => {
        const snap = {
          type:       el.dataset.type || 'sticky',
          className:  el.className.replace(/\bis-selected\b/g, '').trim(),
          savedData:  el.dataset.savedData || '{}',
          left:       parseFloat(el.style.left)   || 0,
          top:        parseFloat(el.style.top)    || 0,
          width:      parseFloat(el.style.width)  || el.offsetWidth,
          height:     parseFloat(el.style.height) || el.offsetHeight,
          background: el.style.background || '',
          groupId:    el.dataset.groupId,
          daimonId:   el.dataset.daimonId,
          // コピー元のページ番号。大問／答ボタンとの紐付けを引き継いでよいか
          // （＝同一ページへの貼り付けか）の判定に使う。
          page:       el.dataset.page,
        };
        // 証明ボタン：shomeiId と紐付き付箋のスナップショットを保存
        if (el.classList.contains('shomei-btn') && el.dataset.shomeiId) {
          snap.shomeiId = el.dataset.shomeiId;
          snap.linkedStickies = [...document.querySelectorAll(`.sticky-note[data-shomei-id="${el.dataset.shomeiId}"]`)].map(n => ({
            left:       parseFloat(n.style.left)   || 0,
            top:        parseFloat(n.style.top)    || 0,
            width:      parseFloat(n.style.width)  || n.offsetWidth,
            height:     parseFloat(n.style.height) || n.offsetHeight,
            background: n.style.background || '#ffffff',
            savedData:  n.dataset.savedData || '{}',
            groupId:    n.dataset.groupId,
          }));
        }
        // 付箋が shomei-btn と一緒にコピーされた場合、shomeiId を保存（重複排除用）
        if (el.classList.contains('sticky-note') && el.dataset.shomeiId) {
          snap.shomeiId = el.dataset.shomeiId;
        }
        // 答ボタン：kotaeId と紐付き付箋のスナップショットを保存
        if (el.classList.contains('kotae-btn') && el.dataset.kotaeId) {
          snap.kotaeId = el.dataset.kotaeId;
          snap.linkedStickies = [...document.querySelectorAll(`.sticky-note[data-kotae-id="${el.dataset.kotaeId}"]`)].map(n => ({
            left:       parseFloat(n.style.left)   || 0,
            top:        parseFloat(n.style.top)    || 0,
            width:      parseFloat(n.style.width)  || n.offsetWidth,
            height:     parseFloat(n.style.height) || n.offsetHeight,
            background: n.style.background || '#ffffff',
            savedData:  n.dataset.savedData || '{}',
            groupId:    n.dataset.groupId,
          }));
        }
        // 付箋が kotae-btn と一緒にコピーされた場合、kotaeId を保存（重複排除用）
        if (el.classList.contains('sticky-note') && el.dataset.kotaeId) {
          snap.kotaeId = el.dataset.kotaeId;
        }
        // LIBRO由来の付箋（.sticky-note.libro-toggle）は、見た目を子要素の閉/開2枚のPNG
        // （<img class="libro-toggle-closed"> / <img class="libro-toggle-open">）で表しており
        // style.background を持たない。従来はその事実を無視して background:'' をそのまま
        // 貼り付けていたため、貼り付け結果が「背景色も画像も無い完全に透明な矩形」になっていた
        // （.sticky-note に背景色の既定値が無いため）。
        // 貼り付け先は通常のCRAFT付箋（単色）として作り直すので、ここではLIBRO由来である
        // ことと、復元すべき色の手がかり（色上書き指定）だけを保存する。
        if (el.classList.contains('sticky-note') && el.dataset.libroToggle === '1') {
          snap.fromLibroToggle = true;
          if (el.dataset.stickyColorOverride !== undefined) {
            snap.stickyColorOverride = el.dataset.stickyColorOverride;
          }
        }
        return snap;
      });
      updateStatus();
    }


    /**
     * クリップボードの内容をページに貼り付ける。
     * 貼り付けたオブジェクトは元の位置から 16px ずらして配置し、選択状態にする。
     */
    export function pasteClipboard() {
      if (document.body.classList.contains('is-view-mode')) return;
      if (state.annClipboard.length === 0) { showToast('貼り付けるオブジェクトがありません。'); return; }
      const OFFSET = 16;
      const page   = document.getElementById('pageLeft');

      // 1回目のペーストからコピー元より OFFSET 分だけ斜め下にずらして配置する
      const dx = OFFSET;
      const dy = OFFSET;

      // 貼り付け前の選択を全解除
      deselectAllObjects();

      // shomei-btn と同じ shomeiId を持つ付箋スナップは shomei-btn 側で複製するためスキップ
      const skipShomeiStickyIds = new Set(
        state.annClipboard
          .filter(s => s.className?.includes('shomei-btn') && s.shomeiId)
          .map(s => s.shomeiId)
      );
      // kotae-btn と同じ kotaeId を持つ付箋スナップは kotae-btn 側で複製するためスキップ
      const skipKotaeStickyIds = new Set(
        state.annClipboard
          .filter(s => s.className?.includes('kotae-btn') && s.kotaeId)
          .map(s => s.kotaeId)
      );

      // 付箋グループ（data-group-id）は複製元と同じIDのまま貼り付けると、複製先が別ページの
      // 場合にLIBRO書き出し時の付箋グループ処理（storage.jsのgroupBuckets）が複製元・複製先を
      // 同一グループとして誤って1ページへ集約してしまう（付箋が別ページへ配置される／
      // 紐付く大問ボタンとの関係が壊れる不具合の原因）。そのため貼り付けのたびに新しい
      // グループIDを発行する。同一ペースト操作内で複数メンバーが同じgroupIdを共有していた
      // 場合は、複製後も互いに同じグループとして振る舞う必要があるため、この呼び出し内では
      // 旧groupId→新groupIdの対応をキャッシュして使い回す。
      const groupIdRemap = new Map();
      const remapGroupId = (oldGid) => {
        if (!oldGid) return undefined;
        if (!groupIdRemap.has(oldGid)) {
          groupIdRemap.set(oldGid, `grp-${++state.stickyGroupCounter}`);
        }
        return groupIdRemap.get(oldGid);
      };

      const pasted = [];
      state.annClipboard.forEach(snap => {
        const newLeft = snap.left + dx;
        const newTop  = snap.top  + dy;

        // shomei-btn と一緒にコピーされた付箋はスキップ（shomei-btn 側で作成済み）
        if (snap.type === 'sticky' && snap.shomeiId && skipShomeiStickyIds.has(snap.shomeiId)) return;

        // kotae-btn と一緒にコピーされた付箋はスキップ（kotae-btn 側で作成済み）
        if (snap.type === 'sticky' && snap.kotaeId && skipKotaeStickyIds.has(snap.kotaeId)) return;

        // 証明ボタン：新 shomeiId で shomei-btn と紐付き付箋を独立複製
        if (snap.className?.includes('shomei-btn')) {
          const newShomeiId = `shomei-${++state.shomeiCounter}`;
          const btn = document.createElement('div');
          btn.dataset.id        = ++state.annIdCounter;
          btn.dataset.type      = 'shomei';
          btn.dataset.shomeiId  = newShomeiId;
          btn.dataset.savedData = snap.savedData || JSON.stringify({ btnPreset: '2', btnScale: '1' });
          // 複製元のページ座標系サイズを保つ（is-sizedとして扱う）
          btn.className         = 'shomei-btn is-sized';
          btn.style.cssText     = `left:${newLeft}px; top:${newTop}px; width:${snap.width}px; height:${snap.height}px;`;
          try {
            renderButtonVisual(btn, 'shomei', JSON.parse(btn.dataset.savedData || '{}'));
          } catch (_) {
            renderButtonVisual(btn, 'shomei', { btnPreset: '2', btnScale: '1' });
          }
          addShomeiClickHandler(btn);
          makeDraggable(btn);
          makeDaimonResizable(btn);
          btn.dataset.page = state.currentPage;
          page.appendChild(btn);
          btn.classList.add('is-selected');
          pasted.push(btn);
          (snap.linkedStickies || []).forEach(ns => {
            const note = document.createElement('div');
            note.dataset.id       = ++state.annIdCounter;
            note.dataset.type     = 'sticky';
            note.dataset.shomeiId = newShomeiId;
            note.dataset.savedData = ns.savedData || '{}';
            if (ns.groupId) note.dataset.groupId = remapGroupId(ns.groupId);
            // 背景は元々常に白固定だが、sticky-open-lockedクラス（クリック無効化・
            // 破線アウトライン等）はコピー元の状態を維持する（F-1と同じ理由）。
            let nsOpenLocked = false;
            try { nsOpenLocked = JSON.parse(ns.savedData || '{}').annStickyOpenMode === '1'; } catch (_) {}
            note.className        = 'sticky-note state-visible' + (nsOpenLocked ? ' sticky-open-locked' : '');
            note.style.cssText    = `left:${ns.left + dx}px; top:${ns.top + dy}px; width:${ns.width}px; height:${ns.height}px;`;
            note.style.background = '#ffffff';
            addStickyClickHandler(note);
            makeDraggable(note);
            makeResizable(note);
            note.dataset.page = state.currentPage;
            page.appendChild(note);
            pasted.push(note);
          });
          return;
        }

        // 答ボタン：新 kotaeId で kotae-btn と紐付き付箋を独立複製
        if (snap.className?.includes('kotae-btn')) {
          const newKotaeId = `kotae-${++state.kotaeCounter}`;
          const btn = document.createElement('div');
          btn.dataset.id       = ++state.annIdCounter;
          btn.dataset.type     = 'kotae';
          btn.dataset.kotaeId  = newKotaeId;
          btn.dataset.savedData = snap.savedData || JSON.stringify({ btnPreset: '1', btnScale: '1' });
          // 複製元のページ座標系サイズを保つ（is-sizedとして扱う）
          btn.className        = 'kotae-btn is-sized';
          btn.style.cssText    = `left:${newLeft}px; top:${newTop}px; width:${snap.width}px; height:${snap.height}px;`;
          try {
            renderButtonVisual(btn, 'kotae', JSON.parse(btn.dataset.savedData || '{}'));
          } catch (_) {
            renderButtonVisual(btn, 'kotae', { btnPreset: '1', btnScale: '1' });
          }
          addKotaeClickHandler(btn);
          makeDraggable(btn);
          makeDaimonResizable(btn);
          btn.dataset.page = state.currentPage;
          page.appendChild(btn);
          btn.classList.add('is-selected');
          pasted.push(btn);
          (snap.linkedStickies || []).forEach(ns => {
            const note = document.createElement('div');
            note.dataset.id      = ++state.annIdCounter;
            note.dataset.type    = 'sticky';
            note.dataset.kotaeId = newKotaeId;
            note.dataset.savedData = ns.savedData || '{}';
            if (ns.groupId) note.dataset.groupId = remapGroupId(ns.groupId);
            // 背景は元々常に白固定だが、sticky-open-lockedクラス（クリック無効化・
            // 破線アウトライン等）はコピー元の状態を維持する（F-1と同じ理由）。
            let nsOpenLocked = false;
            try { nsOpenLocked = JSON.parse(ns.savedData || '{}').annStickyOpenMode === '1'; } catch (_) {}
            note.className       = 'sticky-note state-visible' + (nsOpenLocked ? ' sticky-open-locked' : '');
            note.style.cssText   = `left:${ns.left + dx}px; top:${ns.top + dy}px; width:${ns.width}px; height:${ns.height}px;`;
            note.style.background = '#ffffff';
            addStickyClickHandler(note);
            makeDraggable(note);
            makeResizable(note);
            note.dataset.page = state.currentPage;
            page.appendChild(note);
            pasted.push(note);
          });
          return;
        }

        // 大問ボタン：クラス・ページ座標系サイズ・savedData を保ったまま複製する。
        // daimonId は複製元と同じにする（Alt+ドラッグ複製と同じ挙動。同一の付箋グループを
        // 開閉する2つ目のボタンになる）。
        if (snap.className?.includes('daimon-btn')) {
          const btn = document.createElement('div');
          btn.dataset.id        = ++state.annIdCounter;
          btn.dataset.type      = 'daimon';
          if (snap.daimonId) btn.dataset.daimonId = snap.daimonId;
          btn.dataset.savedData = snap.savedData || '{}';
          // LIBRO由来（.libro-toggle）は複製すると同一idの生データを二重に書き戻すことになるため、
          // 複製結果は新規大問ボタン（.is-sized）として扱う
          btn.className         = 'daimon-btn is-sized';
          btn.style.cssText     = `left:${newLeft}px; top:${newTop}px; width:${snap.width}px; height:${snap.height}px;`;
          try {
            renderButtonVisual(btn, 'daimon', JSON.parse(snap.savedData || '{}'));
          } catch (_) {
            renderButtonVisual(btn, 'daimon', {});
          }
          addDaimonClickHandler(btn);
          makeDraggable(btn);
          makeDaimonResizable(btn);
          btn.dataset.page = state.currentPage;
          page.appendChild(btn);
          btn.classList.add('is-selected');
          pasted.push(btn);
          return;
        }

        const el = document.createElement('div');
        el.dataset.id        = ++state.annIdCounter;
        el.dataset.type      = snap.type;
        el.dataset.savedData = snap.savedData;
        if (snap.groupId) el.dataset.groupId = remapGroupId(snap.groupId);

        if (snap.type === 'sticky') {
          // 「開閉方式：表示ボタン削除」（annStickyOpenMode）はコピー元の状態を維持する。
          // sticky-open-lockedクラスがCSS側の紙色強制・クリック無効化の適用条件のため、
          // savedDataの値から復元する。
          let stickySd = {};
          try { stickySd = JSON.parse(snap.savedData || '{}'); } catch (_) {}
          const stickyOpenLocked = stickySd.annStickyOpenMode === '1';

          // 貼り付け結果は常に通常のCRAFT付箋（単色）として作る。コピー元がLIBRO由来付箋
          // （.libro-toggle）だった場合、その見た目は子要素のPNGで表されていて
          // style.background が空のため、従来はそのまま `background:;`（無効宣言）となり
          // 完全に透明な矩形が生成されていた。
          // 書き出し側（storage.jsの新規付箋経路）は savedData.annColor から単色PNGを生成する
          // ため、DOMの見た目と書き出し結果を一致させる目的で annColor を明示的に補う。
          // 色は「コピー元の色上書き指定 → 環境設定のデフォルト付箋色」の順で決める
          // （元PNGの絵柄そのものは引き継がない。単色付箋になる）。
          let stickyBg = snap.background;
          if (snap.fromLibroToggle) {
            const colorIdx = snap.stickyColorOverride !== undefined
              ? snap.stickyColorOverride
              : (state.settingsStickyDefaultColor ?? '0');
            stickySd.annColor = String(colorIdx);
            el.dataset.savedData = JSON.stringify(stickySd);
            stickyBg = STICKY_COLOR_MAP[parseInt(stickySd.annColor, 10)] ?? STICKY_COLOR_MAP[0];
          }

          el.className = 'sticky-note state-visible' + (stickyOpenLocked ? ' sticky-open-locked' : '');
          el.style.cssText = [
            `left:${newLeft}px`,
            `top:${newTop}px`,
            `width:${snap.width}px`,
            `height:${snap.height}px`,
            `background:${stickyBg}`,
          ].join('; ') + ';';

          // 大問／答ボタンとの紐付けを引き継ぐ。Alt+ドラッグ複製（cloneNode(true)でdatasetごと
          // 複製するため紐付けが維持される）と挙動を揃えるための復元で、従来のペーストは
          // groupIdしか復元しておらず複製先がボタン配下から外れていた。
          // ただしコピー元と同じページへ貼り付ける場合に限る。書き出し時、ボタンの紐付き付箋は
          // document.querySelectorAll('.sticky-note[data-daimon-id="..."]') でページを区別せず
          // 引かれるため、別ページへ紐付けを持ち込むとボタンのHide/Show targetsが他ページの
          // 付箋を指してしまう。
          if (String(snap.page ?? '') === String(state.currentPage)) {
            if (snap.daimonId) el.dataset.daimonId = snap.daimonId;
            if (snap.kotaeId)  el.dataset.kotaeId  = snap.kotaeId;
          }

          addStickyClickHandler(el);
          makeDraggable(el);
          makeResizable(el);
          selectedStickySet.add(el);
        } else {
          // アイコン型・画像アイコン型・紙面カラー型はサイズなし/専用分岐、マーカー型はサイズあり
          let snapDisplayType = 'marker';
          try {
            snapDisplayType = JSON.parse(snap.savedData || '{}').annDisplayType || 'marker';
          } catch (_) {}
          const isIcon      = snap.className.includes('ann-icon-obj');
          const isImage     = snap.className.includes('ann-image-obj');
          const isPageColor = !isIcon && !isImage &&
            (snap.className.includes('dt-page-color') || snapDisplayType === 'page-color');
          el.className = isIcon ? 'ann-icon-obj'
                        : isImage ? 'ann-image-obj'
                        : isPageColor ? 'ann-object dt-page-color'
                        : 'ann-object';
          if (isIcon) {
            // アイコン型は常に 1:1。コピー元が万一非正方形でも短辺に揃えて正方形を保証する
            const iconSize = Math.max(14, Math.min(snap.width, snap.height));
            el.style.cssText = [
              `left:${newLeft}px`,
              `top:${newTop}px`,
              `width:${iconSize}px`,
              `height:${iconSize}px`,
              snap.background ? `background:${snap.background}` : '',
            ].filter(Boolean).join('; ') + ';';
            const cfg = ANNOTATION_TYPE_CONFIG[snap.type];
            if (cfg) el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cfg.iconViewBox || '0 0 24 24'}">${cfg.iconSvg}</svg>`;
            makeResizable(el, { lockAspectRatio: true, minSize: 14 });
          } else if (isImage) {
            el.style.cssText = [
              `left:${newLeft}px`,
              `top:${newTop}px`,
              `width:${snap.width}px`,
              `height:${snap.height}px`,
            ].join('; ') + ';';
            try {
              renderAnnImageContent(el, JSON.parse(snap.savedData || '{}'));
            } catch (_) {}
            makeResizable(el, { lockAspectRatio: true, minSize: 14 });
          } else if (isPageColor) {
            // 紙面カラー型：背景・ラベルは付与しない。種別色は renderAnnObjectContent が
            // --ann-type-rgb インラインカスタムプロパティ経由でCSS側に渡す（新規作成・更新と同じ仕組み）
            el.style.cssText = [
              `left:${newLeft}px`,
              `top:${newTop}px`,
              `width:${snap.width}px`,
              `height:${snap.height}px`,
            ].join('; ') + ';';
            renderAnnObjectContent(el, snap.type, 'page-color');
            makeResizable(el);
          } else {
            el.style.cssText = [
              `left:${newLeft}px`,
              `top:${newTop}px`,
              `width:${snap.width}px`,
              `height:${snap.height}px`,
              `background:${snap.background}`,
            ].join('; ') + ';';
            // ラベル・種別アイコンを savedData から復元
            try {
              const sd = JSON.parse(snap.savedData);
              renderAnnObjectContent(el, snap.type, 'marker', sd.annLabel);
            } catch (_) {}
            makeResizable(el);
          }
          addAnnClickHandler(el);
          makeDraggable(el);
        }

        el.dataset.page = state.currentPage;
        el.classList.add('is-selected');
        page.appendChild(el);
        pasted.push(el);
      });

      // 貼り付け結果が紙面外へはみ出す場合、相対位置を保ったままグループごと紙面内へ引き戻す
      clampGroupIntoPage(pasted);

      // 連続ペースト時は次回を OFFSET ずらして重なりを避ける（linkedObj の位置も更新）
      state.annClipboard = state.annClipboard.map(s => {
        const updated = { ...s, left: s.left + OFFSET, top: s.top + OFFSET };
        if (s.linkedObj) {
          updated.linkedObj = { ...s.linkedObj, left: s.linkedObj.left + OFFSET, top: s.linkedObj.top + OFFSET };
        }
        if (s.linkedStickies) {
          updated.linkedStickies = s.linkedStickies.map(ns => ({ ...ns, left: ns.left + OFFSET, top: ns.top + OFFSET }));
        }
        return updated;
      });

      // 最後のオブジェクトでサイドバーを更新
      if (pasted.length > 0) {
        const last = pasted[pasted.length - 1];
        openAnnotationSettingsDialog(last.dataset.type || 'sticky', last);
      }
      pushUndo({ type: 'create', elements: [...pasted] });
      updateStatus();
      updateAlignPanel();
    }


    /**
     * ページ上の全オブジェクト（付箋・アノテーション）の選択状態を解除する。
     * オーサリングパネルのボタン切り替え時など、選択をリセットしたい場面で使用する。
     */
    export function deselectAllObjects() {
      selectedStickySet.forEach(n => n.classList.remove('is-selected'));
      selectedStickySet.clear();
      document.querySelectorAll('.ann-object, .ann-icon-obj, .ann-image-obj, .daimon-btn, .kotae-btn, .shomei-btn').forEach(a => a.classList.remove('is-selected'));
      state.selectedAnnotation = null;
      closeDialog();
      updateStatus();
    }


    /**
     * アノテーション描画モードを有効にする。
     * @param {string} type - アノテーション種別
     */
    export function activateAnnotationMode(type) {
      // 同じボタンを再度押したらモードを解除（トグル）＆選択解除
      if (state.currentDrawType === type) {
        deactivateAnnotationMode();
        deselectAllObjects();
        closeDialog();
        updateStatus();
        return;
      }

      // 別ボタンへ切り替え：選択中オブジェクトを解除してから切り替える
      deselectAllObjects();
      closeDialog();

      // 前回のアクティブボタンのハイライトを解除
      document.querySelectorAll('li[data-ann-type]').forEach(li => li.classList.remove('is-ann-active'));
      // 選択中ボタンにアクティブクラスを付与
      const activeLi = document.querySelector(`li[data-ann-type="${type}"]`);
      if (activeLi) activeLi.classList.add('is-ann-active');

      state.currentDrawType = type;
      document.getElementById('pageLeft').classList.add('drawing-mode');
      const cfg = ANNOTATION_TYPE_CONFIG[type];
      updateStatus();

      // 詳細設定パネルに選択種別のフォームを表示
      openAnnotationSettingsDialog(type);
    }


    /**
     * アノテーション描画モードを無効にする。
     */
    export function deactivateAnnotationMode() {
      // アクティブボタンのハイライトを全解除
      document.querySelectorAll('li[data-ann-type]').forEach(li => li.classList.remove('is-ann-active'));

      state.currentDrawType = null;
      document.getElementById('pageLeft').classList.remove('drawing-mode');
      if (state.drawPreviewEl) {
        state.drawPreviewEl.remove();
        state.drawPreviewEl = null;
      }
      state.drawStartPos = null;
    }


    /* ============================
       紙面内クランプ
    ============================ */


    /**
     * 紙面（#pageLeft）のベース座標系サイズを返す。
     * offsetWidth / offsetHeight は CSS transform: scale() の影響を受けないレイアウトサイズのため、
     * オブジェクトの style.left/top/width/height と同じ座標系の値になる。
     * @returns {{w: number, h: number}}
     */
    export function getPageBaseSize() {
      const page = document.getElementById('pageLeft');
      return { w: page?.offsetWidth || 0, h: page?.offsetHeight || 0 };
    }


    /**
     * 矩形が紙面内に完全に収まるよう left/top をクランプして返す。
     * 幅・高さが紙面より大きい場合は左上（0,0）に寄せる。
     * @param {number} left
     * @param {number} top
     * @param {number} w
     * @param {number} h
     * @returns {{left: number, top: number}}
     */
    export function clampRectToPage(left, top, w, h) {
      const page = getPageBaseSize();
      if (!page.w || !page.h) return { left, top };
      const maxLeft = Math.max(0, page.w - w);
      const maxTop  = Math.max(0, page.h - h);
      return {
        left: Math.min(Math.max(left, 0), maxLeft),
        top:  Math.min(Math.max(top,  0), maxTop),
      };
    }


    /**
     * 要素の現在位置を紙面内へクランプして適用する。
     * 生成直後・貼り付け直後・入力反映直後など、矩形が確定したタイミングで呼ぶ。
     * @param {HTMLElement} el
     */
    export function clampElementToPage(el) {
      if (!el) return;
      const left = parseFloat(el.style.left) || 0;
      const top  = parseFloat(el.style.top)  || 0;
      const pos  = clampRectToPage(left, top, el.offsetWidth, el.offsetHeight);
      el.style.left = pos.left + 'px';
      el.style.top  = pos.top  + 'px';
    }


    /**
     * 複数要素の相対位置を保ったまま、外接矩形が紙面内に収まるようグループ全体を平行移動する。
     * グループが紙面より大きい場合は左上を優先して合わせる。
     * @param {HTMLElement[]} els
     */
    export function clampGroupIntoPage(els) {
      const page = getPageBaseSize();
      const list = (els || []).filter(Boolean);
      if (!page.w || !page.h || list.length === 0) return;
      const rects = list.map(el => ({
        el,
        left:   parseFloat(el.style.left) || 0,
        top:    parseFloat(el.style.top)  || 0,
        width:  el.offsetWidth,
        height: el.offsetHeight,
      }));
      const minLeft   = Math.min(...rects.map(r => r.left));
      const minTop    = Math.min(...rects.map(r => r.top));
      const maxRight  = Math.max(...rects.map(r => r.left + r.width));
      const maxBottom = Math.max(...rects.map(r => r.top  + r.height));
      // 右下のはみ出しを先に戻し、そのうえで左上が負にならないよう戻す
      let dx = 0, dy = 0;
      if (maxRight  > page.w) dx = page.w - maxRight;
      if (maxBottom > page.h) dy = page.h - maxBottom;
      if (minLeft + dx < 0) dx = -minLeft;
      if (minTop  + dy < 0) dy = -minTop;
      if (dx === 0 && dy === 0) return;
      rects.forEach(r => {
        r.el.style.left = (r.left + dx) + 'px';
        r.el.style.top  = (r.top  + dy) + 'px';
      });
    }


    /**
     * 移動ドラッグの移動量(dx, dy)を、対象群の外接矩形が紙面内に収まる範囲へ制限する。
     *
     * 上限・下限を 0 側へ丸めているのは、LIBRO book 由来などで読み込み時点から紙面外に
     * はみ出している要素を強制的に引き戻さないため。
     * 「はみ出しを悪化させる方向」は 0 で止まり、「解消する方向」は自由に動かせる。
     *
     * @param {number} dx
     * @param {number} dy
     * @param {Array<{left:number, top:number, width:number, height:number}>} rects - ドラッグ開始時の矩形群
     * @returns {{dx: number, dy: number}}
     */
    export function clampMoveDelta(dx, dy, rects) {
      const page = getPageBaseSize();
      if (!page.w || !page.h || !rects || rects.length === 0) return { dx, dy };
      const minLeft   = Math.min(...rects.map(r => r.left));
      const minTop    = Math.min(...rects.map(r => r.top));
      const maxRight  = Math.max(...rects.map(r => r.left + r.width));
      const maxBottom = Math.max(...rects.map(r => r.top  + r.height));
      const dxMin = Math.min(-minLeft, 0);
      const dxMax = Math.max(page.w - maxRight, 0);
      const dyMin = Math.min(-minTop, 0);
      const dyMax = Math.max(page.h - maxBottom, 0);
      return {
        dx: Math.min(Math.max(dx, dxMin), dxMax),
        dy: Math.min(Math.max(dy, dyMin), dyMax),
      };
    }


    /**
     * リサイズドラッグの移動量(dx, dy)を、リサイズ結果の矩形が紙面内に収まる範囲へ制限する。
     * ハンドルごとに「どの辺が動くか」が決まっているため、辺ごとに上限・下限を求めて
     * dx / dy をクランプする（矩形計算そのものは呼び出し側の既存ロジックをそのまま使える）。
     *
     * @param {string} corner - 'tl'|'tc'|'tr'|'ml'|'mr'|'bl'|'bc'|'br'
     * @param {number} dx
     * @param {number} dy
     * @param {{left:number, top:number, width:number, height:number}} start - ドラッグ開始時の矩形
     * @param {number} minSize
     * @param {number|null} aspect - 縦横比ロック時の width/height。ロックなしは null
     * @returns {{dx: number, dy: number}}
     */
    export function clampResizeDelta(corner, dx, dy, start, minSize, aspect = null) {
      const page = getPageBaseSize();
      if (!page.w || !page.h) return { dx, dy };
      const { left, top, width, height } = start;
      const movesLeft   = corner === 'tl' || corner === 'ml' || corner === 'bl';
      const movesRight  = corner === 'tr' || corner === 'mr' || corner === 'br';
      const movesTop    = corner === 'tl' || corner === 'tc' || corner === 'tr';
      const movesBottom = corner === 'bl' || corner === 'bc' || corner === 'br';

      let dxMin = -Infinity, dxMax = Infinity;
      let dyMin = -Infinity, dyMax = Infinity;

      // 左辺が動く：left が 0 未満にならず、幅が minSize を下回らない範囲
      if (movesLeft)   { dxMin = -left;            dxMax = width  - minSize; }
      // 右辺が動く：右端が紙面幅を超えず、幅が minSize を下回らない範囲
      if (movesRight)  { dxMin = minSize - width;  dxMax = page.w - (left + width); }
      if (movesTop)    { dyMin = -top;             dyMax = height - minSize; }
      if (movesBottom) { dyMin = minSize - height; dyMax = page.h - (top + height); }

      if (aspect) {
        // 縦横比ロック時は高さが幅から決まるため、高さ側の制約も dx の上限・下限に反映する。
        // tl / tr は下辺固定（上へ伸びる）、bl / br は上辺固定（下へ伸びる）。
        const maxH = (corner === 'tl' || corner === 'tr') ? (top + height) : (page.h - top);
        const maxW = maxH * aspect;
        if (corner === 'tl' || corner === 'bl') {
          // 幅は -dx 方向に増えるため下限を引き上げる
          dxMin = Math.max(dxMin, width - maxW);
        } else {
          dxMax = Math.min(dxMax, maxW - width);
        }
      }

      return {
        dx: Math.min(Math.max(dx, dxMin), dxMax),
        dy: Math.min(Math.max(dy, dyMin), dyMax),
      };
    }


    /**
     * マウス座標をページ相対座標に変換する。
     * @param {MouseEvent} e
     * @returns {{x: number, y: number}}
     */
    export function getPageRelativePos(e) {
      // getBoundingClientRect は視覚座標（CSS scale適用後）を返すため、
      // scaleで除してベース座標（オブジェクトのleft/topと同じ坐標系）に変換する。
      const rect  = document.getElementById('pageLeft').getBoundingClientRect();
      const scale = state.zoomLevel / 100;
      return {
        x: Math.max(0, Math.min(e.clientX - rect.left, rect.width))  / scale,
        y: Math.max(0, Math.min(e.clientY - rect.top,  rect.height)) / scale
      };
    }


    /**
     * 描画：マウスダウン処理。
     * @param {MouseEvent} e
     */
    export function onPageMouseDown(e) {
      // Spacパンモード中は描画・選択処理をスキップ（バブリングで viewArea のリスナーが起動する）
      if (state.isSpaceHeld) return;
      // 閲覧モード中はドラッグ選択を禁止
      if (document.body.classList.contains('is-view-mode')) return;
      // 見開きページ表示中はアノテーション設定不可
      if (state.realPageCount != null && state.currentPage > state.realPageCount) return;
      // 描画モードでない場合
      if (!state.currentDrawType) {
        // 付箋・アノテーション・リサイズハンドル以外の場所をクリックしたらドラッグ選択を開始
        if (!e.target.closest('.sticky-note') &&
            !e.target.closest('.ann-object') &&
            !e.target.closest('.ann-icon-obj') &&
            !e.target.closest('.ann-image-obj') &&
            !e.target.closest('.resize-handle') &&
            !e.target.closest('#selectionBoundingBox')) {
          e.preventDefault();
          state.dragSelectStartPos   = getPageRelativePos(e);
          state.dragSelectClientStart = { x: e.clientX, y: e.clientY };
          state.isDragSelecting = true;
          // state.dragSelectPreviewEl はマウスが実際に動いた時点（onDragSelectMove 内）で作成する
          document.addEventListener('mousemove', onDragSelectMove);
        }
        return;
      }
      e.preventDefault();
      state.drawStartPos    = getPageRelativePos(e);
      state.drawClientStart = { x: e.clientX, y: e.clientY };
      state.drawPreviewEl = document.createElement('div');
      state.drawPreviewEl.className       = 'draw-preview';
      // position:fixed で body に追加することでページ外にもプレビューを描画できる
      state.drawPreviewEl.style.position      = 'fixed';
      state.drawPreviewEl.style.pointerEvents = 'none';
      state.drawPreviewEl.style.left   = e.clientX + 'px';
      state.drawPreviewEl.style.top    = e.clientY + 'px';
      state.drawPreviewEl.style.width  = '0px';
      state.drawPreviewEl.style.height = '0px';
      document.body.appendChild(state.drawPreviewEl);
      document.addEventListener('mousemove', onDrawPreviewMove);
    }


    /**
     * 描画：マウスムーブ処理。
     * @param {MouseEvent} e
     */
    export function onPageMouseMove(e) {
      // ドラッグ選択・描画はドキュメントレベルのハンドラで処理するためスキップ
      if (state.isDragSelecting) return;
      if (state.drawStartPos && state.drawPreviewEl) return;
    }


    /**
     * 描画：マウスアップ処理。矩形を確定して設定ダイアログを開く。
     * @param {MouseEvent} e
     */
    export function onPageMouseUp(e) {
      // ドラッグ選択の確定処理
      if (state.isDragSelecting) {
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
          if (w < 5 && h < 5) {
            // ほぼクリック扱い：選択を全解除
            deselectAllObjects();
          } else {
            // ドラッグ選択を確定し矩形内のオブジェクトを選択状態にする
            finalizeDragSelect(x, y, w, h, e.shiftKey);
          }
        }
        return;
      }
      if (!state.currentDrawType || !state.drawStartPos) return;
      e.preventDefault();
      document.removeEventListener('mousemove', onDrawPreviewMove);
      const pos  = getPageRelativePos(e);
      const x    = Math.min(pos.x, state.drawStartPos.x);
      const y    = Math.min(pos.y, state.drawStartPos.y);
      const w    = Math.abs(pos.x - state.drawStartPos.x);
      const h    = Math.abs(pos.y - state.drawStartPos.y);
      const type = state.currentDrawType;

      // 描画プレビューをリセット（モードは維持して連続作成を可能にする）
      if (state.drawPreviewEl) {
        state.drawPreviewEl.remove();
        state.drawPreviewEl   = null;
        state.drawClientStart = null;
      }
      state.drawStartPos = null;

      // クリックのみ（ほぼ移動なし）の場合：クイック作成ポップアップを表示
      // 付箋のみ、細い解答欄を覆えるようしきい値を STICKY_MIN_SIZE_PX まで下げる
      const clickThreshold = (type === 'sticky') ? STICKY_MIN_SIZE_PX : 10;
      if (w < clickThreshold && h < clickThreshold) {
        openQuickCreateDialog(type, x, y, e.clientX, e.clientY);
        return;
      }

      // ドラッグ作成：ポップアップなし・紙面カラー形式で即時作成
      // 判定は w/h の AND のため、片辺だけ極端に細い矩形は最小サイズへ切り上げる（付箋のみ）
      const drawW = (type === 'sticky') ? Math.max(w, STICKY_MIN_SIZE_PX) : w;
      const drawH = (type === 'sticky') ? Math.max(h, STICKY_MIN_SIZE_PX) : h;
      state.pendingRect = { x, y, w: drawW, h: drawH };
      const _specForm = document.getElementById('dialogFormSpecific');
      if (_specForm) {
        const _dtEl = _specForm.querySelector('#annDisplayType');
        if (_dtEl) {
          _dtEl.value = 'page-color';
        } else {
          const _inp = document.createElement('input');
          _inp.type = 'hidden'; _inp.id = 'annDisplayType'; _inp.value = 'page-color';
          _inp.dataset.qcInject = '1';
          _specForm.appendChild(_inp);
        }
      }
      confirmAnnotation(type);
      if (_specForm) _specForm.querySelectorAll('[data-qc-inject]').forEach(e => e.remove());
    }


    /**
     * 選択時に四隅リサイズハンドルを追加し、ドラッグでサイズ変更できるようにする。
     * アイコン型（.ann-icon-obj）には適用しない。
     * @param {HTMLElement} el - リサイズ対象要素
     */
    /**
     * 要素にリサイズハンドルを追加する。
     * @param {HTMLElement} el - リサイズ対象要素
     * @param {object} [options] - オプション
     * @param {boolean} [options.lockAspectRatio=false] - true にすると縦横比を維持してリサイズ（コーナー4点のみ表示）
     * @param {number} [options.minSize] - リサイズ時の最小サイズ（px）。省略時は
     *   付箋（.sticky-note）が STICKY_MIN_SIZE_PX、それ以外は 10。
     *   付箋の呼び出し箇所は7か所あるため、呼び出し側ではなくここで既定値を分岐させている。
     */
    export function makeResizable(el, options = {}) {
      // 既存ハンドルを削除（クローン再初期化時の重複防止）
      el.querySelectorAll('.resize-handle').forEach(h => h.remove());

      const lockAspectRatio = options.lockAspectRatio || false;
      const MIN_SIZE        = options.minSize || (el.classList.contains('sticky-note') ? STICKY_MIN_SIZE_PX : 10);

      // lockAspectRatio が true の場合はコーナー4点のみ（辺中点は縦横比を崩すため除外）
      const corners = lockAspectRatio
        ? ['tl', 'tr', 'bl', 'br']
        : ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'];

      corners.forEach(corner => {
        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        handle.dataset.corner = corner;

        handle.addEventListener('mousedown', (e) => {
          // Spaceパンモード中はリサイズを行わない（#viewArea のパンへ委譲）
          if (state.isSpaceHeld) return;
          if (document.body.classList.contains('is-view-mode')) return;
          e.preventDefault();
          e.stopPropagation();

          const startX      = e.clientX;
          const startY      = e.clientY;
          const startLeft   = parseInt(el.style.left,   10) || 0;
          const startTop    = parseInt(el.style.top,    10) || 0;
          const startWidth  = el.offsetWidth;
          const startHeight = el.offsetHeight;
          // 縦横比を事前に計算（lockAspectRatio 時に使用）
          const aspectRatio = lockAspectRatio ? (startWidth / startHeight) : null;

          // Shift 軸固定はコーナーハンドルのみ・縦横比ロック時は無効
          const isCorner = ['tl', 'tr', 'bl', 'br'].includes(corner);
          let axis       = null;
          let prevShift  = false;
          let shiftSnapX = null;
          let shiftSnapY = null;
          let frozenDx   = null;
          let frozenDy   = null;

          // ダブルクリックの2回目のmousedownがわずかに動いただけでリサイズ扱いになるのを防ぐ
          const DRAG_THRESHOLD = 4;
          let hasMoved = false;

          const onMove = (ev) => {
            if (!hasMoved) {
              if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
              hasMoved = true;
            }
            // マウス移動量（視覚座標）をscaleで除してベース座標に変換する
            const scale = state.zoomLevel / 100;
            let dx = (ev.clientX - startX) / scale;
            let dy = (ev.clientY - startY) / scale;

            if (isCorner && ev.shiftKey && !lockAspectRatio) {
              // Shift を押した瞬間：基準点と dx/dy を記録して軸をリセット
              if (!prevShift) {
                shiftSnapX = ev.clientX;
                shiftSnapY = ev.clientY;
                frozenDx   = dx;
                frozenDy   = dy;
                axis       = null;
              }
              const ddx = ev.clientX - shiftSnapX;
              const ddy = ev.clientY - shiftSnapY;
              if (axis === null && (Math.abs(ddx) > 3 || Math.abs(ddy) > 3)) {
                axis = Math.abs(ddx) >= Math.abs(ddy) ? 'h' : 'v';
              }
              if (axis === 'h') dy = frozenDy;
              if (axis === 'v') dx = frozenDx;
            } else if (isCorner && !lockAspectRatio) {
              axis       = null;
              shiftSnapX = shiftSnapY = frozenDx = frozenDy = null;
            }
            prevShift = ev.shiftKey;

            // 紙面外へはみ出さないよう移動量を制限する（縦横比ロック時は高さ側の制約も dx に反映される）
            ({ dx, dy } = clampResizeDelta(
              corner, dx, dy,
              { left: startLeft, top: startTop, width: startWidth, height: startHeight },
              MIN_SIZE,
              lockAspectRatio ? aspectRatio : null
            ));

            if (lockAspectRatio) {
              // 縦横比維持リサイズ：width を基準に height を算出
              if (corner === 'tl') {
                const newW = Math.max(startWidth  - dx, MIN_SIZE);
                const newH = newW / aspectRatio;
                el.style.left   = (startLeft + startWidth  - newW) + 'px';
                el.style.top    = (startTop  + startHeight - newH) + 'px';
                el.style.width  = newW + 'px';
                el.style.height = newH + 'px';
              } else if (corner === 'tr') {
                const newW = Math.max(startWidth  + dx, MIN_SIZE);
                const newH = newW / aspectRatio;
                el.style.top    = (startTop  + startHeight - newH) + 'px';
                el.style.width  = newW + 'px';
                el.style.height = newH + 'px';
              } else if (corner === 'bl') {
                const newW = Math.max(startWidth  - dx, MIN_SIZE);
                const newH = newW / aspectRatio;
                el.style.left   = (startLeft + startWidth  - newW) + 'px';
                el.style.width  = newW + 'px';
                el.style.height = newH + 'px';
              } else if (corner === 'br') {
                const newW = Math.max(startWidth  + dx, MIN_SIZE);
                const newH = newW / aspectRatio;
                el.style.width  = newW + 'px';
                el.style.height = newH + 'px';
              }
            } else {
              if (corner === 'tl') {
                const newW = Math.max(startWidth  - dx, MIN_SIZE);
                const newH = Math.max(startHeight - dy, MIN_SIZE);
                el.style.left   = (startLeft + startWidth  - newW) + 'px';
                el.style.top    = (startTop  + startHeight - newH) + 'px';
                el.style.width  = newW + 'px';
                el.style.height = newH + 'px';
              } else if (corner === 'tc') {
                // 上辺中点：縦方向のみ
                const newH = Math.max(startHeight - dy, MIN_SIZE);
                el.style.top    = (startTop  + startHeight - newH) + 'px';
                el.style.height = newH + 'px';
              } else if (corner === 'tr') {
                const newH = Math.max(startHeight - dy, MIN_SIZE);
                el.style.top    = (startTop  + startHeight - newH) + 'px';
                el.style.width  = Math.max(startWidth  + dx, MIN_SIZE) + 'px';
                el.style.height = newH + 'px';
              } else if (corner === 'ml') {
                // 左辺中点：横方向のみ
                const newW = Math.max(startWidth  - dx, MIN_SIZE);
                el.style.left  = (startLeft + startWidth  - newW) + 'px';
                el.style.width = newW + 'px';
              } else if (corner === 'mr') {
                // 右辺中点：横方向のみ
                el.style.width = Math.max(startWidth + dx, MIN_SIZE) + 'px';
              } else if (corner === 'bl') {
                const newW = Math.max(startWidth  - dx, MIN_SIZE);
                el.style.left   = (startLeft + startWidth  - newW) + 'px';
                el.style.width  = newW + 'px';
                el.style.height = Math.max(startHeight + dy, MIN_SIZE) + 'px';
              } else if (corner === 'bc') {
                // 下辺中点：縦方向のみ
                el.style.height = Math.max(startHeight + dy, MIN_SIZE) + 'px';
              } else if (corner === 'br') {
                el.style.width  = Math.max(startWidth  + dx, MIN_SIZE) + 'px';
                el.style.height = Math.max(startHeight + dy, MIN_SIZE) + 'px';
              }
            }
            // サイドパネルの位置・サイズ表示をリアルタイム更新
            refreshPosFieldsLive(el);
            // 大問ボタングループの選択枠をリサイズに追従させる
            updateDaimonGroupHighlight();
          };

          const onUp = () => {
            axis = null;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',   onUp);
            // リサイズが実際に行われた場合のみ Undo スタックに積む
            const curLeft   = parseInt(el.style.left,   10);
            const curTop    = parseInt(el.style.top,    10);
            const curWidth  = el.offsetWidth;
            const curHeight = el.offsetHeight;
            if (curLeft !== startLeft || curTop !== startTop || curWidth !== startWidth || curHeight !== startHeight) {
              pushUndo({ type: 'resize', el, prevLeft: startLeft, prevTop: startTop, prevWidth: startWidth, prevHeight: startHeight, afterLeft: curLeft, afterTop: curTop, afterWidth: curWidth, afterHeight: curHeight });
            }
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup',   onUp);
        });

        el.appendChild(handle);
      });
    }


    /**
     * クローン要素にクリックハンドラと draggable を再設定する。
     * Alt+ドラッグによるコピー後の再初期化に使用する。
     * @param {HTMLElement} el - 再初期化対象の要素
     */
    export function reinitElement(el) {
      if (el.classList.contains('sticky-note')) {
        addStickyClickHandler(el);
        // 付箋も他の種別と同様にドラッグ移動可能にする。これが無いと
        // restoreAnnotationsFromArray() 経由で復元した付箋（オートセーブ復元・
        // 独自ZIP読み込み）が移動できなくなる（新規作成パスは makeDraggable を呼んでいる）。
        makeDraggable(el);
        makeResizable(el);
      } else if (el.classList.contains('daimon-btn')) {
        addDaimonClickHandler(el);
        makeDraggable(el);
        // LIBRO由来（dataset.libroToggle==='1'）と .is-sized なしは makeDaimonResizable 側で除外される
        makeDaimonResizable(el);
      } else if (el.classList.contains('kotae-btn')) {
        addKotaeClickHandler(el);
        makeDraggable(el);
        // LIBRO由来／.is-sized なしは makeDaimonResizable 側で除外される
        makeDaimonResizable(el);
      } else if (el.classList.contains('shomei-btn')) {
        addShomeiClickHandler(el);
        makeDraggable(el);
        makeDaimonResizable(el);
      } else if (el.dataset.type) {
        addAnnClickHandler(el);
        makeDraggable(el);
        // LIBRO+製（libro-craft-metaを持たない他オーサリングツール由来）のknown系は、
        // 元画像をobject-fit:fillで矩形へ引き伸ばして表示するため、リサイズすると絵が歪む。
        // リサイズハンドルのみ付けない（位置移動・設定ダイアログでの編集は従来どおり可能）。
        if (el.dataset.libroLockedSize !== '1') {
          if (el.classList.contains('ann-icon-obj') || el.classList.contains('ann-image-obj')) {
            // アイコン型・画像アイコン型：縦横比を維持してリサイズ（最小サイズ 14px）
            makeResizable(el, { lockAspectRatio: true, minSize: 14 });
          } else if (el.classList.contains('ann-object')) {
            makeResizable(el);
          }
        }
      }
    }

    /**
     * Alt+ドラッグで複製したLIBRO由来付箋（.sticky-note.libro-toggle）のクローンを、
     * 通常のCRAFT付箋（単色）へ作り替える。
     *
     * LIBRO由来付箋の見た目は子要素の閉/開2枚のPNG（.libro-toggle-closed /
     * .libro-toggle-open）で表されており style.background を持たない。さらに
     * dataset.closedId / openId / closedFile / openFile は元bookのannotそのものを指す。
     * cloneNode(true) はこれらをすべて複製するため、そのまま複製すると「同一idかつ
     * 同一PNGファイル名のannotがページ内に複数出現する」状態になり、書き出し時に
     * Hide/Show targetsが潰れて大問ボタンとの紐付けが失われる。
     *
     * そこでコピー＆ペースト（pasteClipboard）と同じ方針で、複製先はLIBRO由来の属性を
     * 落とした通常のCRAFT付箋として作り直す。書き出し側（storage.jsの新規付箋経路）が
     * savedData.annColor から単色PNGを生成するため、DOMの見た目と書き出し結果が一致する。
     * 元PNGの絵柄は引き継がない（単色付箋になる）。
     * @param {HTMLElement} clone - cloneNode(true) 直後のクローン要素（DOM挿入前でよい）
     */
    function convertLibroStickyCloneToCraft(clone) {
      // 色は「コピー元の色上書き指定 → 環境設定のデフォルト付箋色」の順で決める
      const colorIdx = clone.dataset.stickyColorOverride !== undefined
        ? clone.dataset.stickyColorOverride
        : (state.settingsStickyDefaultColor ?? '0');
      let sd = {};
      try { sd = JSON.parse(clone.dataset.savedData || '{}'); } catch (_) {}
      sd.annColor = String(colorIdx);
      clone.dataset.savedData = JSON.stringify(sd);
      const bg = STICKY_COLOR_MAP[parseInt(sd.annColor, 10)] ?? STICKY_COLOR_MAP[0];

      // LIBRO由来の見た目（閉/開PNG・色上書きオーバーレイ）を取り除く。
      // .resize-handle は直後の reinitElement → makeResizable が張り直すため触らない。
      clone.querySelectorAll('.libro-toggle-closed, .libro-toggle-open, .libro-toggle-color-override')
        .forEach(n => n.remove());

      // 元bookのannotを指すID系datasetを落とす（複製先で重複させない）
      clone.classList.remove('libro-toggle');
      delete clone.dataset.libroToggle;
      delete clone.dataset.libroToggleCraft;
      delete clone.dataset.closedId;
      delete clone.dataset.openId;
      delete clone.dataset.closedFile;
      delete clone.dataset.openFile;
      delete clone.dataset.stickyColorOverride;

      clone.style.background = bg;
      // 答ボタンとの紐付けを解除したときに戻す背景色（buttons.jsが記録するもの）。
      // 複製元では空文字（LIBRO由来付箋は背景色を持たない）のため、そのまま引き継ぐと
      // 解除時に透明へ戻ってしまう。新しい単色へ付け替える。
      if (clone.dataset.kotaeId) clone.dataset.kotaeOrigBg = bg;
      else delete clone.dataset.kotaeOrigBg;
    }

    /**
     * 要素をドラッグで移動可能にする。
     * - Shift を押しながらドラッグ：水平または垂直に固定して移動
     * - Alt を押しながらドラッグ：要素をコピーしてドラッグ（オリジナルは元の位置に残る）
     *
     * 同一要素に対して2回以上呼ばれても mousedown リスナーは1つしか登録しない。
     * 二重登録すると1回のドラッグで move のUndoエントリが2件積まれ、Alt+ドラッグでは
     * 複製が2個作られてしまう。Alt+ドラッグの複製処理は makeDraggable(clone) の直後に
     * reinitElement(clone) を呼ぶ構造で、reinitElement() 側も付箋以外の種別では
     * makeDraggable() を呼ぶため、実際に二重登録が起こり得る。
     * cloneNode() はJSプロパティを複製しないため、複製先要素のフラグは未設定から始まる。
     * @param {HTMLElement} el - ドラッグ対象要素
     * @param {string} [excludeSelector] - この CSS セレクタにマッチする子要素からのドラッグは無視
     */
    export function makeDraggable(el, excludeSelector) {
      if (el._draggableInit) return;
      el._draggableInit = true;
      el.addEventListener('mousedown', (e) => {
        // Spaceパンモード中はオブジェクト移動を行わない。
        // stopPropagation せずに抜けることで #viewArea のパンリスナーへ委譲する
        // （preventDefault もパンリスナー側で行われる）。
        if (state.isSpaceHeld) return;
        if (document.body.classList.contains('is-view-mode')) return; // 閲覧モードはドラッグ無効
        if (excludeSelector && e.target.matches(excludeSelector)) return;
        e.preventDefault();
        e.stopPropagation();

        // 複数選択中の Alt+ドラッグ：全選択オブジェクトをまとめてコピー
        const selectedAll      = getSelectedObjects();
        const isInMultiSel     = selectedAll.length > 1 && selectedAll.includes(el);

        // LIBRO由来（dataset.libroToggle==='1'）のうち複製できるのは付箋のみ。
        // 付箋は convertLibroStickyCloneToCraft() で通常のCRAFT付箋（単色）へ作り替えて複製する。
        // LIBRO+製の大問／答ボタン（.daimon-btn.libro-toggle / .kotae-btn.libro-toggle）は
        // 生データを無変更で書き戻すpassthrough対象で、複製するとページ内に同一annotが
        // 二重出力されるため従来どおり除外する（位置移動は引き続き可能）。
        const cloneableSelected = (e.altKey && isInMultiSel)
          ? selectedAll.filter(n => n.dataset.libroToggle !== '1' || n.classList.contains('sticky-note'))
          : [];

        // 従来はドラッグの起点要素がLIBRO由来だとこの分岐へ入らず、選択内に複製可能な
        // 要素があっても一切コピーされなかった。起点要素の種別では分岐せず、
        // 複製対象が1つ以上あるかどうかだけで判定する。
        if (e.altKey && isInMultiSel && cloneableSelected.length > 0) {
          // shomei-btn を含む場合は事前に新 ID を採番してリマップ表を作成
          const shomeiIdMap = new Map();
          const kotaeIdMap  = new Map();
          cloneableSelected.forEach(orig => {
            if (orig.classList.contains('shomei-btn') && orig.dataset.shomeiId) {
              const oldId = orig.dataset.shomeiId;
              if (!shomeiIdMap.has(oldId)) shomeiIdMap.set(oldId, `shomei-${++state.shomeiCounter}`);
            }
            if (orig.classList.contains('kotae-btn') && orig.dataset.kotaeId) {
              const oldId = orig.dataset.kotaeId;
              if (!kotaeIdMap.has(oldId)) kotaeIdMap.set(oldId, `kotae-${++state.kotaeCounter}`);
            }
          });
          // 全選択オブジェクトをクローン（各オブジェクトの開始位置も記録）
          const clones = cloneableSelected.map(orig => {
            const clone = orig.cloneNode(true);
            clone.dataset.id = ++state.annIdCounter;
            clone.classList.remove('is-selected');
            // LIBRO由来付箋の複製は通常のCRAFT付箋（単色）へ作り替える
            if (orig.dataset.libroToggle === '1' && clone.classList.contains('sticky-note')) {
              convertLibroStickyCloneToCraft(clone);
            }
            // shomei-btn / 付箋 の shomeiId を新 ID にリマップ
            if (clone.classList.contains('shomei-btn') && clone.dataset.shomeiId) {
              const mapped = shomeiIdMap.get(clone.dataset.shomeiId);
              if (mapped) clone.dataset.shomeiId = mapped;
            }
            if (clone.classList.contains('sticky-note') && clone.dataset.shomeiId) {
              const mapped = shomeiIdMap.get(clone.dataset.shomeiId);
              if (mapped) clone.dataset.shomeiId = mapped;
            }
            // kotae-btn / 付箋 の kotaeId を新 ID にリマップ
            if (clone.classList.contains('kotae-btn') && clone.dataset.kotaeId) {
              const mapped = kotaeIdMap.get(clone.dataset.kotaeId);
              if (mapped) clone.dataset.kotaeId = mapped;
            }
            if (clone.classList.contains('sticky-note') && clone.dataset.kotaeId) {
              const mapped = kotaeIdMap.get(clone.dataset.kotaeId);
              if (mapped) clone.dataset.kotaeId = mapped;
            }
            orig.parentNode.appendChild(clone);
            makeDraggable(clone, excludeSelector);
            reinitElement(clone);
            return {
              clone,
              startLeft: parseInt(orig.style.left, 10) || 0,
              startTop:  parseInt(orig.style.top,  10) || 0
            };
          });
          // shomei-btn に対応する付箋が選択されていない場合は付箋も補完複製
          const clonedStickyShomeiIds = new Set(
            clones.filter(c => c.clone.classList.contains('sticky-note') && c.clone.dataset.shomeiId).map(c => c.clone.dataset.shomeiId)
          );
          shomeiIdMap.forEach((newId, oldId) => {
            if (clonedStickyShomeiIds.has(newId)) return;
            document.querySelectorAll(`.sticky-note[data-shomei-id="${oldId}"]`).forEach(origNote => {
              const noteClone = origNote.cloneNode(true);
              noteClone.dataset.id       = ++state.annIdCounter;
              noteClone.dataset.shomeiId = newId;
              noteClone.classList.remove('is-selected');
              // LIBRO由来付箋の複製は通常のCRAFT付箋（単色）へ作り替える
              if (origNote.dataset.libroToggle === '1') convertLibroStickyCloneToCraft(noteClone);
              origNote.parentNode.appendChild(noteClone);
              makeDraggable(noteClone, excludeSelector);
              reinitElement(noteClone);
              clones.push({
                clone:     noteClone,
                startLeft: parseInt(origNote.style.left, 10) || 0,
                startTop:  parseInt(origNote.style.top,  10) || 0
              });
            });
          });
          // kotae-btn に対応する付箋が選択されていない場合は付箋も補完複製
          const clonedStickyKotaeIds = new Set(
            clones.filter(c => c.clone.classList.contains('sticky-note') && c.clone.dataset.kotaeId).map(c => c.clone.dataset.kotaeId)
          );
          kotaeIdMap.forEach((newId, oldId) => {
            if (clonedStickyKotaeIds.has(newId)) return;
            document.querySelectorAll(`.sticky-note[data-kotae-id="${oldId}"]`).forEach(origNote => {
              const noteClone = origNote.cloneNode(true);
              noteClone.dataset.id      = ++state.annIdCounter;
              noteClone.dataset.kotaeId = newId;
              noteClone.classList.remove('is-selected');
              // LIBRO由来付箋の複製は通常のCRAFT付箋（単色）へ作り替える
              if (origNote.dataset.libroToggle === '1') convertLibroStickyCloneToCraft(noteClone);
              origNote.parentNode.appendChild(noteClone);
              makeDraggable(noteClone, excludeSelector);
              reinitElement(noteClone);
              clones.push({
                clone:     noteClone,
                startLeft: parseInt(origNote.style.left, 10) || 0,
                startTop:  parseInt(origNote.style.top,  10) || 0
              });
            });
          });

          // 紙面内クランプ用：複製直後の各要素の矩形（相対位置を保つため外接矩形で判定する）
          const cloneRects = clones.map(({ clone, startLeft, startTop }) => ({
            left: startLeft, top: startTop, width: clone.offsetWidth, height: clone.offsetHeight
          }));

          const startX = e.clientX;
          const startY = e.clientY;

          // Shift 制約状態
          let axis2 = null, prevShift2 = false;
          let shiftSnapX2 = null, shiftSnapY2 = null;
          let frozenDx2   = null, frozenDy2   = null;

          // ダブルクリックの2回目のmousedownがわずかに動いただけでドラッグ扱いになるのを防ぐ
          const DRAG_THRESHOLD = 4;
          let hasMoved = false;

          const onMoveMulti = (ev) => {
            if (!hasMoved) {
              if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
              hasMoved = true;
            }
            // マウス移動量（視覚座標）をscaleで除してベース座標に変換する
            const scale = state.zoomLevel / 100;
            let dx = (ev.clientX - startX) / scale;
            let dy = (ev.clientY - startY) / scale;

            if (ev.shiftKey) {
              if (!prevShift2) {
                shiftSnapX2 = ev.clientX; shiftSnapY2 = ev.clientY;
                frozenDx2   = dx;         frozenDy2   = dy;
                axis2       = null;
              }
              const ddx = ev.clientX - shiftSnapX2;
              const ddy = ev.clientY - shiftSnapY2;
              if (axis2 === null && (Math.abs(ddx) > 3 || Math.abs(ddy) > 3)) {
                axis2 = Math.abs(ddx) >= Math.abs(ddy) ? 'h' : 'v';
              }
              if (axis2 === 'h') dy = frozenDy2;
              if (axis2 === 'v') dx = frozenDx2;
            } else {
              axis2 = null;
              shiftSnapX2 = shiftSnapY2 = frozenDx2 = frozenDy2 = null;
            }
            prevShift2 = ev.shiftKey;

            // 紙面外へはみ出さないよう移動量を制限する
            ({ dx, dy } = clampMoveDelta(dx, dy, cloneRects));

            // 全クローンに同じデルタを適用
            clones.forEach(({ clone, startLeft, startTop }) => {
              clone.style.left = (startLeft + dx) + 'px';
              clone.style.top  = (startTop  + dy) + 'px';
            });
            updateAlignPanel();
          };
          const onUpMulti = () => {
            document.removeEventListener('mousemove', onMoveMulti);
            document.removeEventListener('mouseup',   onUpMulti);
            // 直後のclickでクローンへ移した選択が畳まれないよう抑止する（H-2と同じ理由）。
            // 現状はポインタ直下がクローン＝mouseupとmousedownの対象要素が食い違うため
            // clickは#pageLeftで発火し実害は無いが、要素構成の変更に備えて予防的に立てる。
            state.suppressObjectClick = true;
            setTimeout(() => { state.suppressObjectClick = false; }, 0);
            // オリジナルの選択を解除し、クローンに選択を移す
            selectedStickySet.forEach(n => n.classList.remove('is-selected'));
            selectedStickySet.clear();
            document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected').forEach(a => a.classList.remove('is-selected'));
            clones.forEach(({ clone }) => {
              if (clone.classList.contains('sticky-note')) {
                selectedStickySet.add(clone);
              }
              clone.classList.add('is-selected');
            });
            // Alt+複数選択コピーは「作成」として Undo スタックに積む
            pushUndo({ type: 'create', elements: clones.map(c => c.clone) });
            const last = clones[clones.length - 1]?.clone;
            if (last) openAnnotationSettingsDialog(last.dataset.type || 'sticky', last);
            updateAlignPanel();
          };
          document.addEventListener('mousemove', onMoveMulti);
          document.addEventListener('mouseup',   onUpMulti);

          updateStatus();
          return;
        }

        // 複数選択中の通常ドラッグ：全選択オブジェクトをまとめて移動
        if (isInMultiSel) {
          const multiTargets = selectedAll.map(orig => ({
            el:        orig,
            startLeft: parseInt(orig.style.left, 10) || 0,
            startTop:  parseInt(orig.style.top,  10) || 0
          }));
          // 紙面内クランプ用：選択群の矩形（相対位置を保つため外接矩形で判定する）
          const multiRects = multiTargets.map(({ el: t, startLeft, startTop }) => ({
            left: startLeft, top: startTop, width: t.offsetWidth, height: t.offsetHeight
          }));

          const startX = e.clientX;
          const startY = e.clientY;

          let axisM = null, prevShiftM = false;
          let shiftSnapXM = null, shiftSnapYM = null;
          let frozenDxM   = null, frozenDyM   = null;

          // ダブルクリックの2回目のmousedownがわずかに動いただけでドラッグ扱いになるのを防ぐ
          const DRAG_THRESHOLD = 4;
          let hasMoved = false;

          const onMoveM = (ev) => {
            if (!hasMoved) {
              if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
              hasMoved = true;
            }
            // マウス移動量（視覚座標）をscaleで除してベース座標に変換する
            const scale = state.zoomLevel / 100;
            let dx = (ev.clientX - startX) / scale;
            let dy = (ev.clientY - startY) / scale;

            if (ev.shiftKey) {
              if (!prevShiftM) {
                shiftSnapXM = ev.clientX; shiftSnapYM = ev.clientY;
                frozenDxM   = dx;         frozenDyM   = dy;
                axisM       = null;
              }
              const ddx = ev.clientX - shiftSnapXM;
              const ddy = ev.clientY - shiftSnapYM;
              if (axisM === null && (Math.abs(ddx) > 3 || Math.abs(ddy) > 3)) {
                axisM = Math.abs(ddx) >= Math.abs(ddy) ? 'h' : 'v';
              }
              if (axisM === 'h') dy = frozenDyM;
              if (axisM === 'v') dx = frozenDxM;
            } else {
              axisM = null;
              shiftSnapXM = shiftSnapYM = frozenDxM = frozenDyM = null;
            }
            prevShiftM = ev.shiftKey;

            // 紙面外へはみ出さないよう移動量を制限する
            ({ dx, dy } = clampMoveDelta(dx, dy, multiRects));

            multiTargets.forEach(({ el: t, startLeft, startTop }) => {
              t.style.left = (startLeft + dx) + 'px';
              t.style.top  = (startTop  + dy) + 'px';
            });
            updateAlignPanel();
          };
          const onUpM = () => {
            document.removeEventListener('mousemove', onMoveM);
            document.removeEventListener('mouseup',   onUpM);
            // 実際にドラッグした場合のみ、直後に発火するclickでの選択リセットを抑止する
            // （複数選択を解除するまで維持するため）。動かしていない＝単なるクリックのときは
            // 抑止せず、従来どおり「クリックした1件だけを選択」に絞り込む挙動を残す。
            if (hasMoved) {
              state.suppressObjectClick = true;
              setTimeout(() => { state.suppressObjectClick = false; }, 0);
            }
            // 移動が実際に行われた場合のみ Undo スタックに積む
            const movedTargets = multiTargets.filter(({ el: t, startLeft, startTop }) =>
              parseInt(t.style.left, 10) !== startLeft || parseInt(t.style.top, 10) !== startTop
            );
            if (movedTargets.length > 0) {
              pushUndo({ type: 'move', targets: movedTargets.map(({ el: t, startLeft, startTop }) => ({ el: t, prevLeft: startLeft, prevTop: startTop, afterLeft: parseInt(t.style.left, 10), afterTop: parseInt(t.style.top, 10) })) });
            }
            updateAlignPanel();
          };
          document.addEventListener('mousemove', onMoveM);
          document.addEventListener('mouseup',   onUpM);
          return;
        }

        let target = el;
        let altCopied = false; // Alt コピーフラグ
        let altExtraClones = []; // 追加複製された要素（Undo 用）

        // Alt+ドラッグ（単体）：クローンを作成してドラッグ（オリジナルは元の位置に残る）
        // LIBRO+製の大問／答ボタン（passthrough書き戻し対象）だけは複製せず、
        // 従来どおり通常の移動になる（複数選択時の除外条件と同じ）。
        const altCopyBlocked = el.dataset.libroToggle === '1' && !el.classList.contains('sticky-note');
        if (e.altKey && !altCopyBlocked) {
          const clone = el.cloneNode(true);
          clone.dataset.id = ++state.annIdCounter;
          clone.classList.remove('is-selected');
          // LIBRO由来付箋の複製は通常のCRAFT付箋（単色）へ作り替える
          if (el.dataset.libroToggle === '1' && clone.classList.contains('sticky-note')) {
            convertLibroStickyCloneToCraft(clone);
          }
          // shomei-btn の場合：新 shomeiId を採番し、紐付き付箋も複製
          if (clone.classList.contains('shomei-btn') && clone.dataset.shomeiId) {
            const oldShomeiId = clone.dataset.shomeiId;
            const newShomeiId = `shomei-${++state.shomeiCounter}`;
            clone.dataset.shomeiId = newShomeiId;
            document.querySelectorAll(`.sticky-note[data-shomei-id="${oldShomeiId}"]`).forEach(origNote => {
              const noteClone = origNote.cloneNode(true);
              noteClone.dataset.id       = ++state.annIdCounter;
              noteClone.dataset.shomeiId = newShomeiId;
              noteClone.classList.remove('is-selected');
              // LIBRO由来付箋の複製は通常のCRAFT付箋（単色）へ作り替える
              if (origNote.dataset.libroToggle === '1') convertLibroStickyCloneToCraft(noteClone);
              origNote.parentNode.appendChild(noteClone);
              makeDraggable(noteClone, excludeSelector);
              reinitElement(noteClone);
              altExtraClones.push(noteClone);
            });
          }
          // kotae-btn の場合：新 kotaeId を採番し、紐付き付箋も複製
          if (clone.classList.contains('kotae-btn') && clone.dataset.kotaeId) {
            const oldKotaeId = clone.dataset.kotaeId;
            const newKotaeId = `kotae-${++state.kotaeCounter}`;
            clone.dataset.kotaeId = newKotaeId;
            document.querySelectorAll(`.sticky-note[data-kotae-id="${oldKotaeId}"]`).forEach(origNote => {
              const noteClone = origNote.cloneNode(true);
              noteClone.dataset.id      = ++state.annIdCounter;
              noteClone.dataset.kotaeId = newKotaeId;
              noteClone.classList.remove('is-selected');
              // LIBRO由来付箋の複製は通常のCRAFT付箋（単色）へ作り替える
              if (origNote.dataset.libroToggle === '1') convertLibroStickyCloneToCraft(noteClone);
              origNote.parentNode.appendChild(noteClone);
              makeDraggable(noteClone, excludeSelector);
              reinitElement(noteClone);
              altExtraClones.push(noteClone);
            });
          }
          el.parentNode.appendChild(clone);
          makeDraggable(clone, excludeSelector);
          reinitElement(clone);
          target = clone;
          altCopied = true;
          updateStatus();
        }

        const startX    = e.clientX;
        const startY    = e.clientY;
        const startLeft = parseInt(target.style.left, 10) || 0;
        const startTop  = parseInt(target.style.top,  10) || 0;

        // Shift制約：Shift を押した瞬間の位置を起点に軸を判定して固定する
        let axis       = null;
        let prevShift  = false;
        let shiftSnapX = null; // Shift 押下時の clientX
        let shiftSnapY = null; // Shift 押下時の clientY
        let frozenDx   = null; // 固定軸で凍結する dx 値
        let frozenDy   = null; // 固定軸で凍結する dy 値

        // ダブルクリックの2回目のmousedownがわずかに動いただけでドラッグ扱いになるのを防ぐ
        const DRAG_THRESHOLD = 4;
        let hasMoved = false;

        const onMove = (ev) => {
          if (!hasMoved) {
            if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
            hasMoved = true;
          }
          // マウス移動量（視覚座標）をscaleで除してベース座標に変換する
          const scale = state.zoomLevel / 100;
          let dx = (ev.clientX - startX) / scale;
          let dy = (ev.clientY - startY) / scale;

          // Shift を押した瞬間：その時点の位置・dx/dy を記録して軸をリセット
          if (ev.shiftKey) {
            if (!prevShift) {
              shiftSnapX = ev.clientX;
              shiftSnapY = ev.clientY;
              frozenDx   = dx;
              frozenDy   = dy;
              axis       = null;
            }
            // Shift 押下時点からの増分で軸を決定
            const ddx = ev.clientX - shiftSnapX;
            const ddy = ev.clientY - shiftSnapY;
            if (axis === null && (Math.abs(ddx) > 3 || Math.abs(ddy) > 3)) {
              axis = Math.abs(ddx) >= Math.abs(ddy) ? 'h' : 'v';
            }
            // 固定軸は Shift 押下時の値で凍結
            if (axis === 'h') dy = frozenDy;
            if (axis === 'v') dx = frozenDx;
          } else {
            // Shift を離したら制約を全解除
            axis = null;
            shiftSnapX = shiftSnapY = frozenDx = frozenDy = null;
          }
          prevShift = ev.shiftKey;

          // 紙面外へはみ出さないよう移動量を制限する
          ({ dx, dy } = clampMoveDelta(dx, dy, [{
            left: startLeft, top: startTop, width: target.offsetWidth, height: target.offsetHeight
          }]));

          target.style.left = (startLeft + dx) + 'px';
          target.style.top  = (startTop  + dy) + 'px';
          // サイドパネルの位置表示をリアルタイム更新（単一選択・Altコピー複製先どちらも対象）
          refreshPosFieldsLive(target);
          // 大問ボタングループの選択枠を移動に追従させる
          updateDaimonGroupHighlight();
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
          axis = null;
          if (altCopied) {
            // Alt コピー完了：オリジナルの選択を解除してクローンに選択を移す
            el.classList.remove('is-selected');
            selectedStickySet.delete(el);
            if (target.classList.contains('sticky-note')) {
              selectedStickySet.add(target);
            }
            target.classList.add('is-selected');
            // Alt コピーは「作成」として Undo スタックに積む
            pushUndo({ type: 'create', elements: [target, ...altExtraClones] });
            openAnnotationSettingsDialog(target.dataset.type || 'sticky', target);
            updateAlignPanel();
          } else {
            // 通常ドラッグ：移動が実際に行われた場合のみ Undo スタックに積む
            const curLeft = parseInt(target.style.left, 10);
            const curTop  = parseInt(target.style.top,  10);
            if (curLeft !== startLeft || curTop !== startTop) {
              pushUndo({ type: 'move', targets: [{ el: target, prevLeft: startLeft, prevTop: startTop, afterLeft: curLeft, afterTop: curTop }] });
            }
          }
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });
    }


    /* ============================
       ページ操作
    ============================ */


    /**
     * ステータスバーの選択表示を更新する。
     * @param {string} msg - 表示するメッセージ
     */
    /**
     * 複数選択時のバウンディングボックスに四隅リサイズハンドルを設置する。
     * ハンドルをドラッグすると、全選択オブジェクトが外接矩形に対して比例スケーリングされる。
     * @param {HTMLElement} box - #selectionBoundingBox 要素
     */
    export function addBoundingBoxHandles(box) {
      // 既存ハンドルを削除（再描画時の重複防止）
      box.querySelectorAll('.resize-handle').forEach(h => h.remove());

      // コーナー4点 + 各辺中点4点 = 計8ハンドル
      ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'].forEach(corner => {
        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        handle.dataset.corner = corner;

        handle.addEventListener('mousedown', (e) => {
          // Spaceパンモード中はリサイズを行わない（#viewArea のパンへ委譲）
          if (state.isSpaceHeld) return;
          if (document.body.classList.contains('is-view-mode')) return;
          e.preventDefault();
          e.stopPropagation();

          const startX    = e.clientX;
          const startY    = e.clientY;
          const boxLeft   = parseFloat(box.style.left);
          const boxTop    = parseFloat(box.style.top);
          const boxWidth  = parseFloat(box.style.width);
          const boxHeight = parseFloat(box.style.height);
          const MIN_SIZE  = 20;

          // 各選択オブジェクトの初期状態を記録（アイコン型・画像アイコン型はリサイズ対象外・位置移動のみ）
          const selectedObjects = getSelectedObjects();
          const snapshots = selectedObjects
            .filter(el => !el.classList.contains('ann-icon-obj') && !el.classList.contains('ann-image-obj'))
            .map(el => ({
              el,
              left:   parseFloat(el.style.left)   || 0,
              top:    parseFloat(el.style.top)    || 0,
              width:  el.offsetWidth,
              height: el.offsetHeight,
            }));
          // アイコン型・画像アイコン型：位置のみ追従（リサイズなし）
          const iconSnapshots = selectedObjects
            .filter(el => el.classList.contains('ann-icon-obj') || el.classList.contains('ann-image-obj'))
            .map(el => ({
              el,
              left: parseFloat(el.style.left) || 0,
              top:  parseFloat(el.style.top)  || 0,
            }));

          // Shift 軸固定はコーナーハンドルのみ適用（単一選択と同仕様）
          const isCorner = ['tl', 'tr', 'bl', 'br'].includes(corner);
          let axis       = null;
          let prevShift  = false;
          let shiftSnapX = null;
          let shiftSnapY = null;
          let frozenDx   = null;
          let frozenDy   = null;

          // ダブルクリックの2回目のmousedownがわずかに動いただけでリサイズ扱いになるのを防ぐ
          const DRAG_THRESHOLD = 4;
          let hasMoved = false;

          const onMove = (ev) => {
            if (!hasMoved) {
              if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
              hasMoved = true;
            }
            // マウス移動量（視覚座標）をscaleで除してベース座標に変換する
            const scale = state.zoomLevel / 100;
            let dx = (ev.clientX - startX) / scale;
            let dy = (ev.clientY - startY) / scale;

            if (isCorner && ev.shiftKey) {
              if (!prevShift) {
                shiftSnapX = ev.clientX;
                shiftSnapY = ev.clientY;
                frozenDx   = dx;
                frozenDy   = dy;
                axis       = null;
              }
              const ddx = ev.clientX - shiftSnapX;
              const ddy = ev.clientY - shiftSnapY;
              if (axis === null && (Math.abs(ddx) > 3 || Math.abs(ddy) > 3)) {
                axis = Math.abs(ddx) >= Math.abs(ddy) ? 'h' : 'v';
              }
              if (axis === 'h') dy = frozenDy;
              if (axis === 'v') dx = frozenDx;
            } else if (isCorner) {
              axis       = null;
              shiftSnapX = shiftSnapY = frozenDx = frozenDy = null;
            }
            prevShift = ev.shiftKey;

            // 紙面外へはみ出さないよう移動量を制限する。
            // 各オブジェクトはこの外接矩形に対して比例スケーリングされるため、
            // 外接矩形が紙面内に収まれば中身も紙面内に収まる。
            ({ dx, dy } = clampResizeDelta(
              corner, dx, dy,
              { left: boxLeft, top: boxTop, width: boxWidth, height: boxHeight },
              MIN_SIZE, null
            ));

            let newLeft   = boxLeft;
            let newTop    = boxTop;
            let newWidth  = boxWidth;
            let newHeight = boxHeight;

            if (corner === 'tl') {
              newWidth  = Math.max(boxWidth  - dx, MIN_SIZE);
              newHeight = Math.max(boxHeight - dy, MIN_SIZE);
              newLeft   = boxLeft + boxWidth  - newWidth;
              newTop    = boxTop  + boxHeight - newHeight;
            } else if (corner === 'tc') {
              newHeight = Math.max(boxHeight - dy, MIN_SIZE);
              newTop    = boxTop  + boxHeight - newHeight;
            } else if (corner === 'tr') {
              newWidth  = Math.max(boxWidth  + dx, MIN_SIZE);
              newHeight = Math.max(boxHeight - dy, MIN_SIZE);
              newTop    = boxTop  + boxHeight - newHeight;
            } else if (corner === 'ml') {
              newWidth  = Math.max(boxWidth  - dx, MIN_SIZE);
              newLeft   = boxLeft + boxWidth  - newWidth;
            } else if (corner === 'mr') {
              newWidth  = Math.max(boxWidth  + dx, MIN_SIZE);
            } else if (corner === 'bl') {
              newWidth  = Math.max(boxWidth  - dx, MIN_SIZE);
              newHeight = Math.max(boxHeight + dy, MIN_SIZE);
              newLeft   = boxLeft + boxWidth  - newWidth;
            } else if (corner === 'bc') {
              newHeight = Math.max(boxHeight + dy, MIN_SIZE);
            } else {
              newWidth  = Math.max(boxWidth  + dx, MIN_SIZE);
              newHeight = Math.max(boxHeight + dy, MIN_SIZE);
            }

            const scaleX = newWidth  / boxWidth;
            const scaleY = newHeight / boxHeight;

            // 各オブジェクトをバウンディングボックス基準で比例スケーリング
            snapshots.forEach(({ el, left, top, width, height }) => {
              el.style.left   = (newLeft + (left   - boxLeft) * scaleX) + 'px';
              el.style.top    = (newTop  + (top    - boxTop)  * scaleY) + 'px';
              el.style.width  = (width  * scaleX) + 'px';
              el.style.height = (height * scaleY) + 'px';
            });

            // アイコン型はリサイズせず位置のみ破線に追従
            iconSnapshots.forEach(({ el, left, top }) => {
              el.style.left = (newLeft + (left - boxLeft) * scaleX) + 'px';
              el.style.top  = (newTop  + (top  - boxTop)  * scaleY) + 'px';
            });

            // バウンディングボックス自体を更新
            box.style.left   = newLeft   + 'px';
            box.style.top    = newTop    + 'px';
            box.style.width  = newWidth  + 'px';
            box.style.height = newHeight + 'px';
            // サイドパネルの外接矩形表示をリアルタイム更新（updateAlignPanel全体は呼ばず軽量に）
            refreshMultiSelectionPanel(box);
            // 大問ボタングループの選択枠をスケーリングに追従させる
            updateDaimonGroupHighlight();
          };

          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',   onUp);
            // アイコン型・画像アイコン型は矩形スケールに追従せずサイズ固定のため、
            // 外接矩形が紙面内でも自身のサイズ分だけはみ出しうる。個別に補正する。
            getSelectedObjects().forEach(el => clampElementToPage(el));
            updateAlignPanel();
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup',   onUp);
        });

        box.appendChild(handle);
      });
    }


    /**
     * 現在選択中の全オブジェクト（付箋 + 非sticky）を配列で返す。
     * @returns {HTMLElement[]}
     */
    export function getSelectedObjects() {
      const result = [];
      selectedStickySet.forEach(n => result.push(n));
      document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').forEach(a => result.push(a));
      return result;
    }

    /**
     * 選択中のオブジェクト（付箋・アノテーション・各種ボタン）を削除する。
     * Undoスナップショット取得〜DOM削除〜紐付き付箋の解除処理まで含む。
     */
    export function deleteSelectedObjects() {
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
      document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected').forEach(ann => {
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
      document.querySelectorAll('.daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').forEach(btn => {
        deleteSnapshots.push({
          className:   btn.className.replace(/\bis-selected\b/g, '').trim(),
          id:          btn.dataset.id,
          type:        btn.dataset.type,
          daimonId:    btn.dataset.daimonId,
          kotaeId:     btn.dataset.kotaeId,
          shomeiId:    btn.dataset.shomeiId,
          styleCssText: btn.style.cssText,
          pageNum:     btn.dataset.page || '1',
          savedData:   btn.dataset.savedData,
          libroToggle: btn.dataset.libroToggle,
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
        // 答ボタン削除に伴う付箋の kotaeId・背景色・開閉方式の変化を記録
        if (btn.classList.contains('kotae-btn')) {
          const kid = btn.dataset.kotaeId;
          if (kid) {
            document.querySelectorAll(`.sticky-note[data-kotae-id="${kid}"]`).forEach(n => {
              let nSd = {};
              try { nSd = JSON.parse(n.dataset.savedData || '{}'); } catch (_) {}
              linkedStickyChanges.push({
                el: n, kotaeId: kid,
                kotaeOrigBg: n.dataset.kotaeOrigBg,
                background:  n.style.background,
                // 削除実行で「紐付け前の開閉方式」へ戻すため、Undo用に削除前の値を控える
                openMode:          nSd.annStickyOpenMode === '1' ? '1' : '0',
                kotaeOrigOpenMode: n.dataset.kotaeOrigOpenMode,
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
      document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected').forEach(ann => {
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

      // 選択中の答ボタンを削除（紐付き付箋の元色・開閉方式を復元）
      document.querySelectorAll('.kotae-btn.is-selected').forEach(btn => {
        const kid = btn.dataset.kotaeId;
        if (kid) {
          document.querySelectorAll(`.sticky-note[data-kotae-id="${kid}"]`).forEach(n => {
            if (n.dataset.kotaeOrigBg !== undefined) {
              n.style.background = n.dataset.kotaeOrigBg;
              delete n.dataset.kotaeOrigBg;
            }
            // 答ボタン作成時に既定適用した「表示ボタン削除」を紐付け前の設定へ戻す
            // （答ボタンが無くなった付箋が永久に開けなくなるのを防ぐ）。
            // 【H-1】ZIP/book読み込みで復元された答ボタンは createKotaeButton() を通っていないため
            // dataset.kotaeOrigOpenMode を持たない。その場合は既定値（通常開閉）へ戻す。
            if (n.dataset.kotaeOrigOpenMode !== undefined) {
              applyStickyOpenMode(n, n.dataset.kotaeOrigOpenMode);
              delete n.dataset.kotaeOrigOpenMode;
            } else if (n.classList.contains('sticky-open-locked')) {
              applyStickyOpenMode(n, '0');
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
        updateStatus();
      }
    }

    /**
     * 選択中のオブジェクトを切り取る（コピー＋削除）。
     */
    export function cutSelectedObjects() {
      if (document.body.classList.contains('is-view-mode')) return;
      const targets = getSelectedObjects();
      if (targets.length === 0) { showToast('切り取るオブジェクトを選択してください。'); return; }
      copySelectedObjects();      // state.annClipboard へスナップショット保存
      deleteSelectedObjects();    // Undoスナップショット付きで削除
    }


    /**
     * ドラッグ選択（ラバーバンド）を確定し、指定矩形内に含まれるオブジェクトを選択状態にする。
     * Shift キーが押されていた場合は既存選択に追加する。
     * @param {number} x           - 選択矩形の左上 X（ページ相対）
     * @param {number} y           - 選択矩形の左上 Y（ページ相対）
     * @param {number} w           - 選択矩形の幅
     * @param {number} h           - 選択矩形の高さ
     * @param {boolean} addToSel   - true の場合は既存選択に追加する
     */
    export function finalizeDragSelect(x, y, w, h, addToSel) {
      const selRight  = x + w;
      const selBottom = y + h;

      // Shift なし：既存選択を全解除してからドラッグ範囲で選択
      if (!addToSel) {
        selectedStickySet.forEach(n => n.classList.remove('is-selected'));
        selectedStickySet.clear();
        document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').forEach(a => a.classList.remove('is-selected'));
      }

      // 現在ページのオブジェクトのみをチェックして矩形との交差判定
      // （他ページ非表示の .ann-hidden-page 要素は除外）
      const page = document.getElementById('pageLeft');
      page.querySelectorAll('.sticky-note, .ann-object, .ann-icon-obj, .ann-image-obj, .daimon-btn, .kotae-btn, .shomei-btn').forEach(obj => {
        if (obj.classList.contains('ann-hidden-page')) return;
        const l = parseFloat(obj.style.left) || 0;
        const t = parseFloat(obj.style.top)  || 0;
        const r = l + obj.offsetWidth;
        const b = t + obj.offsetHeight;
        // 矩形が一部でも重なっていれば選択対象とする
        const overlaps = r >= x && l <= selRight && b >= y && t <= selBottom;
        if (!overlaps) return;

        if (obj.classList.contains('sticky-note')) {
          selectedStickySet.add(obj);
        }
        obj.classList.add('is-selected');
      });

      const finalSelection = getSelectedObjects();
      const total = finalSelection.length;
      if (total === 1) {
        const sel = finalSelection[0];
        const type = sel.dataset.type || 'sticky';
        openAnnotationSettingsDialog(type, sel);
        updateStatus();
      } else if (total > 1) {
        updateStatus();
        updateAlignPanel();
      } else {
        updateStatus();
      }
    }


    /**
     * 選択状態に応じて付箋パーツ操作パネル（#accStickyOps）の項目の
     * 活性/非活性を切り替える。
     * 非活性条件：アノテーションオブジェクト（ページリンク・外部リンク・
     * 音声・動画・Plusファイル）が選択されている、または何も選択されていない。
     * 付箋・大問/答/証明ボタンのみが選択されている場合は活性。
     */
    export function updateStickyOpsPanel() {
      const items = document.querySelectorAll('#accStickyOps .panel-stack > li');
      if (items.length === 0) return;
      const annCount = document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected').length;
      const btnCount = document.querySelectorAll('.daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').length;
      const disabled = annCount > 0 || (selectedStickySet.size === 0 && btnCount === 0);
      items.forEach(li => li.classList.toggle('is_disabled', disabled));
    }

    /**
     * 選択数に応じて整列パネルの有効/グレーアウトを切り替え、
     * 複数選択時は外接バウンディングボックスを #pageLeft 上に描画する。
     * 選択が2件未満の場合はボックスを削除する。
     *
     * 大問ボタングループの選択枠も併せて更新する。単一選択時にも枠は表示されるため、
     * count < 2 の早期returnより前（関数の先頭）で呼ぶ必要がある。
     */
    export function updateAlignPanel() {
      // 大問ボタングループの選択枠を更新（選択・移動・リサイズ・ズームの全経路で追従させる）
      updateDaimonGroupHighlight();
      updateStickyOpsPanel();
      const panel = document.getElementById('alignPanel');
      if (!panel) return;
      const els = getSelectedObjects();
      const count = els.length;
      panel.classList.toggle('is-disabled', count < 2);
      // 複数選択クラスを body に反映（個別ハンドルの表示切替に使用）
      document.body.classList.toggle('is-multi-select', count >= 2);

      const existing = document.getElementById('selectionBoundingBox');
      if (count < 2) {
        if (existing) existing.remove();
        // 複数選択パネルが構築されている場合、単一選択/選択なしへ戻ったことを示すフラグを落とす
        // （表示・非表示自体はopenAnnotationSettingsDialog/closeDialogに委ねる）
        delete document.getElementById('sideDetailActive').dataset.mode;
        return;
      }

      // 外接バウンディングボックスを算出して描画
      const pageEl     = document.getElementById('pageLeft');
      const pageOrigin = pageEl.getBoundingClientRect();
      const rects = els.map(el => {
        const cr = el.getBoundingClientRect();
        return {
          l: cr.left  - pageOrigin.left,
          t: cr.top   - pageOrigin.top,
          r: cr.right - pageOrigin.left,
          b: cr.bottom - pageOrigin.top,
        };
      });
      const minL = Math.min(...rects.map(r => r.l));
      const minT = Math.min(...rects.map(r => r.t));
      const maxR = Math.max(...rects.map(r => r.r));
      const maxB = Math.max(...rects.map(r => r.b));

      // getBoundingClientRectの値は視覚座標のため、
      // #pageLeftの子要素として配置する際はscaleで除してベース座標に変換する。
      const scale = state.zoomLevel / 100;
      const box = existing || document.createElement('div');
      box.id = 'selectionBoundingBox';
      box.style.left   = minL / scale + 'px';
      box.style.top    = minT / scale + 'px';
      box.style.width  = (maxR - minL) / scale + 'px';
      box.style.height = (maxB - minT) / scale + 'px';
      if (!existing) pageEl.appendChild(box);

      // バウンディングボックスにリサイズハンドルを設置
      addBoundingBoxHandles(box);

      // サイドパネルに外接矩形の左上X・Y、幅・高さをリアルタイム表示する
      refreshMultiSelectionPanel(box);
    }


    /**
     * 大問ボタンまたはその配下の付箋・証明ボタン等を選択しているとき、
     * 同一 daimonId を共有するグループ全体を囲む枠を #pageLeft 上に描画する。
     * 該当グループが選択されていない場合は既存の枠をすべて削除する。
     *
     * ドラッグ移動・リサイズ中の mousemove からも毎フレーム呼ばれるため、
     * 枠は全削除→再生成ではなく「daimonId ごとに既存要素を再利用し、
     * 不要になったものだけ削除する」方式にしている（#selectionBoundingBox と同じ考え方）。
     *
     * 枠の識別には data-group-for を使う。data-daimon-id を枠自身に付けると
     * member 収集の querySelectorAll('[data-daimon-id="..."]') が枠自身にマッチし、
     * 外接矩形が自己参照で膨張し続けるため使ってはならない。
     */
    export function updateDaimonGroupHighlight() {
      const pageEl = document.getElementById('pageLeft');
      if (!pageEl) {
        document.querySelectorAll('.daimon-group-box').forEach(b => b.remove());
        return;
      }

      const daimonIds = new Set();
      getSelectedObjects().forEach(el => {
        const did = el.dataset.daimonId;
        if (did) daimonIds.add(did);
      });

      // 選択から外れたグループの枠を削除する（残った枠だけを以降で更新する）
      pageEl.querySelectorAll('.daimon-group-box').forEach(b => {
        if (!daimonIds.has(b.dataset.groupFor)) b.remove();
      });
      if (daimonIds.size === 0) return;

      const pageOrigin = pageEl.getBoundingClientRect();
      const scale = state.zoomLevel / 100;

      daimonIds.forEach(did => {
        const members = [...pageEl.querySelectorAll(`[data-daimon-id="${did}"]`)]
          .filter(el => !el.classList.contains('ann-hidden-page'));
        const existing = pageEl.querySelector(`.daimon-group-box[data-group-for="${did}"]`);
        if (members.length === 0) {
          if (existing) existing.remove();
          return;
        }

        // 大問制御範囲内の付箋に答ボタンが紐付いている場合、その答ボタンも囲み線に含める。
        // 答ボタンは dataset.daimonId を持たない（createDaimonButton は付箋・証明ボタン・
        // 証明傘下の付箋にしか daimonId を付与しない）ため、上で集めた付箋の
        // dataset.kotaeId から答ボタンを逆引きして members へ加える。
        const kotaeIds = new Set(
          members.map(el => el.dataset.kotaeId).filter(Boolean)
        );
        kotaeIds.forEach(kid => {
          pageEl.querySelectorAll(`.kotae-btn[data-kotae-id="${kid}"]`).forEach(btn => {
            if (btn.classList.contains('ann-hidden-page')) return;
            if (!members.includes(btn)) members.push(btn);
          });
        });

        const rects = members.map(el => {
          const cr = el.getBoundingClientRect();
          return {
            l: cr.left   - pageOrigin.left,
            t: cr.top    - pageOrigin.top,
            r: cr.right  - pageOrigin.left,
            b: cr.bottom - pageOrigin.top,
          };
        });
        const minL = Math.min(...rects.map(r => r.l));
        const minT = Math.min(...rects.map(r => r.t));
        const maxR = Math.max(...rects.map(r => r.r));
        const maxB = Math.max(...rects.map(r => r.b));

        // getBoundingClientRectの値は視覚座標のため、
        // #pageLeftの子要素として配置する際はscaleで除してベース座標に変換する。
        const box = existing || document.createElement('div');
        if (!existing) {
          box.className = 'daimon-group-box';
          box.dataset.groupFor = did;
        }
        box.style.left   = minL / scale + 'px';
        box.style.top    = minT / scale + 'px';
        box.style.width  = (maxR - minL) / scale + 'px';
        box.style.height = (maxB - minT) / scale + 'px';
        if (!existing) pageEl.appendChild(box);
      });
    }


    /**
     * 選択中のオブジェクトを指定モードで整列する。
     * @param {'left'|'centerH'|'right'|'top'|'centerV'|'bottom'} mode
     */
    export function alignObjects(mode) {
      const els = getSelectedObjects();
      if (els.length < 2) return;

      // getBoundingClientRectの値は視覚座標のため、scaleで除してベース座標に変換する。
      // el.style.left/topにそdirectに代入できる形式にする。
      const scale      = state.zoomLevel / 100;
      const pageOrigin = document.getElementById('pageLeft').getBoundingClientRect();
      const rects = els.map(el => {
        const cr = el.getBoundingClientRect();
        const l = (cr.left  - pageOrigin.left) / scale;
        const t = (cr.top   - pageOrigin.top)  / scale;
        const w = cr.width  / scale;
        const h = cr.height / scale;
        return { el, l, t, w, h };
      });

      // Undo用: 整列前の位置を記録
      const prevTargets = rects.map(({ el, l, t }) => ({ el, prevLeft: parseFloat(el.style.left) || l, prevTop: parseFloat(el.style.top) || t }));

      // 外接バウンディングボックス（全オブジェクトを包含する最小矩形）
      const minL   = Math.min(...rects.map(r => r.l));
      const maxR   = Math.max(...rects.map(r => r.l + r.w));
      const minT   = Math.min(...rects.map(r => r.t));
      const maxB   = Math.max(...rects.map(r => r.t + r.h));
      const centerX = (minL + maxR) / 2;
      const centerY = (minT + maxB) / 2;

      // 整列後の位置を計算し、Undo用にafter値も記録
      const afterTargets = [];
      rects.forEach(({ el, l, t, w, h }) => {
        let afterLeft = parseFloat(el.style.left) || l;
        let afterTop  = parseFloat(el.style.top)  || t;
        switch (mode) {
          case 'left':    afterLeft = minL; break;
          case 'centerH': afterLeft = centerX - w / 2; break;
          case 'right':   afterLeft = maxR - w; break;
        }
        switch (mode) {
          case 'top':     afterTop = minT; break;
          case 'centerV': afterTop = centerY - h / 2; break;
          case 'bottom':  afterTop = maxB - h; break;
        }
        // 実際に移動する場合のみ記録
        afterTargets.push({ el, afterLeft, afterTop });
        el.style.left = afterLeft + 'px';
        el.style.top  = afterTop  + 'px';
      });

      // Undoスタックに積む（移動が発生した場合のみ）
      const changed = prevTargets.some((t, i) => t.prevLeft !== afterTargets[i].afterLeft || t.prevTop !== afterTargets[i].afterTop);
      if (changed) {
        // prevTargetsとafterTargetsをマージしてpushUndo
        const targets = prevTargets.map((t, i) => ({ el: t.el, prevLeft: t.prevLeft, prevTop: t.prevTop, afterLeft: afterTargets[i].afterLeft, afterTop: afterTargets[i].afterTop }));
        pushUndo({ type: 'move', targets });
      }

      const labelMap = { left:'水平左揃え', centerH:'水平中央揃え', right:'水平右揃え',
                         top:'垂直上揃え',  centerV:'垂直中央揃え',  bottom:'垂直下揃え' };
      updateStatus();
    }
