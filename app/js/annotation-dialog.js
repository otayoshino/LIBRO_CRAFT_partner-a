import { addAnnClickHandler } from './annotation-actions.js';
import { ANNOTATION_TYPE_CONFIG, ANN_COLOR_OPTIONS, BTN_COLOR_OPTIONS, ICON_COLOR_OPTIONS, getIconDefaultSizePx, STICKY_COLORS, STICKY_COLOR_MAP, renderAnnObjectContent, renderAnnImageContent, MAX_ICON_IMAGE_SIZE_BYTES, MAX_ICON_IMAGE_DIMENSION } from './config.js';
import { deactivateAnnotationMode, getSelectedObjects, makeDraggable, makeResizable, updateAlignPanel } from './annotation-interaction.js';
import { applyDaimonImageAspect, generatePressedVariant, makeDaimonResizable, renderButtonVisual } from './buttons.js';
import { mediaBlobs, state } from './state.js';
import { addStickyClickHandler } from './sticky.js';
import { closeDialog, saveDialog } from './storage.js';
import { showToast, updateStatus } from './ui-common.js';
import { pushUndo } from './undo-redo.js';


    /** 大問/答/証明ボタンのtype一覧（共通判定に使用） */
    const BUTTON_TYPES = new Set(['daimon', 'kotae', 'shomei']);


    /** 連続作成モード用：前回使用した設定を種別ごとに保存 */
    const lastNewAnnData = {};


    /**
     * 環境設定「付箋のデフォルトカラー」変更時に、連続作成用に保持している
     * 付箋の前回設定（lastNewAnnData.sticky）の色も新しいデフォルト色へ揃える。
     * これを行わないと、既に付箋を1つ以上作成したあとに設定を変更しても
     * lastNewAnnData 側の色が優先され、新しいデフォルト色が反映されない。
     * @param {string} colorIdx - STICKY_COLOR_MAPのインデックス文字列
     */
    export function syncStickyDefaultColor(colorIdx) {
      if (lastNewAnnData.sticky) lastNewAnnData.sticky.annColor = String(colorIdx);
    }


    /**
     * 内部ファイル指定(annVideoSrc:'0')の動画アノテーションかどうかを判定する。
     * 新規作成不可に無効化済み(2026-07-21_fix_動画内部ファイル機能の無効化.md)であり、
     * 既存データの編集も同様にブロックする対象を判定するために使う。
     * @param {HTMLElement|null} existingEl - 判定対象要素（新規作成時は null）
     * @returns {boolean}
     */
    function _isLegacyInternalFileVideo(existingEl) {
      if (!existingEl || existingEl.dataset.type !== 'video') return false;
      try {
        return JSON.parse(existingEl.dataset.savedData || '{}').annVideoSrc === '0';
      } catch (_) {
        return false;
      }
    }


    /**
     * 既存のアノテーションオブジェクトをダブルクリックしたときに表示する編集ポップアップ。
     * quick-popup と同じ構造を使い、確定時に confirmAnnotation(type, el) を呼んで更新する。
     * @param {HTMLElement} el - 編集対象の ann-object / ann-icon-obj 要素
     */
    export function openEditPopup(el) {
      // 内部ファイル指定の動画は編集不可(閲覧可否によらず一律禁止)。削除は引き続き可能。
      if (_isLegacyInternalFileVideo(el)) {
        showToast('内部ファイル指定の動画は編集できません（削除して再作成してください）');
        return;
      }

      // 既存ポップアップを削除
      const existing = document.getElementById('quickCreatePopup');
      if (existing) existing.remove();

      const type = el.dataset.type;
      const cfg  = ANNOTATION_TYPE_CONFIG[type];
      if (!cfg) return;

      // 保存済みデータを取得して現在の位置・サイズで上書き
      const prevData = {};
      try { Object.assign(prevData, JSON.parse(el.dataset.savedData || '{}')); } catch {}
      prevData.annPosX        = parseFloat(el.style.left) || 0;
      prevData.annPosY        = parseFloat(el.style.top)  || 0;
      prevData.annWidth       = el.offsetWidth;
      prevData.annHeight      = el.offsetHeight;
      prevData.annDisplayType = el.classList.contains('ann-icon-obj') ? 'icon'
                                : el.classList.contains('ann-image-obj') ? 'image'
                                : (prevData.annDisplayType || 'marker');

      const popup = document.createElement('div');
      popup.id        = 'quickCreatePopup';
      popup.className = 'quick-popup dialog-box';
      popup.innerHTML = `
        <div class="dialog-title">
          <p>■ ${cfg.label}を編集</p>
          <span id="qcCloseBtn">×</span>
        </div>
        <div class="dialog-contents">
          <div class="side-detail-form" style="margin:0 0 6px;">
            <dl id="qcFormCommon"></dl>
          </div>
          <div id="qcSepWrap" style="display:none">
            <div class="detail-section-sep" style="margin:6px 0;">種別設定</div>
            <div class="side-detail-form" style="margin:0;">
              <dl id="qcFormSpecific"></dl>
            </div>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="dialog-btn cancel" id="qcCancelBtn">× キャンセル</button>
          <button class="dialog-btn ok"     id="qcOkBtn">&gt; 更新する</button>
        </div>
      `;

      document.body.appendChild(popup);

      buildCommonFields(document.getElementById('qcFormCommon'), type, prevData, null, el);

      const isLibroToggleSticky = type === 'sticky' && el.dataset.libroToggle === '1';
      if (!isLibroToggleSticky) {
        buildSpecificFields(document.getElementById('qcFormSpecific'), type, prevData, el);
        document.getElementById('qcSepWrap').style.display = '';
      }

      if (BUTTON_TYPES.has(type)) {
        // プリセット・拡大率・画像素材の変更を即座にボタンへライブプレビューする
        const livePreview = () => {
          const preset = document.getElementById('btnPreset')?.value;
          const scale  = document.getElementById('btnScale')?.value;
          const image  = document.getElementById('btnImageFile')?.value;
          // btnLabel を渡さないと、プリセット等を触った瞬間にプレビューのテキストが既定文言へ戻る
          const label  = document.getElementById('btnLabel')?.value;
          renderButtonVisual(el, type, { btnPreset: preset, btnScale: scale, btnImageFile: image, btnLabel: label });
          // renderButtonVisual() は el.textContent = '' で子要素（＝リサイズハンドル）を全削除するため、
          // プレビューのたびに再付与する。これが無いと、編集ポップアップで値を変更したあと
          // キャンセルした場合にハンドルが失われたまま復帰しない。
          makeDaimonResizable(el);
        };
        ['btnPreset', 'btnScale', 'btnImageFile'].forEach(id => {
          const fieldEl = document.getElementById(id);
          if (fieldEl) {
            fieldEl.addEventListener('input', livePreview);
            fieldEl.addEventListener('change', livePreview);
          }
        });
      }

      // ポップアップを対象要素の右隣に表示（ビューポートを超えないよう補正）
      const elRect = el.getBoundingClientRect();
      const pw   = popup.offsetWidth  || 380;
      const ph   = popup.offsetHeight || 300;
      const left = Math.min(elRect.right + 8, window.innerWidth  - pw - 8);
      const top  = Math.min(elRect.top,       window.innerHeight - ph - 8);
      popup.style.left = Math.max(8, left) + 'px';
      popup.style.top  = Math.max(8, top)  + 'px';

      // 更新ボタン：popup フォーム値 → サイドバーフォームへ転写 → confirmAnnotation
      document.getElementById('qcOkBtn').onclick = () => {
        // ポップアップ内フォーム値を直接収集
        const savedData = {};
        ['qcFormCommon', 'qcFormSpecific'].forEach(formId => {
          const formEl = document.getElementById(formId);
          if (!formEl) return;
          formEl.querySelectorAll('input[id], select[id], textarea[id]').forEach(el => {
            savedData[el.id] = el.value;
          });
        });
        closeQuickCreateDialog();
        confirmAnnotation(type, el, savedData);
      };

      document.getElementById('qcCancelBtn').onclick = closeQuickCreateDialog;
      document.getElementById('qcCloseBtn').onclick  = closeQuickCreateDialog;

      // ダイアログタイトルバーをドラッグしてポップアップを移動できるようにする
      const titleBar = popup.querySelector('.dialog-title');
      titleBar.addEventListener('mousedown', (e) => {
        // × ボタンはドラッグ対象外
        if (e.target.id === 'qcCloseBtn') return;
        e.preventDefault();
        const startX   = e.clientX;
        const startY   = e.clientY;
        const origLeft = parseInt(popup.style.left, 10) || 0;
        const origTop  = parseInt(popup.style.top,  10) || 0;

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          // ビューポートからはみ出さないよう範囲を制限する
          const newLeft = Math.max(0, Math.min(origLeft + dx, window.innerWidth  - popup.offsetWidth));
          const newTop  = Math.max(0, Math.min(origTop  + dy, window.innerHeight - popup.offsetHeight));
          popup.style.left = newLeft + 'px';
          popup.style.top  = newTop  + 'px';
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });

      updateStatus();
    }


    /**
     * クリックのみでオブジェクトを作成する際のクイック設定ポップアップを表示する。
     * @param {string} type     - アノテーション種別
     * @param {number} pageX    - ページ相対X座標（配置位置）
     * @param {number} pageY    - ページ相対Y座標（配置位置）
     * @param {number} clientX  - ビューポートX座標（ポップアップ表示位置）
     * @param {number} clientY  - ビューポートY座標（ポップアップ表示位置）
     */
    export function openQuickCreateDialog(type, pageX, pageY, clientX, clientY) {
      // 既存ポップアップを削除
      const existing = document.getElementById('quickCreatePopup');
      if (existing) existing.remove();

      const cfg      = ANNOTATION_TYPE_CONFIG[type];
      const prevData = lastNewAnnData[type] || {};

      // ポップアップシェルを生成（フォーム内容は buildCommonFields/buildSpecificFields が埋める）
      const popup = document.createElement('div');
      popup.id        = 'quickCreatePopup';
      popup.className = 'quick-popup dialog-box';
      popup.innerHTML = `
        <div class="dialog-title">
          <p>■ ${cfg.label}を作成</p>
          <span id="qcCloseBtn">×</span>
        </div>
        <div class="dialog-contents">
          <div class="side-detail-form" style="margin:0 0 6px;">
            <dl id="qcFormCommon"></dl>
          </div>
          <div id="qcSepWrap" style="display:none">
            <div class="detail-section-sep" style="margin:6px 0;">種別設定</div>
            <div class="side-detail-form" style="margin:0;">
              <dl id="qcFormSpecific"></dl>
            </div>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="dialog-btn cancel" id="qcCancelBtn">× キャンセル</button>
          <button class="dialog-btn ok"     id="qcOkBtn">&gt; 作成する</button>
        </div>
      `;

      // DOM に追加してからフォームフィールドを生成（ID参照が必要なため）
      document.body.appendChild(popup);

      buildCommonFields(document.getElementById('qcFormCommon'), type, prevData, null);

      buildSpecificFields(document.getElementById('qcFormSpecific'), type, prevData);
      document.getElementById('qcSepWrap').style.display = '';

      // ポップアップをビューポート内に収まる位置に配置
      const pw   = popup.offsetWidth  || 310;
      const ph   = popup.offsetHeight || 260;
      const left = Math.min(clientX + 8, window.innerWidth  - pw - 8);
      const top  = Math.min(clientY + 8, window.innerHeight - ph - 8);
      popup.style.left = Math.max(8, left) + 'px';
      popup.style.top  = Math.max(8, top)  + 'px';

      // ボタンイベントを設定
      document.getElementById('qcOkBtn').onclick     = () => confirmQuickCreate(type, pageX, pageY);
      document.getElementById('qcCancelBtn').onclick = closeQuickCreateDialog;
      document.getElementById('qcCloseBtn').onclick  = closeQuickCreateDialog;

      // ダイアログタイトルバーをドラッグしてポップアップを移動できるようにする
      const titleBar = popup.querySelector('.dialog-title');
      titleBar.addEventListener('mousedown', (e) => {
        if (e.target.id === 'qcCloseBtn') return;
        e.preventDefault();
        const startX   = e.clientX;
        const startY   = e.clientY;
        const origLeft = parseInt(popup.style.left, 10) || 0;
        const origTop  = parseInt(popup.style.top,  10) || 0;
        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          const newLeft = Math.max(0, Math.min(origLeft + dx, window.innerWidth  - popup.offsetWidth));
          const newTop  = Math.max(0, Math.min(origTop  + dy, window.innerHeight - popup.offsetHeight));
          popup.style.left = newLeft + 'px';
          popup.style.top  = newTop  + 'px';
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });

      updateStatus();
    }


    /**
     * クイック作成ポップアップを閉じる。
     */
    export function closeQuickCreateDialog() {
      const popup = document.getElementById('quickCreatePopup');
      if (popup) popup.remove();
    }


    /**
     * クイック作成ポップアップで確定し、オブジェクトをページに配置する。
     * クリック位置がオブジェクトの中央になるよう state.pendingRect を設定してから
     * confirmAnnotation() を呼び出す。
     * @param {string} type  - アノテーション種別
     * @param {number} pageX - ページ相対X座標
     * @param {number} pageY - ページ相対Y座標
     */
    function confirmQuickCreate(type, pageX, pageY) {
      // ポップアップフォームから値を収集し、サイドバーの共通/種別固有フォームに転写する
      ['qcFormCommon', 'qcFormSpecific'].forEach((srcId, i) => {
        const src  = document.getElementById(srcId);
        const dest = document.getElementById(['dialogFormCommon', 'dialogFormSpecific'][i]);
        if (!src || !dest) return;
        src.querySelectorAll('input[id], select[id], textarea[id]').forEach(srcEl => {
          // 封到済みの要素があれば値を上書き、なければ hidden input を挿入
          const destEl = dest.querySelector(`[id="${srcEl.id}"]`);
          if (destEl) {
            destEl.value = srcEl.value;
          } else {
            const inp = document.createElement('input');
            inp.type = 'hidden'; inp.id = srcEl.id; inp.value = srcEl.value;
            inp.dataset.qcInject = '1';
            dest.appendChild(inp);
          }
        });
      });

      const qcCommon = document.getElementById('qcFormCommon');
      const w = Math.max(parseFloat(qcCommon?.querySelector('[id="annWidth"]')?.value)  || 120, 10);
      const h = Math.max(parseFloat(qcCommon?.querySelector('[id="annHeight"]')?.value) || 40,  10);
      closeQuickCreateDialog();

      // クリック位置をオブジェクトの中央にして配置
      state.pendingRect = { x: pageX - w / 2, y: pageY - h / 2, w, h };
      confirmAnnotation(type);

      // 注入した hidden input を二次防止のため後片付けで削除
      ['dialogFormCommon', 'dialogFormSpecific'].forEach(id => {
        const form = document.getElementById(id);
        if (form) form.querySelectorAll('[data-qc-inject]').forEach(e => e.remove());
      });
    }


    /**
     * スピンボタン付き数値入力フィールド（.pos-field）を生成する。
     * スピンボタンは入力窓の左側に縦並びで配置し、入力窓と同じ背景色を使用する。
     * @param {string} id    - input 要素に付与する id
     * @param {number} value - 初期値
     * @returns {HTMLElement} .pos-field 要素
     */
    function makePosField(id, value) {
      const field = document.createElement('div');
      field.className = 'pos-field';
      field.innerHTML = `
        <div class="spin-btns">
          <button type="button" class="spin-btn spin-up">▲</button>
          <button type="button" class="spin-btn spin-down">▼</button>
        </div>
        <input type="number" class="d-input d-input-sm" id="${id}" value="${value}">
      `;
      const input = field.querySelector('input');
      // スピンアップ：+1
      field.querySelector('.spin-up').addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = (parseInt(input.value, 10) || 0) + 1;
        input.dispatchEvent(new Event('input'));
      });
      // スピンダウン：-1（0未満にしない）
      field.querySelector('.spin-down').addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1);
        input.dispatchEvent(new Event('input'));
      });
      return field;
    }


    function buildCommonFields(form, type, savedData, initRect, existingEl = null) {
      const px = initRect ? Math.round(initRect.x) : (parseInt(savedData.annPosX,   10) || 0);
      const py = initRect ? Math.round(initRect.y) : (parseInt(savedData.annPosY,   10) || 0);
      const pw = initRect ? Math.round(initRect.w) : (parseInt(savedData.annWidth,  10) || 100);
      const ph = initRect ? Math.round(initRect.h) : (parseInt(savedData.annHeight, 10) || 100);

      // --- 位置 ---
      const posDt = document.createElement('dt');
      posDt.textContent = '位置';
      form.appendChild(posDt);
      const posDd = document.createElement('dd');
      const posRow = document.createElement('div');
      posRow.className = 'pos-row';
      ['X','Y'].forEach((label, i) => {
        const sp = document.createElement('span');
        sp.textContent = label;
        posRow.appendChild(sp);
        posRow.appendChild(makePosField(['annPosX','annPosY'][i], [px, py][i]));
      });
      posDd.appendChild(posRow);
      form.appendChild(posDd);

      // 大問/答/証明ボタンは固定サイズCSS＋プリセット選択式のため、
      // 汎用の「変形」(W/H)・「塗り」行は生成しない（buildSpecificFieldsの専用フィールドに置き換える）
      const isButtonType = BUTTON_TYPES.has(type);

      if (!isButtonType) {
      // --- 変形 ---
      const szDt = document.createElement('dt');
      szDt.textContent = '変形';
      szDt.dataset.fieldGroup = 'transform';
      form.appendChild(szDt);
      const szDd = document.createElement('dd');
      szDd.dataset.fieldGroup = 'transform';
      const szRow = document.createElement('div');
      szRow.className = 'pos-row';
      ['W','H'].forEach((label, i) => {
        const sp = document.createElement('span');
        sp.textContent = label;
        szRow.appendChild(sp);
        szRow.appendChild(makePosField(['annWidth','annHeight'][i], [pw, ph][i]));
      });
      szDd.appendChild(szRow);
      form.appendChild(szDd);

      // --- 塗り色（付箋のみ。それ以外の種別は buildSpecificFields 側の「表示タイプ」直下に生成する） ---
      if (type === 'sticky') {
      const colDt = document.createElement('dt');
      colDt.textContent = '塗り';
      colDt.dataset.fieldGroup = 'fill';
      form.appendChild(colDt);
      const colDd = document.createElement('dd');
      colDd.dataset.fieldGroup = 'fill';
      colDd.className = 'color-row';
      const colWrap = document.createElement('div');
      colWrap.className = 'd-select-wrap';
      const colSel = document.createElement('select');
      colSel.className = 'd-select';
      colSel.id = 'annColor';
      // LIBRO由来の既存付箋（.libro-toggle）は色プロパティを持たないため、
      // 「既存付箋カラー」という専用選択肢を先頭に追加しデフォルト選択にする。
      // 実際の色を選び直した場合のみ、confirmAnnotation側で新規画像を生成して色を持たせる。
      const isLibroToggle = existingEl?.dataset.libroToggle === '1';
      if (isLibroToggle) {
        const o = document.createElement('option');
        o.value = 'existing';
        o.textContent = '既存付箋カラー';
        colSel.appendChild(o);
      }
      STICKY_COLORS.forEach((c, i) => {
        const o = document.createElement('option');
        o.value = i;
        o.textContent = c.label;
        colSel.appendChild(o);
      });
      // 新規作成時（existingElなし）のみ、フォールバック先を環境設定のデフォルト色にする
      const stickyColorFallback = existingEl ? '0' : (state.settingsStickyDefaultColor ?? '0');
      colSel.value = isLibroToggle ? 'existing' : (savedData.annColor || stickyColorFallback);
      colWrap.appendChild(colSel);
      colDd.appendChild(colWrap);
      form.appendChild(colDt);
      form.appendChild(colDd);
      }
      }

      // アイコン型・画像アイコン型：W/H入力時に縦横比を維持して反対軸を自動更新（applyLiveUpdateより先に登録して先行実行させる）
      const _selectedIconObj = document.querySelector('.ann-icon-obj.is-selected, .ann-image-obj.is-selected');
      if (_selectedIconObj) {
        // アイコン型（.ann-icon-obj）は常に 1:1。画像アイコン型（.ann-image-obj）は元画像の
        // 縦横比をそのまま維持するため実測値を使う。
        const _initAspect = _selectedIconObj.classList.contains('ann-icon-obj')
          ? 1
          : (_selectedIconObj.offsetWidth / (_selectedIconObj.offsetHeight || 1));
        const _wEl = document.getElementById('annWidth');
        const _hEl = document.getElementById('annHeight');
        if (_wEl && _hEl) {
          _wEl.addEventListener('input', () => {
            // 幅変更時：縦横比から高さを算出（最小 14px）
            const newW = Math.max(14, parseFloat(_wEl.value) || 14);
            _hEl.value = Math.max(14, Math.round(newW / _initAspect));
          });
          _hEl.addEventListener('input', () => {
            // 高さ変更時：縦横比から幅を算出（最小 14px）
            const newH = Math.max(14, parseFloat(_hEl.value) || 14);
            _wEl.value = Math.max(14, Math.round(newH * _initAspect));
          });
        }
      }

      // 選択中オブジェクトへの即時反映リスナーを登録
      // サイドメニュー・ダイアログ両対応でUndoが積まれるよう、input/change両方でapplyLiveUpdateを呼ぶ
      ['annPosX', 'annPosY', 'annWidth', 'annHeight'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('input', () => applyLiveUpdate(type));
          el.addEventListener('change', () => applyLiveUpdate(type));
        }
      });
      const colElForLive = document.getElementById('annColor');
      if (colElForLive) {
        colElForLive.addEventListener('change', () => applyLiveUpdate(type));
        colElForLive.addEventListener('input', () => applyLiveUpdate(type));
      }
    }


    /**
     * 共通フィールド（位置・変形・塗り）の値を選択中オブジェクトに即時反映する。
     * 「この内容で設定する」ボタンを押さなくても変更がオブジェクトに適用される。
     * @param {string} type - アノテーション種別
     */
    export function applyLiveUpdate(type) {

      const allTargets = getSelectedObjects();
      if (allTargets.length === 0) return;

      // Undo用: 変更前スナップショットを積む（初回または値が変わる直前のみ）
      if (!applyLiveUpdate._undoPushed) {
        // 単一選択時は1件、複数選択時は全件
        const snapshots = allTargets.map(target => ({
          el: target,
          prevStyleCssText: target.style.cssText,
          prevClassName: target.className,
          prevSavedData: target.dataset.savedData,
          prevInnerHTML: target.innerHTML
        }));
        pushUndo({ type: 'prop', targets: snapshots });
        applyLiveUpdate._undoPushed = true;
      }


      const x = parseFloat(document.getElementById('annPosX')?.value)  ?? 0;
      const y = parseFloat(document.getElementById('annPosY')?.value)  ?? 0;
      const w = parseFloat(document.getElementById('annWidth')?.value)  || 0;
      const h = parseFloat(document.getElementById('annHeight')?.value) || 0;
      const colorIdx = parseInt(document.getElementById('annColor')?.value || '0', 10);

      // ボタン系要素（答/大問/証明ボタン）か判定するヘルパー
      const isButtonEl = el => el.classList.contains('daimon-btn') ||
                                el.classList.contains('kotae-btn') ||
                                el.classList.contains('shomei-btn');

      if (allTargets.length === 1) {
        // 単一選択：絶対値で位置・サイズ・色を適用
        const target = allTargets[0];
        target.style.left = x + 'px';
        target.style.top  = y + 'px';
        if (isButtonEl(target)) {
          // ボタン系：位置のみ変更、背景・サイズは変更しない
        } else if (type === 'sticky') {
          const color = STICKY_COLOR_MAP[colorIdx] ?? STICKY_COLOR_MAP[0];
          if (w > 0) target.style.width  = w + 'px';
          if (h > 0) target.style.height = h + 'px';
          target.style.background = color;
        } else if (target.classList.contains('ann-icon-obj')) {
          // アイコン型：常に 1:1（正方形）でサイズ変更し、背景グラデーション色も適用する。
          // W/H入力はペアリングで同値になるが、選択の切り替え直後など片方しか値がない場合にも
          // 正方形を崩さないよう、有効な方の値で両辺を揃える。
          const ICON_MIN = 14;
          const size = Math.max(ICON_MIN, w > 0 ? w : (h > 0 ? h : getIconDefaultSizePx()));
          target.style.width  = size + 'px';
          target.style.height = size + 'px';
          target.style.background = ICON_COLOR_OPTIONS[colorIdx]?.value ?? ICON_COLOR_OPTIONS[0].value;
        } else if (target.classList.contains('ann-image-obj')) {
          // 画像アイコン型：サイズのみ変更（背景色は適用しない、元画像をそのまま表示するため）
          if (w > 0) target.style.width  = w + 'px';
          if (h > 0) target.style.height = h + 'px';
        } else {
          const bgColor = ANN_COLOR_OPTIONS[colorIdx]?.value ?? ANN_COLOR_OPTIONS[0].value;
          if (w > 0) target.style.width  = w + 'px';
          if (h > 0) target.style.height = h + 'px';
          target.style.background = bgColor;
        }
      } else {
        // 複数選択：位置・サイズはデルタで全対象に適用し個々の状態を保持、塗り色は絶対値で適用
        const prevX = applyLiveUpdate._prevX ?? x;
        const prevY = applyLiveUpdate._prevY ?? y;
        const prevW = applyLiveUpdate._prevW ?? w;
        const prevH = applyLiveUpdate._prevH ?? h;
        const dx = x - prevX;
        const dy = y - prevY;
        const dw = w - prevW;
        const dh = h - prevH;

        allTargets.forEach(target => {
          // 位置をデルタ分移動
          if (dx !== 0) target.style.left = (parseFloat(target.style.left) || 0) + dx + 'px';
          if (dy !== 0) target.style.top  = (parseFloat(target.style.top)  || 0) + dy + 'px';

          if (isButtonEl(target)) {
            // ボタン系：位置のみ変更、サイズ・背景は変更しない
            return;
          }
          const isSticky = target.classList.contains('sticky-note');
          if (isSticky) {
            // 付箋：サイズをデルタ分変更（最小10px）、塗り色は絶対値適用
            const color = STICKY_COLOR_MAP[colorIdx] ?? STICKY_COLOR_MAP[0];
            if (dw !== 0) target.style.width  = Math.max(10, (parseFloat(target.style.width)  || 0) + dw) + 'px';
            if (dh !== 0) target.style.height = Math.max(10, (parseFloat(target.style.height) || 0) + dh) + 'px';
            target.style.background = color;
          } else if (target.classList.contains('ann-icon-obj')) {
            // アイコン型：常に 1:1（正方形）を保ったままサイズをデルタ分変更し、背景色も適用する
            const ICON_MIN = 14;
            const curW = parseFloat(target.style.width)  || target.offsetWidth;
            const curH = parseFloat(target.style.height) || target.offsetHeight;
            if (dw !== 0 || dh !== 0) {
              const size = Math.max(ICON_MIN, dw !== 0 ? curW + dw : curH + dh);
              target.style.width  = size + 'px';
              target.style.height = size + 'px';
            }
            target.style.background = ICON_COLOR_OPTIONS[colorIdx]?.value ?? ICON_COLOR_OPTIONS[0].value;
          } else if (target.classList.contains('ann-image-obj')) {
            // 画像アイコン型：サイズのみデルタ分変更（背景色は適用しない）
            if (dw !== 0) target.style.width  = Math.max(10, (parseFloat(target.style.width)  || 0) + dw) + 'px';
            if (dh !== 0) target.style.height = Math.max(10, (parseFloat(target.style.height) || 0) + dh) + 'px';
          } else {
            // マーカー型：サイズをデルタ分変更（最小10px）、塗り色は絶対値適用
            const bgColor = ANN_COLOR_OPTIONS[colorIdx]?.value ?? ANN_COLOR_OPTIONS[0].value;
            if (dw !== 0) target.style.width  = Math.max(10, (parseFloat(target.style.width)  || 0) + dw) + 'px';
            if (dh !== 0) target.style.height = Math.max(10, (parseFloat(target.style.height) || 0) + dh) + 'px';
            target.style.background = bgColor;
          }
        });

        // バウンディングボックスを再描画
        updateAlignPanel();
      }
      // 次回デルタ計算のために現在値を保持
      applyLiveUpdate._prevX = x;
      applyLiveUpdate._prevY = y;
      applyLiveUpdate._prevW = w;
      applyLiveUpdate._prevH = h;
      // 入力確定時にUndo積み直しを許可
      setTimeout(() => { applyLiveUpdate._undoPushed = false; }, 0);
    }


    /**
     * 種別固有フィールド（表示タイプ・種別設定）を指定フォームに生成する。
     * @param {HTMLElement} form      - 追加先の dl 要素
     * @param {string}      type      - アノテーション種別
     * @param {object}      savedData - 保存済みデータ
     * @param {HTMLElement|null} existingEl - 再設定対象要素（新規作成時は null）
     */
    function buildSpecificFields(form, type, savedData, existingEl = null) {
      const cfg      = ANNOTATION_TYPE_CONFIG[type];
      const dispType = savedData.annDisplayType || 'icon';

      if (type === 'sticky') {
        // LIBRO由来の既存付箋（.libro-toggle）は閉側画像が元データ由来のため、
        // 開閉方式の変更（閉側の白画像再生成）を提供しない（既存付箋カラー選択と同じ制約）。
        if (existingEl?.dataset.libroToggle === '1') return;
        const openMode = savedData.annStickyOpenMode || '0';
        form.appendChild(_buildRadioDt('開閉方式'));
        form.appendChild(_buildRadioDD('annStickyOpenMode', 'annStickyOpenModeRadio', openMode, [
          { value: '0', label: '通常開閉' },
          { value: '1', label: '開削除' },
        ]));
        return;
      }

      if (BUTTON_TYPES.has(type)) {
        // --- 大問/答/証明ボタン固有：プリセット・拡大率・画像素材 ---
        const defaultPresetIdx = { daimon: '0', kotae: '1', shomei: '2' }[type] || '0';

        // 表示文言（大問ボタンのみ。環境設定で選んだ文言を作成時に保持したもの）。
        // confirmAnnotation はフォーム内の input[id] を総なめして savedData を作り直すため、
        // hidden input として載せておかないと編集確定のたびに btnLabel が脱落して
        // 既定文言（「大問」）に戻ってしまう。UI上は編集させないため hidden とする。
        if (type === 'daimon') {
          const hiddenLabel = document.createElement('input');
          hiddenLabel.type  = 'hidden';
          hiddenLabel.id    = 'btnLabel';
          hiddenLabel.value = savedData.btnLabel || '';
          form.appendChild(hiddenLabel);
        }

        // プリセットスタイル
        const presetDt = document.createElement('dt');
        presetDt.textContent = 'スタイル';
        form.appendChild(presetDt);
        const presetDd = document.createElement('dd');
        const presetWrap = document.createElement('div');
        presetWrap.className = 'd-select-wrap';
        const presetSel = document.createElement('select');
        presetSel.className = 'd-select';
        presetSel.id = 'btnPreset';
        BTN_COLOR_OPTIONS.forEach((c, i) => {
          const o = document.createElement('option');
          o.value = i;
          o.textContent = c.label;
          presetSel.appendChild(o);
        });
        presetSel.value = savedData.btnPreset !== undefined ? savedData.btnPreset : defaultPresetIdx;
        presetWrap.appendChild(presetSel);
        presetDd.appendChild(presetWrap);
        form.appendChild(presetDd);

        // 拡大率
        const scaleDt = document.createElement('dt');
        scaleDt.textContent = '拡大率';
        form.appendChild(scaleDt);
        const scaleDd = document.createElement('dd');
        const scaleInput = document.createElement('input');
        scaleInput.type = 'number';
        scaleInput.className = 'd-input d-input-sm';
        scaleInput.id = 'btnScale';
        scaleInput.step = '0.1';
        scaleInput.min = '0.5';
        scaleInput.max = '3';
        scaleInput.value = savedData.btnScale || '1';
        scaleDd.appendChild(scaleInput);
        form.appendChild(scaleDd);

        // 画像素材（SVG/PNG）
        const imgDt = document.createElement('dt');
        imgDt.textContent = '画像素材';
        form.appendChild(imgDt);
        const imgDd = document.createElement('dd');
        const hiddenFile = document.createElement('input');
        hiddenFile.type = 'hidden';
        hiddenFile.id = 'btnImageFile';
        hiddenFile.value = savedData.btnImageFile || '';
        imgDd.appendChild(hiddenFile);
        _appendImageDropZone(imgDd, 'btnImageFile');
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'field-link-btn';
        clearBtn.textContent = '画像をクリアして既定のボタンに戻す';
        clearBtn.addEventListener('click', () => {
          hiddenFile.value = '';
          hiddenFile.dispatchEvent(new Event('change'));
        });
        imgDd.appendChild(clearBtn);
        form.appendChild(imgDd);

        return;
      }

      // --- 表示タイプ（非sticky共通） ---
      const dtDt = document.createElement('dt');
      dtDt.textContent = '表示タイプ';
      form.appendChild(dtDt);
      const dtDd = document.createElement('dd');
      const pageColorOption = ['pagelink', 'audio', 'video', 'plusfile', 'externallink'].includes(type) ? `
          <label class="disp-type-option${dispType === 'page-color' ? ' is-active' : ''}" id="dtOpt-page-color">
            <div class="disp-type-top">
              <input type="radio" name="annDisplayTypeRadio" value="page-color"${dispType === 'page-color' ? ' checked' : ''}>
              <div class="disp-type-preview disp-type-preview--page-color"></div>
            </div>
            <span class="disp-type-label">紙面カラー</span>
          </label>` : '';
      const existingIconImageSrc = savedData.annIconImage ? mediaBlobs[savedData.annIconImage] : '';
      dtDd.innerHTML = `
        <div class="disp-type-row">
          <label class="disp-type-option${dispType === 'icon' ? ' is-active' : ''}" id="dtOpt-icon">
            <div class="disp-type-top">
              <input type="radio" name="annDisplayTypeRadio" value="icon"${dispType === 'icon' ? ' checked' : ''}>
              <div class="disp-type-preview disp-type-preview--icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="${cfg.iconViewBox || '0 0 24 24'}">${cfg.iconSvg}</svg>
              </div>
            </div>
            <span class="disp-type-label">アイコン</span>
          </label>
          <label class="disp-type-option${dispType === 'marker' ? ' is-active' : ''}" id="dtOpt-marker" style="display:none">
            <div class="disp-type-top">
              <input type="radio" name="annDisplayTypeRadio" value="marker"${dispType === 'marker' ? ' checked' : ''}>
              <div class="disp-type-preview disp-type-preview--marker">テキスト</div>
            </div>
            <span class="disp-type-label">マーカー</span>
          </label>
          <label class="disp-type-option${dispType === 'image' ? ' is-active' : ''}" id="dtOpt-image">
            <div class="disp-type-top">
              <input type="radio" name="annDisplayTypeRadio" value="image"${dispType === 'image' ? ' checked' : ''}>
              <div class="disp-type-preview disp-type-preview--image">${existingIconImageSrc ? `<img src="${existingIconImageSrc}" alt="">` : ''}</div>
            </div>
            <span class="disp-type-label">画像</span>
          </label>
          ${pageColorOption}
        </div>
        <input type="hidden" id="annDisplayType" value="${dispType}">
      `;
      dtDd.querySelectorAll('input[name="annDisplayTypeRadio"]').forEach(radio => {
        radio.addEventListener('change', () => {
          // dtDd スコープで検索することでポップアップとサイドバーの ID 競合を防ぐ
          dtDd.querySelector('#annDisplayType').value = radio.value;
          dtDd.querySelector('#dtOpt-icon').classList.toggle('is-active',       radio.value === 'icon');
          dtDd.querySelector('#dtOpt-marker').classList.toggle('is-active',     radio.value === 'marker');
          dtDd.querySelector('#dtOpt-image').classList.toggle('is-active',      radio.value === 'image');
          const pcOpt = dtDd.querySelector('#dtOpt-page-color');
          if (pcOpt) pcOpt.classList.toggle('is-active', radio.value === 'page-color');
          if (iconImageDt && iconImageDd) {
            const show = radio.value === 'image';
            iconImageDt.style.display = show ? '' : 'none';
            iconImageDd.style.display = show ? '' : 'none';
          }
          if (scaleDt && scaleDd) {
            const showScale = radio.value === 'image';
            scaleDt.style.display = showScale ? '' : 'none';
            scaleDd.style.display = showScale ? '' : 'none';
          }
          if (colDt && colDd) {
            const showColor = radio.value === 'icon' || radio.value === 'marker';
            colDt.style.display = showColor ? '' : 'none';
            colDd.style.display = showColor ? '' : 'none';
          }
        });
      });
      form.appendChild(dtDd);

      // --- 表示比率（表示タイプが「画像」の場合のみ表示。画像本来のサイズを100%とした拡縮率） ---
      const showScaleInit = dispType === 'image';
      const scaleDt = document.createElement('dt');
      scaleDt.textContent = '表示比率';
      scaleDt.style.display = showScaleInit ? '' : 'none';
      form.appendChild(scaleDt);
      const scaleDd = document.createElement('dd');
      scaleDd.style.display = showScaleInit ? '' : 'none';
      // 画像本来のサイズ（100%の基準値）。表示タイプに関わらずbuildSpecificFieldsは
      // 全種別で常に呼ばれる（confirmAnnotation時にhidden inputが無条件でsavedDataへ
      // 収集されるため）ため、ここで基準値を確定・書き込みしてしまうと「画像」型を
      // 一度も選んでいないアノテーションにも無関係な値が永続化されてしまう。
      // そのため hidden input には savedData に既存の値がある場合のみ書き込み、
      // 未確定の間は空のままにする（annIconImage欄と同じ扱い）。
      // 基準値が未確定の場合、比率入力欄の初期表示のみ「現在サイズ＝100%」として
      // 一時的に計算する（applyImageScale側で実際に操作されるまでは保存しない）。
      const curImgW = existingEl ? existingEl.offsetWidth  : (state.pendingRect?.w ?? parseFloat(savedData.annWidth)  ?? 100);
      const curImgH = existingEl ? existingEl.offsetHeight : (state.pendingRect?.h ?? parseFloat(savedData.annHeight) ?? 100);
      const naturalWForDisplay = parseFloat(savedData.annImageNaturalW) || curImgW || 100;
      const initialRatio = Math.round(curImgW / naturalWForDisplay * 100) || 100;
      scaleDd.innerHTML = `
        <div style="display:flex; align-items:center; gap:6px;">
          <input type="number" class="d-input d-input-sm" id="annImageScale" min="10" max="500" step="5" value="${initialRatio}">
          <span style="font-size:12px; color:#555;">%</span>
          <button type="button" class="field-link-btn" id="annImageScaleReset">100%にリセット</button>
        </div>
        <input type="hidden" id="annImageNaturalW" value="${savedData.annImageNaturalW || ''}">
        <input type="hidden" id="annImageNaturalH" value="${savedData.annImageNaturalH || ''}">
      `;
      form.appendChild(scaleDd);
      const scaleInputEl = scaleDd.querySelector('#annImageScale');
      const applyImageScale = (ratioValue) => {
        const naturalWEl = scaleDd.querySelector('#annImageNaturalW');
        const naturalHEl = scaleDd.querySelector('#annImageNaturalH');
        // 初回操作時：基準値が未確定なら、ダイアログを開いた時点の現在サイズを
        // 100%の基準値として確定・保存する
        if (!naturalWEl.value) naturalWEl.value = curImgW;
        if (!naturalHEl.value) naturalHEl.value = curImgH;
        const nw = parseFloat(naturalWEl.value) || 100;
        const nh = parseFloat(naturalHEl.value) || 100;
        const ratio = Math.max(10, Math.min(500, parseFloat(ratioValue) || 100));
        const container = scaleDd.closest('#sideDetailActive, #quickCreatePopup') || document;
        const wEl = container.querySelector('#annWidth');
        const hEl = container.querySelector('#annHeight');
        const newW = Math.max(14, Math.round(nw * ratio / 100));
        const newH = Math.max(14, Math.round(nh * ratio / 100));
        if (wEl) wEl.value = newW;
        if (hEl) hEl.value = newH;
        if (state.pendingRect) { state.pendingRect.w = newW; state.pendingRect.h = newH; }
        applyLiveUpdate(type);
      };
      scaleInputEl.addEventListener('input',  () => applyImageScale(scaleInputEl.value));
      scaleInputEl.addEventListener('change', () => applyImageScale(scaleInputEl.value));
      scaleDd.querySelector('#annImageScaleReset').addEventListener('click', () => {
        scaleInputEl.value = 100;
        applyImageScale(100);
      });

      // --- 塗り色（表示タイプが「アイコン」「マーカー」の場合のみ表示。ANN_COLOR_OPTIONS使用） ---
      const showColorInit = dispType === 'icon' || dispType === 'marker';
      const colDt = document.createElement('dt');
      colDt.textContent = '塗り';
      colDt.dataset.fieldGroup = 'fill';
      colDt.style.display = showColorInit ? '' : 'none';
      form.appendChild(colDt);
      const colDd = document.createElement('dd');
      colDd.dataset.fieldGroup = 'fill';
      colDd.style.display = showColorInit ? '' : 'none';
      const colWrap = document.createElement('div');
      colWrap.className = 'd-select-wrap';
      const colSel = document.createElement('select');
      colSel.className = 'd-select';
      colSel.id = 'annColor';
      // LIBRO由来の既存ページリンク（紙面カラー型でインポートされ、annColorを一度も
      // 保存していないもの）は色プロパティを実データとして持たない。
      // 表示タイプを手動で「マーカー」に切り替えた際の塗り色選択用に、専用選択肢を用意する。
      const isPagelinkNoColor = type === 'pagelink' && !!existingEl &&
        (savedData.annColor === undefined || savedData.annColor === 'existing');
      if (isPagelinkNoColor) {
        const o = document.createElement('option');
        o.value = 'existing';
        o.textContent = '既存ページリンクカラー';
        colSel.appendChild(o);
      }
      ANN_COLOR_OPTIONS.forEach((c, i) => {
        const o = document.createElement('option');
        o.value = i;
        o.textContent = c.label;
        colSel.appendChild(o);
      });
      colSel.value = isPagelinkNoColor ? 'existing' : (savedData.annColor || '0');
      colWrap.appendChild(colSel);
      colDd.appendChild(colWrap);
      form.appendChild(colDt);
      form.appendChild(colDd);
      colSel.addEventListener('change', () => applyLiveUpdate(type));
      colSel.addEventListener('input',  () => applyLiveUpdate(type));

      // --- 画像アイコン用アップロードフィールド（表示タイプ「画像」選択時のみ表示） ---
      const iconImageDt = document.createElement('dt');
      iconImageDt.textContent = 'アイコン画像';
      iconImageDt.style.display = dispType === 'image' ? '' : 'none';
      form.appendChild(iconImageDt);
      const iconImageDd = document.createElement('dd');
      iconImageDd.style.display = dispType === 'image' ? '' : 'none';
      const iconImageHidden = document.createElement('input');
      iconImageHidden.type = 'hidden';
      iconImageHidden.id = 'annIconImage';
      iconImageHidden.value = savedData.annIconImage || '';
      iconImageDd.appendChild(iconImageHidden);
      _appendIconImageDropZone(iconImageDd, 'annIconImage');
      form.appendChild(iconImageDd);

      // --- 種別固有フィールド ---
      if (type === 'pagelink') {
        const dt = document.createElement('dt');
        dt.textContent = 'リンク先';
        form.appendChild(dt);
        const dd = document.createElement('dd');
        dd.innerHTML = `
          <div style="display:flex; align-items:center; gap:6px;">
            <input type="number" class="d-input d-input-sm" id="annTarget" min="1"
              value="${savedData.annTarget || ''}" placeholder="0">
            <span style="font-size:12px; color:#555;">ページ目</span>
          </div>
          <p class="field-note">※目次を兼ねたページを指定してください。</p>`;
        form.appendChild(dd);

      } else if (type === 'plusfile') {
        // 表示方法は toAppendix("ディレクトリ名",表示モード) の第2引数として書き出される。
        // '0'＝ページ内（LIBRO+ではモーダル表示のためCRAFTプレビューでも移動不可）、
        // '1'＝別タブ、'2'＝フローティング（移動可）。
        const showMode = savedData.annShowMode || '0';
        form.appendChild(_buildRadioDt('表示方法'));
        form.appendChild(_buildRadioDD('annShowMode', 'annShowModeRadio', showMode, [
          { value: '0', label: 'ページ内' },
          { value: '1', label: '別タブ' },
          { value: '2', label: 'フローティング' },
        ]));
        form.appendChild(_buildTextDt('ディレクトリ名'));
        form.appendChild(_buildTextDD('annFile', savedData.annFile || '', ''));

      } else if (type === 'externallink') {
        form.appendChild(_buildTextDt('リンク先URL'));
        form.appendChild(_buildTextDD('annUrl', savedData.annUrl || '', 'https://...'));

      } else if (type === 'audio') {
        const playMode = savedData.annPlayMode || '0';
        form.appendChild(_buildTextDt('ファイル名'));
        const fileDd = _buildTextDD('annFile', savedData.annFile || '', 'ファイル名を入力');
        fileDd.querySelector('input').insertAdjacentHTML('afterend',
          '<p class="field-note">※ファイル名の拡張子「.mp3」は除く</p>');
        _appendDropZone(fileDd, 'annFile', 'audio', existingEl);
        form.appendChild(fileDd);
        form.appendChild(_buildRadioDt('再生方法'));
        form.appendChild(_buildRadioDD('annPlayMode', 'annPlayModeRadio', playMode, [
          { value: '0', label: 'コントローラーあり' },
          { value: '1', label: 'コントローラーなし' },
        ]));

      } else if (type === 'video') {
        // 内部ファイル(annVideoSrc:'0')はLIBRO+実機でtoMovieBNRの動作検証が未完了
        // （TypeError再発が報告され原因未確定）のため、新規作成不可に無効化した(2026-07-21)。
        // 新規作成できる動画はJ-stream固定のため、ラジオ選択肢からJ-streamを削除し、
        // ラベルに「動画ファイル（J-stream）」と明記した。新規作成時（annVideoSrc未設定、
        // ='2'）はラジオ行自体を非表示にする。既存の内部ファイル・外部タグ指定
        // アノテーションは編集・削除のみ可能（この場合のみラジオ行を表示する）。
        // 経緯: docs/plans/2026-07-21_feat_動画内部ファイルのvideo-in書き出し対応.md
        //       docs/plans/2026-07-21_fix_動画内部ファイル機能の無効化.md
        const videoSrc = savedData.annVideoSrc || '2';
        form.appendChild(_buildRadioDt('動画ファイル（J-stream）'));
        const srcDD = _buildRadioDD('annVideoSrc', 'annVideoSrcRadio', videoSrc, [
          { value: '0', label: '内部ファイル' },
          { value: '1', label: '外部動画をタグで追加' },
        ]);
        // 「内部ファイル」「外部動画をタグで追加」は非表示化(機能・データは残す)。
        // 既存アノテーションがその値の場合のみ、選択中ラジオが見えるよう表示する。
        ['0', '1'].forEach(hiddenVal => {
          if (videoSrc !== hiddenVal) {
            srcDD.querySelector(`input[name="annVideoSrcRadio"][value="${hiddenVal}"]`)
              .closest('label').style.display = 'none';
          }
        });
        // 動画は現在J-stream固定のため、ラジオ行自体は既存の内部ファイル・外部タグ
        // データを編集する場合のみ表示する（新規作成時は出さない）。
        // ただしDOMからは外さず display:none で隠すだけにすること。srcDD内のhidden input
        // （#annVideoSrc）がform配下に無いと、confirmAnnotationのフォーム走査
        // （input[id]を舐めてsavedDataを組み立てる処理）でannVideoSrc自体がsavedDataから
        // 欠落し、書き出し時にconvertAnnotationToLibroAnnotの種別判定を通らず
        // アノテーションごとサイレントに消える（2026-07-23確認）。
        if (videoSrc !== '0' && videoSrc !== '1') srcDD.style.display = 'none';
        form.appendChild(srcDD);

        // --- 内部ファイル/外部タグ用フィールド(annVideoSrc: '0'/'1') ---
        // 内部ファイルは書き出し時に toMovieBNR("ファイル名",1) へ変換され、動画本体は
        // video/in/<ファイル名>.mp4 としてzipへ格納される(libro-format.js)。無効化済みのため
        // このフィールド群は既存の内部ファイル指定アノテーションを編集する場合のみ表示される。
        const fileDt = _buildTextDt('ファイル名');
        const fileDd = _buildTextDD('annFile', savedData.annFile || '', 'ファイル名を入力');
        fileDd.querySelector('input').insertAdjacentHTML('afterend',
          '<p class="field-note">※ファイル名の拡張子「.mp4」は除く</p>' +
          '<p class="field-note">※LIBRO+上では常に別タブで再生されます（「表示方法」の選択はCRAFT内プレビューにのみ適用されます）</p>' +
          '<p class="field-note">※現在この方式は新規作成できません（既存設定の編集のみ可能）</p>');
        _appendDropZone(fileDd, 'annFile', 'video', existingEl);
        const showMode = savedData.annShowMode || '0';
        const modeDt = _buildRadioDt('表示方法');
        const modeDd = _buildRadioDD('annShowMode', 'annShowModeRadio', showMode, [
          { value: '0', label: 'ページ内' },
          { value: '1', label: '別タブ' },
        ]);
        // 「表示方法」は内部ファイル・J-streamどちらでも使う共通項目のため、
        // toggleVideoSrcFields の表示切替対象から外し常時表示にする。
        // J-stream選択時に「J-stream入力欄→表示方法」の順で表示させるため、
        // ここでは modeDt/modeDd を追加せず、J-stream欄(jsFields)の後にまとめて追加する。
        [fileDt, fileDd].forEach(el => form.appendChild(el));

        // --- J-stream用フィールド(annVideoSrc: '2')---
        // 入力値(ディレクトリ・企業ID・難読化ID)はエンコード等を行わずそのまま、
        // 「表示方法」は0=ページ内（モーダル）／1=別タブの数値として、
        // toMovie("ディレクトリ","企業ID","難読化ID",表示モード) へ変換される(libro-format.js)。
        // 引数構成が想定外でこの形式に変換できなかったLIBRO由来リンクは annVideoFn/annVideoArg の
        // 生文字列を hidden input で素通しし、書き出し時も無変更で書き戻す。
        const isLegacyLink = savedData.annJstreamDir === undefined && !!savedData.annVideoArg;
        let jsFields;
        if (isLegacyLink) {
          const jsDt = _buildTextDt('J-stream指定');
          const jsDd = document.createElement('dd');
          const fnName = savedData.annVideoFn === 'toMovieBNR' ? 'toMovieBNR' : 'toMovie';
          const note = document.createElement('p');
          note.className = 'field-note';
          note.textContent = `※LIBRO由来のリンク ${fnName}(${savedData.annVideoArg}) をそのまま保持します(編集不可)。`;
          jsDd.appendChild(note);
          const fnHidden = document.createElement('input');
          fnHidden.type = 'hidden';
          fnHidden.id = 'annVideoFn';
          fnHidden.value = savedData.annVideoFn || 'toMovie';
          jsDd.appendChild(fnHidden);
          const argHidden = document.createElement('input');
          argHidden.type = 'hidden';
          argHidden.id = 'annVideoArg';
          argHidden.value = savedData.annVideoArg || '';
          jsDd.appendChild(argHidden);
          jsFields = [jsDt, jsDd];
        } else {
          // annFile欄と同じ「1グループ=1dd」の配置に合わせ、3つの入力欄を1つのddにまとめる。
          // dtラベルは置かず、各inputのplaceholderに項目名称を表示する。
          const jsDd = document.createElement('dd');
          const dirInput = document.createElement('input');
          dirInput.type = 'text';
          dirInput.className = 'd-input';
          dirInput.id = 'annJstreamDir';
          dirInput.value = savedData.annJstreamDir || '';
          dirInput.placeholder = 'Jストリームディレクトリ';
          const corpInput = document.createElement('input');
          corpInput.type = 'text';
          corpInput.className = 'd-input';
          corpInput.id = 'annJstreamCorpId';
          corpInput.value = savedData.annJstreamCorpId || '';
          corpInput.placeholder = '企業ID';
          const vidInput = document.createElement('input');
          vidInput.type = 'text';
          vidInput.className = 'd-input';
          vidInput.id = 'annJstreamVideoId';
          vidInput.value = savedData.annJstreamVideoId || '';
          vidInput.placeholder = 'Jストリーム難読化ID';
          [dirInput, corpInput, vidInput].forEach(inp => jsDd.appendChild(inp));
          jsFields = [jsDd];
        }
        [...jsFields, modeDt, modeDd].forEach(el => form.appendChild(el));

        const toggleVideoSrcFields = (val) => {
          const showFile = val !== '2';
          [fileDt, fileDd].forEach(el => { el.style.display = showFile ? '' : 'none'; });
          jsFields.forEach(el => { el.style.display = showFile ? 'none' : ''; });
        };
        toggleVideoSrcFields(videoSrc);
        srcDD.querySelectorAll('input[name="annVideoSrcRadio"]').forEach(r => {
          r.addEventListener('change', () => toggleVideoSrcFields(r.value));
        });
      }
    }


    /** DL用 dt 要素を生成するヘルパー */
    function _buildRadioDt(label) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      return dt;
    }

    function _buildTextDt(label) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      return dt;
    }


    /**
     * ラジオボタン dd 要素を生成し、hidden input を連動させるヘルパー。
     * @param {string} hiddenId   - hidden input の id
     * @param {string} radioName  - radio の name 属性
     * @param {string} currentVal - 現在の選択値
     * @param {Array}  items      - [{value, label}, ...]
     */
    function _buildRadioDD(hiddenId, radioName, currentVal, items) {
      const dd = document.createElement('dd');
      const radiosHtml = items.map(it =>
        `<label><input type="radio" name="${radioName}" value="${it.value}"${currentVal === it.value ? ' checked' : ''}> ${it.label}</label>`
      ).join('');
      dd.innerHTML = `<div class="radio-row">${radiosHtml}</div><input type="hidden" id="${hiddenId}" value="${currentVal}">`;
      // dd スコープ内の hidden input を直接参照することで、
      // 同一 id が複数存在する場合でも正しい要素が更新されるようにする
      const hiddenInput = dd.querySelector(`input[type="hidden"][id="${hiddenId}"]`);
      dd.querySelectorAll(`input[name="${radioName}"]`).forEach(r => {
        r.addEventListener('change', () => { hiddenInput.value = r.value; });
      });
      return dd;
    }


    /**
     * テキスト入力 dd 要素を生成するヘルパー。
     * @param {string} id          - input の id
     * @param {string} value       - 初期値
     * @param {string} placeholder - プレースホルダー
     */
    function _buildTextDD(id, value, placeholder) {
      const dd = document.createElement('dd');
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'd-input';
      inp.id = id;
      inp.value = value;
      inp.placeholder = placeholder;
      dd.appendChild(inp);
      return dd;
    }


    /**
     * ファイルドロップゾーンを dd 要素に追加するヘルパー。
     * ドロップで受け取ったファイルをBlobURLに変換してmediaBlobsへ格納し、
     * inputId のフィールドに拡張子なしのファイル名をセットする。
     * 音声（mediaType: 'audio'、MP3）と動画（mediaType: 'video'、MP4）が使用する。
     * ゾーンのクリックでファイル選択ダイアログからも指定できる。
     * @param {HTMLElement} ddEl      - 追加先の dd 要素
     * @param {string}      inputId   - ファイル名を反映する input の id
     * @param {string}      mediaType - 'audio' または 'video'
     * @param {HTMLElement} [existingEl] - 編集対象アノテーションの既存DOM要素（新規作成時はnull）
     */
    function _appendDropZone(ddEl, inputId, mediaType, existingEl = null) {
      const isAudio = mediaType === 'audio';
      const extHint = isAudio ? 'MP3' : 'MP4';
      const extRe   = isAudio ? /\.mp3$/i : /\.mp4$/i;
      const accept  = isAudio ? '.mp3,audio/mpeg' : '.mp4,video/mp4';
      const zone = document.createElement('div');
      zone.className = 'file-drop-zone';
      zone.innerHTML = `
        <p>ここに ${extHint} ファイルをドロップ、またはクリックして選択</p>
        <p class="drop-status"></p>
      `;
      zone.style.cursor = 'pointer';
      const statusEl = zone.querySelector('.drop-status');

      // ドロップ／ファイル選択の共通処理：BlobURL化してmediaBlobsへ格納し、ファイル名をセット
      const handleFile = (file) => {
        if (!file) return;

        // annFileは拡張子なし前提で、再生時に .mp3 / .mp4 を補ってmediaBlobsを引くため、
        // 想定拡張子以外のファイルは設定できても再生できない。ここで弾く。
        if (!extRe.test(file.name)) {
          statusEl.textContent = `✕ ${extHint}ファイルを指定してください`;
          statusEl.className = 'drop-status is-error';
          return;
        }

        const fileInput = ddEl.querySelector(`#${inputId}`);
        const baseName = file.name.replace(/\.[^/.]+$/, '');

        // 同名ファイルが既に別アノテーションで使用中の場合は上書き前に警告する
        // （「自分自身の差し替え」＝現在このダイアログが編集中のファイル名と同じ場合は警告不要）
        if (mediaBlobs[file.name]) {
          let savedAnnFile = '';
          if (existingEl) {
            try {
              savedAnnFile = JSON.parse(existingEl.dataset.savedData || '{}').annFile || '';
            } catch (err) {
              savedAnnFile = '';
            }
          }
          const isSelfReplace = savedAnnFile === baseName;
          if (!isSelfReplace) {
            const proceed = confirm(`「${file.name}」は既に他のアノテーションで使用されています。上書きしますか？`);
            if (!proceed) return;
          }
        }

        // 拡張子なしのファイル名を入力欄に即時反映
        if (fileInput) fileInput.value = baseName;

        // ファイルをBlobURLに変換してmediaBlobsへキャッシュ（サーバー不要）
        // 同名ファイルが既にある場合は古いBlobURLを解放してから上書き
        if (mediaBlobs[file.name]) {
          URL.revokeObjectURL(mediaBlobs[file.name]);
        }
        mediaBlobs[file.name] = URL.createObjectURL(file);
        statusEl.textContent = `✔ ${file.name} を読み込みました`;
        statusEl.className = 'drop-status is-success';
      };

      // ドラッグオーバー：ハイライト表示
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('is-dragover');
      });

      // ドラッグ離脱：ハイライト解除
      zone.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        zone.classList.remove('is-dragover');
      });

      // ドロップ：共通処理へ
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('is-dragover');
        handleFile(e.dataTransfer.files[0]);
      });

      // クリックでファイル選択ダイアログを開く（_appendIconImageDropZone と同パターン）
      // ※ fileInput はファイル名テキスト欄を指す既存の変数名のため、filePicker と命名して区別する
      const filePicker = document.createElement('input');
      filePicker.type = 'file';
      filePicker.accept = accept;
      filePicker.style.display = 'none';
      zone.appendChild(filePicker);

      zone.addEventListener('click', () => filePicker.click());
      filePicker.addEventListener('change', () => {
        handleFile(filePicker.files[0]);
        filePicker.value = '';
      });

      ddEl.appendChild(zone);
    }


    /**
     * 画像アイコン型（.ann-image-obj）のアイコン画像用ドロップゾーンを dd 要素に追加するヘルパー。
     * ドロップされたPNGをBlobURLに変換してmediaBlobsへ格納し、拡張子込みのファイル名を
     * hidden input（annIconImage）にセットする。LIBRO書き出し時にannots/xxxx.pngへ
     * そのまま書き戻せるよう、受け入れ拡張子はPNGのみに限定する。
     * @param {HTMLElement} ddEl    - 追加先の dd 要素
     * @param {string}      inputId - ファイル名（拡張子込み）を反映する hidden input の id
     */
    function _appendIconImageDropZone(ddEl, inputId) {
      const zone = document.createElement('div');
      zone.className = 'file-drop-zone';
      zone.innerHTML = `
        <p>ここに PNG ファイルをドロップ、またはクリックして選択</p>
        <p class="drop-status"></p>
      `;
      zone.style.cursor = 'pointer';
      const statusEl = zone.querySelector('.drop-status');
      const preview = document.createElement('div');
      preview.className = 'disp-type-preview disp-type-preview--image';
      preview.style.margin = '8px 0';
      const hiddenInput = ddEl.querySelector(`#${inputId}`);
      const existingSrc = hiddenInput?.value ? mediaBlobs[hiddenInput.value] : '';
      if (hiddenInput && hiddenInput.value) {
        statusEl.textContent = `✔ ${hiddenInput.value} を使用中`;
        statusEl.className = 'drop-status is-success';
        if (existingSrc) preview.innerHTML = `<img src="${existingSrc}" alt="">`;
      }
      ddEl.appendChild(preview);

      // ファイルセレクトダイアログ用の隠し input（クリックで開く）
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.png,image/png';
      fileInput.style.display = 'none';
      zone.appendChild(fileInput);

      const showError = (msg) => {
        statusEl.textContent = `✕ ${msg}`;
        statusEl.className = 'drop-status is-error';
      };

      const handleFile = (file) => {
        if (!file) return;
        if (!/\.png$/i.test(file.name) || (file.type && file.type !== 'image/png')) {
          showError('PNGファイルを指定してください');
          return;
        }
        if (file.size > MAX_ICON_IMAGE_SIZE_BYTES) {
          showError(`ファイルサイズが大きすぎます（上限${MAX_ICON_IMAGE_SIZE_BYTES / (1024 * 1024)}MB）`);
          return;
        }

        // 拡張子・MIME・サイズだけでは偽装/破損ファイルを防げないため、
        // 実際にデコードできるか・縦横サイズが上限内かを確認してから確定する。
        const tempUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          if (img.naturalWidth > MAX_ICON_IMAGE_DIMENSION || img.naturalHeight > MAX_ICON_IMAGE_DIMENSION) {
            URL.revokeObjectURL(tempUrl);
            showError(`画像サイズが大きすぎます（上限${MAX_ICON_IMAGE_DIMENSION}px四方）`);
            return;
          }

          if (mediaBlobs[file.name]) URL.revokeObjectURL(mediaBlobs[file.name]);
          mediaBlobs[file.name] = tempUrl;

          if (hiddenInput) {
            hiddenInput.value = file.name;
            hiddenInput.dispatchEvent(new Event('change'));
          }

          // 矩形サイズに合わせて縮小配置するのではなく、画像本来の縦横サイズをそのまま採用する。
          // ・新規作成中（ドラッグ矩形が保留中）：確定時に優先されるpendingRect自体を書き換える
          // ・既存要素の編集中：W/H欄を直接更新し、選択中オブジェクトへ即時反映する
          //   （W/H欄へのinputイベント発火はアイコン型の縦横比維持リスナーと競合するため使わない）
          const container = ddEl.closest('#sideDetailActive, #quickCreatePopup') || document;
          const wEl = container.querySelector('#annWidth');
          const hEl = container.querySelector('#annHeight');
          if (wEl && hEl) {
            wEl.value = img.naturalWidth;
            hEl.value = img.naturalHeight;
          }
          if (state.pendingRect) {
            state.pendingRect.w = img.naturalWidth;
            state.pendingRect.h = img.naturalHeight;
          }
          // 新しい画像に差し替えたため、表示比率の基準値（100%＝画像本来のサイズ）も更新する
          const naturalWEl = container.querySelector('#annImageNaturalW');
          const naturalHEl = container.querySelector('#annImageNaturalH');
          const scaleEl    = container.querySelector('#annImageScale');
          if (naturalWEl) naturalWEl.value = img.naturalWidth;
          if (naturalHEl) naturalHEl.value = img.naturalHeight;
          if (scaleEl) scaleEl.value = 100;
          const selectedImageEl = document.querySelector('.ann-image-obj.is-selected');
          if (selectedImageEl) applyLiveUpdate(selectedImageEl.dataset.type);

          preview.innerHTML = `<img src="${tempUrl}" alt="">`;
          statusEl.textContent = `✔ ${file.name} を読み込みました`;
          statusEl.className = 'drop-status is-success';
        };
        img.onerror = () => {
          URL.revokeObjectURL(tempUrl);
          showError('画像として読み込めませんでした');
        };
        img.src = tempUrl;
      };

      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('is-dragover');
      });
      zone.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        zone.classList.remove('is-dragover');
      });
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('is-dragover');
        handleFile(e.dataTransfer.files[0]);
      });
      zone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        handleFile(fileInput.files[0]);
        fileInput.value = '';
      });

      ddEl.appendChild(zone);
    }


    /**
     * 大問/答/証明ボタンの画像素材（SVG/PNG）用ドロップゾーンを dd 要素に追加するヘルパー。
     * ドロップされた画像をBlobURLに変換してmediaBlobsへ格納し、押下時バリアントも生成する。
     * @param {HTMLElement} ddEl    - 追加先の dd 要素
     * @param {string}      inputId - ファイル名（拡張子込み）を反映する hidden input の id
     */
    function _appendImageDropZone(ddEl, inputId) {
      const zone = document.createElement('div');
      zone.className = 'file-drop-zone';
      zone.innerHTML = `
        <p>ここに SVG または PNG ファイルをドロップ</p>
        <p class="drop-status"></p>
      `;
      const statusEl = zone.querySelector('.drop-status');
      const hiddenInput = ddEl.querySelector(`#${inputId}`);
      if (hiddenInput && hiddenInput.value) {
        statusEl.textContent = `✔ ${hiddenInput.value} を使用中`;
        statusEl.className = 'drop-status is-success';
      }

      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('is-dragover');
      });
      zone.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        zone.classList.remove('is-dragover');
      });
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('is-dragover');

        const file = e.dataTransfer.files[0];
        if (!file) return;
        if (!/\.(svg|png)$/i.test(file.name)) {
          statusEl.textContent = '✕ SVGまたはPNGファイルを指定してください';
          statusEl.className = 'drop-status is-error';
          return;
        }

        if (mediaBlobs[file.name]) URL.revokeObjectURL(mediaBlobs[file.name]);
        mediaBlobs[file.name] = URL.createObjectURL(file);

        statusEl.textContent = `読み込み中... (${file.name})`;
        statusEl.className = 'drop-status';

        generatePressedVariant(file).then(() => {
          if (hiddenInput) {
            hiddenInput.value = file.name;
            hiddenInput.dispatchEvent(new Event('change'));
          }
          statusEl.textContent = `✔ ${file.name} を読み込みました`;
          statusEl.className = 'drop-status is-success';
        }).catch(err => {
          statusEl.textContent = '✕ 押下時スタイルの生成に失敗しました';
          statusEl.className = 'drop-status is-error';
          console.error(err);
        });
      });

      ddEl.appendChild(zone);
    }


    /**
     * アノテーション設定ダイアログを開く。
     * 全種別共通：buildCommonFields / buildSpecificFields からフィールドを生成する。
     * @param {string} type
     * @param {HTMLElement|null} existingEl - 再設定対象要素（新規作成時は null）
     */
    export function openAnnotationSettingsDialog(type, existingEl = null) {
      // 内部ファイル指定の動画は編集不可(閲覧可否によらず一律禁止)。削除は引き続き可能。
      // サイドバーは前回表示分の中身が残らないよう空状態に戻す（選択状態自体は変更しない）。
      if (_isLegacyInternalFileVideo(existingEl)) {
        showToast('内部ファイル指定の動画は編集できません（削除して再作成してください）');
        closeDialog();
        return;
      }
      state.lastDetailType = type;  // 最後に表示した種別を履歴保持
      // デルタ計算の基準値をリセット（新たな選択に備える）
      applyLiveUpdate._prevX = undefined;
      applyLiveUpdate._prevY = undefined;
      applyLiveUpdate._prevW = undefined;
      applyLiveUpdate._prevH = undefined;
      const cfg = ANNOTATION_TYPE_CONFIG[type];
      document.getElementById('dialogTitle').textContent = cfg.label + '設定';

      // --- 共通セクション（位置・サイズ・塗り色）を再構築 ---
      const commonForm = document.getElementById('dialogFormCommon');
      commonForm.innerHTML = '';

      // --- 種別固有セクションを再構築 ---
      const specificForm = document.getElementById('dialogFormSpecific');
      specificForm.innerHTML = '';

      // savedData の収集（既存要素 or 連続作成引継ぎ）
      let savedData = {};
      if (existingEl?.dataset.savedData) {
        try { savedData = JSON.parse(existingEl.dataset.savedData); } catch (_) {}
      } else if (lastNewAnnData[type]) {
        savedData = { ...lastNewAnnData[type] };
      }
      // 既存要素の場合は style から位置・サイズを上書き（ドラッグ移動後も正確に取得）
      if (existingEl) {
        savedData.annPosX   = parseInt(existingEl.style.left,   10) || 0;
        savedData.annPosY   = parseInt(existingEl.style.top,    10) || 0;
        if (existingEl.style.width)  savedData.annWidth  = parseInt(existingEl.style.width,  10) || 100;
        if (existingEl.style.height) savedData.annHeight = parseInt(existingEl.style.height, 10) || 100;
      }
      // 新規作成時は state.pendingRect を初期値として使用
      const initRect = existingEl ? null : state.pendingRect;

      // 共通フィールドを生成（常時表示）。LIBRO由来の既存付箋（.libro-toggle）の場合は
      // 「既存付箋カラー」選択肢がデフォルト選択される（buildCommonFields内で判定）
      buildCommonFields(commonForm, type, savedData, initRect, existingEl);

      // アイコン型でも塗り色（背景グラデーション）を変更可能にするため無効化しない

      // 種別固有フィールドを生成（サイドバーでは非表示だが confirmAnnotation が読み取るため常に生成）
      buildSpecificFields(specificForm, type, savedData, existingEl);

      // 種別固有セクションはサイドメニューでは常に非表示（ダブルクリック編集ポップアップで編集する）
      const sepEl      = document.getElementById('detailSectionSep');
      const specificEl = document.getElementById('sideDetailSpecificWrap');
      sepEl.style.display      = 'none';
      specificEl.style.display = 'none';

      // ダイアログ削除ボタンは常に非表示（削除はDeleteキーで行う）
      const dialogDeleteBtn = document.querySelector('.dialog-btn.delete-btn');
      dialogDeleteBtn.style.display = 'none';
      dialogDeleteBtn.onclick = null;

      // キャンセルボタン
      document.querySelector('.dialog-btn.cancel').onclick = () => {
        if (!existingEl) { state.pendingRect = null; deactivateAnnotationMode(); }
        closeDialog();
        document.querySelector('.dialog-btn.ok').onclick = saveDialog;
        updateStatus();
      };

      // 保存
      document.querySelector('.dialog-btn.ok').onclick = () => confirmAnnotation(type, existingEl);

      document.getElementById('sideDetailEmpty').style.visibility = 'hidden';
      document.getElementById('sideDetailActive').style.display = '';
    }


    /**
     * アノテーションをページに確定配置する、または既存要素を更新する。
     * @param {string} type
     * @param {HTMLElement|null} existingEl - 更新対象要素（新規作成時は null）
     */
    export function confirmAnnotation(type, existingEl = null, overrideSavedData = null) {
      // 新規作成時は state.pendingRect が必要
      if (!existingEl && !state.pendingRect) { closeDialog(); return; }

      const isUpdate = existingEl !== null;

      // フォームフィールド値を一括収集
      // overrideSavedDataがあればそれを優先、なければサイドバーのフォームから取得
      let savedData = {};
      if (overrideSavedData) {
        savedData = overrideSavedData;
      } else {
        ['dialogFormCommon', 'dialogFormSpecific'].forEach(formId => {
          const formEl = document.getElementById(formId);
          if (!formEl) return;
          formEl.querySelectorAll('input[id], select[id], textarea[id]').forEach(el => {
            savedData[el.id] = el.value;
          });
        });
      }

      if (type === 'sticky') {
        // LIBRO由来の既存付箋（.libro-toggle）は色プロパティを持たないため、
        // ダイアログには「既存付箋カラー」という専用選択肢がデフォルト選択されている（buildCommonFields参照）。
        // それが選ばれたままなら元画像（閉・開とも）を維持し、実際の色が選ばれた場合は
        // 「閉」（解答を隠す面）だけを選択色のプレビューに差し替える。
        // 「開」（解答等が描き込まれている可能性がある元画像）は常に無変更のまま維持する
        // （他システム作成のbookでは開側に答えなどが直接描き込まれており、再生成できないため）。
        const isLibroToggleNote = existingEl?.dataset.libroToggle === '1';
        const colorSelection    = savedData.annColor;
        const keepsOriginalImage = isLibroToggleNote && (colorSelection === undefined || colorSelection === 'existing');
        // 新規作成時（isUpdate=false）のみ、フォールバック先を環境設定のデフォルト色にする
        const colorFallback = isUpdate ? '0' : (state.settingsStickyDefaultColor ?? '0');
        const colorIdx = parseInt(colorSelection || colorFallback, 10);
        const color    = STICKY_COLOR_MAP[colorIdx] ?? STICKY_COLOR_MAP[0];

        if (isUpdate) {
          // 更新前のスナップショットを Undo スタックに積む（ラベルやクラス名も含める）
          pushUndo({
            type: 'prop',
            el: existingEl,
            prevSavedData: existingEl.dataset.savedData,
            prevStyleCssText: existingEl.style.cssText,
            prevClassName: existingEl.className,
            prevInnerHTML: existingEl.innerHTML,
            prevStickyColorOverride: existingEl.dataset.stickyColorOverride,
          });
          // 位置・サイズを反映
          if (savedData.annPosX !== undefined) existingEl.style.left = parseInt(savedData.annPosX, 10) + 'px';
          if (savedData.annPosY !== undefined) existingEl.style.top  = parseInt(savedData.annPosY, 10) + 'px';
          if (savedData.annWidth !== undefined)  existingEl.style.width  = parseInt(savedData.annWidth, 10) + 'px';
          if (savedData.annHeight !== undefined) existingEl.style.height = parseInt(savedData.annHeight, 10) + 'px';

          if (isLibroToggleNote && keepsOriginalImage) {
            // 「既存付箋カラー」に戻した場合：色上書きを解除し、元の閉画像表示に戻す
            delete existingEl.dataset.stickyColorOverride;
          } else if (isLibroToggleNote) {
            // 実際の色が選択された：閉のみ選択色のプレビューに差し替える（開・元datasetは無変更のまま維持）
            existingEl.dataset.stickyColorOverride = String(colorIdx);
            let overlay = existingEl.querySelector('.libro-toggle-color-override');
            if (!overlay) {
              overlay = document.createElement('div');
              overlay.className = 'libro-toggle-color-override';
              existingEl.appendChild(overlay);
            }
            overlay.style.background = color;
          } else {
            // 通常付箋：色を反映
            existingEl.style.background = color;
          }
          // ラベル（annLabel）があれば反映
          if (savedData.annLabel !== undefined) {
            let labelSpan = existingEl.querySelector('.ann-label');
            if (!labelSpan) {
              labelSpan = document.createElement('span');
              labelSpan.className = 'ann-label';
              existingEl.appendChild(labelSpan);
            }
            labelSpan.textContent = savedData.annLabel;
          }
          existingEl.dataset.savedData = JSON.stringify(savedData);
          // 「開削除」設定をクラスへ反映（CSS側の紙色固定・マウス無反応の適用条件、
          // およびLIBRO書き出し時のopenLocked判定に使う）
          existingEl.classList.toggle('sticky-open-locked', savedData.annStickyOpenMode === '1');
          updateStatus();
        } else {
          // 新規作成：連続作成用に設定を保存
          lastNewAnnData[type] = savedData;
          const { x, y, w, h } = state.pendingRect;
          const note = document.createElement('div');
          note.className = 'sticky-note state-visible';
          note.dataset.id        = ++state.annIdCounter;
          note.dataset.type      = 'sticky';
          note.dataset.savedData = JSON.stringify(savedData);
          note.style.cssText = `left:${x}px; top:${y}px; width:${w}px; height:${h}px; background:${color};`;
          note.classList.toggle('sticky-open-locked', savedData.annStickyOpenMode === '1');

          // クリックハンドラを設定（コピー時の再利用のため関数化）
          addStickyClickHandler(note);

          makeDraggable(note);
          makeResizable(note);
          note.dataset.page = state.currentPage;
          document.getElementById('pageLeft').appendChild(note);
          pushUndo({ type: 'create', elements: [note] });
          updateStatus();
        }

      } else if (BUTTON_TYPES.has(type)) {
        // --- 大問/答/証明ボタン：座標・プリセット・拡大率・画像素材の更新のみ（生成はcreateXxxButton()が担当） ---
        if (!isUpdate) { closeDialog(); return; }

        pushUndo({
          type: 'prop',
          el: existingEl,
          prevSavedData: existingEl.dataset.savedData,
          prevStyleCssText: existingEl.style.cssText,
          prevClassName: existingEl.className,
          prevInnerHTML: existingEl.innerHTML,
        });
        // 画像素材が差し替わったかを判定するため、savedData を上書きする前に旧値を読む
        let prevBtnSd = {};
        try { prevBtnSd = JSON.parse(existingEl.dataset.savedData || '{}'); } catch (_) {}
        const prevBtnImage = (prevBtnSd.btnImageFile || '').trim();
        const nextBtnImage = (savedData.btnImageFile || '').trim();

        if (savedData.annPosX !== undefined) existingEl.style.left = parseInt(savedData.annPosX, 10) + 'px';
        if (savedData.annPosY !== undefined) existingEl.style.top  = parseInt(savedData.annPosY, 10) + 'px';
        renderButtonVisual(existingEl, type, savedData);
        existingEl.dataset.savedData = JSON.stringify(savedData);
        // renderButtonVisual() は el.textContent = '' で子要素を全削除するため、
        // 追加済みのリサイズハンドルも消える。ここで必ず再付与する
        // （プリセット⇔カスタム画像の切替で縦横比ロックの有無も切り替わる）。
        makeDaimonResizable(existingEl);
        // 画像素材を新しく設定／差し替えたときだけ、幅を保ったまま高さを画像本来の縦横比へ合わせる。
        // 画像が変わっていない場合（ラベル・色だけ変更した場合など）は、ユーザーが手動リサイズした
        // 矩形を勝手に戻さないよう何もしない。
        if (nextBtnImage && nextBtnImage !== prevBtnImage) applyDaimonImageAspect(existingEl);
        updateStatus();

      } else {
        // --- 汎用アノテーション（ページリンク / Plusファイル / 外部リンク / 音声再生 / 動画再生） ---
        const cfg         = ANNOTATION_TYPE_CONFIG[type];
        const displayType = savedData.annDisplayType || 'icon';
        // 'existing'（LIBRO由来ページリンクの「既存ページリンクカラー」選択時）や
        // 未設定時はデフォルト塗り色（ANN_COLOR_OPTIONS[0]）にフォールバックする
        const colorIdx    = parseInt(savedData.annColor, 10);
        const bgColor     = ANN_COLOR_OPTIONS[colorIdx]?.value ?? ANN_COLOR_OPTIONS[0].value;
        // 新規作成時は state.pendingRect のドラッグ寸法を優先し、更新時はフォーム値を使用する
        const x = isUpdate ? (parseFloat(savedData.annPosX)   || 0)   : (state.pendingRect?.x ?? parseFloat(savedData.annPosX)   ?? 0);
        const y = isUpdate ? (parseFloat(savedData.annPosY)   || 0)   : (state.pendingRect?.y ?? parseFloat(savedData.annPosY)   ?? 0);
        const w = isUpdate ? (parseFloat(savedData.annWidth)  || 100) : (state.pendingRect?.w ?? parseFloat(savedData.annWidth)  ?? 100);
        const h = isUpdate ? (parseFloat(savedData.annHeight) || 100) : (state.pendingRect?.h ?? parseFloat(savedData.annHeight) ?? 100);
        const label = (savedData.annLabel || '').trim() || cfg.label;

        if (isUpdate) {
          // 更新前のスナップショットを Undo スタックに積む
          pushUndo({ type: 'prop', el: existingEl, prevSavedData: existingEl.dataset.savedData, prevStyleCssText: existingEl.style.cssText, prevClassName: existingEl.className, prevInnerHTML: existingEl.innerHTML });
          // 更新：表示タイプの変更にも対応する
          existingEl.style.left = x + 'px';
          existingEl.style.top  = y + 'px';
          existingEl.dataset.savedData = JSON.stringify(savedData);

          if (displayType === 'icon') {
            // アイコン型に変更または絶対アイコン型のまま更新
            // 1:1比率を強制：short辺に揃える（非アイコン型から切り替え時に縦横が異なる場合がある）
            const iconDefault = getIconDefaultSizePx();
            const iconSize = Math.min(existingEl.offsetWidth || iconDefault, existingEl.offsetHeight || iconDefault);
            existingEl.className = 'ann-icon-obj';
            existingEl.style.width  = iconSize + 'px';
            existingEl.style.height = iconSize + 'px';
            existingEl.style.background = ICON_COLOR_OPTIONS[colorIdx]?.value ?? ICON_COLOR_OPTIONS[0].value;
            existingEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cfg.iconViewBox || '0 0 24 24'}">${cfg.iconSvg}</svg>`;
          } else if (displayType === 'page-color') {
            // 紙面カラー型：ラベルなしの透明ホットスポット（編集モードのみ種別アイコンを中央表示）
            existingEl.className = 'ann-object dt-page-color';
            existingEl.style.width      = w + 'px';
            existingEl.style.height     = h + 'px';
            existingEl.style.background = '';
            renderAnnObjectContent(existingEl, type, 'page-color');
          } else if (displayType === 'image') {
            // 画像アイコン型：元画像・アップロード画像をそのまま表示（rectのw/hをそのまま採用）
            existingEl.className = 'ann-image-obj';
            existingEl.style.width      = w + 'px';
            existingEl.style.height     = h + 'px';
            existingEl.style.background = '';
            renderAnnImageContent(existingEl, savedData);
          } else {
            // マーカー型に変更または絶対マーカー型のまま更新
            existingEl.className = 'ann-object';
            existingEl.style.width      = w + 'px';
            existingEl.style.height     = h + 'px';
            existingEl.style.background = bgColor;
            renderAnnObjectContent(existingEl, type, 'marker', label);
          }
          // タイプ変更後にリサイズハンドルを再付与（icon ↔ marker 切り替え時にハンドルがなくなる問題を修正）
          if (displayType === 'icon' || displayType === 'image') {
            makeResizable(existingEl, { lockAspectRatio: true, minSize: 14 });
          } else {
            makeResizable(existingEl);
          }
          updateStatus();
        } else {
          // 新規作成：連続作成用に設定を保存し、displayType に応じて要素を生成
          lastNewAnnData[type] = savedData;
          const ann = document.createElement('div');
          ann.dataset.id        = ++state.annIdCounter;
          ann.dataset.type      = type;
          ann.dataset.savedData = JSON.stringify(savedData);

          if (displayType === 'icon') {
            // アイコン型：円形ボタン
            const iconBg = ICON_COLOR_OPTIONS[colorIdx]?.value ?? ICON_COLOR_OPTIONS[0].value;
            ann.className = 'ann-icon-obj';
            // 種別によらず同一の既定サイズ・1:1で作成する
            // （getIconDefaultSizePx() を唯一の基準にする。ドラッグで描いた矩形の寸法は使わない）
            const iconSize = getIconDefaultSizePx();
            ann.style.cssText = `left:${x}px; top:${y}px; width:${iconSize}px; height:${iconSize}px; background:${iconBg};`;
            ann.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cfg.iconViewBox || '0 0 24 24'}">${cfg.iconSvg}</svg>`;
          } else if (displayType === 'page-color') {
            // 紙面カラー型：ラベルなしの透明ホットスポット（編集モードのみ種別アイコンを中央表示）
            ann.className = 'ann-object dt-page-color';
            ann.style.cssText = `left:${x}px; top:${y}px; width:${w}px; height:${h}px;`;
            renderAnnObjectContent(ann, type, 'page-color');
          } else if (displayType === 'image') {
            // 画像アイコン型：元画像・アップロード画像をそのまま表示（rectのw/hをそのまま採用）
            ann.className = 'ann-image-obj';
            ann.style.cssText = `left:${x}px; top:${y}px; width:${w}px; height:${h}px;`;
            renderAnnImageContent(ann, savedData);
          } else {
            // マーカー型：矩形ラベル（編集モードは種別アイコンも横並び表示）
            ann.className = 'ann-object';
            ann.style.cssText = `left:${x}px; top:${y}px; width:${w}px; height:${h}px; background:${bgColor};`;
            renderAnnObjectContent(ann, type, 'marker', label);
          }

          // クリックハンドラを設定（コピー時の再利用のため関数化）
          addAnnClickHandler(ann);

          makeDraggable(ann);
          if (displayType === 'icon' || displayType === 'image') {
            // アイコン型・画像アイコン型：縦横比を維持してリサイズ（最小サイズ 14px）
            makeResizable(ann, { lockAspectRatio: true, minSize: 14 });
          } else {
            makeResizable(ann);
          }
          ann.dataset.page = state.currentPage;
          document.getElementById('pageLeft').appendChild(ann);
          pushUndo({ type: 'create', elements: [ann] });
          const dispLabel = displayType === 'icon' ? 'アイコン' : displayType === 'page-color' ? '紙面カラー' : displayType === 'image' ? '画像' : 'マーカー';
          updateStatus();
        }
      }

      if (!isUpdate) state.pendingRect = null;
      // 連続作成モード（新規作成）：設定フォームを再表示して次のドラッグに備える
      if (!isUpdate && state.currentDrawType) {
        openAnnotationSettingsDialog(state.currentDrawType);
      } else {
        closeDialog();
        document.querySelector('.dialog-btn.ok').onclick = saveDialog;
      }
    }
