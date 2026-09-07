import { state } from './state.js';
import { restoreAnnotationsFromArray, restoreLibroStickyOverrides } from './storage.js';
import { showToast } from './ui-common.js';

    /* ============================
       編集状態の定期オートセーブ（IndexedDB）
       画像・音声本体はZIP書き出し時に生成するため、対象はDOMのアノテーション状態のみ。
    ============================ */

    const DB_NAME = 'ContentsBuilderAutoSave';
    const DB_VERSION = 1;
    const STORE_NAME = 'snapshots';
    const SNAPSHOT_KEY = 'latest';
    /** 操作発生後、この時間操作が無ければ保存する（デバウンス） */
    const AUTOSAVE_DEBOUNCE_MS = 3000;
    /** デバウンスが発火し続けるケースへの保険として、この間隔でも必ず保存する */
    const AUTOSAVE_INTERVAL_MS = 30000;

    let dbPromise = null;

    function openAutoSaveDB() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE_NAME);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbPromise;
    }

    /**
     * 現在のDOMからアノテーション状態を抽出する。
     * %座標・スタイル・各種datasetを保存フォーマットと同じ形で抽出する。
     */
    function collectAnnotationSnapshotData() {
      const page = document.getElementById('pageLeft');
      const pageRect = { width: page.offsetWidth, height: page.offsetHeight };
      const elements = page.querySelectorAll('.sticky-note:not(.libro-toggle), .ann-object, .ann-icon-obj, .ann-image-obj, .daimon-btn, .kotae-btn, .shomei-btn');
      return Array.from(elements).map(el => {
        const left = parseFloat(el.style.left) || 0;
        const top = parseFloat(el.style.top) || 0;
        const width = parseFloat(el.style.width) || el.offsetWidth;
        const height = parseFloat(el.style.height) || el.offsetHeight;
        const leftPct = (left / pageRect.width) * 100;
        const topPct = (top / pageRect.height) * 100;
        const widthPct = (width / pageRect.width) * 100;
        const heightPct = (height / pageRect.height) * 100;
        const bg = el.style.background || el.style.backgroundColor || '';
        const style = `left:${leftPct}%;top:${topPct}%;width:${widthPct}%;height:${heightPct}%;${bg ? 'background:' + bg + ';' : ''}`;
        return {
          className: el.className,
          type: el.dataset.type,
          id: el.dataset.id,
          page: el.dataset.page,
          style: style,
          savedData: el.dataset.savedData || '',
          groupId: el.dataset.groupId,
          daimonId: el.dataset.daimonId,
          kotaeId: el.dataset.kotaeId,
          kotaeOrigBg: el.dataset.kotaeOrigBg,
          // 答ボタン削除時に開閉方式を戻すための元値（開閉方式自体は className／savedData で保存済み）
          kotaeOrigOpenMode: el.dataset.kotaeOrigOpenMode,
          shomeiId: el.dataset.shomeiId,
          shomeiOrigBg: el.dataset.shomeiOrigBg,
          shomeiOutline: el.dataset.shomeiOutline,
          fuhyoji: el.dataset.fuhyoji,
          // LIBRO由来の大問ボタン（.daimon-btn.libro-toggle）を復元後も passthrough 書き出し
          // 対象として識別できるようにする
          libroToggle: el.dataset.libroToggle,
          // 大問/答ボタンの押下時（open）id。復元後の書き出しで新規idを再発行させず、
          // 元のペアid（LIBRO由来ボタンでは元bookのid）をそのまま使うために保存する
          daimonPressedId: el.dataset.daimonPressedId,
          kotaePressedId: el.dataset.kotaePressedId,
          // LIBRO+製（他ツール由来）known系のリサイズ禁止フラグ
          libroLockedSize: el.dataset.libroLockedSize,
        };
      });
    }

    /**
     * LIBRO book由来の付箋（.sticky-note.libro-toggle）に対してCRAFT側で付けた編集情報だけを
     * 抽出する。これらの要素はbook読み込み時に renderTogglePairs() が毎回描画し直すため
     * collectAnnotationSnapshotData() の対象外（セレクタで除外している）だが、
     * 答/大問/証明ボタンとの紐付け・色上書きはCRAFT側の編集結果であり、保存しないと
     * 復元時にボタンだけが生き残って紐付きが切れる。位置・サイズ・画像はzip側が真とするため保存しない。
     * @returns {Array<Object>} 紐付け・色上書きを持つ付箋のみの配列（無ければ空配列）
     */
    function collectLibroStickyOverrides() {
      const page = document.getElementById('pageLeft');
      if (!page) return [];
      return Array.from(page.querySelectorAll('.sticky-note.libro-toggle'))
        .filter(el => el.dataset.kotaeId || el.dataset.daimonId || el.dataset.shomeiId ||
                      el.dataset.stickyColorOverride || el.dataset.groupId)
        .map(el => {
          let sd = {};
          try { sd = JSON.parse(el.dataset.savedData || '{}'); } catch (_) {}
          return {
            page:     el.dataset.page,
            closedId: el.dataset.closedId,
            kotaeId:  el.dataset.kotaeId,
            kotaeOrigBg: el.dataset.kotaeOrigBg,
            daimonId: el.dataset.daimonId,
            shomeiId: el.dataset.shomeiId,
            groupId:  el.dataset.groupId,
            stickyColorOverride:    el.dataset.stickyColorOverride,
            stickyColorOverrideHex: el.dataset.stickyColorOverrideHex,
            // 答ボタン紐付けで既定適用される開閉方式と、その復帰用の元値。
            // .libro-toggle付箋はbook読込のたび renderTogglePairs() が再描画するため、
            // ここで保存しないと復元時に「表示ボタン削除」が失われる。
            stickyOpenMode:    sd.annStickyOpenMode,
            kotaeOrigOpenMode: el.dataset.kotaeOrigOpenMode,
          };
        });
    }

    /**
     * 現在のアノテーション状態をIndexedDBへ保存する。
     */
    async function saveAutoSaveSnapshot() {
      // 見開き表示中はスナップショットのpx→%換算基準（#pageLeft の実寸）が見開き紙面のものになり、
      // 保存される座標が壊れる。見開きは閲覧専用で編集も発生しないため、保存自体を見送る。
      if (state.viewMode === 'spread') return;
      try {
        const data = collectAnnotationSnapshotData();
        // LIBRO book由来付箋の紐付け情報（本体はzip側が真のため、編集分だけを別枠で保存する）
        const libroStickies = collectLibroStickyOverrides();
        const db = await openAutoSaveDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put({ data, libroStickies, savedAt: Date.now(), bookId: state.currentBookId }, SNAPSHOT_KEY);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) {
        console.error('[autosave] 保存に失敗しました', e);
      }
    }

    /**
     * オートセーブをデバウンス予約する。pushUndo() など状態変化のたびに呼び出す。
     */
    export function scheduleAutoSave() {
      clearTimeout(state._autoSaveTimer);
      state._autoSaveTimer = setTimeout(saveAutoSaveSnapshot, AUTOSAVE_DEBOUNCE_MS);
    }

    /**
     * デバウンスが発火し続けて保存が先延ばしになり続けるケースの保険として、
     * 一定間隔で無条件に保存を行うタイマーを開始する。アプリ起動時に一度だけ呼び出す。
     */
    export function startAutoSaveInterval() {
      setInterval(saveAutoSaveSnapshot, AUTOSAVE_INTERVAL_MS);
    }

    async function getAutoSaveSnapshot() {
      const db = await openAutoSaveDB();
      return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(SNAPSHOT_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }

    async function clearAutoSaveSnapshot() {
      const db = await openAutoSaveDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(SNAPSHOT_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }

    /**
     * 指定bookに対応するオートセーブ済みデータの有無を確認し、あれば復元するか確認ダイアログを出す。
     * zip（book）の読み込み完了後に、そのbookIdを渡して呼び出す。
     * スナップショットのbookIdが一致しない場合は、別bookの編集中データのため警告を出さない。
     * @param {string} bookId - 読み込んだbookの識別子
     */
    export async function checkAndPromptRestoreForBook(bookId) {
      try {
        const snapshot = await getAutoSaveSnapshot();
        if (!snapshot || !Array.isArray(snapshot.data) || snapshot.data.length === 0) return;
        if (!bookId || snapshot.bookId !== bookId) return;
        const savedAt = new Date(snapshot.savedAt).toLocaleString('ja-JP');
        const restore = window.confirm(`このbookの自動保存された編集内容があります（${savedAt} 保存）。\n復元しますか？`);
        if (restore) {
          restoreAnnotationsFromArray(snapshot.data);
          // LIBRO book由来付箋の紐付け情報を復元する（旧スナップショットではキーが無いが、
          // 復元側が配列以外を無視するためそのまま渡してよい）
          restoreLibroStickyOverrides(snapshot.libroStickies);
          showToast('オートセーブデータから復元しました');
        } else {
          await clearAutoSaveSnapshot();
        }
      } catch (e) {
        console.error('[autosave] 復元確認に失敗しました', e);
      }
    }
