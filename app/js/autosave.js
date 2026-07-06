import { state } from './state.js';
import { restoreAnnotationsFromArray } from './storage.js';
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
     * saveAnnotations() と同じ抽出ロジック（%座標・スタイル・各種dataset）。
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
          zuId: el.dataset.zuId,
          shomeiId: el.dataset.shomeiId,
          shomeiOrigBg: el.dataset.shomeiOrigBg,
          shomeiOutline: el.dataset.shomeiOutline,
          fuhyoji: el.dataset.fuhyoji,
        };
      });
    }

    /**
     * 現在のアノテーション状態をIndexedDBへ保存する。
     */
    export async function saveAutoSaveSnapshot() {
      try {
        const data = collectAnnotationSnapshotData();
        const db = await openAutoSaveDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put({ data, savedAt: Date.now() }, SNAPSHOT_KEY);
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
     * 起動時にオートセーブ済みデータの有無を確認し、あれば復元するか確認ダイアログを出す。
     * アプリ起動時に一度だけ呼び出す。
     */
    export async function checkAndPromptRestore() {
      try {
        const snapshot = await getAutoSaveSnapshot();
        if (!snapshot || !Array.isArray(snapshot.data) || snapshot.data.length === 0) return;
        const savedAt = new Date(snapshot.savedAt).toLocaleString('ja-JP');
        const restore = window.confirm(`自動保存された編集内容があります（${savedAt} 保存）。\n復元しますか？`);
        if (restore) {
          restoreAnnotationsFromArray(snapshot.data);
          showToast('オートセーブデータから復元しました');
        } else {
          await clearAutoSaveSnapshot();
        }
      } catch (e) {
        console.error('[autosave] 復元確認に失敗しました', e);
      }
    }
