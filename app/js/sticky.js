import { openAnnotationSettingsDialog, openEditPopup } from './annotation-dialog.js';
import { syncKotaeButtonPressedByStickies } from './buttons.js';
import { STICKY_COLOR_MAP } from './config.js';
import { makeDraggable, makeResizable } from './annotation-interaction.js';
import { selectedStickySet, state, undoStack } from './state.js';
import { closeDialog, saveDialog } from './storage.js';
import { showToast, updateStatus } from './ui-common.js';
import { pushUndo, redo } from './undo-redo.js';


    /**
     * 閲覧モードに切り替える。
     * - オーサリングパネル・付箋パーツ操作を非表示
     * - ボタンは実際の挙動を行う
     */
    /* ============================
       アコーディオン開閉
    ============================ */


    /**
     * 選択中の複数付箋に対して、詳細ダイアログから一括で設定を変更する。
     * 背景色・フォント・内容を一括適用する（内容が空欄の場合は各付箋の既存テキストを維持）。
     * 付箋が1件も選択されていない場合はステータスバーにメッセージを表示する。
     */
    export function openBulkStickyDialog() {
      if (selectedStickySet.size === 0) {
        updateStatus();
        return;
      }

      // ダイアログタイトルに件数を表示
      document.getElementById('dialogTitle').textContent = `付箋一括設定（${selectedStickySet.size}件）`;
      const form = document.getElementById('dialogForm');
      form.innerHTML = '';

      // 対象フィールド定義（位置情報は付箋ごとに異なるため除外）
      const bulkFields = [
        { label: '背景色',                         type: 'select',   id: 'bulkAnnColor', options: ['黄（標準）', '橙', '緑', '青', 'ピンク'] },
        { label: 'フォント',                       type: 'select',   id: 'bulkAnnFont',  options: ['標準', '大', '小'] },
      ];

      // フィールド要素を生成してフォームに追加
      bulkFields.forEach(field => {
        const dt = document.createElement('dt');
        dt.textContent = field.label;
        const dd = document.createElement('dd');
        if (field.type === 'textarea') {
          const ta = document.createElement('textarea');
          ta.className = 'd-input'; ta.id = field.id;
          ta.placeholder = field.placeholder || '';
          ta.style.cssText = 'height:72px; resize:vertical;';
          dd.appendChild(ta);
        } else if (field.type === 'select') {
          const sw = document.createElement('div');
          sw.className = 'd-select-wrap';
          const sel = document.createElement('select');
          sel.className = 'd-select'; sel.id = field.id;
          (field.options || []).forEach((opt, i) => {
            const o = document.createElement('option');
            o.value = i; o.textContent = opt;
            sel.appendChild(o);
          });
          sw.appendChild(sel); dd.appendChild(sw);
        }
        form.appendChild(dt);
        form.appendChild(dd);
      });

      // 削除ボタン：常に非表示（削除はDeleteキーで行う）
      const dialogDeleteBtn = document.querySelector('.dialog-btn.delete-btn');
      dialogDeleteBtn.style.display = 'none';
      dialogDeleteBtn.onclick = () => {
        const count = selectedStickySet.size;
        selectedStickySet.forEach(note => note.remove());
        selectedStickySet.clear();
        closeDialog();
        document.querySelector('.dialog-btn.ok').onclick = saveDialog;
        updateStatus();
      };

      // キャンセルボタン
      document.querySelector('.dialog-btn.cancel').onclick = () => {
        closeDialog();
        document.querySelector('.dialog-btn.ok').onclick = saveDialog;
        updateStatus();
      };

      // 保存：選択中の全付箋に設定を一括適用
      document.querySelector('.dialog-btn.ok').onclick = () => {
        const colorIdx = parseInt(document.getElementById('bulkAnnColor')?.value ?? '0', 10);
        const fontVal  = document.getElementById('bulkAnnFont')?.value ?? '0';
        const color    = STICKY_COLOR_MAP[colorIdx] ?? STICKY_COLOR_MAP[0];

        selectedStickySet.forEach(note => {
          // LIBRO由来の既存付箋（.libro-toggle）は元画像をそのまま使うため色変更対象外
          if (note.dataset.libroToggle === '1') return;
          // 背景色を適用
          note.style.background = color;
          // savedData を取得・更新して再保存
          let saved = {};
          try { saved = JSON.parse(note.dataset.savedData || '{}'); } catch (_) {}
          saved.annColor = String(colorIdx);
          saved.annFont  = fontVal;
          note.dataset.savedData = JSON.stringify(saved);
        });

        const count = selectedStickySet.size;
        closeDialog();
        document.querySelector('.dialog-btn.ok').onclick = saveDialog;
        updateStatus();
      };

      document.getElementById('sideDetailEmpty').style.visibility = 'hidden';
      document.getElementById('sideDetailActive').style.display = '';
    }


    /**
     * 「付箋を隠す」ボタンの処理。
     * 選択中の付箋を紙色（白一色）に変更する。
     * 閲覧モードでは通常付箋と同様にクリックで開閉（トグル）する。
     * 編集モード中のみ実行可能。
     */
    export function onMisetteiBtnClick() {
      if (document.body.classList.contains('is-view-mode')) return;
      if (selectedStickySet.size === 0) {
        showToast('付箋を選択してください。');
        return;
      }
      // LIBRO由来のトグル付箋（.libro-toggle）は、見た目を子要素の閉/開2枚のPNGで表す
      // 画像表示モデルであり style.background を持たない。白背景＋fuhyojiフラグを与えると
      // 表示モデルとの整合が崩れるため対象から除外する（openBulkStickyDialog と同じ扱い）。
      const targets = [...selectedStickySet].filter(note => !note.classList.contains('libro-toggle'));
      if (targets.length === 0) {
        showToast('LIBRO由来の付箋は「付箋を隠す」の対象外です。');
        return;
      }
      // Undo用: 操作前の背景色・fuhyoji属性・クラス名を記録
      const prevStates = [];
      targets.forEach(note => {
        prevStates.push({
          el: note,
          prevBackground: note.style.background,
          prevFuhyoji: note.dataset.fuhyoji,
          prevClassName: note.className
        });
      });
      // 選択中の付箋の背景色を白一色に変更し、専用フラグを付与する
      targets.forEach(note => {
        note.style.background = '#ffffff';
        note.dataset.fuhyoji = '1'; // 「付箋を隠す」ボタンで設定された付箋と識別するフラグ
      });
      // Undoスタックに積む
      pushUndo({ type: 'sticky-hide', targets: prevStates });
      updateStatus();
    }


    // Undo/Redo用: 付箋非表示（白色化）操作の取り消し・やり直し
    // @param {Array} targets - {el, prevBackground, prevFuhyoji, prevClassName}
    // @param {boolean} redo - trueでやり直し、falseで取り消し
    export function applyStickyHideUndo(targets, redo) {
      targets.forEach(({ el, prevBackground, prevFuhyoji, prevClassName }) => {
        if (!el) return;
        if (redo) {
          el.style.background = '#ffffff';
          el.dataset.fuhyoji = '1';
        } else {
          el.style.background = prevBackground || '';
          if (prevFuhyoji === undefined) {
            delete el.dataset.fuhyoji;
          } else {
            el.dataset.fuhyoji = prevFuhyoji;
          }
          // クラス名を元に戻す
          if (prevClassName) {
            el.className = prevClassName;
          }
        }
      });
    }


    /**
     * 付箋の開閉方式（savedData.annStickyOpenMode）を設定し、見た目・書き出し判定に使う
     * .sticky-open-locked クラスへ反映する。
     * 答ボタン紐付け時の既定適用・紐付け解除時の復帰・そのUndo/Redoで同じ処理を使うため関数化している。
     * @param {HTMLElement} el   - 対象の .sticky-note 要素
     * @param {string}      mode - '1'＝表示ボタン削除 / それ以外＝通常開閉
     */
    export function applyStickyOpenMode(el, mode) {
      if (!el) return;
      const value = mode === '1' ? '1' : '0';
      let sd = {};
      try { sd = JSON.parse(el.dataset.savedData || '{}'); } catch (_) {}
      sd.annStickyOpenMode = value;
      el.dataset.savedData = JSON.stringify(sd);
      el.classList.toggle('sticky-open-locked', value === '1');
    }


    export function toggleStickyGroup() {
      if (selectedStickySet.size === 0) {
        showToast('付箋を選択してください。');
        return;
      }
      // グループ化/解除前のスナップショットを Undo スタックに積む
      const beforeGroup = [...selectedStickySet].map(n => ({ el: n, prevGroupId: n.dataset.groupId }));
      pushUndo({ type: 'group', targets: beforeGroup });

      // 全選択付箋がグループ化済みかを判定
      const allGrouped = [...selectedStickySet].every(n => n.dataset.groupId);
      if (allGrouped) {
        // 全員グループ済み → 解除
        selectedStickySet.forEach(note => { delete note.dataset.groupId; });
        updateStatus();
      } else {
        // 未グループのものがある → グループ化
        if (selectedStickySet.size < 2) {
          undoStack.pop(); // pushUndo を取り消す（グループ化失敗のため）
          showToast('2つ以上の付箋を選択してグループ化してください。');
          return;
        }
        const gid = `grp-${++state.stickyGroupCounter}`;
        selectedStickySet.forEach(note => { note.dataset.groupId = gid; });
        updateStatus();
      }
    }


    /**
     * 要素をドラッグ可能にする。
     * @param {HTMLElement} el
     * @param {string} excludeSelector - ドラッグを除外する子要素セレクタ
     */
    /**
     * 付箋要素にクリックハンドラを設定する。
     * コピー（Alt+ドラッグ）時のクローン再初期化でも使用する。
     * @param {HTMLElement} note - 付箋要素
     */
    export function addStickyClickHandler(note) {
      // 多重リスナー登録の防止。理由は buttons.js の addDaimonClickHandler と同じ。
      // reinitElement() は Undo/Redo の 'prop' 系復元で既存要素にも呼ばれるため、
      // 解除しないとクリックの開閉トグルが2回走って自己相殺する。
      if (note._stickyDblclickHandler) note.removeEventListener('dblclick', note._stickyDblclickHandler);
      if (note._stickyClickHandler)    note.removeEventListener('click',    note._stickyClickHandler);

      // ダブルクリック：編集モード時に編集ポップアップを開く
      note._stickyDblclickHandler = (e) => {
        if (document.body.classList.contains('is-view-mode')) return;
        e.preventDefault();
        e.stopPropagation();
        openEditPopup(note);
      };
      note.addEventListener('dblclick', note._stickyDblclickHandler);

      note._stickyClickHandler = (e) => {
        // 複数選択のドラッグ移動直後に発火したclickは選択操作として扱わない
        // （選択を1件へ畳まず、複数選択を維持する。state.suppressObjectClickの説明を参照）
        if (state.suppressObjectClick) { state.suppressObjectClick = false; return; }
        // 編集モード時
        if (!document.body.classList.contains('is-view-mode')) {
          if (e.shiftKey) {
            if (selectedStickySet.has(note)) {
              selectedStickySet.delete(note);
              note.classList.remove('is-selected');
              if (selectedStickySet.size === 0) closeDialog();
            } else {
              selectedStickySet.add(note);
              note.classList.add('is-selected');
              openAnnotationSettingsDialog('sticky', note);
            }
            updateStatus();
          } else {
            const multiCount = selectedStickySet.size
              + document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').length;
            if (multiCount > 1 && selectedStickySet.has(note)) {
              // 複数選択中に選択済み付箋をクリック：他の選択を解除してこの付箋のみ選択
              selectedStickySet.forEach(n => n.classList.remove('is-selected'));
              selectedStickySet.clear();
              document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').forEach(a => a.classList.remove('is-selected'));
              selectedStickySet.add(note);
              note.classList.add('is-selected');
              openAnnotationSettingsDialog('sticky', note);
              updateStatus();
            } else {
              // 未選択オブジェクトクリック：全解除してこの付箋のみ選択
              selectedStickySet.forEach(n => n.classList.remove('is-selected'));
              selectedStickySet.clear();
              document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').forEach(a => a.classList.remove('is-selected'));
              selectedStickySet.add(note);
              note.classList.add('is-selected');
              openAnnotationSettingsDialog('sticky', note);
              updateStatus();
            }
          }
          return;
        }
        // 閲覧モード時
        // 証明ボタン管理の付箋：直接クリックで白表示⇔赤枠線のみをトグル
        if (note.dataset.shomeiId) {
          if (note.dataset.shomeiOutline === '1') {
            // 赤枠線状態 → 白で表示
            note.style.background = '#ffffff';
            note.style.outline = '';
            delete note.dataset.shomeiOutline;
            updateStatus();
          } else {
            // 白表示中 → 赤枠線のみ表示
            note.style.background = 'transparent';
            note.style.outline = '2px solid rgb(255,0,0)';
            note.dataset.shomeiOutline = '1';
            updateStatus();
          }
          return;
        }

        // 付箋の開閉トグル（「付箋を隠す」設定済みの白付箋も通常付箋と同じ挙動）
        const isVisible = note.classList.contains('state-visible');
        const gid = note.dataset.groupId;
        const targets = gid
          ? Array.from(document.querySelectorAll(`.sticky-note[data-group-id="${gid}"]`))
          : [note];
        targets.forEach(t => {
          t.classList.toggle('state-visible', !isVisible);
          t.classList.toggle('state-hidden',   isVisible);
        });
        // 付箋側で閉じた（開いた）場合も、紐付く答ボタンの押下見た目を実態へ追従させる。
        // 配下が全て閉になれば答ボタンは通常（初期）見た目へ戻る。
        syncKotaeButtonPressedByStickies(targets);
        updateStatus();
      };
      note.addEventListener('click', note._stickyClickHandler);
    }
