import { applyLiveUpdate, buildAnnDialogFields } from './annotation-dialog.js';
import { ANNOTATION_TYPE_CONFIG, STICKY_COLOR_MAP } from './config.js';
import { reinitElement, updateAlignPanel } from './annotation-interaction.js';
import { updateAnnotationVisibility } from './pdf-view.js';
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
          const pageRect = page.getBoundingClientRect();
          const elements = page.querySelectorAll('.sticky-note, .ann-object, .ann-icon-obj, .daimon-btn, .kotae-btn, .shomei-btn');
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
         * ローカルストレージからアノテーションを復元する。
         */
        /**
         * ファイル選択ダイアログを開く（読込ボタンから呼び出し）
         */
        export function loadAnnotations() {
          document.getElementById('annotationFileInput').value = '';
          document.getElementById('annotationFileInput').click();
        }


        /**
         * アノテーション配列からDOMを再構築する共通処理。
         * handleAnnotationFile / handleZipFile の両方から呼び出される。
         * @param {Array} arr - annotations.json のパース済み配列
         */
        export function restoreAnnotationsFromArray(arr) {
          const page = document.getElementById('pageLeft');
          const pageRect = page.getBoundingClientRect();
          // 既存アノテーションを全削除
          page.querySelectorAll('.sticky-note, .ann-object, .ann-icon-obj, .daimon-btn, .kotae-btn, .shomei-btn').forEach(el => el.remove());
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
                if (el.classList.contains('ann-object') && !el.classList.contains('dt-page-color')) {
                  let label = '';
                  try {
                    const sd = JSON.parse(obj.savedData || '{}');
                    label = (sd.annLabel || '').trim() || (ANNOTATION_TYPE_CONFIG[obj.type]?.label || obj.type);
                  } catch (_) { label = ANNOTATION_TYPE_CONFIG[obj.type]?.label || obj.type; }
                  const span = document.createElement('span');
                  span.className = 'ann-label';
                  span.textContent = label;
                  el.innerHTML = '';
                  el.appendChild(span);
                } else if (el.classList.contains('ann-icon-obj')) {
                  const cfg = ANNOTATION_TYPE_CONFIG[obj.type];
                  el.innerHTML = cfg ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${cfg.iconSvg}</svg>` : '';
                } else if (el.classList.contains('daimon-btn')) {
                  el.textContent = '大問';
                } else if (el.classList.contains('kotae-btn')) {
                  el.textContent = '答';
                } else if (el.classList.contains('shomei-btn')) {
                  el.textContent = '証明';
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
         * ファイル選択時の処理。JSONを読み込んでアノテーションを復元。
         */
        export function handleAnnotationFile(event) {
          const file = event.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function(e) {
            try {
              const arr = JSON.parse(e.target.result);
              restoreAnnotationsFromArray(arr);
            } catch (_) {
              showToast('読込エラー: データが壊れています');
            }
          };
          reader.readAsText(file);
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
        restoreAnnotationsFromArray(arr);
        const mediaCount = Object.keys(mediaBlobs).length;
        showToast(`ZIPから復元しました（メディア: ${mediaCount}件）`);
      } catch (e) {
        showToast('ZIP読込エラー: ファイルが壊れているか形式が正しくありません');
        console.error(e);
      }
    }


    /**
     * 現在のアノテーションと関連する音声・動画ファイルをまとめてZIPで保存する。
     * annFile フィールドを持つアノテーションのメディアファイルを収集してZIPに同梱する。
     */
    export async function saveAnnotationsAsZip() {
      const page = document.getElementById('pageLeft');
      const pageRect = page.getBoundingClientRect();
      const elements = page.querySelectorAll('.sticky-note, .ann-object, .ann-icon-obj, .daimon-btn, .kotae-btn, .shomei-btn');
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


    /* ============================
       ダイアログ設定定義
    ============================ */
    const dialogConfigs = {
      // 非sticky 5種別：フィールドIDのみ定義（フォームは buildAnnDialogFields で生成）
      pagelink: {
        title: 'ページリンク設定',
        fields: [
          { id: 'annDisplayType' }, { id: 'annPosX' }, { id: 'annPosY' },
          { id: 'annWidth' }, { id: 'annHeight' }, { id: 'annColor' }, { id: 'annTarget' },
        ]
      },
      plusfile: {
        title: 'Plusファイル設定',
        fields: [
          { id: 'annDisplayType' }, { id: 'annPosX' }, { id: 'annPosY' },
          { id: 'annWidth' }, { id: 'annHeight' }, { id: 'annColor' },
          { id: 'annShowMode' }, { id: 'annFile' },
        ]
      },
      externallink: {
        title: '外部リンク設定',
        fields: [
          { id: 'annDisplayType' }, { id: 'annPosX' }, { id: 'annPosY' },
          { id: 'annWidth' }, { id: 'annHeight' }, { id: 'annColor' },
          { id: 'annUrl' },
        ]
      },
      audio: {
        title: '音声再生設定',
        fields: [
          { id: 'annDisplayType' }, { id: 'annPosX' }, { id: 'annPosY' },
          { id: 'annWidth' }, { id: 'annHeight' }, { id: 'annColor' },
          { id: 'annFile' }, { id: 'annPlayMode' },
        ]
      },
      video: {
        title: '動画再生設定',
        fields: [
          { id: 'annDisplayType' }, { id: 'annPosX' }, { id: 'annPosY' },
          { id: 'annWidth' }, { id: 'annHeight' }, { id: 'annColor' },
          { id: 'annVideoSrc' }, { id: 'annFile' }, { id: 'annShowMode' },
        ]
      },
      sticky: {
        title: '付箋設定',
        fields: [
          { label: '背景色',   type: 'select',   id: 'annColor',  options: ['黄（標準）', '橙', '緑', '青', 'ピンク'] },
          { label: 'フォント', type: 'select',   id: 'annFont',   options: ['標準', '大', '小'] },
          { label: '位置', type: 'text',     id: 'annPos',    placeholder: 'X: 100, Y: 150' },
        ]
      }
    };


    /**
     * ダイアログを開く。
     * @param {string} type - アノテーション種別
     */
    export function openDialog(type) {
      const config = dialogConfigs[type];
      if (!config) return;

      // タイトル設定
      document.getElementById('dialogTitle').textContent = config.title;

      // フォーム生成
      const form = document.getElementById('dialogForm');
      form.innerHTML = '';
      config.fields.forEach(field => {
        const dt = document.createElement('dt');
        dt.textContent = field.label;
        const dd = document.createElement('dd');

        if (field.type === 'text') {
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'd-input';
          inp.id = field.id;
          inp.placeholder = field.placeholder || '';
          dd.appendChild(inp);
        } else if (field.type === 'textarea') {
          const ta = document.createElement('textarea');
          ta.className = 'd-input';
          ta.id = field.id;
          ta.placeholder = field.placeholder || '';
          ta.style.height = '72px';
          ta.style.resize = 'vertical';
          dd.appendChild(ta);
        } else if (field.type === 'select') {
          const wrap = document.createElement('div');
          wrap.className = 'd-select-wrap';
          const sel = document.createElement('select');
          sel.className = 'd-select';
          sel.id = field.id;
          (field.options || []).forEach((opt, i) => {
            const o = document.createElement('option');
            o.value = i;
            o.textContent = opt;
            sel.appendChild(o);
          });
          wrap.appendChild(sel);
          dd.appendChild(wrap);
        }

        form.appendChild(dt);
        form.appendChild(dd);
      });

      document.getElementById('sideDetailEmpty').style.visibility = 'hidden';
      document.getElementById('sideDetailActive').style.display = '';
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

    /** トースト非表示用タイマー */
    let _toastTimer = null;
