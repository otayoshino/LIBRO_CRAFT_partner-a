import { openAnnotationSettingsDialog, openEditPopup } from './annotation-dialog.js';
import { STICKY_COLOR_MAP } from './config.js';
import { makeDraggable, makeResizable } from './annotation-interaction.js';
import { selectedStickySet, state, undoStack } from './state.js';
import { closeDialog, saveDialog } from './storage.js';
import { showToast, updateStatus } from './ui-common.js';
import { pushUndo, redo } from './undo-redo.js';


    /**
     * 選択中の付箋をコピーしてページに貼り付ける。
     * 未選択の場合は画面中央に警告メッセージを表示する。
     */
    export function copySelectedSticky() {
      if (selectedStickySet.size === 0) {
        showToast('まず先に付箋を選択してください。');
        return;
      }
      const page = document.getElementById('pageLeft');
      const OFFSET = 16; // コピー先のオフセット（px）
      const copies = [];

      selectedStickySet.forEach(note => {
        const clone = document.createElement('div');
        clone.className = 'sticky-note state-visible';
        clone.dataset.id   = ++state.annIdCounter;
        clone.dataset.type = 'sticky';
        clone.dataset.savedData = note.dataset.savedData || '{}';
        if (note.dataset.groupId) clone.dataset.groupId = note.dataset.groupId;

        const origLeft = parseInt(note.style.left, 10) || 0;
        const origTop  = parseInt(note.style.top,  10) || 0;
        clone.style.cssText = [
          `left:${origLeft + OFFSET}px`,
          `top:${origTop  + OFFSET}px`,
          `width:${note.style.width}`,
          `height:${note.style.height}`,
          `background:${note.style.background}`,
        ].join('; ') + ';';

        // クリックイベント：元の付箋と同じロジックを再利用
        clone.addEventListener('click', (e) => {
          if (!document.body.classList.contains('is-view-mode')) {
            if (e.shiftKey) {
              if (selectedStickySet.has(clone)) {
                selectedStickySet.delete(clone);
                clone.classList.remove('is-selected');
                if (selectedStickySet.size === 0) closeDialog();
              } else {
                selectedStickySet.add(clone);
                clone.classList.add('is-selected');
                openAnnotationSettingsDialog('sticky', clone);
              }
              updateStatus(`付箋を ${selectedStickySet.size} 件選択中`);
            } else {
              if (!selectedStickySet.has(clone)) {
                selectedStickySet.forEach(n => n.classList.remove('is-selected'));
                selectedStickySet.clear();
                selectedStickySet.add(clone);
                clone.classList.add('is-selected');
                openAnnotationSettingsDialog('sticky', clone);
                updateStatus('付箋を選択中');
              }
            }
            return;
          }
          // 閲覧モード時
          const isFuhyoji = clone.dataset.fuhyoji === '1';
          if (isFuhyoji) {
            if (clone.classList.contains('state-visible')) return;
            const gid = clone.dataset.groupId;
            const targets = gid
              ? Array.from(document.querySelectorAll(`.sticky-note[data-group-id="${gid}"]`))
              : [clone];
            targets.forEach(t => {
              if (!t.classList.contains('state-hidden')) return;
              t.classList.remove('state-hidden');
              t.classList.add('state-visible');
            });
            updateStatus('解答を表示しました');
          } else {
            const isVisible = clone.classList.contains('state-visible');
            const gid = clone.dataset.groupId;
            const targets = gid
              ? Array.from(document.querySelectorAll(`.sticky-note[data-group-id="${gid}"]`))
              : [clone];
            targets.forEach(t => {
              t.classList.toggle('state-visible', !isVisible);
              t.classList.toggle('state-hidden',   isVisible);
            });
            updateStatus(isVisible ? '解答を隠しました' : '解答を表示しました');
          }
        });

        makeDraggable(clone);
        makeResizable(clone);
        page.appendChild(clone);
        copies.push(clone);
      });

      // コピー元の選択を解除し、コピーした要素を選択状態に
      selectedStickySet.forEach(n => n.classList.remove('is-selected'));
      selectedStickySet.clear();
      copies.forEach(c => { selectedStickySet.add(c); c.classList.add('is-selected'); });

      updateStatus(`付箋を ${copies.length} 件コピーしました`);
    }

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
        updateStatus('付箋を選択してください（Shift+クリックで複数選択）');
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
        updateStatus(`付箋 ${count} 件を削除しました`);
      };

      // キャンセルボタン
      document.querySelector('.dialog-btn.cancel').onclick = () => {
        closeDialog();
        document.querySelector('.dialog-btn.ok').onclick = saveDialog;
        updateStatus('キャンセルしました');
      };

      // 保存：選択中の全付箋に設定を一括適用
      document.querySelector('.dialog-btn.ok').onclick = () => {
        const colorIdx = parseInt(document.getElementById('bulkAnnColor')?.value ?? '0', 10);
        const fontVal  = document.getElementById('bulkAnnFont')?.value ?? '0';
        const color    = STICKY_COLOR_MAP[colorIdx] ?? STICKY_COLOR_MAP[0];

        selectedStickySet.forEach(note => {
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
        updateStatus(`付箋 ${count} 件を一括更新しました`);
      };

      document.getElementById('sideDetailEmpty').style.visibility = 'hidden';
      document.getElementById('sideDetailActive').style.display = '';
    }


    /**
     * 選択中の付箋をグループ化する。
     * グループ化された付箋は閲覧モードでクリックすると、同じグループの付箋が同時に表示/非表示される。
     * 2件未満の選択ではトーストメッセージを表示する。
     */
    export function groupStickyNotes() {
      if (selectedStickySet.size < 2) {
        showToast('2つ以上の付箋を選択してグループ化してください。');
        return;
      }
      const gid = `grp-${++state.stickyGroupCounter}`;
      selectedStickySet.forEach(note => {
        note.dataset.groupId = gid;
      });
      updateStatus(`${selectedStickySet.size} 件の付箋をグループ化しました（${gid}）`);
    }


    /**
     * 選択中の付箋のグループを解除する。
     * 選択中の付箋から data-group-id を削除する。
     * グループ化されていない付箋が選択されている場合はトーストを表示する。
     */
    export function ungroupStickyNotes() {
      if (selectedStickySet.size === 0) {
        showToast('グループ解除する付箋を選択してください。');
        return;
      }
      let count = 0;
      selectedStickySet.forEach(note => {
        if (note.dataset.groupId) {
          delete note.dataset.groupId;
          count++;
        }
      });
      if (count === 0) {
        showToast('選択中の付箋はグループ化されていません。');
      } else {
        updateStatus(`${count} 件の付箋のグループを解除しました`);
      }
    }


    /**
     * 付箋非表示ボタンの処理。
     * 選択中の付箋を白一色に変更し、閲覧モードでは
     * 非表示状態の付箋を押下で表示するよう設定する。
     * 編集モード中のみ実行可能。
     */
    export function onMisetteiBtnClick() {
      if (document.body.classList.contains('is-view-mode')) return;
      if (selectedStickySet.size === 0) {
        showToast('付箋を選択してください。');
        return;
      }
      // Undo用: 操作前の背景色・fuhyoji属性・クラス名を記録
      const prevStates = [];
      selectedStickySet.forEach(note => {
        prevStates.push({
          el: note,
          prevBackground: note.style.background,
          prevFuhyoji: note.dataset.fuhyoji,
          prevClassName: note.className
        });
      });
      // 選択中の付箋の背景色を白一色に変更し、専用フラグを付与する
      selectedStickySet.forEach(note => {
        note.style.background = '#ffffff';
        note.dataset.fuhyoji = '1'; // 「付箋非表示」ボタンで設定された付箋と識別するフラグ
        // 非表示状態にする（閲覧モードでクリック時のみ表示）
        note.classList.remove('state-visible');
        note.classList.add('state-hidden');
      });
      // Undoスタックに積む
      pushUndo({ type: 'sticky-hide', targets: prevStates });
      updateStatus(`${selectedStickySet.size} 件の付箋を白色に変更しました`);
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
          el.classList.remove('state-visible');
          el.classList.add('state-hidden');
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
        updateStatus(`${selectedStickySet.size} 件の付箋のグループを解除しました`);
      } else {
        // 未グループのものがある → グループ化
        if (selectedStickySet.size < 2) {
          undoStack.pop(); // pushUndo を取り消す（グループ化失敗のため）
          showToast('2つ以上の付箋を選択してグループ化してください。');
          return;
        }
        const gid = `grp-${++state.stickyGroupCounter}`;
        selectedStickySet.forEach(note => { note.dataset.groupId = gid; });
        updateStatus(`${selectedStickySet.size} 件の付箋をグループ化しました（${gid}）`);
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
            // ダブルクリック：編集モード時に編集ポップアップを開く
            note.addEventListener('dblclick', (e) => {
              if (document.body.classList.contains('is-view-mode')) return;
              e.preventDefault();
              e.stopPropagation();
              openEditPopup(note);
            });
      note.addEventListener('click', (e) => {
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
            updateStatus(`付箋を ${selectedStickySet.size} 件選択中`);
          } else {
            const multiCount = selectedStickySet.size
              + document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').length;
            if (multiCount > 1 && selectedStickySet.has(note)) {
              // 複数選択中に選択済み付箋をクリック：他の選択を解除してこの付箋のみ選択
              selectedStickySet.forEach(n => n.classList.remove('is-selected'));
              selectedStickySet.clear();
              document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').forEach(a => a.classList.remove('is-selected'));
              selectedStickySet.add(note);
              note.classList.add('is-selected');
              openAnnotationSettingsDialog('sticky', note);
              updateStatus('付箋を選択中');
            } else {
              // 未選択オブジェクトクリック：全解除してこの付箋のみ選択
              selectedStickySet.forEach(n => n.classList.remove('is-selected'));
              selectedStickySet.clear();
              document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').forEach(a => a.classList.remove('is-selected'));
              selectedStickySet.add(note);
              note.classList.add('is-selected');
              openAnnotationSettingsDialog('sticky', note);
              updateStatus('付箋を選択中');
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
            updateStatus('証明を表示しました');
          } else {
            // 白表示中 → 赤枠線のみ表示
            note.style.background = 'transparent';
            note.style.outline = '2px solid rgb(255,0,0)';
            note.dataset.shomeiOutline = '1';
            updateStatus('証明を非表示にしました');
          }
          return;
        }

        const isFuhyoji = note.dataset.fuhyoji === '1';
        if (isFuhyoji) {
          // 「付箋非表示」設定済み：表示状態のときは反応しない。非表示のときのみ表示する。
          if (note.classList.contains('state-visible')) return;
          const gid = note.dataset.groupId;
          const targets = gid
            ? Array.from(document.querySelectorAll(`.sticky-note[data-group-id="${gid}"]`))
            : [note];
          targets.forEach(t => {
            if (!t.classList.contains('state-hidden')) return;
            t.classList.remove('state-hidden');
            t.classList.add('state-visible');
          });
          updateStatus('解答を表示しました');
        } else {
          // 通常付箋：トグル（即時）
          const isVisible = note.classList.contains('state-visible');
          const gid = note.dataset.groupId;
          const targets = gid
            ? Array.from(document.querySelectorAll(`.sticky-note[data-group-id="${gid}"]`))
            : [note];
          targets.forEach(t => {
            t.classList.toggle('state-visible', !isVisible);
            t.classList.toggle('state-hidden',   isVisible);
          });
          updateStatus(isVisible ? '解答を隠しました' : '解答を表示しました');
        }
      });
    }
