import { applyLiveUpdate } from './annotation-dialog.js';
import { checkAndPromptRestoreForBook } from './autosave.js';
import { renderButtonVisual } from './buttons.js';
import { ANNOTATION_TYPE_CONFIG, STICKY_COLOR_MAP, renderAnnObjectContent, renderAnnImageContent } from './config.js';
import { reinitElement, updateAlignPanel } from './annotation-interaction.js';
import { buildLibroBookExport, isLibroBookZip, parseLibroBookZip, renderTogglePairs, renderNetworkGroups, styleToRect } from './libro-format.js';
import { loadLibroBookPages, updateAnnotationVisibility } from './page-view.js';
import { mediaBlobs, state } from './state.js';
import { showToast, updateStatus } from './ui-common.js';

        /**
         * アノテーションをローカルストレージに保存する。
         */
        /**
         * アノテーションをJSONファイルとしてダウンロード保存する。
         */
        export function saveAnnotations() {
          const page = document.getElementById('pageLeft');
          // offsetWidth/offsetHeightはCSS transform（ズーム）の影響を受けない基準サイズ。
          // アノテーション座標もズーム前の基準サイズを前提としているため、ここで揃える。
          const pageRect = { width: page.offsetWidth, height: page.offsetHeight };
          // LIBRO book由来の付箋（.libro-toggle）はLIBRO書き出し専用のため、通常のローカル保存対象からは除外する
          const elements = page.querySelectorAll('.sticky-note:not(.libro-toggle), .ann-object, .ann-icon-obj, .ann-image-obj, .daimon-btn, .kotae-btn, .shomei-btn');
          const data = Array.from(elements).map(el => {
            // px値取得
            const left = parseFloat(el.style.left) || 0;
            const top = parseFloat(el.style.top) || 0;
            const width = parseFloat(el.style.width) || el.offsetWidth;
            const height = parseFloat(el.style.height) || el.offsetHeight;
            // %変換
            const leftPct = (left / pageRect.width) * 100;
            const topPct = (top / pageRect.height) * 100;
            const widthPct = (width / pageRect.width) * 100;
            const heightPct = (height / pageRect.height) * 100;
            // styleを%で構築（背景色も保存）
            const bg = el.style.background || el.style.backgroundColor || '';
            const style = `left:${leftPct}%;top:${topPct}%;width:${widthPct}%;height:${heightPct}%;${bg ? 'background:' + bg + ';' : ''}`;
            const obj = {
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
              fuhyoji: el.dataset.fuhyoji
            };
            return obj;
          });
          // JSONファイルとしてダウンロード
          const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'annotations.json';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 100);
          showToast('アノテーションをファイル保存しました');
        }


        /**
         * アノテーション配列からDOMを再構築する共通処理。
         * handleZipFile から呼び出される。
         * @param {Array} arr - annotations.json のパース済み配列
         */
        export function restoreAnnotationsFromArray(arr) {
          const page = document.getElementById('pageLeft');
          // offsetWidth/offsetHeightはCSS transform（ズーム）の影響を受けない基準サイズ。
          // アノテーション座標もズーム前の基準サイズを前提としているため、ここで揃える。
          const pageRect = { width: page.offsetWidth, height: page.offsetHeight };
          // 既存アノテーションを全削除（LIBRO book由来の付箋 .libro-toggle は対象外）
          page.querySelectorAll('.sticky-note:not(.libro-toggle), .ann-object, .ann-icon-obj, .ann-image-obj, .daimon-btn, .kotae-btn, .shomei-btn').forEach(el => el.remove());
          arr.forEach(obj => {
                const el = document.createElement('div');
                // ann-hidden-page はページ表示管理で付け直すため、className から除去してセット
                el.className = (obj.className || '').replace(/\bann-hidden-page\b/g, '').trim();
                el.dataset.type = obj.type;
                el.dataset.id = obj.id;
                if (obj.page) el.dataset.page = obj.page;
                // --- 座標・サイズの復元（複数フォーマットに対応） ---
                // ボタン系クラスはCSSでサイズが定義されているため、位置（left/top）のみ復元する
                const isBtnClass = el.classList.contains('daimon-btn') ||
                                   el.classList.contains('kotae-btn')  ||
                                   el.classList.contains('shomei-btn') ||
                                   el.classList.contains('zu-btn');
                // 優先順位: (1) % 形式  (2) xRatio/yRatio/wRatio/hRatio  (3) px 形式
                if (obj.style) {
                  const leftPctMatch   = obj.style.match(/left:\s*([\d.]+)%/);
                  const topPctMatch    = obj.style.match(/top:\s*([\d.]+)%/);
                  const widthPctMatch  = obj.style.match(/width:\s*([\d.]+)%/);
                  const heightPctMatch = obj.style.match(/height:\s*([\d.]+)%/);
                  let styleStr = '';
                  // 背景色を抽出（付箋の塗り復元に必要）
                  const bgMatch = obj.style.match(/background:([^;]+)/);
                  if (leftPctMatch) {
                    // (1) % 形式（saveAnnotations が出力する現行フォーマット）
                    styleStr += `left:${parseFloat(leftPctMatch[1]) * pageRect.width / 100}px;`;
                    if (topPctMatch) styleStr += `top:${parseFloat(topPctMatch[1]) * pageRect.height / 100}px;`;
                    if (!isBtnClass) {
                      if (widthPctMatch)  styleStr += `width:${parseFloat(widthPctMatch[1]) * pageRect.width / 100}px;`;
                      if (heightPctMatch) styleStr += `height:${parseFloat(heightPctMatch[1]) * pageRect.height / 100}px;`;
                    }
                    if (bgMatch) styleStr += `background:${bgMatch[1].trim()};`;
                  } else if (obj.xRatio !== undefined) {
                    // (2) xRatio/yRatio/wRatio/hRatio 形式（旧バージョンの JSON）
                    styleStr += `left:${obj.xRatio * pageRect.width}px;`;
                    styleStr += `top:${obj.yRatio * pageRect.height}px;`;
                    if (!isBtnClass) {
                      if (obj.wRatio !== undefined) styleStr += `width:${obj.wRatio * pageRect.width}px;`;
                      if (obj.hRatio !== undefined) styleStr += `height:${obj.hRatio * pageRect.height}px;`;
                    }
                    if (bgMatch) styleStr += `background:${bgMatch[1].trim()};`;
                  } else {
                    // (3) px 形式（style に直接 px 値が入っているフォーマット）
                    const leftPxMatch   = obj.style.match(/left:\s*([\d.]+)px/);
                    const topPxMatch    = obj.style.match(/top:\s*([\d.]+)px/);
                    const widthPxMatch  = obj.style.match(/width:\s*([\d.]+)px/);
                    const heightPxMatch = obj.style.match(/height:\s*([\d.]+)px/);
                    if (leftPxMatch)   styleStr += `left:${leftPxMatch[1]}px;`;
                    if (topPxMatch)    styleStr += `top:${topPxMatch[1]}px;`;
                    if (!isBtnClass) {
                      if (widthPxMatch)  styleStr += `width:${widthPxMatch[1]}px;`;
                      if (heightPxMatch) styleStr += `height:${heightPxMatch[1]}px;`;
                    }
                    if (bgMatch) styleStr += `background:${bgMatch[1].trim()};`;
                  }
                  el.style.cssText = styleStr;
                }
                // 付箋の背景色を復元する
                // style に background が含まれていない旧形式JSONの場合は savedData.annColor から引き当てる
                if (el.classList.contains('sticky-note') && !el.style.background) {
                  let colorIdx = 0;
                  try { colorIdx = parseInt((JSON.parse(obj.savedData || '{}')).annColor ?? '0', 10); } catch (_) {}
                  el.style.background = STICKY_COLOR_MAP[colorIdx] ?? STICKY_COLOR_MAP[0];
                }
                if (obj.savedData) el.dataset.savedData = obj.savedData;
                if (obj.groupId) el.dataset.groupId = obj.groupId;
                if (obj.daimonId) el.dataset.daimonId = obj.daimonId;
                if (obj.kotaeId) el.dataset.kotaeId = obj.kotaeId;
                if (obj.kotaeOrigBg) el.dataset.kotaeOrigBg = obj.kotaeOrigBg;
                if (obj.zuId) el.dataset.zuId = obj.zuId;
                if (obj.shomeiId) el.dataset.shomeiId = obj.shomeiId;
                if (obj.shomeiOrigBg) el.dataset.shomeiOrigBg = obj.shomeiOrigBg;
                if (obj.shomeiOutline) el.dataset.shomeiOutline = obj.shomeiOutline;
                if (obj.fuhyoji) el.dataset.fuhyoji = obj.fuhyoji;
                // 内容再構築
                if (el.classList.contains('ann-object')) {
                  let label = '';
                  try {
                    const sd = JSON.parse(obj.savedData || '{}');
                    label = (sd.annLabel || '').trim() || (ANNOTATION_TYPE_CONFIG[obj.type]?.label || obj.type);
                  } catch (_) { label = ANNOTATION_TYPE_CONFIG[obj.type]?.label || obj.type; }
                  const displayType = el.classList.contains('dt-page-color') ? 'page-color' : 'marker';
                  renderAnnObjectContent(el, obj.type, displayType, label);
                } else if (el.classList.contains('ann-icon-obj')) {
                  const cfg = ANNOTATION_TYPE_CONFIG[obj.type];
                  el.innerHTML = cfg ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${cfg.iconSvg}</svg>` : '';
                } else if (el.classList.contains('ann-image-obj')) {
                  let sd = {};
                  try { sd = JSON.parse(obj.savedData || '{}'); } catch (_) {}
                  renderAnnImageContent(el, sd);
                } else if (el.classList.contains('daimon-btn') || el.classList.contains('kotae-btn') || el.classList.contains('shomei-btn')) {
                  let sd = {};
                  try { sd = JSON.parse(obj.savedData || '{}'); } catch (_) {}
                  renderButtonVisual(el, obj.type, sd);
                } else if (el.classList.contains('zu-btn')) {
                  el.textContent = '図';
                }
                // ハンドラ再設定
                reinitElement(el);
                page.appendChild(el);
              });
              updateAnnotationVisibility();
              showToast('アノテーションをファイルから復元しました');
        }


    /**
     * ファイル名と拡張子からメディアの再生URL を解決する。
     * ZIPから読み込んだファイルがあればBlobURLを返し、
     * なければサーバー上の従来パスを返す。
     * @param {string} fileName - 拡張子なしのファイル名
     * @param {string} ext      - 拡張子（"mp3" または "mp4"）
     * @returns {string} 再生URL
     */
    export function resolveMediaSrc(fileName, ext) {
      const key = `${fileName}.${ext}`;
      if (mediaBlobs[key]) return mediaBlobs[key];
      return `/mock/ver2/_media/${encodeURIComponent(fileName)}.${ext}`;
    }


    /**
     * ZIPファイルを選択するファイル選択ダイアログを開く。
     */
    export function loadAnnotationsFromZip() {
      document.getElementById('zipFileInput').value = '';
      document.getElementById('zipFileInput').click();
    }


    /**
     * ZIPファイル選択時の処理。
     * ZIP内の音声・動画ファイルをBlobURLに変換してmediaBlobsへ格納し、
     * annotations.json を読み込んでアノテーションを復元する。
     * @param {Event} event - ファイル選択イベント
     */
    export async function handleZipFile(event) {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const zip = await JSZip.loadAsync(file);

        // ルート直下にindex.jsonがあればLIBRO bookフォルダ形式として扱う
        if (isLibroBookZip(zip)) {
          await handleLibroBookZip(zip, file.name);
          return;
        }

        // 既存BlobURLを解放してmediaBlobsを初期化
        Object.values(mediaBlobs).forEach(url => URL.revokeObjectURL(url));
        Object.keys(mediaBlobs).forEach(k => delete mediaBlobs[k]);

        // 音声・動画・Plusファイルを含む全ファイルをBlobURLに変換してキャッシュ
        const mimeMap = {
          '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
          '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
          '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html',
        };
        const promises = [];
        zip.forEach((relativePath, zipEntry) => {
          if (zipEntry.dir) return;
          const baseName = relativePath.split('/').pop();
          if (baseName === 'annotations.json') return;
          const lower = baseName.toLowerCase();
          promises.push(
            zipEntry.async('blob').then(blob => {
              const ext = lower.slice(lower.lastIndexOf('.'));
              const typedBlob = new Blob([blob], { type: mimeMap[ext] || blob.type });
              mediaBlobs[baseName] = URL.createObjectURL(typedBlob);
            })
          );
        });
        await Promise.all(promises);

        // annotations.json を読み込んでアノテーションを復元
        const jsonFile = zip.file('annotations.json');
        if (!jsonFile) {
          showToast('ZIPにannotations.jsonが見つかりません');
          return;
        }
        const jsonText = await jsonFile.async('string');
        const arr = JSON.parse(jsonText);
        // 独自ZIP形式にはbook folder名が無いため、ファイル名をbook識別子として使う
        const bookId = file.name;
        state.currentBookId = bookId;
        restoreAnnotationsFromArray(arr);
        const mediaCount = Object.keys(mediaBlobs).length;
        showToast(`ZIPから復元しました（メディア: ${mediaCount}件）`);
        await checkAndPromptRestoreForBook(bookId);
      } catch (e) {
        showToast('ZIP読込エラー: ファイルが壊れているか形式が正しくありません');
        console.error(e);
      }
    }


    /**
     * LIBRO bookフォルダ形式のZIPを読み込み、ページ画像を表示しアノテーションを復元する。
     * 既知のアノテーション（ページリンク／外部リンク／音声再生／付箋等の開閉）はContentsBuilderの
     * オブジェクトとして復元し、未知のアノテーションは編集UIに出さず内部に保持するのみとする
     * （書き出しは現段階では未対応）。
     * @param {JSZip} zip - JSZip.loadAsync 済みのZIPオブジェクト
     * @param {string} fallbackName - book folder名が空の場合に使うbook識別子（元zipファイル名）
     */
    async function handleLibroBookZip(zip, fallbackName) {
      const { pages, knownAnnotations, togglePairs, unknownAnnotations, daimonPassthrough, networkGroups, maxAnnotId, baseDir, indexJson, unencryptedAssetPaths } =
        await parseLibroBookZip(zip);

      // 再読込時に前回分のHide/Showペア要素が残らないようクリアする
      // （restoreAnnotationsFromArray は標準アノテーション種別のみクリアするため別途対応）
      document.querySelectorAll('#pageLeft .libro-toggle, #pageLeft .libro-network-slot').forEach(el => el.remove());

      const realPageCount = indexJson.configs?.['real-page-count'] ?? null;
      loadLibroBookPages(pages, realPageCount);
      restoreAnnotationsFromArray(knownAnnotations);
      renderTogglePairs(togglePairs);
      renderNetworkGroups(networkGroups);
      updateAnnotationVisibility();

      // 新規アノテーションのID採番が既存IDと衝突しないよう、カウンターを引き上げる
      state.annIdCounter = Math.max(state.annIdCounter, maxAnnotId);
      // 未知アノテーション・Hide/Showペアの生データは編集不可のまま保持し、書き出し時にそのまま書き戻す
      state.libroUnknownAnnotations = unknownAnnotations;
      // 大問ボタンは書き出し未対応のため、位置未編集・未削除の場合の書き戻し用に生データを保持する
      state.libroDaimonPassthrough = daimonPassthrough;
      // 拡張トグルネットワーク（色分けボタン・ステップボタン等）は位置・サイズ編集のみ対応。
      // 書き出し時に編集後のrectを反映した生データを書き戻すため保持する
      state.libroNetworkPassthrough = networkGroups;
      // 書き出し時に未変更ファイルをそのまま維持できるよう、元zip・書誌情報を保持する。
      // unencryptedAssetPathsは、別オーサリングツール由来で実際には暗号化されていなかった
      // 音声・アノテーション画像のパス一覧（書き出し時に強制暗号化する対象）
      state.libroBook = { zip, baseDir, indexJson, unencryptedAssetPaths };
      // book識別子：LIBRO book folder名（baseDir）。folder無し（index.jsonがzipルート直下）の場合は
      // 元zipファイル名にフォールバックする
      const bookId = baseDir || fallbackName;
      state.currentBookId = bookId;

      const unencryptedNote = unencryptedAssetPaths.size > 0
        ? `、未暗号化ファイル${unencryptedAssetPaths.size}件を検出（保存時に暗号化します）`
        : '';
      showToast(`LIBRO bookを読み込みました（${pages.length}ページ、未知アノテーション${unknownAnnotations.length}件${unencryptedNote}）`);
      await checkAndPromptRestoreForBook(bookId);
    }


    /**
     * 現在のアノテーションと関連する音声・動画ファイルをまとめてZIPで保存する。
     * annFile フィールドを持つアノテーションのメディアファイルを収集してZIPに同梱する。
     */
    export async function saveAnnotationsAsZip() {
      const page = document.getElementById('pageLeft');
      // offsetWidth/offsetHeightはCSS transform（ズーム）の影響を受けない基準サイズ。
      // アノテーション座標もズーム前の基準サイズを前提としているため、ここで揃える。
      const pageRect = { width: page.offsetWidth, height: page.offsetHeight };
      const elements = page.querySelectorAll('.sticky-note:not(.libro-toggle), .ann-object, .ann-icon-obj, .ann-image-obj, .daimon-btn, .kotae-btn, .shomei-btn');
      const data = Array.from(elements).map(el => {
        const left = parseFloat(el.style.left) || 0;
        const top  = parseFloat(el.style.top)  || 0;
        const width  = parseFloat(el.style.width)  || el.offsetWidth;
        const height = parseFloat(el.style.height) || el.offsetHeight;
        const leftPct   = (left   / pageRect.width)  * 100;
        const topPct    = (top    / pageRect.height) * 100;
        const widthPct  = (width  / pageRect.width)  * 100;
        const heightPct = (height / pageRect.height) * 100;
        return {
          className:     el.className,
          type:          el.dataset.type,
          id:            el.dataset.id,
          page:          el.dataset.page,
          style:         `left:${leftPct}%;top:${topPct}%;width:${widthPct}%;height:${heightPct}%;`,
          savedData:     el.dataset.savedData || '',
          groupId:       el.dataset.groupId,
          daimonId:      el.dataset.daimonId,
          kotaeId:       el.dataset.kotaeId,
          kotaeOrigBg:   el.dataset.kotaeOrigBg,
          zuId:          el.dataset.zuId,
          shomeiId:      el.dataset.shomeiId,
          shomeiOrigBg:  el.dataset.shomeiOrigBg,
          shomeiOutline: el.dataset.shomeiOutline,
          fuhyoji:       el.dataset.fuhyoji,
        };
      });

      const zip = new JSZip();
      zip.file('annotations.json', JSON.stringify(data, null, 2));

      // annFile を持つアノテーション（音声・動画・Plusファイル）をZIPに同梱（重複除去）
      const mediaExtMap = { audio: 'mp3', video: 'mp4' };
      const collected = new Set();
      data.forEach(obj => {
        try {
          const sd = JSON.parse(obj.savedData || '{}');
          if (!sd.annFile) return;
          const fileName = sd.annFile.trim();
          if (!fileName) return;

          if (obj.type === 'plusfile') {
            // Plusファイル：ファイル名そのまま（拡張子込み）
            if (!collected.has(fileName)) {
              collected.add(fileName);
              const src = mediaBlobs[fileName] || `./${fileName}`;
              zip.file(fileName, fetch(src).then(r => {
                if (!r.ok) throw new Error(`fetch failed: ${src}`);
                return r.blob();
              }).catch(() => null));
            }
          } else {
            const ext = mediaExtMap[obj.type];
            if (!ext) return;
            const key = `${fileName}.${ext}`;
            if (!collected.has(key)) {
              collected.add(key);
              const src = mediaBlobs[key] || `/mock/ver2/_media/${encodeURIComponent(fileName)}.${ext}`;
              zip.file(key, fetch(src).then(r => {
                if (!r.ok) throw new Error(`fetch failed: ${src}`);
                return r.blob();
              }).catch(() => null));
            }
          }
        } catch (_) {}
      });

      // btnImageFile を持つ大問/答/証明ボタンの画像素材もZIPに同梱（重複除去、押下時バリアントは含めず読込時に再生成する）
      data.forEach(obj => {
        if (!['daimon', 'kotae', 'shomei'].includes(obj.type)) return;
        try {
          const sd = JSON.parse(obj.savedData || '{}');
          const fileName = (sd.btnImageFile || '').trim();
          if (!fileName || collected.has(fileName)) return;
          collected.add(fileName);
          const src = mediaBlobs[fileName];
          if (!src) return;
          zip.file(fileName, fetch(src).then(r => {
            if (!r.ok) throw new Error(`fetch failed: ${src}`);
            return r.blob();
          }).catch(() => null));
        } catch (_) {}
      });

      try {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'annotations.zip';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
        showToast('ZIPで保存しました');
      } catch (e) {
        showToast('ZIP保存エラー: ' + e.message);
        console.error(e);
      }
    }


    /**
     * LIBRO bookとして読み込んだ内容を、LIBRO bookフォルダ形式のZIPとして書き出す。
     * ページリンク・外部リンク・音声再生・Plusファイル・付箋（Hide/Show）に対応する。
     * 動画はLIBRO由来のtoMovie/toMovieBNRリンク（annVideoSrc: '2'）のみ対応し、
     * 内部ファイル/外部タグ指定はLIBRO側に対応actionが無いため未対応のまま。
     * LIBRO由来の大問ボタンは編集非対応のため、削除されていない限り生データを無変更のまま書き戻す
     * （位置編集した場合は反映されない）。それ以外の種別（図・答/証明ボタン、新規作成の大問ボタン等）
     * が存在する場合はトーストで警告し、書き出し対象から除外する。
     */
    export async function saveAnnotationsAsLibroBook() {
      if (!state.libroBook) {
        showToast('LIBRO bookとして読み込んだ場合のみ書き出せます');
        return;
      }

      const page = document.getElementById('pageLeft');
      // offsetWidth/offsetHeightはCSS transform（ズーム）の影響を受けない基準サイズ。
      // アノテーション座標もズーム前の基準サイズを前提としているため、ここで揃える。
      const pageRect = { width: page.offsetWidth, height: page.offsetHeight };
      const elements = page.querySelectorAll('.ann-object, .ann-icon-obj, .ann-image-obj, .daimon-btn, .kotae-btn, .shomei-btn');
      const supportedTypes = new Set(['pagelink', 'externallink', 'audio', 'plusfile']);

      const domAnnotations = [];
      const unsupportedTypes = new Set();
      // LIBRO由来の大問ボタン（削除も位置編集もされていないもの）は、生データをそのまま
      // 書き戻すため domAnnotations には含めず、キー（"page:closedId"）だけを記録する
      const survivingDaimonIds = new Set();
      elements.forEach(el => {
        const type = el.dataset.type;
        if (type === 'daimon' && el.dataset.libroToggle === '1') {
          survivingDaimonIds.add(`${el.dataset.page}:${el.dataset.id}`);
          return;
        }
        // 動画はLIBRO由来のtoMovie/toMovieBNRリンク（annVideoSrc: '2'）のみ書き出し可能
        let isSupported = supportedTypes.has(type);
        if (type === 'video') {
          let vsd = {};
          try { vsd = JSON.parse(el.dataset.savedData || '{}'); } catch (_) {}
          isSupported = vsd.annVideoSrc === '2';
        }
        if (!isSupported) {
          if (type) unsupportedTypes.add(ANNOTATION_TYPE_CONFIG[type]?.label || type);
          return;
        }
        const left   = parseFloat(el.style.left)   || 0;
        const top    = parseFloat(el.style.top)    || 0;
        const width  = parseFloat(el.style.width)  || el.offsetWidth;
        const height = parseFloat(el.style.height) || el.offsetHeight;
        domAnnotations.push({
          id:   parseInt(el.dataset.id, 10),
          page: parseInt(el.dataset.page, 10),
          type,
          style: `left:${(left / pageRect.width) * 100}%;top:${(top / pageRect.height) * 100}%;` +
                 `width:${(width / pageRect.width) * 100}%;height:${(height / pageRect.height) * 100}%;`,
          savedData: el.dataset.savedData || '',
        });
      });

      // 付箋（sticky-note）をグループ単位（groupId未設定は単独1件）でまとめ、
      // LIBROのHide/Showペア（既存付箋は画像そのまま再利用、新規付箋は色から新規PNGを生成）に変換する
      const groupBuckets = new Map();
      page.querySelectorAll('.sticky-note').forEach(el => {
        const gid = el.dataset.groupId || `__solo-${el.dataset.id}`;
        if (!groupBuckets.has(gid)) groupBuckets.set(gid, []);
        groupBuckets.get(gid).push(el);
      });

      const domStickyGroups = [];
      groupBuckets.forEach((members, gid) => {
        const pageNum = parseInt(members[0].dataset.page, 10) || 1;
        const memberDescs = members.map(el => {
          const left   = parseFloat(el.style.left)   || 0;
          const top    = parseFloat(el.style.top)    || 0;
          const width  = parseFloat(el.style.width)  || el.offsetWidth;
          const height = parseFloat(el.style.height) || el.offsetHeight;
          const style = `left:${(left / pageRect.width) * 100}%;top:${(top / pageRect.height) * 100}%;` +
                        `width:${(width / pageRect.width) * 100}%;height:${(height / pageRect.height) * 100}%;`;

          if (el.dataset.libroToggle === '1') {
            // 既存付箋：id・画像は基本そのまま再利用する。
            // 「開」（解答等が描き込まれている可能性がある元画像）は常に無変更のまま維持し、
            // 色が上書きされた場合（dataset.stickyColorOverride）のみ「閉」だけを新規生成する。
            const closedId = parseInt(el.dataset.closedId, 10);
            const openId   = parseInt(el.dataset.openId, 10);
            const closedFile = el.dataset.closedFile;
            const openFile   = el.dataset.openFile;
            if (el.dataset.stickyColorOverride) {
              const colorIdx = parseInt(el.dataset.stickyColorOverride, 10);
              const color = STICKY_COLOR_MAP[colorIdx] ?? STICKY_COLOR_MAP[0];
              return { closedId, openId, closedFile, openFile, closedMode: 'color', openMode: 'reuse', color, style };
            }
            return { closedId, openId, closedFile, openFile, closedMode: 'reuse', openMode: 'reuse', style };
          }

          // 新規付箋：閉id（dataset.id）は既存を再利用し、開idは初回のみ発行してdatasetにキャッシュする
          // （再エクスポート時に毎回新規idを発行して不要なファイルが増えるのを防ぐため）
          const closedId = parseInt(el.dataset.id, 10);
          if (!el.dataset.stickyOpenId) el.dataset.stickyOpenId = String(++state.annIdCounter);
          const openId = parseInt(el.dataset.stickyOpenId, 10);
          let sd = {};
          try { sd = JSON.parse(el.dataset.savedData || '{}'); } catch (_) {}
          const colorIdx = parseInt(sd.annColor || '0', 10);
          const color = STICKY_COLOR_MAP[colorIdx] ?? STICKY_COLOR_MAP[0];
          return { closedId, openId, closedMode: 'color', openMode: 'transparent', color, style };
        });
        domStickyGroups.push({ pageNum, members: memberDescs, groupId: gid });
      });

      if (unsupportedTypes.size > 0) {
        showToast(`LIBRO形式に非対応の種別（${[...unsupportedTypes].join('、')}）は書き出し対象から除外しました`);
      }

      // 削除されていない大問ボタンのみ、元のclosed/open生データを無変更のまま書き戻す
      const daimonRawAnnots = state.libroDaimonPassthrough
        .filter(({ pageNum, closedId }) => survivingDaimonIds.has(`${pageNum}:${closedId}`))
        .flatMap(({ pageNum, closed, open }) => [{ pageNum, raw: closed }, { pageNum, raw: open }]);

      // 拡張トグルネットワーク（色分けボタン・ステップボタン等）：スロットの現在DOM位置から
      // rectだけ上書きし、actions/filename/hidden等の元データはそのまま書き戻す。
      // 対応するDOM要素が見つからない場合（未描画・削除済み）は元rectを維持する安全側フォールバック。
      const networkRawAnnots = [];
      state.libroNetworkPassthrough.forEach(net => {
        const slotRects = net.slots.map((slot, slotIndex) => {
          const el = document.querySelector(
            `.libro-network-slot[data-network-id="${net.networkId}"][data-slot-index="${slotIndex}"]`
          );
          if (!el) return slot.rect;
          const left   = parseFloat(el.style.left)   || 0;
          const top    = parseFloat(el.style.top)    || 0;
          const width  = parseFloat(el.style.width)  || el.offsetWidth;
          const height = parseFloat(el.style.height) || el.offsetHeight;
          const style = `left:${(left / pageRect.width) * 100}%;top:${(top / pageRect.height) * 100}%;` +
                        `width:${(width / pageRect.width) * 100}%;height:${(height / pageRect.height) * 100}%;`;
          return styleToRect(style, net.pageWidth, net.pageHeight);
        });
        net.members.forEach(raw => {
          const slotIndex = net.slots.findIndex(s => s.memberIds.includes(raw._id));
          const rect = slotIndex >= 0 ? slotRects[slotIndex] : raw.rect;
          networkRawAnnots.push({ pageNum: net.pageNum, raw: { ...raw, rect } });
        });
      });

      const passthroughAnnotations = [...state.libroUnknownAnnotations, ...daimonRawAnnots, ...networkRawAnnots];

      try {
        const zip = await buildLibroBookExport(state.libroBook, domAnnotations, passthroughAnnotations, domStickyGroups);
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'libro_book.zip';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
        showToast('LIBRO形式で書き出しました');
      } catch (e) {
        showToast('LIBRO書き出しエラー: ' + e.message);
        console.error(e);
      }
    }


    /**
     * 保存ドロップダウンメニューの表示・非表示を切り替える。
     * @param {Event} e - クリックイベント
     */
    export function toggleSaveDropdown(e) {
      e.stopPropagation();
      const menu = document.getElementById('saveDropdownMenu');
      const isOpen = menu.classList.toggle('is-open');
      if (isOpen) {
        // メニュー外クリックで閉じる
        const close = () => {
          menu.classList.remove('is-open');
          document.removeEventListener('click', close);
        };
        document.addEventListener('click', close);
      }
    }


    /**
     * 詳細設定パネルを閉じてプレースホルダーに戻す。
     */
    /**
     * 詳細設定パネルを閉じてグレーアウトパネルを再描画する。
     */
    export function closeDialog() {
      document.getElementById('sideDetailActive').style.display = 'none';
      // 種別固有セクションをリセット（次回表示を正しく制御するため）
      document.getElementById('detailSectionSep').style.display      = 'none';
      document.getElementById('sideDetailSpecificWrap').style.display = 'none';
      _renderGrayedPanel(state.lastDetailType);
      document.getElementById('sideDetailEmpty').style.visibility = '';
      // 選択が解除されたタイミングでバウンディングボックスを即削除
      updateAlignPanel();
      // デルタ計算の基準値をクリア
      applyLiveUpdate._prevX = undefined;
      applyLiveUpdate._prevY = undefined;
      applyLiveUpdate._prevW = undefined;
      applyLiveUpdate._prevH = undefined;
    }


    /**
     * 指定種別のグレーアウトフォームを sideDetailEmpty に再構築する。
     * 共通セクション（位置・W/H・塗り色）を常時表示し、
     * 種別固有フィールドはヒントテキストで代替表示する。
     * @param {string} type - アノテーション種別
     */
    export function _renderGrayedPanel(type) {
      const emptyDiv = document.getElementById('sideDetailEmpty');
      const cfg = ANNOTATION_TYPE_CONFIG?.[type];

      // 共通フィールド（常時表示）：位置・W/H・塗り色
      const commonRows = `
        <dt>位置</dt>
        <dd>
          <div class="pos-row">
            <span>X</span><div class="pos-field"><div class="spin-btns"><button class="spin-btn spin-up" disabled>▲</button><button class="spin-btn spin-down" disabled>▼</button></div><input class="d-input d-input-sm" type="number" disabled value="0"></div>
            <span>Y</span><div class="pos-field"><div class="spin-btns"><button class="spin-btn spin-up" disabled>▲</button><button class="spin-btn spin-down" disabled>▼</button></div><input class="d-input d-input-sm" type="number" disabled value="0"></div>
          </div>
        </dd>
        <dt>変形</dt>
        <dd>
          <div class="pos-row">
            <span>W</span><div class="pos-field"><div class="spin-btns"><button class="spin-btn spin-up" disabled>▲</button><button class="spin-btn spin-down" disabled>▼</button></div><input class="d-input d-input-sm" type="number" disabled value="0"></div>
            <span>H</span><div class="pos-field"><div class="spin-btns"><button class="spin-btn spin-up" disabled>▲</button><button class="spin-btn spin-down" disabled>▼</button></div><input class="d-input d-input-sm" type="number" disabled value="0"></div>
          </div>
        </dd>
        <dt>塗り</dt>
        <dd class="color-row">
          <div class="d-select-wrap">
            <select class="d-select" disabled><option>—</option></select>
          </div>
        </dd>
      `;

      emptyDiv.innerHTML = `
        <div class="side-detail-grayed">
          <p class="side-detail-title">${cfg?.label ?? type}設定</p>
          <div class="side-detail-form"><dl>${commonRows}</dl></div>
        </div>`;
    }


    /**
     * ダイアログの保存処理（モック）。
     */
    export function saveDialog() {
      closeDialog();
      updateStatus('アノテーションを保存しました');
    }
