import { addAnnClickHandler } from './annotation-actions.js';
import { ANNOTATION_TYPE_CONFIG, ANN_COLOR_OPTIONS, ICON_COLOR_OPTIONS, getIconDefaultSizePx, STICKY_COLORS, STICKY_COLOR_MAP, CUSTOM_STICKY_COLOR_BASE, CUSTOM_STICKY_COLOR_SLOTS, getStickyColor, isCustomStickyColorIndex, renderAnnObjectContent, renderAnnImageContent, MAX_ICON_IMAGE_SIZE_BYTES, MAX_ICON_IMAGE_DIMENSION } from './config.js';
import { clampElementToPage, clampGroupIntoPage, deactivateAnnotationMode, getPageBaseSize, getSelectedObjects, makeDraggable, makeResizable, readClosedImageSolidHex, updateAlignPanel, updateDaimonGroupHighlight } from './annotation-interaction.js';
import { applyDaimonImageAspect, generatePressedVariant, makeDaimonResizable, renderButtonVisual } from './buttons.js';
import { validateJstreamCorpId, validateJstreamDir, validateJstreamVideoId } from './jstream-validate.js';
import { mediaBlobs, state } from './state.js';
import { addStickyClickHandler } from './sticky.js';
import { closeDialog, saveDialog } from './storage.js';
import { escapeHtml, updateStatus } from './ui-common.js';
import { pushUndo } from './undo-redo.js';
import { trackEvent } from './analytics.js';


    /** 大問/答/証明ボタンのtype一覧（共通判定に使用） */
    const BUTTON_TYPES = new Set(['daimon', 'kotae', 'shomei']);

    /**
     * 大問/答/証明ボタンのサイズを変更してよい要素かを判定する。
     * ページ座標系サイズをインラインstyleで持つ .is-sized のもののみ対象で、
     * LIBRO由来（dataset.libroToggle === '1'）とCSS固定サイズの旧ボタンは対象外。
     * makeDaimonResizable()（buttons.js）が紙面上のリサイズハンドルを付ける条件と
     * 同一にしてあり、「紙面で変えられないものはheaderからも変えられない」を保つ。
     * @param {HTMLElement|null} el
     * @returns {boolean}
     */
    function isButtonResizable(el) {
      return !!el && el.classList.contains('is-sized') && el.dataset.libroToggle !== '1';
    }

    /** 連続作成モード用：前回使用した設定を種別ごとに保存 */
    const lastNewAnnData = {};


    /**
     * 紙面表示用の内部px（#pageLeftのベースサイズ＝offsetWidth/offsetHeight基準。
     * フィットモード・ウィンドウ幅で#pageLeftの表示サイズが変わるとこの内部pxの
     * 「同じ座標が意味する画面上の位置」も変わる）を、LIBROページ画像の実寸px
     * （index.json由来のstate.bookPages[n].width/height基準。フィット・ウィンドウ幅に
     * よらず常に一定）に変換する。
     *
     * サイドパネル・編集ポップアップの位置/サイズ入力欄（annPosX/Y/annWidth/annHeight）は
     * この実寸pxで表示・入力を受け付ける。内部処理（style.left/top・savedData.annPosX等・
     * 書き出し・自動保存・Undo/Redo）は従来どおり内部pxのまま扱うため変更しない
     * （影響範囲を表示・入力の変換レイヤーだけに限定するため）。
     *
     * ページのアスペクト比はresizePage()がstate.PAGE_ASPECTに基づいて維持しているため、
     * X軸（width基準）・Y軸（height基準）で換算比率が異なることはない（確認済み）。
     * @param {number} px    - 内部px値
     * @param {'x'|'y'} axis - X軸（left/width）かY軸（top/height）か
     * @returns {number} 実寸px値（変換元データが無い場合はpxをそのまま返す）
     */
    function internalToRealPx(px, axis) {
      const base = getPageBaseSize();
      const pageData = state.bookPages?.[state.currentPage - 1];
      if (!pageData || !base.w || !base.h) return px;
      const real     = axis === 'x' ? pageData.width : pageData.height;
      const baseAxis = axis === 'x' ? base.w : base.h;
      if (!baseAxis) return px;
      return px * real / baseAxis;
    }


    /**
     * internalToRealPx() の逆変換。UI入力欄（実寸px）から読み取った値を内部pxへ戻し、
     * 従来どおりの内部処理（style適用・savedData保存）に渡すために使う。
     * `app/js/undo-redo.js` からも使うため export する（`internalToRealPx` は
     * このファイル内でしか使わないため非export＝確認済み）。
     * @param {number} px    - 実寸px値
     * @param {'x'|'y'} axis - X軸（left/width）かY軸（top/height）か
     * @returns {number} 内部px値（変換元データが無い場合はpxをそのまま返す）
     */
    export function realToInternalPx(px, axis) {
      const base = getPageBaseSize();
      const pageData = state.bookPages?.[state.currentPage - 1];
      if (!pageData || !base.w || !base.h) return px;
      const real     = axis === 'x' ? pageData.width : pageData.height;
      const baseAxis = axis === 'x' ? base.w : base.h;
      if (!real) return px;
      return px * baseAxis / real;
    }


    /**
     * 位置・サイズ入力欄（#annPosX等）へ値を書き戻す。
     * ユーザーが入力中（フォーカス中）の欄は書き換えない。
     *
     * 欄の値は確定（Enter・フォーカス解除）時の `change` で applyLiveUpdate() へ渡すが、
     * スピンボタンはフォーカスを保ったまま即時反映 → 書き戻しまで走る。フォーカス中の欄まで
     * 上書きすると、スピン後に続けて打っている値が実配置の値へ差し替わってしまう。
     * 入力中の欄と実配置のずれは、フォーカスが外れた時点の再同期（buildCommonFieldsのblur）で解消する。
     * @param {HTMLElement|null} el    - 入力欄
     * @param {number}           value - 書き戻す値（実寸px）
     */
    function setPosFieldValue(el, value) {
      if (!el || el === document.activeElement) return;
      el.value = value;
    }


    /**
     * ドラッグ移動・リサイズ操作中（単一選択）に、サイドパネルの位置X・Y、変形W・Hの表示値を
     * リアルタイムで更新する。DOM再構築（buildCommonFieldsの再呼び出し）は行わず、既存のinput要素
     * （#annPosX等）の.valueだけを書き換えるため、mousemoveのたびに呼んでも軽量でフォーカスも失われない。
     * サイドパネルが非表示（グレーアウト中）でも呼んで構わない（値を書き換えるだけで画面に影響しない）。
     * @param {HTMLElement} el - ドラッグ・リサイズ中の要素
     */
    export function refreshPosFieldsLive(el) {
      const posXEl = document.getElementById('annPosX');
      const posYEl = document.getElementById('annPosY');
      const wEl    = document.getElementById('annWidth');
      const hEl    = document.getElementById('annHeight');
      setPosFieldValue(posXEl, Math.round(internalToRealPx(parseFloat(el.style.left) || 0, 'x')));
      setPosFieldValue(posYEl, Math.round(internalToRealPx(parseFloat(el.style.top)  || 0, 'y')));
      // 幅・高さは、整数に丸められる offsetWidth/offsetHeight ではなく style の値から換算する
      // （内部px 1px が実寸4〜5pxにあたるため、offsetWidth では表示が最大±5ずれていた）
      setPosFieldValue(wEl,    Math.round(internalToRealPx(parseFloat(el.style.width)  || el.offsetWidth,  'x')));
      setPosFieldValue(hEl,    Math.round(internalToRealPx(parseFloat(el.style.height) || el.offsetHeight, 'y')));
    }


    /**
     * 複数選択中、外接矩形（バウンディングボックス）の左上X・Y、幅・高さをサイドパネルへ表示する。
     * 個々のオブジェクトの色・種別固有設定は複数選択では扱わないため、位置・変形の2行のみを表示する
     * （buildCommonFields()にtype=nullを渡すと「変形欄は出る・塗り色欄と種別固有欄は出ない」分岐に
     * なる＝確認済み）。
     *
     * サイドパネルが既に複数選択モードで構築済み（#sideDetailActiveのdataset.mode==='multi'）なら
     * フォーム骨格の再構築はせず、既存input要素の.valueだけを更新する（mousemoveのたびに呼ばれるため、
     * DOM再構築は初回のみに限定する）。
     * @param {HTMLElement} box - #selectionBoundingBox要素（内部px座標のstyle.left/top/width/height）
     */
    export function refreshMultiSelectionPanel(box) {
      const activePanel = document.getElementById('sideDetailActive');
      if (activePanel.dataset.mode !== 'multi') {
        // 初回：フォーム骨格を構築する
        document.getElementById('dialogTitle').textContent = '複数選択';
        const commonForm = document.getElementById('dialogFormCommon');
        commonForm.innerHTML = '';
        const specificForm = document.getElementById('dialogFormSpecific');
        specificForm.innerHTML = '';
        buildCommonFields(commonForm, null, {}, null, null);
        document.getElementById('detailSectionSep').style.display      = 'none';
        document.getElementById('sideDetailSpecificWrap').style.display = 'none';
        const dialogDeleteBtn = document.querySelector('.dialog-btn.delete-btn');
        dialogDeleteBtn.style.display = 'none';
        dialogDeleteBtn.onclick = null;
        document.getElementById('sideDetailEmpty').style.visibility = 'hidden';
        activePanel.style.display = '';
        activePanel.dataset.mode = 'multi';
      }
      // 値をリアルタイム更新（DOM再構築なし）
      const posXEl = document.getElementById('annPosX');
      const posYEl = document.getElementById('annPosY');
      const wEl    = document.getElementById('annWidth');
      const hEl    = document.getElementById('annHeight');
      setPosFieldValue(posXEl, Math.round(internalToRealPx(parseFloat(box.style.left)   || 0, 'x')));
      setPosFieldValue(posYEl, Math.round(internalToRealPx(parseFloat(box.style.top)    || 0, 'y')));
      setPosFieldValue(wEl,    Math.round(internalToRealPx(parseFloat(box.style.width)  || 0, 'x')));
      setPosFieldValue(hEl,    Math.round(internalToRealPx(parseFloat(box.style.height) || 0, 'y')));
    }


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
     * 環境設定「Jストリームディレクトリ」「企業ID」変更時に、連続作成用に保持している
     * 動画の前回設定（lastNewAnnData.video）の該当値も新しいデフォルトへ揃える。
     * これを行わないと、既に動画を1つ以上作成したあとに設定を変更しても
     * lastNewAnnData 側の値が優先され、新しいデフォルトが反映されない。
     * @param {string} dir - Jストリームディレクトリ
     * @param {string} corpId - 企業ID
     */
    export function syncJstreamDefaults(dir, corpId) {
      if (!lastNewAnnData.video) return;
      lastNewAnnData.video.annJstreamDir    = String(dir);
      lastNewAnnData.video.annJstreamCorpId = String(corpId);
    }

    /**
     * 連続作成用の前回設定（lastNewAnnData[type]）へ格納する値を組み立てる。
     * 種別ごとに「1件ごとに個別指定すべきフィールド」を引継ぎ対象から除外する。
     *  - audio：annFile（音声ファイルごとに異なるため常に空へ）
     *  - video：annJstreamVideoId（動画ごとに一意のため常に空へ）。ディレクトリ・企業IDは
     *    項目ごとに独立して扱い、環境設定に既定値が無い項目だけ空へ倒す。
     *    環境設定に値がある項目を空へ倒さないのは、ユーザーが環境設定と異なる値を手入力していた
     *    ときにそれを失わせないため（空にしても入力欄構築側の jsDirFallback/jsCorpFallback で
     *    環境設定値へ戻るだけだが、手入力値は復元されない）。
     *    逆に環境設定が空の項目は、ここで空にしておかないとフォールバックも空のため
     *    前回入力値がそのまま引き継がれてしまう。
     * @param {string} type - アノテーション種別
     * @param {Object} savedData - 今回作成したアノテーションの設定値
     * @returns {Object} lastNewAnnData[type] へ格納する値
     */
    function buildLastNewAnnData(type, savedData) {
      if (type === 'audio') return { ...savedData, annFile: '' };
      if (type === 'video') {
        const next = { ...savedData, annJstreamVideoId: '' };
        if (!(state.settingsJstreamDir    || '').trim()) next.annJstreamDir    = '';
        if (!(state.settingsJstreamCorpId || '').trim()) next.annJstreamCorpId = '';
        return next;
      }
      return savedData;
    }


    /**
     * クイック作成／編集ポップアップのJ-stream入力欄が、J-Streamの想定入力値かを検証する。
     * 動画以外の種別、「J-stream」未選択（内部ファイル・外部タグ）、LIBRO由来の生文字列を
     * 保持しているリンク（3欄が生成されない）は検証対象外として常に true を返す。
     *
     * - error：該当欄の直下にメッセージを表示し、最初にエラーになった欄へフォーカスして中止する
     *   （3欄すべてを判定するため、複数欄が同時にエラー表示になることがある。
     *     確認ダイアログは出さず、ユーザーに続行可否を尋ねない）。
     *
     * 種別固有フィールドのidはサイドバーの詳細フォームにも同時に存在しうるため、
     * 必ず #quickCreatePopup を起点に取得すること（document.getElementById は使わない）。
     * @param {string} type - アノテーション種別
     * @returns {boolean} true なら確定処理を続行してよい
     */
    function validateQuickPopupJstream(type) {
      const popup = document.getElementById('quickCreatePopup');
      if (type !== 'video' || !popup) return true;
      // 「動画ファイル」ラジオの hidden input。'2' がJ-stream指定
      const srcEl = popup.querySelector('[id="annVideoSrc"]');
      if (!srcEl || srcEl.value !== '2') return true;

      // 3欄すべてを判定し、エラーの欄には各欄直下のエラー表示欄へメッセージを出す
      // （最初のエラーで打ち切らない）。フォーカスは最初にエラーになった欄へ当てる。
      const targets = [
        ['annJstreamDir',     'annJstreamDirError',     validateJstreamDir],
        ['annJstreamCorpId',  'annJstreamCorpIdError',  validateJstreamCorpId],
        ['annJstreamVideoId', 'annJstreamVideoIdError', validateJstreamVideoId],
      ];
      let firstInvalid = null;
      for (const [id, errId, validate] of targets) {
        const input = popup.querySelector(`[id="${id}"]`);
        if (!input) continue;
        const result = validate(input.value.trim());
        const isError = result.level === 'error';
        const errEl = popup.querySelector(`[id="${errId}"]`);
        if (errEl) {
          errEl.textContent = isError ? result.message : '';
          errEl.classList.toggle('is-shown', isError);
        }
        if (isError && !firstInvalid) firstInvalid = input;
      }
      if (firstInvalid) {
        firstInvalid.focus();
        return false;
      }
      return true;
    }


    /**
     * 既存のアノテーションオブジェクトをダブルクリックしたときに表示する編集ポップアップ。
     * quick-popup と同じ構造を使い、確定時に confirmAnnotation(type, el) を呼んで更新する。
     * @param {HTMLElement} el - 編集対象の ann-object / ann-icon-obj 要素
     */
    export function openEditPopup(el) {
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
      prevData.annWidth       = parseFloat(el.style.width)  || el.offsetWidth;
      prevData.annHeight      = parseFloat(el.style.height) || el.offsetHeight;
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

      // dataset.libroToggleCraftは libro-format.js の renderTogglePairs() が、CRAFT自身が
      // 書き出した付箋（libro-craft-metaあり）を再読込した際にのみ付与する。CRAFT製なら
      // 元画像を再生成できるため、開閉方式欄の表示だけはLIBRO+製由来との判定から除外する
      // （色編集不可の制約はisLibroToggleStickyのまま維持し、buildCommonFields側は無変更）。
      const isLibroToggleSticky = type === 'sticky' && el.dataset.libroToggle === '1'
        && el.dataset.libroToggleCraft !== '1';
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
        // J-stream指定の入力値を検証する。通らない場合はポップアップを閉じず更新もしない
        if (!validateQuickPopupJstream(type)) return;
        // アイコン型は1:1のため、W・Hのうち変えた方の値で両欄を揃えてから収集する。
        // confirmAnnotation はW・Hが等しいときにその値を1辺として使う
        unifyIconSizeFields(popup);
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
        // headerの詳細パネルはポップアップの確定では作り直されないため、
        // 表示タイプ・塗り色を変えると共通セクションのミラー欄が古いままになる。
        // 単一選択でパネルを開いている場合のみ、更新後の値で作り直す。
        // （複数選択パネル表示中は refreshMultiSelectionPanel の管轄なので触らない）
        const activePanel = document.getElementById('sideDetailActive');
        if (activePanel.dataset.mode !== 'multi' && activePanel.style.display !== 'none') {
          openAnnotationSettingsDialog(type, el);
        }
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
      const prevData = { ...(lastNewAnnData[type] || {}) };
      // アイコン型は W・H 欄にアイコンの既定サイズ（1:1）を表示する。
      // 前回作成時の値や buildCommonFields の既定値（100）のままだと、何も変えずに作ったときの
      // 大きさ（既定サイズ）と欄の表示が一致しないため。表示タイプの既定は buildSpecificFields と同じ 'icon'。
      if (type !== 'sticky' && !BUTTON_TYPES.has(type) && (prevData.annDisplayType || 'icon') === 'icon') {
        const iconDefault = getIconDefaultSizePx();
        prevData.annWidth  = iconDefault;
        prevData.annHeight = iconDefault;
      }

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
     * ポップアップ（#quickCreatePopup）の W・H 欄を、アイコン型（1:1）用に同じ値へ揃える。
     * 表示タイプがアイコンのときだけ働き、W・H のうち値を変えた方（初期値＝defaultValue と
     * 異なる方）に揃える。両方変えた場合は W に揃える。どちらも変えていない場合は何もしない。
     *
     * ポップアップの欄には縦横比ペアリング（buildCommonFields）が付かない。
     * buildCommonFields は欄を document.getElementById で探すため、ヘッダーに同じ id の欄が
     * あるとそちらを拾うので、W を変えても H が追従せず、別々の値のまま確定されてしまう。
     * @param {HTMLElement|null} popup - #quickCreatePopup
     * @returns {boolean} 揃えた場合 true
     */
    function unifyIconSizeFields(popup) {
      if (!popup) return false;
      if (popup.querySelector('#qcFormSpecific [id="annDisplayType"]')?.value !== 'icon') return false;
      const wEl = popup.querySelector('#qcFormCommon [id="annWidth"]');
      const hEl = popup.querySelector('#qcFormCommon [id="annHeight"]');
      if (!wEl || !hEl) return false;
      const wChanged = wEl.value !== wEl.defaultValue;
      const hChanged = hEl.value !== hEl.defaultValue;
      if (!wChanged && !hChanged) return false;
      const side = parseFloat((wChanged ? wEl : hEl).value);
      if (!(side > 0)) return false;
      wEl.value = String(side);
      hEl.value = String(side);
      return true;
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
      // J-stream指定の入力値を検証する。通らない場合はポップアップを閉じずオブジェクトも作らない
      if (!validateQuickPopupJstream(type)) return;
      // アイコン型は1:1のため、W・Hのうち変えた方の値で両欄を揃える（転写・中心合わせより先に行う）。
      // どちらも変えていなければ false で、アイコンは従来どおり既定サイズで作る
      const iconResized = unifyIconSizeFields(document.getElementById('quickCreatePopup'));
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
      // annWidth/annHeight欄はLIBRO実寸px表示のため、state.pendingRect（内部px前提）に
      // 設定する前に内部pxへ変換する。
      const w = Math.max(realToInternalPx(parseFloat(qcCommon?.querySelector('[id="annWidth"]')?.value)  || 120, 'x'), 10);
      const h = Math.max(realToInternalPx(parseFloat(qcCommon?.querySelector('[id="annHeight"]')?.value) || 40,  'y'), 10);
      closeQuickCreateDialog();

      // クリック位置をオブジェクトの中央にして配置
      state.pendingRect = { x: pageX - w / 2, y: pageY - h / 2, w, h };
      // アイコン型でW・Hを変えた場合は、その1辺で作る（confirmAnnotation のアイコン型・新規作成分岐が使う）
      if (iconResized) state.pendingRect.iconSize = Math.max(14, w);
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
      // スピンボタンは押すたびに即時反映する（1クリック＝取り消し1件）。
      // 欄の値は通常、確定（Enter・フォーカス解除）時の change でのみ部品へ反映するため、
      // スピン専用の確定イベント poscommit を発火する（受け側は buildCommonFields）。
      // input はアイコン型の縦横比ペアリング（反対側の欄の表示追従）のために残す。
      // スピンアップ：+1
      field.querySelector('.spin-up').addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = (parseInt(input.value, 10) || 0) + 1;
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new Event('poscommit'));
      });
      // スピンダウン：-1（0未満にしない）
      field.querySelector('.spin-down').addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1);
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new Event('poscommit'));
      });
      return field;
    }


    function buildCommonFields(form, type, savedData, initRect, existingEl = null) {
      // 内部px（小数）のまま扱い、入力欄へ表示するときだけ実寸を整数に丸める。
      // 内部pxで丸めると、実寸で最大±5の誤差になる。
      const px = initRect ? initRect.x : (parseFloat(savedData.annPosX) || 0);
      const py = initRect ? initRect.y : (parseFloat(savedData.annPosY) || 0);
      // 大問/答/証明ボタンは dataset.savedData に annWidth/annHeight を持たないことがあり
      // （openAnnotationSettingsDialogが style.width のあるときだけ設定するため）、
      // 取得できない場合は実レイアウトサイズへフォールバックする。
      // 従来はここで一律 100 になり、変形欄に実サイズと無関係な値が表示されていた。
      const pw = initRect ? initRect.w : (parseFloat(savedData.annWidth)  || existingEl?.offsetWidth  || 100);
      const ph = initRect ? initRect.h : (parseFloat(savedData.annHeight) || existingEl?.offsetHeight || 100);
      // px/py/pw/phは内部px（#pageLeftのベースサイズ基準）。入力欄にはLIBROページ実寸pxで
      // 表示する（フィットモード・ウィンドウ幅を変えても同じ値になるようにするため）。
      const dispX = Math.round(internalToRealPx(px, 'x'));
      const dispY = Math.round(internalToRealPx(py, 'y'));
      const dispW = Math.round(internalToRealPx(pw, 'x'));
      const dispH = Math.round(internalToRealPx(ph, 'y'));

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
        posRow.appendChild(makePosField(['annPosX','annPosY'][i], [dispX, dispY][i]));
      });
      posDd.appendChild(posRow);
      form.appendChild(posDd);

      // 「変形」行は種別を問わず常に生成する（種別ごとにheaderの行構成＝幅が変わるのを防ぐため）。
      // 大問/答/証明ボタンのうち、紙面上でリサイズできないもの（LIBRO由来・CSS固定サイズの
      // 旧ボタン）だけを非活性表示にする。
      const isButtonType = BUTTON_TYPES.has(type);

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
        szRow.appendChild(makePosField(['annWidth','annHeight'][i], [dispW, dispH][i]));
      });
      szDd.appendChild(szRow);
      form.appendChild(szDd);
      if (isButtonType && !isButtonResizable(existingEl)) {
        // LIBRO由来（.libro-toggle）・CSS固定サイズの旧ボタンは紙面上でもリサイズできないため、
        // headerからも変更できないよう表示したまま非活性にする。
        // .is-field-disabled が pointer-events:none を付けるためスピンボタンも操作できない。
        szDt.classList.add('is-field-disabled');
        szDd.classList.add('is-field-disabled');
        szDd.querySelectorAll('input, button').forEach(el => { el.disabled = true; });
      }

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
      // 色欄の名前は、付箋がいま表示している色の値で決める（表示のたびに判定する）。
      // 記録された色番号（例：カスタム1＝100）で決めると、環境設定のカスタムカラーを後から
      // 上書きしたとき、付箋は元の色のままなのに色欄だけ新しい色の名前になるため。
      // - 同じ色の欄があればその名前（記録された番号の色が同じならその番号を優先）
      // - どれとも同じでなければ「既存付箋カラー（#rrggbb）」（value='existing'）
      // 色が変わるのは、利用者が色欄で色を選んだときだけ（applyLiveUpdate / confirmAnnotation）。
      const isLibroToggle = existingEl?.dataset.libroToggle === '1';
      let stickyColorValue;
      let showExistingOption = false;
      // 「既存付箋カラー」の選択肢の文言に添える色の値（null なら添えない）
      let existingOptionHex = null;
      if (isLibroToggle) {
        // LIBRO由来の付箋：「既存付箋カラー」＝元の閉じた画像のまま（重ね表示を外す）。
        // 元の色がいまの環境設定のどれとも同じでない（または読めない）付箋には、色を変えた後も
        // 元へ戻せるよう、重ね表示の有無にかかわらずこの選択肢を出す。
        const originalHex   = getLibroToggleOriginalHex(existingEl);
        const originalValue = findStickyColorValueByHex(originalHex, existingEl.dataset.stickyBaseColor);
        showExistingOption = originalValue === null;
        existingOptionHex  = originalHex;
        if (existingEl.dataset.stickyColorOverride !== undefined) {
          const overrideHex = existingEl.dataset.stickyColorOverrideHex;
          const resolvedOverrideHex = (overrideHex && /^#[0-9a-f]{6}$/i.test(overrideHex))
            ? overrideHex.toLowerCase()
            : stickyColorValueToHex(existingEl.dataset.stickyColorOverride);
          const overrideValue = findStickyColorValueByHex(resolvedOverrideHex, existingEl.dataset.stickyColorOverride);
          if (overrideValue !== null) {
            stickyColorValue = overrideValue;
          } else {
            // 重ね表示の色がいまの環境設定のどれとも同じでない：いまの重ね表示のままを表す選択肢
            // （番号の欄を選択状態にすると、確定でいまの環境設定の色へ黙って変わるため）
            stickyColorValue = 'current';
            const currentOpt = document.createElement('option');
            currentOpt.value = 'current';
            currentOpt.textContent = resolvedOverrideHex ? `現在の色（${resolvedOverrideHex}）` : '現在の色';
            colSel.appendChild(currentOpt);
          }
        } else {
          stickyColorValue = originalValue ?? 'existing';
        }
      } else if (existingEl) {
        // 通常の付箋：色の値（savedData.annColorHex。無ければ色番号のいまの色）で名前を決める。
        // 書き出しも同じ順で色を決める（storage.js の getStickyColor(colorIdx, sd.annColorHex)）
        const recordedValue = savedData.annColor || '0';
        const actualHex     = String(getStickyColor(recordedValue, savedData.annColorHex)).toLowerCase();
        const matchedValue  = findStickyColorValueByHex(actualHex, recordedValue);
        if (matchedValue !== null) {
          stickyColorValue = matchedValue;
        } else {
          // 「既存付箋カラー」＝色欄を作った時点の色のまま。色を変えた後に選び直したとき
          // 戻す色を色欄に控える（applyLiveUpdate が使う）
          stickyColorValue   = 'existing';
          showExistingOption = true;
          existingOptionHex  = actualHex;
          colSel.dataset.existingHex        = actualHex;
          colSel.dataset.existingColorIndex = recordedValue;
        }
      } else {
        // 新規作成時のみ、フォールバック先を環境設定のデフォルト色にする
        stickyColorValue = savedData.annColor || (state.settingsStickyDefaultColor ?? '0');
      }
      if (showExistingOption) {
        const o = document.createElement('option');
        o.value = 'existing';
        o.textContent = existingOptionHex ? `既存付箋カラー（${existingOptionHex}）` : '既存付箋カラー';
        colSel.insertBefore(o, colSel.firstChild);
      }
      // 新規作成で選べるのは紙色（STICKY_COLORS[3]）と登録済みのカスタムスロットのみ。
      // 旧選択肢（青/緑/黄）は過去データの描画・書き出し用に定義だけ残しており、ここには出さない。
      {
        const paperOpt = document.createElement('option');
        paperOpt.value = '3';
        paperOpt.textContent = STICKY_COLORS[3].label;
        colSel.appendChild(paperOpt);
      }
      // カスタムカラーは環境設定で登録済み（空文字でない）のスロットだけ選択肢に出す
      let hasCustomColor = false;
      for (let slot = 0; slot < CUSTOM_STICKY_COLOR_SLOTS; slot++) {
        if (!state.settingsCustomStickyColors[slot]) continue;
        hasCustomColor = true;
        const customOpt = document.createElement('option');
        customOpt.value = String(CUSTOM_STICKY_COLOR_BASE + slot);
        customOpt.textContent = `カスタム${slot + 1}`;
        colSel.appendChild(customOpt);
      }
      // カスタムカラーが1つも登録されていない場合は、選択できない案内用の項目を出す。
      // 「紙色しか選べない」状態の理由（環境設定で登録が必要なこと）を利用者へ示すため。
      // disabled のため選択されることはなく、colSel.value に入ることもない。
      if (!hasCustomColor) {
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = 'カスタムカラー未設定';
        emptyOpt.disabled = true;
        colSel.appendChild(emptyOpt);
      }
      // 選択肢に無い色（旧パレットの青/緑/黄・環境設定に登録されていないカスタム）は、
      // その色の項目を足して表示する（足さないと色欄が空欄になり、何色か分からない）
      if (stickyColorValue !== 'existing' && stickyColorValue !== 'current' && ![...colSel.options].some(o => o.value === stickyColorValue)) {
        const missingIdx = parseInt(stickyColorValue, 10);
        const missingOpt = document.createElement('option');
        missingOpt.value = stickyColorValue;
        missingOpt.textContent = isCustomStickyColorIndex(missingIdx)
          ? `カスタム${missingIdx - CUSTOM_STICKY_COLOR_BASE + 1}（未登録）`
          : (STICKY_COLORS[missingIdx]?.label ?? `色${stickyColorValue}`);
        colSel.appendChild(missingOpt);
      }
      colSel.value = stickyColorValue;
      colWrap.appendChild(colSel);
      colDd.appendChild(colWrap);
      form.appendChild(colDt);
      form.appendChild(colDd);
      }

      // --- 塗り（付箋以外：header共通セクション用のミラー欄） ---
      // 付箋以外の塗り色の実体は buildSpecificFields() 側の #annColor だが、
      // 種別設定セクション（#sideDetailSpecificWrap）はheaderでは常に非表示のため、
      // そのままではheaderから塗り色を変更できない。ここに複製欄を置き、
      // syncCommonFillMirror() で実体と双方向同期する。
      // - idを付けないため confirmAnnotation の `input[id], select[id], textarea[id]` 収集には
      //   拾われず、#annColor の重複も発生しない（確認済み）
      // - クイック作成／編集ポップアップ（#qcFormCommon）には生成しない。ポップアップでは
      //   種別設定セクションが表示され実体を直接操作できるため（＝ラベルの二重表示にならない）
      // - 初期状態は非活性。使える状況かどうかは syncCommonFillMirror() が判定する
      if (form.id === 'dialogFormCommon' && type !== 'sticky') {
        const mirDt = document.createElement('dt');
        mirDt.textContent = '塗り';
        mirDt.dataset.fieldGroup = 'fill';
        mirDt.dataset.role = 'fill-mirror-dt';
        mirDt.classList.add('is-field-disabled');
        form.appendChild(mirDt);
        const mirDd = document.createElement('dd');
        mirDd.className = 'color-row is-field-disabled';
        mirDd.dataset.fieldGroup = 'fill';
        mirDd.dataset.role = 'fill-mirror-dd';
        const mirWrap = document.createElement('div');
        mirWrap.className = 'd-select-wrap';
        const mirSel = document.createElement('select');
        mirSel.className = 'd-select';
        mirSel.dataset.role = 'fill-mirror';
        mirSel.disabled = true;
        const mirOpt = document.createElement('option');
        mirOpt.textContent = '—';
        mirSel.appendChild(mirOpt);
        mirWrap.appendChild(mirSel);
        mirDd.appendChild(mirWrap);
        form.appendChild(mirDd);
      }

      // アイコン型・画像アイコン型：W/H入力時に縦横比を維持して反対軸を自動更新
      // （applyLiveUpdateより先に登録して先行実行させる）。
      //
      // 大問/答/証明ボタンはペアリング対象に含めない。headerの「変形」欄からW・Hを独立に
      // 指定できることが仕様（2026-07-31_fix_header詳細パネル… の項目C）であり、ここで
      // ペアリングすると W欄を変えただけで H欄まで追従して縦横比が固定されてしまうため。
      // - 紙面上のリサイズハンドルによるドラッグは buttons.js の makeDaimonResizable() が
      //   別経路で扱うため、画像素材ありのボタンの縦横比ロックは従来どおり維持される（確認済み）
      // - サイズ変更を許可しないボタン（LIBRO由来・CSS固定サイズ）は「変形」欄自体を
      //   非活性にしているため、ペアリングの有無によらず影響を受けない（確認済み）
      const _selectedIconObj = document.querySelector('.ann-icon-obj.is-selected, .ann-image-obj.is-selected');
      if (_selectedIconObj) {
        // アイコン型（.ann-icon-obj）は常に 1:1。画像アイコン型（.ann-image-obj）は
        // パネルを開いた時点の矩形の縦横比を実測して維持する。
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

      // 選択中オブジェクトへの反映リスナーを登録
      // 入力中（1文字ごとの input）には反映せず、確定したときだけ反映する。
      // 1文字ごとに反映すると、途中の値（「600」を打つ途中の「6」など）でも部品が動き、
      // 取り消し履歴も1文字ごとに積まれて Ctrl+Z / Ctrl+Shift+Z が1文字単位になるため。
      // - 確定 = change（Enter で blur したとき・欄の外を押してフォーカスが外れたとき・Tab）
      // - スピンボタン = poscommit（makePosField が発火。押すたびに即時反映）
      ['annPosX', 'annPosY', 'annWidth', 'annHeight'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          // 最後に部品へ反映した値。スピン後にフォーカスを外したときの change など、
          // 値の変わらない確定で反映と取り消し履歴が二重にならないよう比較に使う。
          let lastApplied = el.value;
          // フォーカスの無い間はドラッグ等で表示値が書き換わる（setPosFieldValue）ため、
          // 入力を始める時点の表示値で取り直す
          el.addEventListener('focus', () => { lastApplied = el.value; });
          el.addEventListener('change', () => {
            if (el.value === lastApplied) return;
            lastApplied = el.value;
            applyLiveUpdate(type);
          });
          // スピンボタンは比較せず必ず反映する（フォーカスの無い欄では lastApplied が
          // 古い値のままのことがあり、比較すると反映漏れになる）
          el.addEventListener('poscommit', () => {
            applyLiveUpdate(type);
            lastApplied = el.value;
          });
          // 入力中はフォーカス中の欄への書き戻しを抑止している（setPosFieldValue）ため、
          // フォーカスが外れた時点で実際の配置（紙面外クランプ後の値）へ表示を揃える。
          el.addEventListener('blur', () => {
            const targets = getSelectedObjects();
            if (targets.length >= 2)      updateAlignPanel();
            else if (targets.length === 1) refreshPosFieldsLive(targets[0]);
          });
          // Enterで確定したらフォーカスを外す（blur の直前に change が発火して反映され、
          // 上の blur 処理で表示も実配置へ揃う）。
          // 編集ポップアップ内の欄は、Enterを「確定ボタンのクリック」として扱う
          // main.js の keydown に任せるため対象外とする。
          el.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            if (e.isComposing || e.keyCode === 229) return;
            if (el.closest('#quickCreatePopup')) return;
            e.preventDefault();
            el.blur();
          });
        }
      });
      const colElForLive = document.getElementById('annColor');
      if (colElForLive) {
        // 色欄からの呼び出しだけ色を塗り直す（位置・大きさの確定では塗り直さない）
        colElForLive.addEventListener('change', () => applyLiveUpdate(type, { colorChanged: true }));
        colElForLive.addEventListener('input', () => applyLiveUpdate(type, { colorChanged: true }));
      }
    }


    /**
     * 共通フィールド（位置・変形・塗り）の値を選択中オブジェクトに即時反映する。
     * 「この内容で設定する」ボタンを押さなくても変更がオブジェクトに適用される。
     * @param {string} type - アノテーション種別
     */
    /**
     * 色欄の値（'3'・'100' など）が、いまの環境設定で表す色の値（#rrggbb・小文字）を返す。
     * 登録されていないカスタムカラー・数値でない値は null（getStickyColor() は未登録のカスタムを
     * 紙色へ倒すが、色欄の名前の判定では「その色」とみなさないため）。
     * @param {string|undefined} value
     * @returns {string|null}
     */
    function stickyColorValueToHex(value) {
      if (!/^\d+$/.test(String(value ?? ''))) return null;
      const idx = parseInt(value, 10);
      if (isCustomStickyColorIndex(idx)) {
        const custom = state.settingsCustomStickyColors?.[idx - CUSTOM_STICKY_COLOR_BASE];
        return custom ? String(custom).toLowerCase() : null;
      }
      return STICKY_COLOR_MAP[idx] ? STICKY_COLOR_MAP[idx].toLowerCase() : null;
    }

    /**
     * 色の値（#rrggbb）と同じ色になる色欄の値を返す。どれとも同じでなければ null。
     * 記録された色欄の値（preferredValue）が同じ色ならそれを優先し、違えば
     * 「紙色 → カスタム1〜3 → 青・緑・黄」の順で同じ色の欄を探す
     * （libro-format.js の findStickyColorIndexByHex() と同じ順）。
     * @param {string|null} hex
     * @param {string|undefined} preferredValue
     * @returns {string|null}
     */
    function findStickyColorValueByHex(hex, preferredValue) {
      if (!hex) return null;
      const target = String(hex).toLowerCase();
      if (stickyColorValueToHex(preferredValue) === target) return String(parseInt(preferredValue, 10));
      const candidates = ['3'];
      for (let slot = 0; slot < CUSTOM_STICKY_COLOR_SLOTS; slot++) candidates.push(String(CUSTOM_STICKY_COLOR_BASE + slot));
      candidates.push('0', '1', '2');
      return candidates.find(v => stickyColorValueToHex(v) === target) ?? null;
    }

    /**
     * LIBRO由来の付箋（.libro-toggle）の元の色（重ね表示を外したときの閉じた画像の色。
     * #rrggbb・小文字）を返す。記録された色（stickyBaseColorHex）→ 閉じた画像から読んだ色 の順。
     * 分からなければ null（単色でない画像など）。
     * @param {HTMLElement} el - .sticky-note.libro-toggle
     * @returns {string|null}
     */
    function getLibroToggleOriginalHex(el) {
      const baseHex = el.dataset.stickyBaseColorHex;
      if (baseHex && /^#[0-9a-f]{6}$/i.test(baseHex)) return baseHex.toLowerCase();
      return readClosedImageSolidHex(el);
    }

    /**
     * LIBRO由来の付箋（.libro-toggle）の色を、色の重ね表示（stickyColorOverride）で変える。
     * 見た目は閉じた画像で決まるため、背景を塗っても画像に隠れて変わらない。
     * 選んだ色が元の色（getLibroToggleOriginalHex）と同じなら重ね表示を外し、
     * 元の閉じた画像をそのまま使う（書き出しでも画像を作り直さない）。
     * 「既存付箋カラー」（existing）は重ね表示を外して元の閉じた画像に戻す。
     * 「現在の色」（current）・空・数値でない値は、何もしない。
     * @param {HTMLElement} el - .sticky-note.libro-toggle
     * @param {string|undefined} colorValue - 色欄の値
     */
    function applyLibroToggleStickyColor(el, colorValue) {
      if (colorValue === 'existing') {
        delete el.dataset.stickyColorOverride;
        delete el.dataset.stickyColorOverrideHex;
        return;
      }
      if (colorValue === undefined || colorValue === '' || colorValue === 'current') return;
      const colorIdx = parseInt(colorValue, 10);
      if (!Number.isFinite(colorIdx)) return;
      const color = getStickyColor(colorIdx);
      const originalHex = getLibroToggleOriginalHex(el);
      if (originalHex && originalHex === String(color).toLowerCase()) {
        delete el.dataset.stickyColorOverride;
        delete el.dataset.stickyColorOverrideHex;
        return;
      }
      el.dataset.stickyColorOverride    = String(colorIdx);
      // 色の実体も併記する（カスタムカラーの定義が失われた環境でも色が確定するように）
      el.dataset.stickyColorOverrideHex = color;
      let overlay = el.querySelector('.libro-toggle-color-override');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'libro-toggle-color-override';
        el.appendChild(overlay);
      }
      overlay.style.background = color;
    }

    /**
     * @param {string} type - アノテーション種別
     * @param {{colorChanged?: boolean}} [opts] - colorChanged: 色欄が変わったときの呼び出しなら true。
     *   true のときだけ色を塗り直す。位置・大きさの確定で塗り直すと、色欄の番号（例：カスタム1）が
     *   その時点の環境設定の色を指すため、環境設定を後から変えた場合に色が黙って変わる。
     */
    export function applyLiveUpdate(type, { colorChanged = false } = {}) {

      const allTargets = getSelectedObjects();
      if (allTargets.length === 0) return;

      // Undo用: 変更前スナップショットを積む（初回または値が変わる直前のみ）
      if (!applyLiveUpdate._undoPushed) {
        // 単一選択時は1件、複数選択時は全件
        const snapshots = allTargets.map(target => {
          const snap = {
            el: target,
            prevStyleCssText: target.style.cssText,
            prevClassName: target.className,
            prevSavedData: target.dataset.savedData,
            prevInnerHTML: target.innerHTML
          };
          // LIBRO由来の付箋は色を重ね表示で変えるため、その値も取り消せるように控える
          if (target.dataset.libroToggle === '1') {
            snap.prevStickyColorOverride    = target.dataset.stickyColorOverride;
            snap.prevStickyColorOverrideHex = target.dataset.stickyColorOverrideHex;
          }
          return snap;
        });
        pushUndo({ type: 'prop', targets: snapshots });
        applyLiveUpdate._undoPushed = true;
      }


      // 入力欄の値はLIBRO実寸px表示のため、内部px（#pageLeftベースサイズ基準）に変換してから
      // 以降の適用ロジック（単一/複数選択の位置・サイズ計算）へ渡す。以降のロジックは無変更。
      const x = realToInternalPx(parseFloat(document.getElementById('annPosX')?.value)  ?? 0, 'x');
      const y = realToInternalPx(parseFloat(document.getElementById('annPosY')?.value)  ?? 0, 'y');
      const w = realToInternalPx(parseFloat(document.getElementById('annWidth')?.value)  || 0, 'x');
      const h = realToInternalPx(parseFloat(document.getElementById('annHeight')?.value) || 0, 'y');
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
          // ボタン系：位置に加えてサイズも変更する（背景はプリセット/画像素材で決まるため変更しない）。
          // W/H入力欄の縦横比ペアリング（buildCommonFields内）はボタン系には登録しないため、
          // W欄・H欄の入力値をそれぞれ独立にそのまま適用する（縦横比は維持しない）。
          // サイズ変更を許可しないボタンは「変形」欄自体が非活性だが、二重に守るため条件を付ける。
          if (isButtonResizable(target)) {
            const BTN_MIN = 14;
            if (w > 0) target.style.width  = Math.max(BTN_MIN, w) + 'px';
            if (h > 0) target.style.height = Math.max(BTN_MIN, h) + 'px';
          }
        } else if (type === 'sticky') {
          if (w > 0) target.style.width  = w + 'px';
          if (h > 0) target.style.height = h + 'px';
          const colorValue = document.getElementById('annColor')?.value;
          if (!colorChanged) {
            // 色欄以外の確定：色は変えない
          } else if (target.dataset.libroToggle === '1') {
            // LIBRO由来の付箋：背景は閉じた画像に隠れるため、色の重ね表示で変える
            applyLibroToggleStickyColor(target, colorValue);
          } else if (colorValue === 'existing') {
            // 「既存付箋カラー」：色欄を作った時点の色（buildCommonFields が色欄に控えたもの）へ戻す
            const colEl = document.getElementById('annColor');
            const existingHex = colEl?.dataset.existingHex;
            if (existingHex) {
              target.style.background = existingHex;
              let stickySd = {};
              try { stickySd = JSON.parse(target.dataset.savedData || '{}'); } catch (_) {}
              stickySd.annColor    = colEl.dataset.existingColorIndex ?? stickySd.annColor;
              stickySd.annColorHex = existingHex;
              target.dataset.savedData = JSON.stringify(stickySd);
            }
          } else {
            const color = getStickyColor(colorIdx);
            target.style.background = color;
            // 書き出しと色欄の再表示は savedData の色を使うため、背景と同じ値へ揃える
            if (colorValue !== undefined && colorValue !== '' && colorValue !== 'existing') {
              let stickySd = {};
              try { stickySd = JSON.parse(target.dataset.savedData || '{}'); } catch (_) {}
              stickySd.annColor    = String(colorIdx);
              stickySd.annColorHex = color;
              target.dataset.savedData = JSON.stringify(stickySd);
            }
          }
        } else if (target.classList.contains('ann-icon-obj')) {
          // アイコン型：常に 1:1（正方形）でサイズ変更し、背景グラデーション色も適用する。
          // W/H入力はペアリングで同値になるが、選択の切り替え直後など片方しか値がない場合にも
          // 正方形を崩さないよう、有効な方の値で両辺を揃える。
          const ICON_MIN = 14;
          const size = Math.max(ICON_MIN, w > 0 ? w : (h > 0 ? h : getIconDefaultSizePx()));
          target.style.width  = size + 'px';
          target.style.height = size + 'px';
          if (colorChanged) {
            target.style.background = ICON_COLOR_OPTIONS[colorIdx]?.value ?? ICON_COLOR_OPTIONS[0].value;
          }
        } else if (target.classList.contains('ann-image-obj')) {
          // 画像アイコン型：サイズのみ変更（背景色は適用しない、元画像をそのまま表示するため）
          if (w > 0) target.style.width  = w + 'px';
          if (h > 0) target.style.height = h + 'px';
        } else {
          const bgColor = ANN_COLOR_OPTIONS[colorIdx]?.value ?? ANN_COLOR_OPTIONS[0].value;
          if (w > 0) target.style.width  = w + 'px';
          if (h > 0) target.style.height = h + 'px';
          if (colorChanged) target.style.background = bgColor;
        }
      } else {
        // 複数選択：位置・サイズはデルタで全対象に適用し個々の状態を保持する。
        // 塗り色は「サイドパネルに色選択欄がある場合のみ」適用する。
        // refreshMultiSelectionPanel() は buildCommonFields(form, null, ...) で組み立てるため
        // 複数選択パネルには #annColor が生成されない。無条件に適用すると colorIdx が常に 0 となり、
        // 位置やサイズを1つ変えただけで選択中の全オブジェクトが既定色へ塗り替わってしまう。
        // #annColor は編集ポップアップ（#quickCreatePopup）にも同じidで生成されうるため、
        // 必ず #sideDetailActive を起点に取得する。
        const multiColorEl  = document.querySelector('#sideDetailActive #annColor');
        const multiColorIdx = parseInt(multiColorEl?.value || '0', 10);
        // 'existing'（LIBRO由来の「既存カラー」選択）は色を持たない指定のため、色の適用対象外とする
        const applyColor    = colorChanged && !!multiColorEl && multiColorEl.value !== 'existing';

        // デルタの基準は「現在の外接矩形（#selectionBoundingBox）」＝サイドパネルに表示中の値。
        // 以前は applyLiveUpdate._prevX 等のキャッシュを基準にしていたが、ドラッグ移動・リサイズ・
        // ズーム・Undo/Redo・紙面外クランプでは入力欄だけが更新されキャッシュは据え置かれるため、
        // 基準値と表示値がずれた状態で次の入力を受けると「Yだけ変えたのにXも動く」
        // 「一定以上値を変えられない」不具合になっていた。
        // 外接矩形から都度求めれば基準は常に実際の配置と一致し、ずれが蓄積しない。
        const selBox = document.getElementById('selectionBoundingBox');
        const curX = parseFloat(selBox?.style.left)   || 0;
        const curY = parseFloat(selBox?.style.top)    || 0;
        const curW = parseFloat(selBox?.style.width)  || 0;
        const curH = parseFloat(selBox?.style.height) || 0;
        // 入力欄の表示値は実寸pxで Math.round() 済みのため、差分も実寸pxで取ってから内部pxへ
        // 換算する（内部pxのまま引くと丸め誤差が毎回デルタとして残り、無操作の軸まで動く）。
        const rawX = parseFloat(document.getElementById('annPosX')?.value)   || 0;
        const rawY = parseFloat(document.getElementById('annPosY')?.value)   || 0;
        const rawW = parseFloat(document.getElementById('annWidth')?.value)  || 0;
        const rawH = parseFloat(document.getElementById('annHeight')?.value) || 0;
        // 外接矩形が未生成のとき（想定外）は動かさない
        const dx = selBox ? realToInternalPx(rawX - Math.round(internalToRealPx(curX, 'x')), 'x') : 0;
        const dy = selBox ? realToInternalPx(rawY - Math.round(internalToRealPx(curY, 'y')), 'y') : 0;
        const dw = selBox ? realToInternalPx(rawW - Math.round(internalToRealPx(curW, 'x')), 'x') : 0;
        const dh = selBox ? realToInternalPx(rawH - Math.round(internalToRealPx(curH, 'y')), 'y') : 0;

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
            // 付箋：サイズをデルタ分変更（最小10px）。塗り色は色選択欄がある場合のみ適用し、
            // 無い場合（複数選択パネル）は各付箋の元の色をそのまま維持する
            if (dw !== 0) target.style.width  = Math.max(10, (parseFloat(target.style.width)  || 0) + dw) + 'px';
            if (dh !== 0) target.style.height = Math.max(10, (parseFloat(target.style.height) || 0) + dh) + 'px';
            if (applyColor) {
              target.style.background = getStickyColor(multiColorIdx);
            }
          } else if (target.classList.contains('ann-icon-obj')) {
            // アイコン型：常に 1:1（正方形）を保ったままサイズをデルタ分変更する。
            // 背景色は色選択欄がある場合のみ適用（無い場合は元の色を維持）
            const ICON_MIN = 14;
            const curW = parseFloat(target.style.width)  || target.offsetWidth;
            const curH = parseFloat(target.style.height) || target.offsetHeight;
            if (dw !== 0 || dh !== 0) {
              const size = Math.max(ICON_MIN, dw !== 0 ? curW + dw : curH + dh);
              target.style.width  = size + 'px';
              target.style.height = size + 'px';
            }
            if (applyColor) {
              target.style.background = ICON_COLOR_OPTIONS[multiColorIdx]?.value ?? ICON_COLOR_OPTIONS[0].value;
            }
          } else if (target.classList.contains('ann-image-obj')) {
            // 画像アイコン型：サイズのみデルタ分変更（背景色は適用しない）
            if (dw !== 0) target.style.width  = Math.max(10, (parseFloat(target.style.width)  || 0) + dw) + 'px';
            if (dh !== 0) target.style.height = Math.max(10, (parseFloat(target.style.height) || 0) + dh) + 'px';
          } else {
            // マーカー型・紙面カラー型：サイズをデルタ分変更（最小10px）。
            // 塗り色は色選択欄がある場合のみ適用（無い場合は元の色・透明のまま維持）
            if (dw !== 0) target.style.width  = Math.max(10, (parseFloat(target.style.width)  || 0) + dw) + 'px';
            if (dh !== 0) target.style.height = Math.max(10, (parseFloat(target.style.height) || 0) + dh) + 'px';
            if (applyColor) {
              target.style.background = ANN_COLOR_OPTIONS[multiColorIdx]?.value ?? ANN_COLOR_OPTIONS[0].value;
            }
          }
        });

        // バウンディングボックスを再描画
        updateAlignPanel();
      }
      // 紙面外への配置を禁止：入力反映後に紙面内へ引き戻す
      if (allTargets.length === 1) {
        clampElementToPage(allTargets[0]);
        // 入力欄の値と実際の位置がずれないよう、クランプ後の値を書き戻す
        const clamped  = allTargets[0];
        const posXEl   = document.getElementById('annPosX');
        const posYEl   = document.getElementById('annPosY');
        setPosFieldValue(posXEl, Math.round(internalToRealPx(parseFloat(clamped.style.left) || 0, 'x')));
        setPosFieldValue(posYEl, Math.round(internalToRealPx(parseFloat(clamped.style.top)  || 0, 'y')));
        // 大問ボタングループの選択枠を数値入力にも追従させる
        // （updateAlignPanel() は sideDetailActive の dataset.mode を消す副作用があるため直接呼ぶ）
        updateDaimonGroupHighlight();
      } else {
        // 複数選択：個別にクランプすると相対位置が崩れるため、グループごと引き戻す
        clampGroupIntoPage(allTargets);
        updateAlignPanel();
      }
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
        // ただしCRAFT自身が書き出した付箋を再読込した場合（dataset.libroToggleCraft==='1'）は
        // 開閉方式欄自体は表示してよい（openEditPopupのisLibroToggleStickyと同じ判定基準）。
        if (existingEl?.dataset.libroToggle === '1' && existingEl.dataset.libroToggleCraft !== '1') {
          // 開閉方式の選択UIは出せないが、答ボタン紐付けで既定適用された annStickyOpenMode が
          // 編集確定（confirmAnnotation のフォーム総なめ）で脱落しないよう hidden で持ち回る
          // （btnLabel / btnPreset と同じパターン）。
          const hiddenOpenMode = document.createElement('input');
          hiddenOpenMode.type  = 'hidden';
          hiddenOpenMode.id    = 'annStickyOpenMode';
          hiddenOpenMode.value = savedData.annStickyOpenMode || '0';
          form.appendChild(hiddenOpenMode);
          return;
        }
        const openMode = savedData.annStickyOpenMode || '0';
        form.appendChild(_buildRadioDt('開閉方式'));
        form.appendChild(_buildRadioDD('annStickyOpenMode', 'annStickyOpenModeRadio', openMode, [
          { value: '0', label: '通常開閉' },
          { value: '1', label: '表示ボタン削除' },
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

        // プリセットスタイル：UI上は編集させないため hidden とする（btnLabelと同じパターン）。
        // 値（btnPreset）自体はrenderButtonVisual・LIBRO書き出しで引き続き使用するため保持する。
        const presetHidden = document.createElement('input');
        presetHidden.type  = 'hidden';
        presetHidden.id    = 'btnPreset';
        presetHidden.value = savedData.btnPreset !== undefined ? savedData.btnPreset : defaultPresetIdx;
        form.appendChild(presetHidden);

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
        <input type="hidden" id="annImageNaturalW" value="${escapeHtml(savedData.annImageNaturalW || '')}">
        <input type="hidden" id="annImageNaturalH" value="${escapeHtml(savedData.annImageNaturalH || '')}">
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
        // newW/newHは内部px。入力欄（annWidth/annHeight）は実寸px表示のため変換して書き込む。
        // state.pendingRectは内部px前提のためnewW/newHをそのまま設定する（無変更）。
        if (wEl) wEl.value = Math.round(internalToRealPx(newW, 'x'));
        if (hEl) hEl.value = Math.round(internalToRealPx(newH, 'y'));
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
      // 色欄からの呼び出しだけ色を塗り直す（位置・大きさの確定では塗り直さない）
      colSel.addEventListener('change', () => applyLiveUpdate(type, { colorChanged: true }));
      colSel.addEventListener('input',  () => applyLiveUpdate(type, { colorChanged: true }));

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
              value="${escapeHtml(savedData.annTarget || '')}" placeholder="0">
            <span style="font-size:12px; color:#555;">ページ目</span>
          </div>
          <p class="field-note">※目次を兼ねたページを指定してください。</p>`;
        form.appendChild(dd);

      } else if (type === 'plusfile') {
        // 表示方法は toAppendix("ディレクトリ名",表示モード) の第2引数として書き出される。
        // '0'＝ページ内（LIBRO+ではモーダル表示のためCRAFTプレビューでも移動不可）、
        // '1'＝別タブ、'2'＝フローティング（移動可）。
        // 表示順は音声・動画と揃え、入力対象（ディレクトリ名）→表示挙動（表示方法）とする。
        const showMode = savedData.annShowMode || '0';
        form.appendChild(_buildTextDt('ディレクトリ名'));
        form.appendChild(_buildTextDD('annFile', savedData.annFile || '', ''));
        form.appendChild(_buildRadioDt('表示方法'));
        form.appendChild(_buildRadioDD('annShowMode', 'annShowModeRadio', showMode, [
          { value: '0', label: 'ページ内' },
          { value: '1', label: '別タブ' },
          { value: '2', label: 'フローティング' },
        ]));

      } else if (type === 'externallink') {
        form.appendChild(_buildTextDt('リンク先URL'));
        form.appendChild(_buildTextDD('annUrl', savedData.annUrl || '', 'https://...'));

      } else if (type === 'audio') {
        const playMode = savedData.annPlayMode || '0';
        form.appendChild(_buildTextDt('ファイル名'));
        const fileDd = _buildTextDD('annFile', savedData.annFile || '', 'ファイル名を入力');
        fileDd.querySelector('input').insertAdjacentHTML('afterend',
          '<p class="field-note">※ファイル名の拡張子「.mp3」は除く</p>');
        // bookに同梱された音声を入力候補として提示する（自由入力も従来どおり可能）
        appendAudioFileDatalist(fileDd);
        _appendDropZone(fileDd, 'annFile', 'audio', existingEl);
        form.appendChild(fileDd);
        form.appendChild(_buildRadioDt('再生方法'));
        form.appendChild(_buildRadioDD('annPlayMode', 'annPlayModeRadio', playMode, [
          { value: '0', label: 'コントローラーあり' },
          { value: '1', label: 'コントローラーなし' },
        ]));

      } else if (type === 'video') {
        // 内部ファイル(annVideoSrc:'0')は2026-07-28にいったん再有効化したが、LIBRO+実機での
        // 動作が確認できておらず機能として死んでいるため、新規作成できないようUI選択肢を
        // 再度非表示にする(2026-08-04)。今後の再有効化に備えコード・データ構造は削除せず、
        // 「外部動画をタグで追加」と同じ非表示化パターンに揃える。既存の内部ファイル指定
        // アノテーションは引き続き編集・保存・削除できる（編集ブロックは行わない）。
        // 経緯: docs/plans/archive/2026-07-21_fix_動画内部ファイル機能の無効化.md
        //       docs/plans/archive/2026-07-28_feat_動画内部ファイル機能の再有効化.md
        //       docs/plans/2026-08-04_fix_動画内部ファイル設定の非表示化.md
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
        // 新規作成できる動画はJ-stream固定のため、ラジオ行自体は既存の内部ファイル・
        // 外部タグデータを編集する場合のみ表示する。ただしDOMからは外さず display:none で
        // 隠すだけにすること。srcDD内のhidden input（#annVideoSrc）がform配下に無いと、
        // confirmAnnotation のフォーム走査（input[id]を舐めてsavedDataを組み立てる処理）と
        // validateQuickPopupJstream の判定で annVideoSrc を拾えず、書き出し時に
        // アノテーションごとサイレントに消える（2026-07-23確認）。
        if (videoSrc !== '0' && videoSrc !== '1') srcDD.style.display = 'none';
        form.appendChild(srcDD);

        // --- 内部ファイル/外部タグ用フィールド(annVideoSrc: '0'/'1') ---
        // 内部ファイルは書き出し時に toMovieBNR("ファイル名",表示モード) へ変換され、動画本体は
        // video/in/<ファイル名>.mp4 としてzipへ格納される(libro-format.js)。非表示化済みのため、
        // このフィールド群は既存の内部ファイル指定アノテーションを編集する場合のみ表示される。
        const fileDt = _buildTextDt('ファイル名');
        const fileDd = _buildTextDD('annFile', savedData.annFile || '', 'ファイル名を入力');
        fileDd.querySelector('input').insertAdjacentHTML('afterend',
          '<p class="field-note">※ファイル名の拡張子「.mp4」は除く</p>' +
          '<p class="field-note">※LIBRO+上では常に別タブで再生されます（「表示方法」の選択はCRAFT内プレビューにのみ適用されます）</p>' +
          '<p class="field-note">※現在この方式は新規作成できません（既存設定の編集のみ可能）</p>');
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
          // ディレクトリ・企業IDは出版社ごとに固定値のため、新規作成時（existingElなし）のみ
          // 環境設定のデフォルト値をフォールバックにする。既存アノテーションの編集時は
          // 保存済みの値をそのまま表示し、環境設定値で上書きしない。
          // 難読化IDは動画ごとに異なるためデフォルト値の対象外（常に空フォールバック）。
          const jsDirFallback  = existingEl ? '' : (state.settingsJstreamDir || '');
          const jsCorpFallback = existingEl ? '' : (state.settingsJstreamCorpId || '');
          const jsDd = document.createElement('dd');
          const dirInput = document.createElement('input');
          dirInput.type = 'text';
          dirInput.className = 'd-input';
          dirInput.id = 'annJstreamDir';
          dirInput.value = savedData.annJstreamDir || jsDirFallback;
          dirInput.placeholder = 'Jストリームディレクトリ';
          const corpInput = document.createElement('input');
          corpInput.type = 'text';
          corpInput.className = 'd-input';
          corpInput.id = 'annJstreamCorpId';
          corpInput.value = savedData.annJstreamCorpId || jsCorpFallback;
          corpInput.placeholder = '企業ID';
          const vidInput = document.createElement('input');
          vidInput.type = 'text';
          vidInput.className = 'd-input';
          vidInput.id = 'annJstreamVideoId';
          vidInput.value = savedData.annJstreamVideoId || '';
          vidInput.placeholder = 'Jストリーム難読化ID';
          // 入力欄ごとの検証エラー表示欄。既定は非表示（.input-error）で、
          // validateQuickPopupJstream() が is-shown を付けたときだけ表示される。
          [[dirInput, 'annJstreamDirError'], [corpInput, 'annJstreamCorpIdError'], [vidInput, 'annJstreamVideoIdError']]
            .forEach(([inp, errId]) => {
              jsDd.appendChild(inp);
              const errP = document.createElement('p');
              errP.className = 'input-error';
              errP.id = errId;
              jsDd.appendChild(errP);
            });
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
      dd.innerHTML = `<div class="radio-row">${radiosHtml}</div><input type="hidden" id="${hiddenId}" value="${escapeHtml(currentVal)}">`;
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
     * 音声ファイル名の入力欄へ、bookに同梱された音声の候補リスト（<datalist>）を付ける。
     * 候補は mediaBlobs にキャッシュ済みの *.mp3 キーから作る。LIBRO book形式では
     * sounds/ 配下の全mp3が、独自ZIP形式ではzip内の全mp3がキャッシュ済みのため、
     * どちらの形式でも同じ抽出で候補を出せる。候補が0件のときは何も付けない。
     * 入力欄の id は同ダイアログ内で重複し得るため、getElementById ではなく
     * 渡された dd 要素からの相対参照で取得する。
     * @param {HTMLElement} dd - annFile入力欄を含む dd 要素
     */
    function appendAudioFileDatalist(dd) {
      const inp = dd.querySelector('input');
      if (!inp) return;
      const names = [...new Set(
        Object.keys(mediaBlobs)
          .filter(k => /\.mp3$/i.test(k))
          .map(k => k.replace(/\.mp3$/i, ''))
      )].sort();
      if (names.length === 0) return;
      const listId = 'annFileCandidates';
      // 前回ダイアログ分の datalist が残っていると候補が古いままになるため作り直す
      document.getElementById(listId)?.remove();
      const dl = document.createElement('datalist');
      dl.id = listId;
      names.forEach(n => {
        const opt = document.createElement('option');
        opt.value = n;
        dl.appendChild(opt);
      });
      dd.appendChild(dl);
      inp.setAttribute('list', listId);
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
        if (existingSrc) preview.innerHTML = `<img src="${escapeHtml(existingSrc)}" alt="">`;
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

          preview.innerHTML = `<img src="${escapeHtml(tempUrl)}" alt="">`;
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
     * header共通セクションに置いた「塗り」ミラー欄（data-role="fill-mirror"）を、
     * 種別設定セクションの実体（#dialogFormSpecific #annColor）と同期させる。
     *
     * - 実体が存在し、その dd が表示中（display:none でない）→ ミラーを活性化し、
     *   選択肢と現在値をコピーして双方向同期する
     * - 実体が無い／非表示（ボタン種別・表示タイプが「画像」「紙面カラー」・複数選択）
     *   → 選択肢を「—」に戻して非活性にする
     *
     * 表示タイプのラジオ変更で実体の表示/非表示が切り替わるため、ラジオのchangeでも呼び直す。
     * buildSpecificFields() 内で先に登録されているラジオリスナー（dd の display 切替）より
     * あとに登録するため、実行順は「display切替 → 本関数」になる（確認済み）。
     *
     * ミラー欄・実体はいずれも openAnnotationSettingsDialog() の innerHTML='' で毎回作り直される
     * ため、_fillMirrorBound フラグはパネル再構築のたびに自然にリセットされる（確認済み）。
     */
    function syncCommonFillMirror() {
      const commonForm = document.getElementById('dialogFormCommon');
      const mirSel = commonForm?.querySelector('[data-role="fill-mirror"]');
      if (!mirSel) return;
      const mirDt = commonForm.querySelector('[data-role="fill-mirror-dt"]');
      const mirDd = commonForm.querySelector('[data-role="fill-mirror-dd"]');
      const specificForm = document.getElementById('dialogFormSpecific');
      const realSel = specificForm?.querySelector('#annColor');
      const realDd  = realSel?.closest('dd');
      const usable  = !!realSel && realDd?.style.display !== 'none';

      const setDisabled = (flag) => {
        mirSel.disabled = flag;
        mirDt?.classList.toggle('is-field-disabled', flag);
        mirDd?.classList.toggle('is-field-disabled', flag);
      };

      if (!usable) {
        mirSel.innerHTML = '';
        const opt = document.createElement('option');
        opt.textContent = '—';
        mirSel.appendChild(opt);
        setDisabled(true);
        return;
      }

      // 選択肢は種別・表示タイプで構成が変わる（「既存ページリンクカラー」の有無など）ため、
      // 呼ばれるたびに実体から作り直す
      mirSel.innerHTML = '';
      Array.from(realSel.options).forEach(o => {
        const c = document.createElement('option');
        c.value = o.value;
        c.textContent = o.textContent;
        mirSel.appendChild(c);
      });
      mirSel.value = realSel.value;
      setDisabled(false);

      // 双方向同期。実体側のchangeには applyLiveUpdate(type) が既に紐づいているため、
      // ミラー側の変更は実体へ書き戻したうえで change を発火させて反映させる。
      if (!mirSel._fillMirrorBound) {
        mirSel._fillMirrorBound = true;
        mirSel.addEventListener('change', () => {
          const cur = document.getElementById('dialogFormSpecific')?.querySelector('#annColor');
          if (!cur) return;
          cur.value = mirSel.value;
          cur.dispatchEvent(new Event('change'));
        });
      }
      if (!realSel._fillMirrorBound) {
        realSel._fillMirrorBound = true;
        realSel.addEventListener('change', () => { mirSel.value = realSel.value; });
      }
    }

    /**
     * アノテーション設定ダイアログを開く。
     * 全種別共通：buildCommonFields / buildSpecificFields からフィールドを生成する。
     * @param {string} type
     * @param {HTMLElement|null} existingEl - 再設定対象要素（新規作成時は null）
     */
    export function openAnnotationSettingsDialog(type, existingEl = null) {
      state.lastDetailType = type;  // 最後に表示した種別を履歴保持
      // 複数選択モード（refreshMultiSelectionPanelが構築したフォーム）から抜けたことを示す。
      // これが無いと、複数選択→単一選択→再び複数選択と切り替えたとき、
      // refreshMultiSelectionPanelがフォーム骨格を作り直すべきタイミングを見誤る可能性がある。
      document.getElementById('sideDetailActive').dataset.mode = 'single';
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
        savedData.annPosX   = parseFloat(existingEl.style.left) || 0;
        savedData.annPosY   = parseFloat(existingEl.style.top)  || 0;
        if (existingEl.style.width)  savedData.annWidth  = parseFloat(existingEl.style.width)  || 100;
        if (existingEl.style.height) savedData.annHeight = parseFloat(existingEl.style.height) || 100;
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

      // 共通セクションの「塗り」ミラー欄を、種別設定側の実体（#annColor）と同期する（付箋以外）。
      // 種別設定セクションはheaderでは常に非表示のため、headerから塗り色を変更する唯一の入口が
      // このミラー欄になる。表示タイプの切替で実体の表示/非表示が変わるため、ラジオのchangeでも
      // 同期し直す（ラジオはこの specificForm 内のものだけに限定してスコープする）。
      syncCommonFillMirror();
      specificForm.querySelectorAll('input[name="annDisplayTypeRadio"]').forEach(radio => {
        radio.addEventListener('change', syncCommonFillMirror);
      });

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
      // annPosX/Y・annWidth/Heightは入力欄上ではLIBRO実寸px表示のため、以降の内部処理
      // （style.left/top・savedData保存はすべて内部px＝#pageLeftベースサイズ基準）に渡す前に
      // 実寸px→内部pxへ変換する。overrideSavedData経由（編集ポップアップの更新ボタン）・
      // 通常のdialogForm収集経由のどちらもこの1箇所で吸収できる（確認済み）。
      // これ以降（1600行目以降の各種別の分岐）は無変更。
      // 内部pxは丸めない（内部px 1px が実寸4〜5pxにあたり、丸めると確定のたびに大きさ・位置がずれる）
      if (savedData.annPosX   !== undefined) savedData.annPosX   = String(realToInternalPx(parseFloat(savedData.annPosX)   || 0, 'x'));
      if (savedData.annPosY   !== undefined) savedData.annPosY   = String(realToInternalPx(parseFloat(savedData.annPosY)   || 0, 'y'));
      if (savedData.annWidth  !== undefined) savedData.annWidth  = String(realToInternalPx(parseFloat(savedData.annWidth)  || 0, 'x'));
      if (savedData.annHeight !== undefined) savedData.annHeight = String(realToInternalPx(parseFloat(savedData.annHeight) || 0, 'y'));

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
        // LIBRO由来の付箋で「現在の色」（いまの重ね表示のまま）が選ばれている
        const keepsCurrentOverride = isLibroToggleNote && colorSelection === 'current';
        // 通常の付箋で「既存付箋カラー」が選ばれている：色はそのまま（要素の savedData の色）。
        // 詳細設定では applyLiveUpdate が色欄を選ぶたびに要素の savedData を合わせ、
        // 編集ポップアップは開いた時点の要素の savedData から色欄を作るため、
        // どちらの経路でも要素の savedData が「既存付箋カラー」の色になっている
        let keptStickySd = null;
        if (!isLibroToggleNote && isUpdate && colorSelection === 'existing') {
          keptStickySd = {};
          try { keptStickySd = JSON.parse(existingEl.dataset.savedData || '{}'); } catch (_) {}
          savedData.annColor = keptStickySd.annColor || '0';
        }
        // 新規作成時（isUpdate=false）のみ、フォールバック先を環境設定のデフォルト色にする
        const colorFallback = isUpdate ? '0' : (state.settingsStickyDefaultColor ?? '0');
        const colorIdx = parseInt(savedData.annColor || colorFallback, 10);
        const color    = keptStickySd
          ? getStickyColor(colorIdx, keptStickySd.annColorHex)
          : getStickyColor(colorIdx);
        // 色の実体を付箋自身へ併記する（カスタムカラーの定義が失われた環境でも色が確定するように）。
        // 「既存付箋カラー」「現在の色」（色を持たない指定）のときは付けない。
        if (!keepsOriginalImage && !keepsCurrentOverride) savedData.annColorHex = color;

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
            prevStickyColorOverrideHex: existingEl.dataset.stickyColorOverrideHex,
          });
          // 位置・サイズを反映
          if (savedData.annPosX !== undefined) existingEl.style.left = parseFloat(savedData.annPosX) + 'px';
          if (savedData.annPosY !== undefined) existingEl.style.top  = parseFloat(savedData.annPosY) + 'px';
          if (savedData.annWidth !== undefined)  existingEl.style.width  = parseFloat(savedData.annWidth) + 'px';
          if (savedData.annHeight !== undefined) existingEl.style.height = parseFloat(savedData.annHeight) + 'px';
          // 紙面外への配置を禁止：クランプ後の実位置を savedData にも反映してから保存する
          clampElementToPage(existingEl);
          savedData.annPosX = parseFloat(existingEl.style.left) || 0;
          savedData.annPosY = parseFloat(existingEl.style.top)  || 0;

          const openLocked = savedData.annStickyOpenMode === '1';
          // 答ボタン紐付き付箋（data-kotae-id あり）は紙色表示をCSS
          // （.sticky-note.libro-toggle[data-kotae-id] .libro-toggle-closed）が担うため、
          // ここでオーバーレイ（dataset.stickyColorOverride）を作らない。作ってしまうと
          // 答ボタン削除後も元の閉画像へ戻らなくなる。
          if (isLibroToggleNote && openLocked && !existingEl.dataset.kotaeId) {
            // 「表示ボタン削除」：.libro-toggle付箋は<img>が背景を覆うためbackground:#fff !important
            // が反映されない。色選択と同じオーバーレイ機構で白（STICKY_COLOR_MAP[3]）を強制表示する。
            existingEl.dataset.stickyColorOverride    = '3';
            existingEl.dataset.stickyColorOverrideHex = STICKY_COLOR_MAP[3];
            let overlay = existingEl.querySelector('.libro-toggle-color-override');
            if (!overlay) {
              overlay = document.createElement('div');
              overlay.className = 'libro-toggle-color-override';
              existingEl.appendChild(overlay);
            }
            overlay.style.background = STICKY_COLOR_MAP[3];
          } else if (isLibroToggleNote && keepsOriginalImage) {
            // 「既存付箋カラー」に戻した場合：色上書きを解除し、元の閉画像表示に戻す
            delete existingEl.dataset.stickyColorOverride;
            delete existingEl.dataset.stickyColorOverrideHex;
          } else if (isLibroToggleNote) {
            // 実際の色が選択された：閉のみ選択色のプレビューに差し替える（開・元datasetは無変更のまま維持）。
            // 書き出し時に記録された元の色と同じなら、重ね表示を外して元の閉じた画像に戻す
            applyLibroToggleStickyColor(existingEl, colorSelection);
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
          // 新規作成：連続作成用に設定を保存する。ただし「開閉方式」は付箋ごとに個別設定すべき
          // 項目のため引継ぎ対象から除外し、次回ポップアップは常に既定値（通常開閉）から始める。
          lastNewAnnData[type] = { ...savedData, annStickyOpenMode: '0' };
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
          // 紙面外への配置を禁止(クイック作成はクリック点が中央になるため端で半分はみ出しうる)
          clampElementToPage(note);
          pushUndo({ type: 'create', elements: [note] });
          trackEvent('annotation_create', {
            annotation_type: 'sticky',
            page_number: state.currentPage,
            color_index: String(colorIdx),
            open_mode: savedData.annStickyOpenMode ?? '0',
          });
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

        if (savedData.annPosX !== undefined) existingEl.style.left = parseFloat(savedData.annPosX) + 'px';
        if (savedData.annPosY !== undefined) existingEl.style.top  = parseFloat(savedData.annPosY) + 'px';
        // サイズ変更を許可したボタン（.is-sized かつLIBRO由来でない）のみW/Hを反映する。
        // savedData.annWidth/annHeight は 1805〜1808行目付近で実寸px→内部pxへ変換済みのため、
        // ここで再変換してはならない（確認済み）。
        if (isButtonResizable(existingEl)) {
          const btnW = parseFloat(savedData.annWidth)  || 0;
          const btnH = parseFloat(savedData.annHeight) || 0;
          if (btnW > 0) existingEl.style.width  = Math.max(14, btnW) + 'px';
          if (btnH > 0) existingEl.style.height = Math.max(14, btnH) + 'px';
        }
        // 紙面外への配置を禁止：クランプ後の実位置を savedData にも反映してから保存する
        clampElementToPage(existingEl);
        savedData.annPosX = parseFloat(existingEl.style.left) || 0;
        savedData.annPosY = parseFloat(existingEl.style.top)  || 0;
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
        // 画像差し替えで高さが変わると下端がはみ出しうるため、もう一度クランプする
        clampElementToPage(existingEl);
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
            // 1:1比率を強制する。W・Hが等しい値で届いたとき（編集ポップアップでサイズを変えた場合は
            // unifyIconSizeFields が両欄を揃えて渡す。何も変えていない場合も現在の大きさで等しい）は
            // その値を1辺にする。等しくないとき（非アイコン型から切り替えた場合など）は従来どおり
            // 現在の矩形の短辺に揃える。
            const iconDefault = getIconDefaultSizePx();
            const formW = parseFloat(savedData.annWidth);
            const formH = parseFloat(savedData.annHeight);
            // 実寸→内部pxの換算はX軸・Y軸で別々に行うため、同じ実寸値でも小数の誤差で
            // 完全には一致しないことがある。1px未満の差は「等しい」とみなす
            const iconSize = (formW > 0 && formH > 0 && Math.abs(formW - formH) < 1)
              ? Math.max(14, formW)
              : Math.min(existingEl.offsetWidth || iconDefault, existingEl.offsetHeight || iconDefault);
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
          // タイプ変更後にリサイズハンドルを再付与（icon ↔ marker 切り替え時にハンドルがなくなる問題を修正）。
          // LIBRO+製（libro-craft-metaなし＝他オーサリングツール由来）のknown系は、元画像の歪みを
          // 防ぐためリサイズ不可のまま維持する（dataset.libroLockedSize、reinitElementと同じ判定）。
          if (existingEl.dataset.libroLockedSize !== '1') {
            if (displayType === 'icon' || displayType === 'image') {
              makeResizable(existingEl, { lockAspectRatio: true, minSize: 14 });
            } else {
              makeResizable(existingEl);
            }
          }
          // 紙面外への配置を禁止。サイズ確定後にクランプし、実位置を savedData へ反映し直す
          clampElementToPage(existingEl);
          existingEl.dataset.savedData = JSON.stringify({
            ...savedData,
            annPosX: parseFloat(existingEl.style.left) || 0,
            annPosY: parseFloat(existingEl.style.top)  || 0,
          });
          updateStatus();
        } else {
          // 新規作成：連続作成用に設定を保存し、displayType に応じて要素を生成する。
          // 1件ごとに個別指定すべきフィールド（音声のファイル名・動画のJストリーム難読化ID等）は
          // buildLastNewAnnData() が引継ぎ対象から除外する。
          lastNewAnnData[type] = buildLastNewAnnData(type, savedData);
          const ann = document.createElement('div');
          ann.dataset.id        = ++state.annIdCounter;
          ann.dataset.type      = type;
          ann.dataset.savedData = JSON.stringify(savedData);

          if (displayType === 'icon') {
            // アイコン型：円形ボタン
            const iconBg = ICON_COLOR_OPTIONS[colorIdx]?.value ?? ICON_COLOR_OPTIONS[0].value;
            ann.className = 'ann-icon-obj';
            // 種別によらず同一の既定サイズ・1:1で作成する
            // （getIconDefaultSizePx() を唯一の基準にする。ドラッグで描いた矩形の寸法は使わない）。
            // 作成ポップアップでW・Hを変えた場合だけ、confirmQuickCreate が渡す1辺（iconSize）を使う
            const iconSize = state.pendingRect?.iconSize ?? getIconDefaultSizePx();
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
          // 紙面外への配置を禁止(クイック作成の中央寄せ・アイコン型の既定サイズ置換ではみ出しうる)
          clampElementToPage(ann);
          pushUndo({ type: 'create', elements: [ann] });
          trackEvent('annotation_create', {
            annotation_type: type,
            page_number: state.currentPage,
            display_type: displayType,
            color_index: savedData.annColor ?? '',
            show_mode: savedData.annShowMode ?? '',
            play_mode: savedData.annPlayMode ?? '',
            video_source: savedData.annVideoSrc ?? '',
          });
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
