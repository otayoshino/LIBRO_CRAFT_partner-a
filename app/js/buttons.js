import { openAnnotationSettingsDialog, openEditPopup } from './annotation-dialog.js';
import { clampElementToPage, makeDraggable, makeResizable } from './annotation-interaction.js';
import { BTN_COLOR_OPTIONS, DAIMON_PRESSED_COLOR, DAIMON_DEFAULT_ASPECT, DAIMON_DEFAULT_MIN_WIDTH_PX, DAIMON_DEFAULT_WIDTH_RATIO } from './config.js';
import { mediaBlobs, selectedStickySet, state } from './state.js';
import { applyStickyOpenMode } from './sticky.js';
import { closeDialog } from './storage.js';
import { showToast, updateStatus } from './ui-common.js';
import { pushUndo } from './undo-redo.js';


    /** ボタン種別ごとのデフォルト表示文言・プリセットindex */
    const BTN_TYPE_DEFAULTS = {
      daimon: { label: '大問', presetIdx: 0 },
      kotae:  { label: '答',   presetIdx: 1 },
      shomei: { label: '証明', presetIdx: 2 },
    };

    /**
     * 新規大問ボタンの既定サイズを、現在のページ基準サイズ（#pageLeft の offsetWidth）に対する
     * px 値として算出する。offsetWidth はCSS transform（ズーム）の影響を受けない基準サイズであり、
     * アノテーションの style.left/top/width/height と同じ座標系になる。
     * @returns {{width:number, height:number}} 既定サイズ（px・小数を含む）
     */
    export function getDaimonDefaultSizePx() {
      const page = document.getElementById('pageLeft');
      const baseWidth = page?.offsetWidth || 0;
      // 整数pxに丸めると、ページ表示が小さいとき（例：幅696pxで 27×16px）に書き出しrectが
      // 194×116 ではなく 192×114 になる。小数pxのまま保持して実データとの一致精度を上げる
      // （scaleAnnotations / copySelectedObjects / 書き出しはいずれも parseFloat で読むため小数で問題ない）。
      const width  = Math.max(DAIMON_DEFAULT_MIN_WIDTH_PX, baseWidth * DAIMON_DEFAULT_WIDTH_RATIO);
      const height = Math.max(1, width / DAIMON_DEFAULT_ASPECT);
      return { width, height };
    }

    /**
     * 大問ボタンにリサイズハンドルを付与する。対象は「CRAFTで新規作成した大問ボタン」のみ。
     *
     * 除外条件：
     *  - .daimon-btn 以外（答/証明ボタン・アノテーション）
     *  - LIBRO由来（dataset.libroToggle === '1'）：生データを無変更のまま書き戻す passthrough 対象で、
     *    CRAFT側からのサイズ変更は書き出しに反映されないため、ハンドル自体を出さない
     *  - .is-sized なし：本改修以前に作成されCSS固定サイズのままの大問ボタン（現行仕様を維持する）
     *
     * カスタム画像モード（dataset.btnHasImage === '1'）は .btn-face が object-fit: fill で
     * 引き伸ばされるため、縦横比を維持してリサイズする（コーナー4点のみ）。
     * プリセットモードはラベル文字サイズが高さ（45cqh）に追従するので自由リサイズでよい。
     *
     * renderButtonVisual() は el.textContent = '' で子要素（＝ハンドル）を全削除するため、
     * renderButtonVisual() を呼んだ後に必ずこの関数を呼ぶこと。
     * @param {HTMLElement} el - 大問ボタン要素
     */
    export function makeDaimonResizable(el) {
      if (!el?.classList?.contains('daimon-btn') &&
          !el?.classList?.contains('kotae-btn') &&
          !el?.classList?.contains('shomei-btn')) return;
      if (el.dataset.libroToggle === '1') return;
      if (!el.classList.contains('is-sized')) return;
      const hasImage = el.dataset.btnHasImage === '1';
      makeResizable(el, hasImage ? { lockAspectRatio: true, minSize: 14 } : { minSize: 14 });
    }

    /**
     * 画像素材を設定した大問ボタンの高さを、幅を保ったまま画像本来の縦横比に合わせる。
     *
     * 大問ボタンは既定サイズ（LIBRO実データ 194×116、縦横比約1.67）で生成されるため、
     * 何もしないと .btn-face の object-fit: fill によって画像がその比率へ引き伸ばされる。
     * 幅基準で高さを合わせることで、画像アイコン型アノテーション（.ann-image-obj、
     * 画像本来の縦横サイズをそのまま採用する）と同じ考え方に揃える。
     *
     * 矩形の縦横比が画像の縦横比と一致した状態になるため、makeDaimonResizable() の
     * 縦横比ロック（開始時の矩形から比率を取る）もそのまま正しい比率で働く。
     *
     * 画像のデコード完了前は naturalWidth/naturalHeight が 0 のため、未完了なら load を待つ。
     * width/height 属性を持たないSVG等で自然サイズが取得できない場合は、比率を変えない
     * （既定の矩形のまま fill 表示になる）。
     *
     * left/top は変更しないため、高さの変化は下方向にのみ及ぶ。
     * @param {HTMLElement} el - 大問ボタン要素
     */
    export function applyDaimonImageAspect(el) {
      if (!el?.classList?.contains('daimon-btn') &&
          !el?.classList?.contains('kotae-btn') &&
          !el?.classList?.contains('shomei-btn')) return;
      if (el.dataset.libroToggle === '1') return;
      if (!el.classList.contains('is-sized')) return;
      if (el.dataset.btnHasImage !== '1') return;
      const img = el.querySelector('.btn-face');
      if (!img) return;

      const apply = () => {
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        if (!nw || !nh) return;
        const width = parseFloat(el.style.width) || el.offsetWidth;
        if (!width) return;
        el.style.height = (width * (nh / nw)) + 'px';
        // 矩形の縦横比が変わったので、縦横比ロックの基準を取り直すためハンドルを付け直す
        makeDaimonResizable(el);
      };

      if (img.complete && img.naturalWidth) apply();
      else img.addEventListener('load', apply, { once: true });
    }

    /**
     * 大問/答/証明ボタンの見た目を savedData（プリセット・拡大率・画像素材・表示文言）から確定する。
     * ボタン生成時・編集確定時・アノテーション復元時のいずれからも共通で呼び出す。
     * @param {HTMLElement} el       - daimon-btn/kotae-btn/shomei-btn 要素
     * @param {string}      type     - 'daimon' | 'kotae' | 'shomei'
     * @param {object}      savedData - { btnPreset, btnScale, btnImageFile, btnLabel }
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
        // ラベルは子要素（.btn-label）に入れる。ページ座標系サイズのボタン（.is-sized）の
        // 文字サイズをボタン自身の高さへ追従させるにはコンテナクエリ単位を使うが、
        // コンテナクエリ単位は「自分自身」のコンテナには解決しない（祖先コンテナ、
        // 無ければビューポート基準になる）ため、子要素側に font-size を指定する必要がある。
        // 先に textContent を空にすることで、画像モードから戻った際の <img class="btn-face"> も除去する
        // （従来の el.textContent = ラベル 代入と同じ副作用を維持する）。
        el.textContent = '';
        const labelEl = document.createElement('span');
        labelEl.className = 'btn-label';
        // btnLabel（大問ボタンのみ、環境設定で選んだ文言を作成時に保存したもの）があればそれを使う。
        // 未設定（本改修前のデータ・答/証明ボタン）は種別ごとの既定文言にフォールバックする。
        labelEl.textContent = (savedData.btnLabel || '').trim() || defaults.label;
        el.appendChild(labelEl);
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
     * ボタンの押下時見た目を切り替える。
     * カスタム画像設定済み（btnHasImage === '1'）：押下/通常の画像素材をスワップする。
     * プリセットモードの大問ボタンのみ：背景をグレーソリッド（DAIMON_PRESSED_COLOR）⇔元のプリセット色に切り替える。
     * @param {HTMLElement} btn      - daimon-btn/kotae-btn/shomei-btn 要素
     * @param {boolean}     isPressed - true: 押下時（表示中）見た目へ切替 / false: 通常時見た目へ切替
     */
    function swapButtonPressedImage(btn, isPressed) {
      if (btn.dataset.btnHasImage === '1') {
        let savedData = {};
        try { savedData = JSON.parse(btn.dataset.savedData || '{}'); } catch (_) {}
        const imageFile = (savedData.btnImageFile || '').trim();
        if (!imageFile) return;
        const img = btn.querySelector('.btn-face');
        if (!img) return;
        const key = isPressed ? `pressed__${imageFile}` : imageFile;
        if (mediaBlobs[key]) img.src = mediaBlobs[key];
        return;
      }

      // プリセットモードの押下背景（グレーソリッド）は大問ボタンに加え答ボタンでも切り替える。
      // 証明ボタンは白塗り⇔赤枠の独自表現のため対象外。
      if (btn.dataset.type !== 'daimon' && btn.dataset.type !== 'kotae') return;
      if (isPressed) {
        btn.style.background = DAIMON_PRESSED_COLOR;
      } else {
        let savedData = {};
        try { savedData = JSON.parse(btn.dataset.savedData || '{}'); } catch (_) {}
        const presetIdx = parseInt(savedData.btnPreset, 10);
        const preset = BTN_COLOR_OPTIONS[Number.isInteger(presetIdx) ? presetIdx : 0] || BTN_COLOR_OPTIONS[0];
        btn.style.background = preset.value;
      }
    }


    /**
     * 全ての大問/答/証明ボタンの見た目を通常時画像へ戻す。
     * 編集モードに戻る際、閲覧モードで押下されたボタンの見た目をリセットするために呼び出す。
     */
    export function resetAllButtonPressedImages() {
      document.querySelectorAll('.daimon-btn, .kotae-btn, .shomei-btn').forEach(btn => {
        swapButtonPressedImage(btn, false);
      });
      // daimonの開閉状態（dataset.daimonOpen）も編集モード再入場時にリセットする。
      // 次に閲覧モードへ入ったときの初回押下が必ず「全て開く」から始まるようにするため。
      document.querySelectorAll('.daimon-btn').forEach(btn => {
        delete btn.dataset.daimonOpen;
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
      // 既定サイズはLIBRO実データ（194×116 / ページ4960px幅）基準のページ相対値。
      // is-sized クラスは「ページ座標系のサイズをインラインstyleで持つ大問ボタン」の目印で、
      // CSSの固定サイズ打ち消し・フィット変更時の追従・保存復元時のサイズ復元の判定に使う。
      const { width: defW, height: defH } = getDaimonDefaultSizePx();
      const el = document.createElement('div');
      el.className        = 'daimon-btn is-sized';
      el.dataset.type     = 'daimon';
      el.dataset.id       = ++state.annIdCounter;
      el.dataset.daimonId = did;
      // 環境設定「大問ボタンアイコンのデフォルト」の文言を作成時点の値でボタンごとに保持する。
      // （設定を後から変えても既に作成済みのボタンは変わらない仕様）
      const daimonSavedData = { btnPreset: '0', btnScale: '1', btnLabel: state.settingsDaimonLabel || '大問' };
      el.dataset.savedData = JSON.stringify(daimonSavedData);
      el.style.left       = minLeft + 'px';
      // 紐付けたオブジェクト群の上に、ボタン高さ＋わずかな余白の分だけ持ち上げて配置する
      el.style.top        = Math.max(0, minTop - (defH + 4)) + 'px';
      el.style.width      = defW + 'px';
      el.style.height     = defH + 'px';
      renderButtonVisual(el, 'daimon', daimonSavedData);

      addDaimonClickHandler(el);
      makeDraggable(el);
      // renderButtonVisual() で dataset.btnHasImage が確定した後に呼ぶ（縦横比ロックの判定に使うため）
      makeDaimonResizable(el);
      el.dataset.page = state.currentPage;
      page.appendChild(el);
      // 紙面外への配置を禁止(紐付けオブジェクトが紙面端にある場合に左右・下がはみ出しうる)
      clampElementToPage(el);
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
      // reinitElement()（Undo/Redoによるプロパティ変更の復元、annotation-interaction.js）は
      // 新規クローン要素だけでなく「作成時にすでにこのリスナーが登録済みの既存要素」に対しても
      // 呼ばれることがある。addEventListener は同一要素に対して呼ぶたびリスナーを追加登録してしまい、
      // 解除されないまま2重に発火すると一括開閉の判定が自己干渉して壊れるため、
      // 再呼び出し時は前回登録したリスナーを解除してから登録し直す（初回呼び出し時は何もしない）。
      if (btn._daimonDblclickHandler) btn.removeEventListener('dblclick', btn._daimonDblclickHandler);
      if (btn._daimonClickHandler)    btn.removeEventListener('click',    btn._daimonClickHandler);

      // ダブルクリック：編集モード時にスタイル編集ポップアップを開く
      btn._daimonDblclickHandler = (e) => {
        if (document.body.classList.contains('is-view-mode')) return;
        e.preventDefault();
        e.stopPropagation();
        openEditPopup(btn);
      };
      btn.addEventListener('dblclick', btn._daimonDblclickHandler);

      btn._daimonClickHandler = (e) => {
        // 複数選択のドラッグ移動直後に発火したclickは選択操作として扱わない（H-4と同じ理由）
        if (state.suppressObjectClick) { state.suppressObjectClick = false; return; }
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
          // header詳細設定パネルを選択状態へ追従させる。
          // 従来はここで何もしておらず、大問/答/証明ボタンだけを選択しても
          // パネルがグレーアウト（#sideDetailEmpty）のままだった。
          // 呼び出し順は annotation-actions.js の addAnnClickHandler() と同じで、
          // 2件以上選択されている場合は直後の updateStatus() → updateAlignPanel() →
          // refreshMultiSelectionPanel() が複数選択パネルへ上書きする（確認済み）。
          if (count === 0) {
            closeDialog();
          } else if (btn.classList.contains('is-selected')) {
            openAnnotationSettingsDialog('daimon', btn);
          }
          updateStatus();
          return;
        }

        // 閲覧モード：紐付きオブジェクトを一括開閉
        const did = btn.dataset.daimonId;
        const targets = [
          ...document.querySelectorAll(`.sticky-note[data-daimon-id="${did}"]`),
        ];
        if (targets.length === 0) return;
        // daimon自身の開閉状態（dataset.daimonOpen）を基準に判定する。
        // 配下付箋の個別開閉状態（state-hidden/state-visible等）は判定に使わない
        // ＝個別操作で一部だけ開いた/閉じた状態でも、daimon側の前回状態だけで次の一括開閉を決める。
        // 未設定（初回押下）は「閉」扱い：新規作成時・switchToEditMode()での編集モード再入場時に
        // 付箋がstate-visible（閉）へリセットされる（resetAllButtonPressedImages()でdaimonOpenも削除）のに合わせている。
        const allOpen = btn.dataset.daimonOpen === '1';
        targets.forEach(t => {
          if (t.classList.contains('sticky-note') && t.dataset.shomeiId) {
            // 証明ボタン管理の付箋：白塗り（開）⇔ 赤枠のみ（閉）を再現する
            if (allOpen) {
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
            t.classList.toggle('state-visible', allOpen);
            t.classList.toggle('state-hidden',  !allOpen);
          }
        });
        // daimon自身の新しい開閉状態を保存（次回押下時の判定基準にする）
        btn.dataset.daimonOpen = allOpen ? '0' : '1';
        swapButtonPressedImage(btn, !allOpen);
        // 配下の付箋を共有する答ボタンの押下背景も連動させる（付箋共有で自動検出）。
        // targets（daimon配下の付箋）が持つ kotaeId から対応する答ボタンを引き、
        // daimonと同じ状態（押下後に全員開＝グレー）で押下背景を切り替える。
        const linkedKotaeIds = new Set(targets.map(t => t.dataset.kotaeId).filter(Boolean));
        linkedKotaeIds.forEach(kid => {
          const kbtn = document.querySelector(`.kotae-btn[data-kotae-id="${kid}"]`);
          if (kbtn) swapButtonPressedImage(kbtn, !allOpen);
        });
        updateStatus();
      };
      btn.addEventListener('click', btn._daimonClickHandler);
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

      // 紐付け前の開閉方式（savedData.annStickyOpenMode）を先に控える。
      // 下のループで '1'（表示ボタン削除）へ上書きするため、Undo用の復帰値は
      // 上書き前のこのタイミングでしか取得できない。
      const prevOpenModes = new Map();
      stickies.forEach(note => {
        let sd = {};
        try { sd = JSON.parse(note.dataset.savedData || '{}'); } catch (_) {}
        prevOpenModes.set(note, sd.annStickyOpenMode === '1' ? '1' : '0');
      });

      // 選択中の付箋に答IDを付与し、背景色を白に変更（元色を保存）
      stickies.forEach(note => {
        note.dataset.kotaeId = kid;
        if (!note.dataset.kotaeOrigBg) {
          note.dataset.kotaeOrigBg = note.style.background || note.style.backgroundColor || '';
        }
        // 開閉は答ボタンが担うため、紐付き付箋には「表示ボタン削除」を既定で適用する
        // （適用後も付箋の設定ダイアログで「通常開閉」へ戻せる）。
        // 答ボタン削除時に戻せるよう、紐付け前の開閉方式を dataset へ退避する
        // （既に別の答ボタンへ紐付いていた場合は最初の退避値を維持する）。
        if (note.dataset.kotaeOrigOpenMode === undefined) {
          note.dataset.kotaeOrigOpenMode = prevOpenModes.get(note) || '0';
        }
        applyStickyOpenMode(note, '1');
        // LIBRO由来の既存付箋（.libro-toggle）は見た目が閉/開2枚のPNGで、ラッパのインライン背景は
        // 閉状態では閉画像に隠れて効かず、開状態では逆に残って解答を覆ってしまう。
        // 紙色表示はCSS（.sticky-note.libro-toggle[data-kotae-id]）側で行うため背景は触らない。
        if (note.dataset.libroToggle === '1') return;
        note.style.background = '#ffffff';
      });

      // 配置位置：選択グループの左上の少し上
      const minLeft = Math.min(...stickies.map(n => parseFloat(n.style.left) || 0));
      const minTop  = Math.min(...stickies.map(n => parseFloat(n.style.top)  || 0));

      const page = document.getElementById('pageLeft');
      // 既定サイズは大問ボタンと同じLIBRO実データ基準（194×116 / ページ4960px幅）のページ相対値。
      const { width: defW, height: defH } = getDaimonDefaultSizePx();
      const el = document.createElement('div');
      el.className        = 'kotae-btn is-sized';
      el.dataset.type     = 'kotae';
      el.dataset.id       = ++state.annIdCounter;
      el.dataset.kotaeId  = kid;
      el.dataset.savedData = JSON.stringify({ btnPreset: '1', btnScale: '1' });
      el.style.left       = minLeft + 'px';
      el.style.top        = Math.max(0, minTop - (defH + 4)) + 'px';
      el.style.width      = defW + 'px';
      el.style.height     = defH + 'px';
      renderButtonVisual(el, 'kotae', { btnPreset: '1', btnScale: '1' });

      addKotaeClickHandler(el);
      makeDraggable(el);
      // renderButtonVisual() で子要素（ハンドル）が消えるため、その後に呼ぶ
      makeDaimonResizable(el);
      el.dataset.page = state.currentPage;
      page.appendChild(el);
      // 紙面外への配置を禁止(紐付けオブジェクトが紙面端にある場合に左右・下がはみ出しうる)
      clampElementToPage(el);
      // 答ボタン作成を Undo スタックに積む
      pushUndo({
        type: 'kotae-create',
        btn: el,
        linkedStickies: stickies.map(n => ({
          el: n,
          prevKotaeId: n.dataset.kotaeId === kid ? undefined : n.dataset.kotaeId,
          prevBackground: n.dataset.kotaeOrigBg || '',
          // 開閉方式の復帰値は上書き前に控えた prevOpenModes から引く
          prevOpenMode: prevOpenModes.get(n) || '0',
        }))
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
        // 複数選択のドラッグ移動直後に発火したclickは選択操作として扱わない（H-4と同じ理由）
        if (state.suppressObjectClick) { state.suppressObjectClick = false; return; }
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
          // header詳細設定パネルを選択状態へ追従させる（addDaimonClickHandlerと同じ理由）
          if (count === 0) {
            closeDialog();
          } else if (btn.classList.contains('is-selected')) {
            openAnnotationSettingsDialog('kotae', btn);
          }
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
      // 既定サイズは大問ボタンと同じLIBRO実データ基準（194×116 / ページ4960px幅）のページ相対値。
      const { width: defW, height: defH } = getDaimonDefaultSizePx();
      const el = document.createElement('div');
      el.className        = 'shomei-btn is-sized';
      el.dataset.type     = 'shomei';
      el.dataset.id       = ++state.annIdCounter;
      el.dataset.shomeiId = sid;
      el.dataset.savedData = JSON.stringify({ btnPreset: '2', btnScale: '1' });
      el.style.left       = minLeft + 'px';
      el.style.top        = Math.max(0, minTop - (defH + 4)) + 'px';
      el.style.width      = defW + 'px';
      el.style.height     = defH + 'px';
      renderButtonVisual(el, 'shomei', { btnPreset: '2', btnScale: '1' });

      addShomeiClickHandler(el);
      makeDraggable(el);
      // renderButtonVisual() で子要素（ハンドル）が消えるため、その後に呼ぶ
      makeDaimonResizable(el);
      el.dataset.page = state.currentPage;
      page.appendChild(el);
      // 紙面外への配置を禁止(紐付けオブジェクトが紙面端にある場合に左右・下がはみ出しうる)
      clampElementToPage(el);
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
        // 複数選択のドラッグ移動直後に発火したclickは選択操作として扱わない（H-4と同じ理由）
        if (state.suppressObjectClick) { state.suppressObjectClick = false; return; }
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
          // header詳細設定パネルを選択状態へ追従させる（addDaimonClickHandlerと同じ理由）
          if (count === 0) {
            closeDialog();
          } else if (btn.classList.contains('is-selected')) {
            openAnnotationSettingsDialog('shomei', btn);
          }
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
