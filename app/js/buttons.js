import { makeDraggable } from './annotation-interaction.js';
import { selectedStickySet, state } from './state.js';
import { showToast, updateStatus } from './ui-common.js';
import { pushUndo } from './undo-redo.js';


    /**
     * 選択中の付箋を一括表示/非表示できる大問ボタンをページ上に作成する。
     * 2件以上の付箋が選択されている必要がある。
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
      el.textContent      = '大問';
      el.style.left       = minLeft + 'px';
      el.style.top        = Math.max(0, minTop - 36) + 'px';

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
      updateStatus(`大問ボタンを作成しました（${total}件のオブジェクトに紐付け）`);
    }


    /**
     * 大問ボタンにクリックハンドラを設定する。
     * 編集モード：選択/解除。閲覧モード：紐付き付箋を一括表示/非表示。
     * @param {HTMLElement} btn - 大問ボタン要素
     */
    export function addDaimonClickHandler(btn) {
      btn.addEventListener('click', (e) => {
        if (!document.body.classList.contains('is-view-mode')) {
          // 編集モード：選択処理
          if (e.shiftKey) {
            btn.classList.toggle('is-selected');
          } else {
            // 他の選択をすべて解除してこのボタンのみ選択
            selectedStickySet.forEach(n => n.classList.remove('is-selected'));
            selectedStickySet.clear();
            document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected')
              .forEach(a => a.classList.remove('is-selected'));
            btn.classList.add('is-selected');
          }
          const count = document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').length
                      + selectedStickySet.size;
          updateStatus(count > 1 ? `${count} 件のオブジェクトを選択中` : '大問ボタンを選択中');
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
        updateStatus(allVisible ? '非表示にしました' : '表示しました');
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
      el.textContent      = '答';
      el.style.left       = minLeft + 'px';
      el.style.top        = Math.max(0, minTop - 36) + 'px';

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

      updateStatus(`答ボタンを作成しました（${stickies.length}件の付箋に紐付け）`);
    }


    /**
     * 答ボタンにクリックハンドラを設定する。
     * 編集モード：選択/解除。閉覧モード：紐付き付箋を一括トグル。
     * @param {HTMLElement} btn - 答ボタン要素
     */
    export function addKotaeClickHandler(btn) {
      btn.addEventListener('click', (e) => {
        if (!document.body.classList.contains('is-view-mode')) {
          // 編集モード：選択処理
          if (e.shiftKey) {
            btn.classList.toggle('is-selected');
          } else {
            selectedStickySet.forEach(n => n.classList.remove('is-selected'));
            selectedStickySet.clear();
            document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected')
              .forEach(a => a.classList.remove('is-selected'));
            btn.classList.add('is-selected');
          }
          const count = document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').length
                      + selectedStickySet.size;
          updateStatus(count > 1 ? `${count} 件のオブジェクトを選択中` : '答ボタンを選択中');
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
        updateStatus(allVisible ? '答を非表示にしました' : '答を表示しました');
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
      el.textContent      = '証明';
      el.style.left       = minLeft + 'px';
      el.style.top        = Math.max(0, minTop - 36) + 'px';

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

      updateStatus(`証明ボタンを作成しました（${stickies.length}件の付箋に紐付け）`);
    }


    /**
     * 証明ボタンにクリックハンドラを設定する。
     * 編集モード：選択/解除。
     * 閲覧モード：紐付き付箋を一括トグル（白表示⇔赤枠線のみ）。
     * @param {HTMLElement} btn - 証明ボタン要素
     */
    export function addShomeiClickHandler(btn) {
      btn.addEventListener('click', (e) => {
        if (!document.body.classList.contains('is-view-mode')) {
          // 編集モード：選択処理
          if (e.shiftKey) {
            btn.classList.toggle('is-selected');
          } else {
            selectedStickySet.forEach(n => n.classList.remove('is-selected'));
            selectedStickySet.clear();
            document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected')
              .forEach(a => a.classList.remove('is-selected'));
            btn.classList.add('is-selected');
          }
          const count = document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').length
                      + selectedStickySet.size;
          updateStatus(count > 1 ? `${count} 件のオブジェクトを選択中` : '証明ボタンを選択中');
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
        updateStatus(allShowing ? '証明を非表示にしました' : '証明を表示しました');
      });
    }
