import { checkAndPromptRestoreForBook } from './autosave.js';
import { renderButtonVisual } from './buttons.js';
import { ANNOTATION_TYPE_CONFIG, STICKY_COLOR_MAP, getStickyColor, renderAnnObjectContent, renderAnnImageContent } from './config.js';
import { reinitElement, updateAlignPanel } from './annotation-interaction.js';
import { buildLibroBookExport, checkLibroBookLoadable, isLibroBookZip, parseLibroBookZip, renderTogglePairs, renderNetworkGroups, resolveVideoSrc, styleToRect } from './libro-format.js';
import { loadLibroBookPages, updateAnnotationVisibility, updateNavButtonStates, updateTocButtonState } from './page-view.js';
import { updateLibroBookBtnStates } from './index-outline.js';
import { mediaBlobs, state } from './state.js';
import { applyBookSettings } from './settings.js';
import { escapeHtml, hideLoader, showLoader, showToast, updateAuthoringPanelState, updateStatus } from './ui-common.js';
import { trackEvent } from './analytics.js';

    /**
     * DOM上の付箋に付いている付箋グループID（`grp-N` 形式）を走査し、
     * state.stickyGroupCounter をその最大値まで引き上げる。
     *
     * book読み込み・オートセーブ復元では data-group-id がDOMへ書き戻される
     * （libro-format.js の renderTogglePairs / 本ファイルの restoreAnnotationsFromArray・
     * restoreLibroStickyOverrides）が、カウンタは0のままだった。そのため復元後に
     * 新規グループ化（sticky.js の toggleStickyGroup）や貼り付け（annotation-interaction.js の
     * pasteClipboard）を行うと `grp-1` から採番し直し、既存グループとIDが衝突する。
     * IDが衝突するとLIBRO書き出しの付箋グループ集約が別ページの付箋を同一グループとみなし、
     * 付箋が意図しないページへ書き出される。state.annIdCounter と同じ考え方で引き上げる。
     */
    function syncStickyGroupCounterFromDom() {
      let maxN = state.stickyGroupCounter;
      document.querySelectorAll('#pageLeft .sticky-note[data-group-id]').forEach(el => {
        // `grp-1--p3`（ページごとに分割して書き出したID）も数値部分を拾えるよう前方一致で見る
        const m = /^grp-(\d+)/.exec(el.dataset.groupId || '');
        if (!m) return;
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > maxN) maxN = n;
      });
      state.stickyGroupCounter = maxN;
    }

    /**
     * 大問・答・証明ボタンの採番カウンタ（state.daimonCounter / kotaeCounter / shomeiCounter）を、
     * DOM上の既存ID（`daimon-N` / `kotae-N` / `shomei-N`）より大きく引き上げる。
     *
     * 一時保存から復元した直後はカウンタが0のままのため、そのまま新しいボタンを作ると
     * `kotae-1` などから採番し直し、既存のボタンとIDが衝突する。IDが衝突すると、書き出し時に
     * ページの違うボタンが同じ group-id を持ち、読み込み直したときにボタンが消える。
     * LIBRO book 由来のID（`libro-daimon-6-1500` 等）はこの形に当てはまらないため対象外。
     */
    function syncButtonCountersFromDom() {
      const specs = [
        ['daimonId', 'daimon', 'daimonCounter'],
        ['kotaeId',  'kotae',  'kotaeCounter'],
        ['shomeiId', 'shomei', 'shomeiCounter'],
      ];
      specs.forEach(([key, prefix, counter]) => {
        const re = new RegExp(`^${prefix}-(\\d+)$`);
        let maxN = state[counter];
        document.querySelectorAll(`#pageLeft [data-${prefix}-id]`).forEach(el => {
          const m = re.exec(el.dataset[key] || '');
          if (!m) return;
          const n = parseInt(m[1], 10);
          if (Number.isFinite(n) && n > maxN) maxN = n;
        });
        state[counter] = maxN;
      });
    }

    /**
     * ページをまたいで重複している大問・答・証明のID（data-daimon-id / data-kotae-id /
     * data-shomei-id）を、ページごとに振り直す。旧版で作られた一時保存データの修復用。
     *
     * 同じIDの要素がページをまたいでいる場合、そのIDのボタンがある最小のページ（ボタンが
     * どのページにも無ければ最小のページ）を元のIDの持ち主とし、それ以外のページの要素には
     * ページごとに新しいIDを1つ振る。ページ内のボタンと付箋の紐付けは保たれる。
     * 呼び出し前に syncButtonCountersFromDom() でカウンタが引き上げ済みであること。
     * @returns {number} 振り直したページ数（0なら重複なし）
     */
    export function repairCrossPageLinkIds() {
      const pageEl = document.getElementById('pageLeft');
      if (!pageEl) return 0;
      let repaired = 0;
      const specs = [
        ['daimonId', 'daimon', 'daimonCounter', '.daimon-btn'],
        ['kotaeId',  'kotae',  'kotaeCounter',  '.kotae-btn'],
        ['shomeiId', 'shomei', 'shomeiCounter', '.shomei-btn'],
      ];
      specs.forEach(([key, prefix, counter, btnSelector]) => {
        const byId = new Map(); // ID -> Map(ページ番号文字列 -> 要素配列)
        pageEl.querySelectorAll(`[data-${prefix}-id]`).forEach(el => {
          const id = el.dataset[key];
          if (!id) return;
          const pg = String(el.dataset.page || '');
          if (!byId.has(id)) byId.set(id, new Map());
          const pages = byId.get(id);
          if (!pages.has(pg)) pages.set(pg, []);
          pages.get(pg).push(el);
        });
        byId.forEach(pages => {
          if (pages.size < 2) return;
          const sorted = [...pages.keys()].sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
          const keeper = sorted.find(pg => pages.get(pg).some(el => el.matches(btnSelector))) ?? sorted[0];
          sorted.forEach(pg => {
            if (pg === keeper) return;
            const newId = `${prefix}-${++state[counter]}`;
            pages.get(pg).forEach(el => { el.dataset[key] = newId; });
            repaired++;
          });
        });
      });
      return repaired;
    }

        /**
         * アノテーション配列からDOMを再構築する共通処理。
         * handleZipFile から呼び出される。
         * @param {Array} arr - annotations.json のパース済み配列
         */
        /**
         * 復元データ（annotations.json / IndexedDBオートセーブ）から取り出した
         * CSS background の値を検証し、色表現であればその値を、そうでなければ null を返す。
         *
         * 復元データは外部から持ち込まれるファイルであり、値をそのまま style へ流すと
         * `background: url(https://example.com/beacon.png)` のような外部参照を仕込まれ、
         * bookを開いた瞬間に外部へHTTPリクエストが飛ぶ（閲覧トラッキングが成立する）。
         * アノテーションの background は本来「単色の塗り」しか取らないため、
         * 色表現以外は一律で採用しない。
         *
         * null を返した場合、呼び出し側は background を style へ入れないため、
         * 後段の「style に background が無い場合は savedData.annColor から引き当てる」
         * フォールバックが働き、既定色で復元される。
         *
         * @param {string} rawValue - 復元データから抽出した background の生値
         * @returns {string|null} 採用してよい色文字列。色として解釈できない場合は null
         */
        function sanitizeRestoredBackground(rawValue) {
          const v = (rawValue || '').trim();
          if (!v) return null;
          // url() / image-set() / element() などの外部参照・関数形式を明示的に拒否する。
          // 下の色判定でも弾けるが、意図を明確にするため先に落とす。
          if (/url\s*\(|image-set|element\s*\(|var\s*\(/i.test(v)) return null;
          // #rgb / #rrggbb / #rgba / #rrggbbaa
          if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v;
          // rgb() / rgba()（数値・%・カンマ区切り・スペース区切りのいずれも許容）
          if (/^rgba?\(\s*[\d.%\s,\/]+\)$/i.test(v)) return v;
          // transparent / 色名（CSSの名前付き色）。ブラウザのパーサに解釈させて判定する。
          // 解釈できない文字列は fillStyle が変化しないため、番兵色との比較で弾ける。
          if (!/^[a-z]+$/i.test(v)) return null; // ここへ来る時点で色名以外は認めない
          const ctx = sanitizeRestoredBackground._ctx ||
                      (sanitizeRestoredBackground._ctx = document.createElement('canvas').getContext('2d'));
          ctx.fillStyle = '#010203'; // 番兵
          try { ctx.fillStyle = v; } catch (_) { return null; }
          if (ctx.fillStyle === '#010203') return null; // 代入が効かなかった＝解釈不能
          return v;
        }


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
                // ボタン系クラスはCSSでサイズが定義されているため、位置（left/top）のみ復元する。
                // ただしページ座標系のサイズをインラインstyleで持つ大問ボタン
                // （.is-sized＝LIBRO実データ基準で新規作成したもの／.libro-toggle＝LIBRO由来）は、
                // 幅・高さも復元しないとCSS既定サイズへ潰れてしまうため除外する。
                // ページ座標系サイズをインラインstyleで持つボタン（.is-sized＝新規作成・
                // .libro-toggle＝LIBRO由来）は、大問/答/証明いずれも幅・高さも復元する
                // （復元しないとCSS既定サイズへ潰れるため）。
                const isSizedBtn = (el.classList.contains('daimon-btn') ||
                                    el.classList.contains('kotae-btn')  ||
                                    el.classList.contains('shomei-btn')) &&
                                   (el.classList.contains('is-sized') || el.classList.contains('libro-toggle'));
                const isBtnClass = !isSizedBtn &&
                                  (el.classList.contains('daimon-btn') ||
                                   el.classList.contains('kotae-btn')  ||
                                   el.classList.contains('shomei-btn'));
                // 優先順位: (1) % 形式  (2) xRatio/yRatio/wRatio/hRatio  (3) px 形式
                if (obj.style) {
                  const leftPctMatch   = obj.style.match(/left:\s*([\d.]+)%/);
                  const topPctMatch    = obj.style.match(/top:\s*([\d.]+)%/);
                  const widthPctMatch  = obj.style.match(/width:\s*([\d.]+)%/);
                  const heightPctMatch = obj.style.match(/height:\s*([\d.]+)%/);
                  let styleStr = '';
                  // 背景色を抽出（付箋の塗り復元に必要）。
                  // 外部データ由来のため色表現であることを検証する（url(...) 等は採用しない）。
                  const bgRawMatch = obj.style.match(/background:([^;]+)/);
                  const bgValue = bgRawMatch ? sanitizeRestoredBackground(bgRawMatch[1]) : null;
                  if (leftPctMatch) {
                    // (1) % 形式（現行の保存フォーマット）
                    styleStr += `left:${parseFloat(leftPctMatch[1]) * pageRect.width / 100}px;`;
                    if (topPctMatch) styleStr += `top:${parseFloat(topPctMatch[1]) * pageRect.height / 100}px;`;
                    if (!isBtnClass) {
                      if (widthPctMatch)  styleStr += `width:${parseFloat(widthPctMatch[1]) * pageRect.width / 100}px;`;
                      if (heightPctMatch) styleStr += `height:${parseFloat(heightPctMatch[1]) * pageRect.height / 100}px;`;
                    }
                    if (bgValue) styleStr += `background:${bgValue};`;
                  } else if (obj.xRatio !== undefined) {
                    // (2) xRatio/yRatio/wRatio/hRatio 形式（旧バージョンの JSON）
                    styleStr += `left:${obj.xRatio * pageRect.width}px;`;
                    styleStr += `top:${obj.yRatio * pageRect.height}px;`;
                    if (!isBtnClass) {
                      if (obj.wRatio !== undefined) styleStr += `width:${obj.wRatio * pageRect.width}px;`;
                      if (obj.hRatio !== undefined) styleStr += `height:${obj.hRatio * pageRect.height}px;`;
                    }
                    if (bgValue) styleStr += `background:${bgValue};`;
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
                    if (bgValue) styleStr += `background:${bgValue};`;
                  }
                  el.style.cssText = styleStr;
                }
                // 付箋の背景色を復元する
                // style に background が含まれていない旧形式JSONの場合は savedData.annColor から引き当てる
                if (el.classList.contains('sticky-note') && !el.style.background) {
                  let colorIdx = 0;
                  let colorHex;
                  try {
                    const sd = JSON.parse(obj.savedData || '{}');
                    colorIdx = parseInt(sd.annColor ?? '0', 10);
                    colorHex = sd.annColorHex;
                  } catch (_) {}
                  el.style.background = getStickyColor(colorIdx, colorHex);
                }
                if (obj.savedData) el.dataset.savedData = obj.savedData;
                if (obj.groupId) el.dataset.groupId = obj.groupId;
                if (obj.daimonId) el.dataset.daimonId = obj.daimonId;
                if (obj.kotaeId) el.dataset.kotaeId = obj.kotaeId;
                if (obj.kotaeOrigBg) el.dataset.kotaeOrigBg = obj.kotaeOrigBg;
                if (obj.kotaeOrigOpenMode !== undefined) el.dataset.kotaeOrigOpenMode = obj.kotaeOrigOpenMode;
                if (obj.shomeiId) el.dataset.shomeiId = obj.shomeiId;
                if (obj.shomeiOrigBg) el.dataset.shomeiOrigBg = obj.shomeiOrigBg;
                if (obj.shomeiOutline) el.dataset.shomeiOutline = obj.shomeiOutline;
                if (obj.fuhyoji) el.dataset.fuhyoji = obj.fuhyoji;
                // LIBRO由来フラグ（大問ボタンの書き出し passthrough 判定に必要）
                if (obj.libroToggle) el.dataset.libroToggle = obj.libroToggle;
                // 大問/答ボタンの押下時（open）id。自動保存復元後も同じペアidで書き出せるようにする
                if (obj.daimonPressedId) el.dataset.daimonPressedId = obj.daimonPressedId;
                if (obj.kotaePressedId)  el.dataset.kotaePressedId  = obj.kotaePressedId;
                // LIBRO+製（他ツール由来）known系のリサイズ禁止フラグ（reinitElementが参照）
                if (obj.libroLockedSize) el.dataset.libroLockedSize = obj.libroLockedSize;
                // アイコン型（.ann-icon-obj）は常に 1:1 を保証する。
                // ただし「正方形」の判定は、表示中ページではなく所属ページ（data-page）上で行う。
                // 復元時の px は表示中ページの基準サイズを座標系とするため、縦横比の違うページの
                // アイコンは現在の座標系では縦長／横長になるのが正しい（ページ移動時に
                // rebaseAnnotations() が正方形へ戻す）。これを短辺に丸めると長辺の情報が失われ、
                // アイコンが恒久的に縮む。所属ページ上の正方形は、現在の座標系では
                // 幅/高さ = k（= 表示中ページの縦横比 / 所属ページの縦横比）になる。
                // 所属ページを引き当てられない場合は k = 1（従来どおりの判定）。
                if (el.classList.contains('ann-icon-obj')) {
                  const iw = parseFloat(el.style.width);
                  const ih = parseFloat(el.style.height);
                  const ownPageNum = parseInt(el.dataset.page, 10);
                  const ownPage = (state.singlePages || state.bookPages)?.find(p => p.pageNum === ownPageNum);
                  const k = (ownPage?.width && ownPage?.height && pageRect.width && pageRect.height)
                    ? (pageRect.width / pageRect.height) / (ownPage.width / ownPage.height)
                    : 1;
                  const ihOwn = ih * k;
                  if (iw > 0 && ih > 0 && Math.abs(iw - ihOwn) > 0.5) {
                    const size = Math.min(iw, ihOwn);
                    el.style.width  = size + 'px';
                    el.style.height = (size / k) + 'px';
                  }
                }
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
                  el.innerHTML = cfg ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cfg.iconViewBox || '0 0 24 24'}">${cfg.iconSvg}</svg>` : '';
                } else if (el.classList.contains('ann-image-obj')) {
                  let sd = {};
                  try { sd = JSON.parse(obj.savedData || '{}'); } catch (_) {}
                  renderAnnImageContent(el, sd);
                } else if (el.classList.contains('daimon-btn') || el.classList.contains('kotae-btn') || el.classList.contains('shomei-btn')) {
                  let sd = {};
                  try { sd = JSON.parse(obj.savedData || '{}'); } catch (_) {}
                  renderButtonVisual(el, obj.type, sd);
                }
                // ハンドラ再設定
                reinitElement(el);
                page.appendChild(el);
              });
              updateAnnotationVisibility();
              // 復元した data-group-id と新規発行IDが衝突しないようカウンタを引き上げる
              syncStickyGroupCounterFromDom();
              // 大問・答・証明ボタンのIDも同様に引き上げる
              syncButtonCountersFromDom();
              showToast('アノテーションをファイルから復元しました');
        }

    /**
     * LIBRO book由来の付箋（.sticky-note.libro-toggle）に対してCRAFT側で付けた編集情報を、
     * 自動保存スナップショットから復元する。
     *
     * これらの付箋要素はbook読み込み時に renderTogglePairs() が毎回描画し直すため
     * restoreAnnotationsFromArray() の再構築対象ではない（削除もされない）。一方で
     * 答ボタン・大問ボタン・証明ボタンとの紐付けや色上書きはCRAFT側の編集結果であり、
     * 復元しないとボタンだけが復元されて紐付き付箋を1件も引けなくなる
     * （閲覧モードで押しても何も起きず、再書き出しでもボタンが除外される）。
     *
     * 対応する要素は「ページ番号＋閉id」で引く（renderTogglePairsがdata-page/data-closed-idを
     * 付与済み）。要素が見つからない場合（book差し替え等）はその項目を無視する。
     * @param {Array<Object>|undefined} list - 自動保存スナップショットの libroStickies
     */
    export function restoreLibroStickyOverrides(list) {
      if (!Array.isArray(list)) return;
      const page = document.getElementById('pageLeft');
      if (!page) return;
      list.forEach(obj => {
        if (!obj || obj.closedId === undefined) return;
        const el = page.querySelector(
          `.sticky-note.libro-toggle[data-page="${obj.page}"][data-closed-id="${obj.closedId}"]`
        );
        if (!el) return;
        if (obj.kotaeId)    el.dataset.kotaeId    = obj.kotaeId;
        if (obj.kotaeOrigBg !== undefined) el.dataset.kotaeOrigBg = obj.kotaeOrigBg;
        if (obj.daimonId)   el.dataset.daimonId   = obj.daimonId;
        if (obj.shomeiId)   el.dataset.shomeiId   = obj.shomeiId;
        if (obj.groupId)    el.dataset.groupId    = obj.groupId;
        // 開閉方式（答ボタン紐付けで既定適用される「表示ボタン削除」）を savedData とクラスの
        // 両方へ復元する。applyStickyOpenMode() と同じ処理だが、storage.js から sticky.js への
        // 新規インポートを避けるためここではインラインで書く。
        if (obj.stickyOpenMode !== undefined) {
          let sd = {};
          try { sd = JSON.parse(el.dataset.savedData || '{}'); } catch (_) {}
          sd.annStickyOpenMode = obj.stickyOpenMode === '1' ? '1' : '0';
          el.dataset.savedData = JSON.stringify(sd);
          el.classList.toggle('sticky-open-locked', obj.stickyOpenMode === '1');
        }
        if (obj.kotaeOrigOpenMode !== undefined) el.dataset.kotaeOrigOpenMode = obj.kotaeOrigOpenMode;
        if (obj.stickyColorOverride !== undefined) {
          // 色上書き（設定ダイアログで色を選び直した状態）は、閉側プレビュー用の
          // オーバーレイ要素とセットで復元する（confirmAnnotation と同じ構成）
          el.dataset.stickyColorOverride = obj.stickyColorOverride;
          if (obj.stickyColorOverrideHex !== undefined) {
            el.dataset.stickyColorOverrideHex = obj.stickyColorOverrideHex;
          }
          const colorIdx = parseInt(obj.stickyColorOverride, 10);
          let overlay = el.querySelector('.libro-toggle-color-override');
          if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'libro-toggle-color-override';
            el.appendChild(overlay);
          }
          overlay.style.background = getStickyColor(colorIdx, obj.stickyColorOverrideHex);
        }
      });
      // 復元した data-group-id と新規発行IDが衝突しないようカウンタを引き上げる
      syncStickyGroupCounterFromDom();
      // 大問・答・証明ボタンのIDも同様に引き上げる
      syncButtonCountersFromDom();
    }

    /**
     * ファイル名と拡張子からメディアの再生URL を解決する。
     * ZIPから読み込んだファイルがあればBlobURLを返し、無ければ空文字を返す。
     * 以前は `/mock/ver2/_media/` 配下の従来パスへフォールバックしていたが、
     * このパスは開発環境にも本番サーバにも存在せず必ず404になっていた（旧プロトタイプの残骸）。
     * 呼び出し側は空文字を「ファイルが見つからない」として扱い、ユーザーへ通知する。
     * @param {string} fileName - 拡張子なしのファイル名
     * @param {string} ext      - 拡張子（"mp3" または "mp4"）
     * @returns {string} 再生URL。見つからない場合は空文字
     */
    export function resolveMediaSrc(fileName, ext) {
      const key = `${fileName}.${ext}`;
      return mediaBlobs[key] || '';
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
     * LIBRO bookフォルダ形式（ZIPルート直下に index.json を持つ）のみを受け付ける。
     *
     * 独自ZIP形式（annotations.json ＋ メディア一式）の読み込みは廃止した。書き出し機能は
     * 既に廃止済みで読込コードのみが残っていたこと、および当該分岐が state.libroBook = null を
     * 実行するため読込失敗時に開いているbookを壊す構造だったことによる。
     * @param {Event} event - ファイル選択イベント
     */
    export async function handleZipFile(event) {
      const file = event.target.files[0];
      if (!file) return;
      showLoader();
      try {
        const zip = await JSZip.loadAsync(file);

        // ルート直下にindex.jsonが無いZIPは受け付けない。
        // state を一切変更せずに終了するため、開いているbookはそのまま残る。
        if (!isLibroBookZip(zip)) {
          showToast('LIBRO book形式のZIPではありません');
          return;
        }

        // LIBRO+由来のアノテーションを含むbookは読み込まない。
        // handleLibroBookZip() は先頭で mediaBlobs を解放・初期化するため、
        // この判定は必ずその手前で行う（開いているbookを壊さないため）。
        const loadable = await checkLibroBookLoadable(zip);
        if (!loadable.ok) {
          showToast(loadable.reason === 'libro-annots'
            ? 'LIBRO+由来のアノテーションを含むbookは読み込めません'
            : 'LIBRO book形式のZIPではありません');
          return;
        }

        await handleLibroBookZip(zip, file.name);
      } catch (e) {
        showToast('ZIP読込エラー: ファイルが壊れているか形式が正しくありません');
        console.error(e);
      } finally {
        hideLoader();
      }
    }


    /**
     * LIBRO bookフォルダ形式のZIPを読み込み、ページ画像を表示しアノテーションを復元する。
     * 既知のアノテーション（ページリンク／外部リンク／音声再生／付箋等の開閉）はContentsBuilderの
     * オブジェクトとして復元し、未知のアノテーションは編集UIに出さず内部に保持するのみとする
     * （書き出しは現段階では未対応）。
     * @param {JSZip} zip - JSZip.loadAsync 済みのZIPオブジェクト
     * @param {string} zipFileName - ユーザーが選択したzipファイル名。完了トーストの表示に使うほか、
     *                               book folder名が空の場合のbook識別子フォールバックにも使う
     */
    async function handleLibroBookZip(zip, zipFileName) {
      // 別bookの同名ファイル（"0001.mp3"等）のBlobURLが誤って再利用されないよう、
      // 既存BlobURLを解放してmediaBlobsを初期化する
      Object.values(mediaBlobs).forEach(url => URL.revokeObjectURL(url));
      Object.keys(mediaBlobs).forEach(k => delete mediaBlobs[k]);

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
      // 付箋グループIDも同様に引き上げる（renderTogglePairs が libro-craft-meta の
      // group-id から data-group-id を復元するため、この位置で走らせる必要がある）
      syncStickyGroupCounterFromDom();
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
      // book側に記録された環境設定を無条件で適用する（無ければlocalStorageの値へ戻す）
      applyBookSettings(indexJson);
      updateTocButtonState();
      updateNavButtonStates();
      updateLibroBookBtnStates();
      // book識別子：LIBRO book folder名（baseDir）。folder無し（index.jsonがzipルート直下）の場合は
      // 元zipファイル名にフォールバックする
      const bookId = baseDir || zipFileName;
      state.currentBookId = bookId;
      updateAuthoringPanelState();

      // 未暗号化ファイルの検出は保存時の挙動に関わるため、読み込み完了トーストに併記する
      const unencryptedNote = unencryptedAssetPaths.size > 0
        ? `（未暗号化ファイル${unencryptedAssetPaths.size}件を検出。保存時に暗号化します）`
        : '';
      showToast(`${zipFileName} を読み込みました${unencryptedNote}`);
      trackEvent('book_load', { load_route: 'zip', page_count: pages.length });
      await checkAndPromptRestoreForBook(bookId);
    }


    /**
     * LIBRO bookとして読み込んだ内容を、LIBRO bookフォルダ形式のZIPとして書き出す。
     * ページリンク・外部リンク・音声再生・Plusファイル・付箋（Hide/Show）に対応する。
     * 動画は内部ファイル（annVideoSrc: '0'→toMovieBNR）とJ-stream指定（'2'→toMovie）に対応し、
     * 外部タグ指定（'1'）はLIBRO側に対応actionが無いため未対応のまま。
     * LIBRO由来の大問ボタンは編集非対応のため、削除されていない限り生データを無変更のまま書き戻す
     * （位置編集した場合は反映されない）。それ以外の種別（答/証明ボタン、新規作成の大問ボタン等）
     * が存在する場合はトーストで警告し、書き出し対象から除外する。
     */
    export async function saveAnnotationsAsLibroBook() {
      if (!state.libroBook) {
        showToast('LIBRO bookとして読み込んだ場合のみ書き出せます');
        return;
      }
      // 見開き表示中は座標基準（#pageLeft の実寸）が見開き紙面のものになるため書き出せない
      if (state.viewMode === 'spread') {
        showToast('見開き表示中は書き出せません。単ページ表示に切り替えてください');
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
      // 新規作成の大問ボタン（LIBRO由来でない）は、紐付き付箋のID解決後にまとめて
      // Hide/Showペアへ変換するため、ここでは要素だけを保持しdomAnnotationsには含めない
      const newDaimonButtons = [];
      // 答ボタン（kotae）は大問ボタンと同一構造のため、同じくID解決後にまとめて変換する
      const newKotaeButtons = [];
      elements.forEach(el => {
        const type = el.dataset.type;
        if (type === 'daimon' && el.dataset.libroToggle === '1') {
          survivingDaimonIds.add(`${el.dataset.page}:${el.dataset.id}`);
          return;
        }
        if (type === 'daimon') {
          newDaimonButtons.push(el);
          return;
        }
        if (type === 'kotae') {
          newKotaeButtons.push(el);
          return;
        }
        // 動画は内部ファイル（annVideoSrc: '0'→toMovieBNR）とJ-stream指定（'2'→toMovie）のみ書き出し可能。
        // annVideoSrcが欠落したデータ（2026-07-21〜2026-07-23のUI不具合で作成された新規J-stream動画・
        // その自動保存復元分）の判定は resolveVideoSrc() 側で補正する。書き出し側
        // （convertAnnotationToLibroAnnot）と同じ関数を使い、判定のズレによる
        // 「警告も出ずに書き出しから消える」状態が再発しないようにする。
        let isSupported = supportedTypes.has(type);
        if (type === 'video') {
          let vsd = {};
          try { vsd = JSON.parse(el.dataset.savedData || '{}'); } catch (_) {}
          const vsrc = resolveVideoSrc(vsd);
          isSupported = vsrc === '0' || vsrc === '2';
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
      //
      // バケットのキーは「ページ番号＋groupId」とする。#pageLeft には全ページ分の付箋が
      // 共存しており（表示外は .ann-hidden-page）、groupId だけでまとめると別ページの
      // 同一groupId付き付箋が1つのバケットへ混ざり、代表ページ（先頭要素のページ）へ
      // 全メンバーがまとめて書き出されてしまう（付箋が別ページへ配置される不具合）。
      // グループIDの衝突自体は復元時のカウンタ引き上げ（syncStickyGroupCounterFromDom）で
      // 防いでいるが、既存データに衝突が残っていても書き出しがページを跨がないようにする。
      const groupBuckets = new Map(); // `${pageNum}::${gid}` -> { pageNum, gid, members: HTMLElement[] }
      // 単独付箋（data-group-idなし）に振る合成idの連番。従来は `__solo-${dataset.id}` として
      // いたが、dataset.id が重複した付箋（複製由来）があると単独付箋どうしが同じバケットへ
      // 集約され、書き出したbookを再読込した際に1グループとして誤って復元される。
      // 書き出し1回の中で必ず一意になる連番を使う。
      let soloSeq = 0;
      page.querySelectorAll('.sticky-note').forEach(el => {
        // 証明ボタン（shomei）紐付き付箋は、shomeiボタン自体がLIBRO+書き出し未対応のため
        // 「開閉するボタンの無い付箋」を出力しないよう、暫定的に書き出しから除外する
        // （解答は露出するが破損はしない。shomei正式対応時に本除外を撤去する）。
        if (el.dataset.shomeiId) return;
        const pageNum = parseInt(el.dataset.page, 10) || 1;
        const gid = el.dataset.groupId || `__solo-${++soloSeq}`;
        const key = `${pageNum}::${gid}`;
        if (!groupBuckets.has(key)) groupBuckets.set(key, { pageNum, gid, members: [] });
        groupBuckets.get(key).members.push(el);
      });

      // 同一groupIdが複数ページに散っている場合（既存データにIDの衝突が残っているケース）は、
      // 書き出す group-id もページごとに分ける。分けないと、書き出したbookを再読込した際に
      // renderTogglePairs() が group-id 一致で（ページを区別せず）グループを再構成し、
      // ページを跨いだ1グループとして復元されて同じ不具合が再発する。
      const pagesByGid = new Map();
      groupBuckets.forEach(({ pageNum, gid }) => {
        if (!pagesByGid.has(gid)) pagesByGid.set(gid, new Set());
        pagesByGid.get(gid).add(pageNum);
      });

      // 大問ボタンが紐付く付箋のclosed/open idを引くための逆引き（付箋要素→id）。
      // 新規作成の大問ボタンをLIBROのHide/Showペアに変換する際、紐付き付箋の
      // targetsを組み立てるのに使う（新規付箋・LIBRO由来付箋のどちらでも解決できる）。
      const stickyIdsByEl = new Map();

      const domStickyGroups = [];
      groupBuckets.forEach(({ pageNum, gid, members }) => {
        const memberDescs = members.map(el => {
          const left   = parseFloat(el.style.left)   || 0;
          const top    = parseFloat(el.style.top)    || 0;
          const width  = parseFloat(el.style.width)  || el.offsetWidth;
          const height = parseFloat(el.style.height) || el.offsetHeight;
          const style = `left:${(left / pageRect.width) * 100}%;top:${(top / pageRect.height) * 100}%;` +
                        `width:${(width / pageRect.width) * 100}%;height:${(height / pageRect.height) * 100}%;`;

          let closedId, openId, desc;
          // 答ボタン（.kotae-btn）に紐付いた付箋は、CRAFT画面上と同じく「閉」（解答を隠す面）を
          // 紙色（STICKY_COLOR_MAPのインデックス3＝#ffffff）で書き出す。
          // 見た目の確定はCSS（.sticky-note[data-kotae-id].state-visible）と対になっている。
          const isKotaeLinked = !!el.dataset.kotaeId;
          if (el.dataset.libroToggle === '1') {
            // 既存付箋：id・画像は基本そのまま再利用する。
            // 「開」（解答等が描き込まれている可能性がある元画像）は常に無変更のまま維持し、
            // 答ボタン紐付け（紙色）または色が上書きされた場合（dataset.stickyColorOverride）のみ
            // 「閉」だけを新規生成する。
            closedId = parseInt(el.dataset.closedId, 10);
            openId   = parseInt(el.dataset.openId, 10);
            const closedFile = el.dataset.closedFile;
            const openFile   = el.dataset.openFile;
            if (isKotaeLinked) {
              desc = { closedId, openId, closedFile, openFile, closedMode: 'color', openMode: 'reuse', color: STICKY_COLOR_MAP[3], style };
            } else if (el.dataset.stickyColorOverride) {
              const colorIdx = parseInt(el.dataset.stickyColorOverride, 10);
              const color = getStickyColor(colorIdx, el.dataset.stickyColorOverrideHex);
              desc = { closedId, openId, closedFile, openFile, closedMode: 'color', openMode: 'reuse', color, style };
            } else {
              desc = { closedId, openId, closedFile, openFile, closedMode: 'reuse', openMode: 'reuse', style };
            }
          } else {
            // 新規付箋：閉id（dataset.id）は既存を再利用し、開idは初回のみ発行してdatasetにキャッシュする
            // （再エクスポート時に毎回新規idを発行して不要なファイルが増えるのを防ぐため）
            closedId = parseInt(el.dataset.id, 10);
            if (!el.dataset.stickyOpenId) el.dataset.stickyOpenId = String(++state.annIdCounter);
            openId = parseInt(el.dataset.stickyOpenId, 10);
            let sd = {};
            try { sd = JSON.parse(el.dataset.savedData || '{}'); } catch (_) {}
            const colorIdx = parseInt(sd.annColor || '0', 10);
            const color = isKotaeLinked
              ? STICKY_COLOR_MAP[3]
              : getStickyColor(colorIdx, sd.annColorHex);
            desc = { closedId, openId, closedMode: 'color', openMode: 'transparent', color, style };
          }
          // 「開削除」設定（3-2-4/3-2-5節でクラス反映済み）をLIBRO書き出し側へ伝える。
          // 答ボタン紐付き付箋には作成時に既定適用されるため .libro-toggle付箋にも付きうるが、
          // 紐付き付箋はもともと closedMode:'color' ＋紙色で書き出されるため閉側の見た目は変わらず、
          // 変わるのは閉側 annot の actions が空になる（自己クリックで開かない）点だけ。
          desc.openLocked = el.classList.contains('sticky-open-locked');
          // 大問ボタン・答ボタンとの紐付けを libro-craft-meta へ明示記録するための情報。
          // 値は convertDaimonButtonToLibroAnnots へ渡す groupId（`daimon-${did}` / `kotae-${kid}`）と
          // 同一形式にし、再インポート時に renderTogglePairs がボタン要素へ突き合わせられるようにする。
          if (el.dataset.daimonId) desc.btnDaimonGroupId = `daimon-${el.dataset.daimonId}`;
          if (el.dataset.kotaeId)  desc.btnKotaeGroupId  = `kotae-${el.dataset.kotaeId}`;
          // 付箋側の開閉へ答ボタンの見た目を追従させるため、後段（kotaeIdsByKotaeId構築後）の
          // 第2パスで答ボタンのclosed/openペアidを解決する。ここではその引き当てキーだけを控える
          // （この時点では答ボタン側のidがまだ確定していない）。第2パスの最後に削除する一時キー。
          if (el.dataset.kotaeId) desc.kotaeLinkId = el.dataset.kotaeId;
          // 答ボタン紐付け前の開閉方式。答ボタンを削除したときの復帰値としてメタへ往復させる
          // （これが無いと再読込後の答ボタン削除で一律「通常開閉」に戻ってしまう）。
          if (el.dataset.kotaeOrigOpenMode !== undefined) desc.kotaeOrigOpenMode = el.dataset.kotaeOrigOpenMode;
          stickyIdsByEl.set(el, { closedId, openId });
          return desc;
        });
        // 同一gidが複数ページに散っている場合のみ、書き出すgroup-idをページごとに分ける
        const exportGid = (pagesByGid.get(gid)?.size || 1) > 1 ? `${gid}--p${pageNum}` : gid;
        domStickyGroups.push({ pageNum, members: memberDescs, groupId: exportGid });
      });

      // 【追加要件②】daimon配下の付箋を共有する答ボタンをdaimonのHide/Showターゲットへ
      // 連動メンバーとして加えるため、daimonループより前に「書き出し対象となる答ボタン」の
      // closed/open idを先に確定し、kotaeId→{closedId,openId} の対応表を作る。
      // ここでのid確定は後段の newKotaeButtons ループと同じ dataset.kotaePressedId を用いるため
      // idの二重発行は起きない（未設定時のみ発行し、後段は再利用する）。対象条件（付箋メンバー
      // 1件以上）も後段ループと一致させ、書き出されない答ボタンは対応表に載せない。
      const kotaeIdsByKotaeId = new Map();
      newKotaeButtons.forEach(btn => {
        const kid = btn.dataset.kotaeId;
        if (!kid) return;
        const linkedStickies = [...document.querySelectorAll(`.sticky-note[data-kotae-id="${kid}"]`)];
        const members = linkedStickies.map(el => stickyIdsByEl.get(el)).filter(Boolean);
        if (members.length === 0) return;
        const closedId = parseInt(btn.dataset.id, 10);
        if (!btn.dataset.kotaePressedId) btn.dataset.kotaePressedId = String(++state.annIdCounter);
        const openId = parseInt(btn.dataset.kotaePressedId, 10);
        kotaeIdsByKotaeId.set(kid, { closedId, openId });
      });

      // 付箋側の開閉操作に答ボタンの押下見た目を追従させるため（CRAFT側の
      // syncKotaeButtonPressedByStickies と同じ対応をLIBRO+で再現するため）、
      // 付箋annotのHide/Showターゲットへ答ボタンのclosed/openペアidを加える。
      // LIBRO+のactionsには「配下がすべて閉か」の判定ができないため、答ボタン配下の付箋が
      // すべて同一の付箋グループに収まっている場合のみ連動させる（複数グループに跨る答ボタンは
      // 片方だけ閉じたときにCRAFTと食い違うため、従来どおり連動させない）。
      domStickyGroups.forEach(group => {
        const countByKotaeId = new Map();
        group.members.forEach(m => {
          if (!m.kotaeLinkId) return;
          countByKotaeId.set(m.kotaeLinkId, (countByKotaeId.get(m.kotaeLinkId) || 0) + 1);
        });
        const kotaePairs = [];
        countByKotaeId.forEach((countInGroup, kid) => {
          const pair = kotaeIdsByKotaeId.get(kid);
          if (!pair) return;
          // 書き出し対象外の付箋（証明ボタン紐付き等）が混ざっている答ボタンもここで除外される
          const totalLinked = document.querySelectorAll(`.sticky-note[data-kotae-id="${kid}"]`).length;
          if (totalLinked !== countInGroup) return;
          kotaePairs.push(pair);
        });
        if (kotaePairs.length > 0) group.kotaePairs = kotaePairs;
        group.members.forEach(m => { delete m.kotaeLinkId; });
      });

      // 新規作成の大問ボタン：紐付く付箋（新規・LIBRO由来いずれも）のclosed/open idを
      // stickyIdsByElから解決し、LIBROのHide/Showペア（4アクション形式）へ変換できる形に集約する。
      // 証明ボタンに紐付いた大問ボタンは、証明ボタン自体が書き出し未対応のため
      // 従来どおり警告のうえ対象から除外する（付箋のみ紐付いた大問ボタンのみを対象とする）。
      const domDaimonButtons = [];
      newDaimonButtons.forEach(btn => {
        const did = btn.dataset.daimonId;
        const hasShomeiLink = did && document.querySelector(`.shomei-btn[data-daimon-id="${did}"]`);
        const linkedStickies = did ? [...document.querySelectorAll(`.sticky-note[data-daimon-id="${did}"]`)] : [];
        const members = linkedStickies.map(el => stickyIdsByEl.get(el)).filter(Boolean);
        if (hasShomeiLink || members.length === 0) {
          unsupportedTypes.add(ANNOTATION_TYPE_CONFIG.daimon?.label || 'daimon');
          return;
        }
        // 【追加要件②】daimon配下の付箋を共有する答ボタンも連動メンバーとして加える。
        // これによりdaimonのHide/Showターゲットに答ボタンのclosed/open idが含まれ、
        // LIBRO+でdaimon押下時に付箋と同時に答ボタン画像も同期する（付箋共有で自動検出）。
        const linkedKotaeIds = new Set(linkedStickies.map(s => s.dataset.kotaeId).filter(Boolean));
        linkedKotaeIds.forEach(kid => {
          const km = kotaeIdsByKotaeId.get(kid);
          if (km) members.push(km);
        });

        const left   = parseFloat(btn.style.left)   || 0;
        const top    = parseFloat(btn.style.top)    || 0;
        // 大問ボタンはCSS固定サイズ（style.width/heightを持たない）のためoffsetWidth/Heightに
        // 頼るが、紐付き付箋が別ページにある場合など、書き出し操作時に大問ボタン自身が
        // 現在表示中のページでない（.ann-hidden-page＝display:noneで実寸0になる）ことがある。
        // 計測のため一時的に非表示クラスを外して実寸を取得し、直後に元に戻す。
        const wasHiddenPage = btn.classList.contains('ann-hidden-page');
        if (wasHiddenPage) btn.classList.remove('ann-hidden-page');
        const width  = parseFloat(btn.style.width)  || btn.offsetWidth;
        const height = parseFloat(btn.style.height) || btn.offsetHeight;
        if (wasHiddenPage) btn.classList.add('ann-hidden-page');
        const style = `left:${(left / pageRect.width) * 100}%;top:${(top / pageRect.height) * 100}%;` +
                      `width:${(width / pageRect.width) * 100}%;height:${(height / pageRect.height) * 100}%;`;

        // 通常時（closed・visible・大ID側）はdataset.idを再利用し、押下時（open・hidden・小ID側）は
        // 初回のみ発行してdatasetにキャッシュする（付箋のstickyOpenIdと同じ方式）
        const closedId = parseInt(btn.dataset.id, 10);
        if (!btn.dataset.daimonPressedId) btn.dataset.daimonPressedId = String(++state.annIdCounter);
        const openId = parseInt(btn.dataset.daimonPressedId, 10);

        let sd = {};
        try { sd = JSON.parse(btn.dataset.savedData || '{}'); } catch (_) {}

        domDaimonButtons.push({
          pageNum: parseInt(btn.dataset.page, 10) || 1,
          closedId,
          openId,
          style,
          savedData: sd,
          groupId: `daimon-${did}`,
          members,
        });
      });

      // 答ボタン（kotae）：大問ボタンと同一構造（マスター＋紐付き付箋のHide/Showペア）のため、
      // btnType:'kotae' を付けて大問ボタンと同じ変換パイプライン（domDaimonButtons）に載せる。
      // daimon固有のlibro-toggle passthrough・hasShomeiLink除外は存在しないので単純化している。
      newKotaeButtons.forEach(btn => {
        const kid = btn.dataset.kotaeId;
        const linkedStickies = kid ? [...document.querySelectorAll(`.sticky-note[data-kotae-id="${kid}"]`)] : [];
        const members = linkedStickies.map(el => stickyIdsByEl.get(el)).filter(Boolean);
        if (members.length === 0) {
          unsupportedTypes.add(ANNOTATION_TYPE_CONFIG.kotae?.label || 'kotae');
          return;
        }

        const left = parseFloat(btn.style.left) || 0;
        const top  = parseFloat(btn.style.top)  || 0;
        // 大問ボタンと同様、紐付き付箋が別ページにある等でボタンが非表示ページ（実寸0）に
        // なっている場合に備え、一時的に非表示クラスを外して実寸を取得する。
        const wasHiddenPage = btn.classList.contains('ann-hidden-page');
        if (wasHiddenPage) btn.classList.remove('ann-hidden-page');
        const width  = parseFloat(btn.style.width)  || btn.offsetWidth;
        const height = parseFloat(btn.style.height) || btn.offsetHeight;
        if (wasHiddenPage) btn.classList.add('ann-hidden-page');
        const style = `left:${(left / pageRect.width) * 100}%;top:${(top / pageRect.height) * 100}%;` +
                      `width:${(width / pageRect.width) * 100}%;height:${(height / pageRect.height) * 100}%;`;

        // 通常時（closed・visible・大ID側）はdataset.idを再利用、押下時（open・hidden・小ID側）は
        // 初回のみ発行してdatasetにキャッシュ（大問ボタンのdaimonPressedIdと同じ方式）。
        const closedId = parseInt(btn.dataset.id, 10);
        if (!btn.dataset.kotaePressedId) btn.dataset.kotaePressedId = String(++state.annIdCounter);
        const openId = parseInt(btn.dataset.kotaePressedId, 10);

        let sd = {};
        try { sd = JSON.parse(btn.dataset.savedData || '{}'); } catch (_) {}

        domDaimonButtons.push({
          pageNum: parseInt(btn.dataset.page, 10) || 1,
          closedId,
          openId,
          style,
          savedData: sd,
          groupId: `kotae-${kid}`,
          members,
          btnType: 'kotae',
        });
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
        const zip = await buildLibroBookExport(state.libroBook, domAnnotations, passthroughAnnotations, domStickyGroups, domDaimonButtons);
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'libro_book.zip';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
        showToast('LIBRO形式で書き出しました');
        trackEvent('book_export');
      } catch (e) {
        showToast('LIBRO書き出しエラー: ' + e.message);
        console.error(e);
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
    }


    /**
     * 指定種別のグレーアウトフォームを sideDetailEmpty に再構築する。
     * 共通セクション（位置・W/H・塗り色）を常時表示し、
     * 種別固有フィールドはヒントテキストで代替表示する。
     * @param {string} type - アノテーション種別
     */
    function _renderGrayedPanel(type) {
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
          <p class="side-detail-title">${escapeHtml(cfg?.label ?? type)}設定</p>
          <div class="side-detail-form"><dl>${commonRows}</dl></div>
        </div>`;
    }


    /**
     * ダイアログの保存処理（モック）。
     */
    export function saveDialog() {
      closeDialog();
      updateStatus();
    }
