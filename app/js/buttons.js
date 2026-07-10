import { openEditPopup } from './annotation-dialog.js';
import { makeDraggable } from './annotation-interaction.js';
import { BTN_COLOR_OPTIONS } from './config.js';
import { mediaBlobs, selectedStickySet, state } from './state.js';
import { showToast, updateStatus } from './ui-common.js';
import { pushUndo } from './undo-redo.js';


    /** ボタン種別ごとのデフォルト表示文言・プリセットindex */
    const BTN_TYPE_DEFAULTS = {
      daimon: { label: '大問', presetIdx: 0 },
      kotae:  { label: '答',   presetIdx: 1 },
      shomei: { label: '証明', presetIdx: 2 },
    };


    /**
     * 大問/答/証明ボタンの見た目を savedData（プリセット・拡大率・画像素材）から確定する。
     * ボタン生成時・編集確定時・アノテーション復元時のいずれからも共通で呼び出す。
     * @param {HTMLElement} el       - daimon-btn/kotae-btn/shomei-btn 要素
     * @param {string}      type     - 'daimon' | 'kotae' | 'shomei'
     * @param {object}      savedData - { btnPreset, btnScale, btnImageFile }
     */
    export function renderButtonVisual(el, type, savedData = {}) {
      const defaults = BTN_TYPE_DEFAULTS[type] || BTN_TYPE_DEFAULTS.daimon;
      const scale = parseFloat(savedData.btnScale) || 1;
      el.style.transform = scale !== 1 ? `scale(${scale})` : '';
      el.style.transformOrigin = 'top left';

      const imageFile = (savedData.btnImageFile || '').trim();
      const imageUrl = imageFile ? mediaBlobs[imageFile] : null;

      if (imageUrl) {
        // 画像モード：プリセット固定サイズ・背景・padding を打ち消し、画像素材の自然サイズで表示する
        el.classList.add('has-custom-image');
        el.dataset.btnHasImage = '1';
        el.style.background = '';
        el.textContent = '';
        let img = el.querySelector('.btn-face');
        if (!img) {
          img = document.createElement('img');
          img.className = 'btn-face';
          img.draggable = false;
          el.appendChild(img);
        }
        img.src = imageUrl;
      } else {
        // プリセットモード：固定サイズCSSのまま背景色とラベルのみ変更する
        el.classList.remove('has-custom-image');
        delete el.dataset.btnHasImage;
        const presetIdx = parseInt(savedData.btnPreset, 10);
        const preset = BTN_COLOR_OPTIONS[Number.isInteger(presetIdx) ? presetIdx : defaults.presetIdx]
                      || BTN_COLOR_OPTIONS[defaults.presetIdx];
        el.style.background = preset.value;
        el.textContent = defaults.label;
      }
    }


    /**
     * アップロードされたSVG/PNG画像から、押下時スタイル（同一形状で色反転）を生成しキャッシュする。
     * 既に生成済み（mediaBlobsにキャッシュ済み）の場合は再生成しない。
     * @param {File} file - アップロードされた画像ファイル
     * @returns {Promise<string>} 生成された押下時画像のキー（mediaBlobsのキー）
     */
    export async function generatePressedVariant(file) {
      const pressedKey = `pressed__${file.name}`;
      if (mediaBlobs[pressedKey]) return pressedKey;

      const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
      let blob;

      if (isSvg) {
        const text = await file.text();
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        doc.querySelectorAll('[fill]').forEach(node => {
          const fill = node.getAttribute('fill');
          const inverted = invertColorString(fill);
          if (inverted) node.setAttribute('fill', inverted);
        });
        const serialized = new XMLSerializer().serializeToString(doc);
        blob = new Blob([serialized], { type: 'image/svg+xml' });
      } else {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = imageData.data;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] === 0) continue; // 透明ピクセルは維持
          px[i]     = 255 - px[i];
          px[i + 1] = 255 - px[i + 1];
          px[i + 2] = 255 - px[i + 2];
        }
        ctx.putImageData(imageData, 0, 0);
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      }

      mediaBlobs[pressedKey] = URL.createObjectURL(blob);
      return pressedKey;
    }


    /**
     * カスタム画像が設定されたボタンの押下時見た目を切り替える（画像未設定のボタンは何もしない）。
     * @param {HTMLElement} btn      - daimon-btn/kotae-btn/shomei-btn 要素
     * @param {boolean}     isPressed - true: 押下時（表示中）画像へ切替 / false: 通常時画像へ切替
     */
    function swapButtonPressedImage(btn, isPressed) {
      if (btn.dataset.btnHasImage !== '1') return;
      let savedData = {};
      try { savedData = JSON.parse(btn.dataset.savedData || '{}'); } catch (_) {}
      const imageFile = (savedData.btnImageFile || '').trim();
      if (!imageFile) return;
      const img = btn.querySelector('.btn-face');
      if (!img) return;
      const key = isPressed ? `pressed__${imageFile}` : imageFile;
      if (mediaBlobs[key]) img.src = mediaBlobs[key];
    }


    /**
     * 全ての大問/答/証明ボタンの見た目を通常時画像へ戻す。
     * 編集モードに戻る際、閲覧モードで押下されたボタンの見た目をリセットするために呼び出す。
     */
    export function resetAllButtonPressedImages() {
      document.querySelectorAll('.daimon-btn, .kotae-btn, .shomei-btn').forEach(btn => {
        swapButtonPressedImage(btn, false);
      });
    }


    /** #rgb / #rrggbb / rgb(...) 形式の色文字列を反転する。解釈できない場合は null を返す。 */
    function invertColorString(colorStr) {
      if (!colorStr || colorStr === 'none') return null;
      const ctx = invertColorString._ctx || (invertColorString._ctx = document.createElement('canvas').getContext('2d'));
      ctx.fillStyle = '#000';
      try { ctx.fillStyle = colorStr; } catch (_) { return null; }
      const computed = ctx.fillStyle; // ブラウザが #rrggbb / rgba(...) に正規化して返す
      const m = computed.match(/^#([0-9a-f]{6})$/i);
      if (m) {
        const n = parseInt(m[1], 16);
        const r = 255 - ((n >> 16) & 0xff);
        const g = 255 - ((n >> 8) & 0xff);
        const b = 255 - (n & 0xff);
        return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
      }
      return null;
    }


    /**
     * 選択中の付箋を一括表示/非表示できる大問ボタンをページ上に作成する。
     * 1件以上の付箋・証明ボタンが選択されている必要がある。
     */
    export function createDaimonButton() {
      if (document.body.classList.contains('is-view-mode')) return;
      const stickies = [...selectedStickySet];
      // 選択中の証明ボタンも紐付け対象とする
      const shomeis = [...document.querySelectorAll('.shomei-btn.is-selected')];

      if (stickies.length + shomeis.length < 1) {
        showToast('付箋・証明ボタンを1件以上選択してください。');
        return;
      }

      const did = `daimon-${++state.daimonCounter}`;

      // 証明ボタン傘下の付箋を収集（間接制御対象）
      const shomeiStickies = shomeis.flatMap(b => {
        const sid = b.dataset.shomeiId;
        return sid ? [...document.querySelectorAll(`.sticky-note[data-shomei-id="${sid}"]`)] : [];
      });

      // 紐付けるすべての要素を1つの配列にまとめ、Undo用に変更前のdaimonIdを保存
      const allLinked = [...stickies, ...shomeis, ...shomeiStickies];
      const linkedUndo = allLinked.map(n => ({ el: n, prevDaimonId: n.dataset.daimonId }));

      // 大問IDをすべての要素に一括付与（証明傘下の付箋も含む）
      allLinked.forEach(n => { n.dataset.daimonId = did; });

      // 配置位置：紐付けた全オブジェクトの左上の少し上
      const posEls  = [...stickies, ...shomeis];
      const minLeft = Math.min(...posEls.map(n => parseFloat(n.style.left) || 0));
      const minTop  = Math.min(...posEls.map(n => parseFloat(n.style.top)  || 0));

      const page = document.getElementById('pageLeft');
      const el = document.createElement('div');
      el.className        = 'daimon-btn';
      el.dataset.type     = 'daimon';
      el.dataset.id       = ++state.annIdCounter;
      el.dataset.daimonId = did;
      el.dataset.savedData = JSON.stringify({ btnPreset: '0', btnScale: '1' });
      el.style.left       = minLeft + 'px';
      el.style.top        = Math.max(0, minTop - 36) + 'px';
      renderButtonVisual(el, 'daimon', { btnPreset: '0', btnScale: '1' });

      addDaimonClickHandler(el);
      makeDraggable(el);
      el.dataset.page = state.currentPage;
      page.appendChild(el);
      // 大問ボタン作成を Undo スタックに積む
      pushUndo({
        type: 'daimon-create',
        btn: el,
        linkedAll: linkedUndo
      });

      const total = stickies.length + shomeis.length;
      updateStatus();
    }


    /**
     * 大問ボタンにクリックハンドラを設定する。
     * 編集モード：選択/解除。閲覧モード：紐付き付箋を一括表示/非表示。
     * @param {HTMLElement} btn - 大問ボタン要素
     */
    export function addDaimonClickHandler(btn) {
      // ダブルクリック：編集モード時にスタイル編集ポップアップを開く
      btn.addEventListener('dblclick', (e) => {
        if (document.body.classList.contains('is-view-mode')) return;
        e.preventDefault();
        e.stopPropagation();
        openEditPopup(btn);
      });
      btn.addEventListener('click', (e) => {
        if (!document.body.classList.contains('is-view-mode')) {
          // 編集モード：選択処理
          if (e.shiftKey) {
            btn.classList.toggle('is-selected');
          } else {
            // 他の選択をすべて解除してこのボタンのみ選択
            selectedStickySet.forEach(n => n.classList.remove('is-selected'));
            selectedStickySet.clear();
            document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected')
              .forEach(a => a.classList.remove('is-selected'));
            btn.classList.add('is-selected');
          }
          const count = document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').length
                      + selectedStickySet.size;
          updateStatus();
          return;
        }

        // 閲覧モード：紐付きオブジェクトを一括開閉
        const did = btn.dataset.daimonId;
        const targets = [
          ...document.querySelectorAll(`.sticky-note[data-daimon-id="${did}"]`),
          ...document.querySelectorAll(`.zu-obj[data-daimon-id="${did}"]`)
        ];
        if (targets.length === 0) return;
        // 全オブジェクトが「開いている状態」かを判定
        // 証明ボタン管理の付箋は shomeiOutline で、それ以外は state-hidden で判断する
        const allVisible = targets.every(t => {
          if (t.classList.contains('sticky-note') && t.dataset.shomeiId) {
            return t.dataset.shomeiOutline !== '1';
          }
          return !t.classList.contains('state-hidden');
        });
        targets.forEach(t => {
          if (t.classList.contains('sticky-note') && t.dataset.shomeiId) {
            // 証明ボタン管理の付箋：白塗り（開）⇔ 赤枠のみ（閉）を再現する
            if (allVisible) {
              // 閉じる：赤枠のみ表示
              t.style.background = 'transparent';
              t.style.outline    = '2px solid rgb(255,0,0)';
              t.dataset.shomeiOutline = '1';
            } else {
              // 開く：白塗りで表示
              t.style.background = '#ffffff';
              t.style.outline    = '';
              delete t.dataset.shomeiOutline;
            }
            // opacity は変えないので state-visible を維持する
            t.classList.add('state-visible');
            t.classList.remove('state-hidden');
          } else {
            t.classList.toggle('state-visible', !allVisible);
            t.classList.toggle('state-hidden',   allVisible);
          }
        });
        swapButtonPressedImage(btn, allVisible);
        updateStatus();
      });
    }


    /**
     * 答ボタンをページ上に作成する。
     * 選択中の付箋（1件以上）を紐付け、その付箋の背景色を白に変更する。
     * 閉覧モードでボタンを押すと紐付き付箋の表示/非表示を一括トグルする。
     */
    export function createKotaeButton() {
      if (document.body.classList.contains('is-view-mode')) return;
      const stickies = [...selectedStickySet];
      if (stickies.length < 1) {
        showToast('付箋を1件以上選択してください。');
        return;
      }

      const kid = `kotae-${++state.kotaeCounter}`;

      // 選択中の付箋に答IDを付与し、背景色を白に変更（元色を保存）
      stickies.forEach(note => {
        note.dataset.kotaeId = kid;
        if (!note.dataset.kotaeOrigBg) {
          note.dataset.kotaeOrigBg = note.style.background || note.style.backgroundColor || '';
        }
        note.style.background = '#ffffff';
      });

      // 配置位置：選択グループの左上の少し上
      const minLeft = Math.min(...stickies.map(n => parseFloat(n.style.left) || 0));
      const minTop  = Math.min(...stickies.map(n => parseFloat(n.style.top)  || 0));

      const page = document.getElementById('pageLeft');
      const el = document.createElement('div');
      el.className        = 'kotae-btn';
      el.dataset.type     = 'kotae';
      el.dataset.id       = ++state.annIdCounter;
      el.dataset.kotaeId  = kid;
      el.dataset.savedData = JSON.stringify({ btnPreset: '1', btnScale: '1' });
      el.style.left       = minLeft + 'px';
      el.style.top        = Math.max(0, minTop - 36) + 'px';
      renderButtonVisual(el, 'kotae', { btnPreset: '1', btnScale: '1' });

      addKotaeClickHandler(el);
      makeDraggable(el);
      el.dataset.page = state.currentPage;
      page.appendChild(el);
      // 答ボタン作成を Undo スタックに積む
      pushUndo({
        type: 'kotae-create',
        btn: el,
        linkedStickies: stickies.map(n => ({ el: n, prevKotaeId: n.dataset.kotaeId === kid ? undefined : n.dataset.kotaeId, prevBackground: n.dataset.kotaeOrigBg || '' }))
      });

      updateStatus();
    }


    /**
     * 答ボタンにクリックハンドラを設定する。
     * 編集モード：選択/解除。閉覧モード：紐付き付箋を一括トグル。
     * @param {HTMLElement} btn - 答ボタン要素
     */
    export function addKotaeClickHandler(btn) {
      // ダブルクリック：編集モード時にスタイル編集ポップアップを開く
      btn.addEventListener('dblclick', (e) => {
        if (document.body.classList.contains('is-view-mode')) return;
        e.preventDefault();
        e.stopPropagation();
        openEditPopup(btn);
      });
      btn.addEventListener('click', (e) => {
        if (!document.body.classList.contains('is-view-mode')) {
          // 編集モード：選択処理
          if (e.shiftKey) {
            btn.classList.toggle('is-selected');
          } else {
            selectedStickySet.forEach(n => n.classList.remove('is-selected'));
            selectedStickySet.clear();
            document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected')
              .forEach(a => a.classList.remove('is-selected'));
            btn.classList.add('is-selected');
          }
          const count = document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').length
                      + selectedStickySet.size;
          updateStatus();
          return;
        }

        // 閉覧モード：紐付き付箋を一括トグル
        const kid = btn.dataset.kotaeId;
        const targets = [...document.querySelectorAll(`.sticky-note[data-kotae-id="${kid}"]`)];
        if (targets.length === 0) return;
        const allVisible = targets.every(t => t.classList.contains('state-visible'));
        targets.forEach(t => {
          t.classList.toggle('state-visible', !allVisible);
          t.classList.toggle('state-hidden',   allVisible);
        });
        swapButtonPressedImage(btn, allVisible);
        updateStatus();
      });
    }


    /**
     * 証明ボタンをページ上に作成する。
     * 選択中の付箋（1件以上）を紐付け、その付箋の背景色を白に変更する。
     * 閲覧モードでボタンを押すと：
     *   - 表示状態の付箋 → 反応しない
     *   - 非表示状態の付箋 → 赤枠線のみ表示（RGB 255,0,0 / 2px solid）した後、押下で表示
     */
    export function createShomeiButton() {
      if (document.body.classList.contains('is-view-mode')) return;
      const stickies = [...selectedStickySet];
      if (stickies.length < 1) {
        showToast('付箋を1件以上選択してください。');
        return;
      }

      const sid = `shomei-${++state.shomeiCounter}`;

      // 選択中の付箋に証明IDを付与し、背景色を白に変更（元色を保存）
      stickies.forEach(note => {
        note.dataset.shomeiId = sid;
        if (!note.dataset.shomeiOrigBg) {
          note.dataset.shomeiOrigBg = note.style.background || note.style.backgroundColor || '';
        }
        note.classList.remove('state-hidden');
        note.classList.add('state-visible');
        note.style.background = '#ffffff';
        note.style.outline = '';
        delete note.dataset.shomeiOutline;
      });

      // 配置位置：選択グループの左上の少し上
      const minLeft = Math.min(...stickies.map(n => parseFloat(n.style.left) || 0));
      const minTop  = Math.min(...stickies.map(n => parseFloat(n.style.top)  || 0));

      const page = document.getElementById('pageLeft');
      const el = document.createElement('div');
      el.className        = 'shomei-btn';
      el.dataset.type     = 'shomei';
      el.dataset.id       = ++state.annIdCounter;
      el.dataset.shomeiId = sid;
      el.dataset.savedData = JSON.stringify({ btnPreset: '2', btnScale: '1' });
      el.style.left       = minLeft + 'px';
      el.style.top        = Math.max(0, minTop - 36) + 'px';
      renderButtonVisual(el, 'shomei', { btnPreset: '2', btnScale: '1' });

      addShomeiClickHandler(el);
      makeDraggable(el);
      el.dataset.page = state.currentPage;
      page.appendChild(el);
      // 証明ボタン作成を Undo スタックに積む
      pushUndo({
        type: 'shomei-create',
        btn: el,
        linkedStickies: stickies.map(n => ({
          el: n,
          prevShomeiId:  n.dataset.shomeiId === sid ? undefined : n.dataset.shomeiId,
          prevBackground: n.dataset.shomeiOrigBg || ''
        }))
      });

      updateStatus();
    }


    /**
     * 証明ボタンにクリックハンドラを設定する。
     * 編集モード：選択/解除。
     * 閲覧モード：紐付き付箋を一括トグル（白表示⇔赤枠線のみ）。
     * @param {HTMLElement} btn - 証明ボタン要素
     */
    export function addShomeiClickHandler(btn) {
      // ダブルクリック：編集モード時にスタイル編集ポップアップを開く
      btn.addEventListener('dblclick', (e) => {
        if (document.body.classList.contains('is-view-mode')) return;
        e.preventDefault();
        e.stopPropagation();
        openEditPopup(btn);
      });
      btn.addEventListener('click', (e) => {
        if (!document.body.classList.contains('is-view-mode')) {
          // 編集モード：選択処理
          if (e.shiftKey) {
            btn.classList.toggle('is-selected');
          } else {
            selectedStickySet.forEach(n => n.classList.remove('is-selected'));
            selectedStickySet.clear();
            document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected')
              .forEach(a => a.classList.remove('is-selected'));
            btn.classList.add('is-selected');
          }
          const count = document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').length
                      + selectedStickySet.size;
          updateStatus();
          return;
        }

        // 閲覧モード：紐付き付箋を一括トグル
        const sid = btn.dataset.shomeiId;
        const targets = [...document.querySelectorAll(`.sticky-note[data-shomei-id="${sid}"]`)];
        if (targets.length === 0) return;

        // 全件白表示中なら赤枠線状態へ、それ以外なら白表示へ
        const allShowing = targets.every(t => t.dataset.shomeiOutline !== '1');
        targets.forEach(t => {
          if (allShowing) {
            t.style.background = 'transparent';
            t.style.outline = '2px solid rgb(255,0,0)';
            t.dataset.shomeiOutline = '1';
          } else {
            t.style.background = '#ffffff';
            t.style.outline = '';
            delete t.dataset.shomeiOutline;
          }
        });
        swapButtonPressedImage(btn, allShowing);
        updateStatus();
      });
    }
