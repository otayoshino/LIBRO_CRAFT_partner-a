import { openAnnotationSettingsDialog, openEditPopup } from './annotation-dialog.js';
import { ANNOTATION_TYPE_CONFIG } from './config.js';
import { updatePageDisplay } from './page-view.js';
import { mediaBlobs, selectedStickySet, state } from './state.js';
import { closeDialog, resolveMediaSrc } from './storage.js';
import { showToast, updateStatus } from './ui-common.js';


    /**
     * 閲覧モード時のアノテーションボタンの実際の挙動。
     * @param {HTMLElement} ann
     */
    function fireAnnotationAction(ann) {
      const type = ann.dataset.type;
      let saved = {};
      try { saved = JSON.parse(ann.dataset.savedData || '{}'); } catch (_) {}

      switch (type) {
        case 'pagelink': {
          const targetPage = parseInt(saved.annTarget ?? '0', 10);
          if (targetPage >= 1 && targetPage <= state.totalPages) {
            state.currentPage = targetPage;
            updatePageDisplay();
          } else {
            showToast('ページリンク: 移動先ページが設定されていません');
          }
          break;
        }
        case 'plusfile': {
          const file = (saved.annFile || '').trim();
          if (!file) { updateStatus(); break; }
          const showMode = saved.annShowMode || '0';
          // ZIPから復元されたBlobURLを優先、なければ相対パスで解決
          const url = mediaBlobs[file] || `./${file}`;
          if (showMode === '1') {
            // 別タブで開く
            window.open(url, '_blank', 'noopener');
            updateStatus();
          } else {
            // ページ内（'0'）／フローティング（'2'）はどちらもiframeポップアップで表示する。
            // ただしLIBRO+側では「ページ内」はモーダル表示でウィンドウを動かせないため、
            // CRAFTのプレビューでもタイトルバードラッグ移動を無効にする。
            // 移動できるのは「フローティング」を選択した場合のみ。
            const isFloating = showMode === '2';
            const existing = document.getElementById('plusfilePopup');
            if (existing) existing.remove();
            const popup = document.createElement('div');
            popup.id = 'plusfilePopup';
            popup.innerHTML = `
              <div class="plusfile-title">
                <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${file}</span>
                <span class="plusfile-close" id="plusfileClose">×</span>
              </div>
              <iframe src="${url}" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
            `;
            document.body.appendChild(popup);
            // 画面中央に配置
            popup.style.left = Math.max(8, (window.innerWidth  - 760) / 2) + 'px';
            popup.style.top  = Math.max(8, (window.innerHeight - 520) / 2) + 'px';
            // 閉じるボタン
            document.getElementById('plusfileClose').onclick = () => popup.remove();
            const titleBar = popup.querySelector('.plusfile-title');
            if (isFloating) {
              // タイトルバードラッグ移動(フローティング時のみ)
              titleBar.addEventListener('mousedown', (e) => {
                if (e.target.id === 'plusfileClose') return;
                e.preventDefault();
                const sx = e.clientX, sy = e.clientY;
                const ol = parseInt(popup.style.left, 10) || 0;
                const ot = parseInt(popup.style.top,  10) || 0;
                const onMove = (ev) => {
                  popup.style.left = Math.max(0, Math.min(ol + ev.clientX - sx, window.innerWidth  - 760)) + 'px';
                  popup.style.top  = Math.max(0, Math.min(ot + ev.clientY - sy, window.innerHeight - 520)) + 'px';
                };
                const onUp = () => {
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup',   onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup',   onUp);
              });
            } else {
              // モーダル表示：ドラッグできないため move カーソルも出さない
              // （CSSの `#plusfilePopup .plusfile-title { cursor: move; }` をインラインで上書き）
              titleBar.style.cursor = 'default';
            }
            updateStatus();
          }
          break;
        }
        case 'externallink': {
          const url = (saved.annUrl || '').trim();
          if (url) {
            window.open(url, '_blank', 'noopener');
          } else {
            updateStatus();
          }
          break;
        }
        case 'audio': {
          const fileName = (saved.annFile || '').trim();
          if (!fileName) { updateStatus(); break; }
          const src = resolveMediaSrc(fileName, 'mp3');
          const playMode = saved.annPlayMode || '0';
          if (playMode === '1') {
            // コントローラーなし：そのまま再生
            const audio = new Audio(src);
            audio.play().catch(() => updateStatus());
            updateStatus();
          } else {
            // コントローラーあり：フローティングプレーヤーを表示
            const existing = document.getElementById('audioPlayerPopup');
            if (existing) existing.remove();
            const popup = document.createElement('div');
            popup.id = 'audioPlayerPopup';
            popup.innerHTML = `
              <div class="audio-player-title">
                <span style="font-size:12px;font-weight:700;">▶ ${fileName}</span>
                <span id="audioPlayerClose">×</span>
              </div>
              <div class="audio-player-body">
                <audio controls autoplay src="${src}"></audio>
              </div>
            `;
            document.body.appendChild(popup);
            // 画面中央下寄りに配置
            const pw = popup.offsetWidth || 320;
            const ph = popup.offsetHeight || 100;
            popup.style.left = Math.max(8, (window.innerWidth  - pw) / 2) + 'px';
            popup.style.top  = Math.max(8, window.innerHeight - ph - 60) + 'px';
            // 閉じるボタン
            document.getElementById('audioPlayerClose').onclick = () => {
              popup.querySelector('audio')?.pause();
              popup.remove();
            };
            // タイトルバードラッグ移動
            const titleBar = popup.querySelector('.audio-player-title');
            titleBar.addEventListener('mousedown', (e) => {
              if (e.target.id === 'audioPlayerClose') return;
              e.preventDefault();
              const sx = e.clientX, sy = e.clientY;
              const ol = parseInt(popup.style.left, 10) || 0;
              const ot = parseInt(popup.style.top,  10) || 0;
              const onMove = (ev) => {
                popup.style.left = Math.max(0, Math.min(ol + ev.clientX - sx, window.innerWidth  - popup.offsetWidth))  + 'px';
                popup.style.top  = Math.max(0, Math.min(ot + ev.clientY - sy, window.innerHeight - popup.offsetHeight)) + 'px';
              };
              const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup',   onUp);
            });
            updateStatus();
          }
          break;
        }
        case 'video': {
          const fileName = (saved.annFile || '').trim();
          const videoSrc = saved.annVideoSrc || '0';
          const showMode = saved.annShowMode || '0';

          /**
           * 動画モーダルを開くヘルパー。
           * @param {string} titleText - タイトルバーに表示するテキスト
           * @param {string} bodyHtml  - モーダル本体に挿入するHTML
           */
          const openVideoModal = (titleText, bodyHtml) => {
            // 既存モーダルがあれば動画を停止してから除去
            const prev = document.getElementById('videoPlayerModal');
            if (prev) {
              prev.querySelector('video')?.pause();
              prev.remove();
            }
            const modal = document.createElement('div');
            modal.id = 'videoPlayerModal';
            modal.innerHTML = `
              <div class="video-modal-box">
                <div class="video-modal-title">
                  <span>▶ ${titleText}</span>
                  <span class="video-modal-close">×</span>
                </div>
                <div class="video-modal-body">${bodyHtml}</div>
              </div>
            `;
            document.body.appendChild(modal);
            // 次フレームで is-open を付与してフェードイン
            requestAnimationFrame(() => modal.classList.add('is-open'));
            // 閉じる処理
            const closeModal = () => {
              modal.querySelector('video')?.pause();
              modal.remove();
              document.removeEventListener('keydown', onKeyDown);
            };
            modal.querySelector('.video-modal-close').addEventListener('click', closeModal);
            // オーバーレイ背景クリックで閉じる
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
            // Escキーで閉じる
            const onKeyDown = (e) => { if (e.key === 'Escape') closeModal(); };
            document.addEventListener('keydown', onKeyDown);
          };

          if (videoSrc === '1') {
            // 外部タグをモーダルで表示
            openVideoModal('動画', fileName);
            updateStatus();
          } else {
            if (!fileName) { updateStatus(); break; }
            const src = resolveMediaSrc(fileName, 'mp4');
            if (showMode === '1') {
              // 別タブで開く
              window.open(src, '_blank', 'noopener');
              updateStatus();
            } else {
              // モーダルで再生
              openVideoModal(fileName, `<video controls autoplay src="${src}"></video>`);
              updateStatus();
            }
          }
          break;
        }
        default:
          updateStatus();
      }
    }


    /**
     * アノテーション要素にクリックハンドラを設定する。
     * コピー（Alt+ドラッグ）時のクローン再初期化でも使用する。
     * @param {HTMLElement} ann - アノテーション要素
     */
    export function addAnnClickHandler(ann) {
      const type = ann.dataset.type;
      const cfg  = ANNOTATION_TYPE_CONFIG[type];
      ann.addEventListener('click', (e) => {
        // 複数選択のドラッグ移動直後に発火したclickは選択操作として扱わない（H-4と同じ理由）
        if (state.suppressObjectClick) { state.suppressObjectClick = false; return; }
        // 閲覧モード時：実際の挙動を実行
        if (document.body.classList.contains('is-view-mode')) {
          fireAnnotationAction(ann);
          return;
        }
        if (e.shiftKey) {
          // Shift+クリック：複数選択トグル（付箋との混在も維持）
          if (ann.classList.contains('is-selected')) {
            ann.classList.remove('is-selected');
            const remaining = document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected');
            if (remaining.length === 0 && selectedStickySet.size === 0) closeDialog();
          } else {
            ann.classList.add('is-selected');
            openAnnotationSettingsDialog(type, ann);
          }
          const count = document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected').length
                      + selectedStickySet.size;
          updateStatus();
        } else {
          const multiCount = selectedStickySet.size
            + document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').length;
          if (multiCount > 1 && ann.classList.contains('is-selected')) {
            // 複数選択中に選択済みオブジェクトをクリック：他の選択を解除してこの要素のみ選択
            selectedStickySet.forEach(n => n.classList.remove('is-selected'));
            selectedStickySet.clear();
            document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').forEach(a => a.classList.remove('is-selected'));
            ann.classList.add('is-selected');
            openAnnotationSettingsDialog(type, ann);
            updateStatus();
          } else {
            // 未選択オブジェクトクリック：全解除してこの要素のみ選択
            selectedStickySet.forEach(n => n.classList.remove('is-selected'));
            selectedStickySet.clear();
            document.querySelectorAll('.ann-object.is-selected, .ann-icon-obj.is-selected, .ann-image-obj.is-selected, .daimon-btn.is-selected, .kotae-btn.is-selected, .shomei-btn.is-selected').forEach(a => a.classList.remove('is-selected'));
            ann.classList.add('is-selected');
            openAnnotationSettingsDialog(type, ann);
            updateStatus();
          }
        }
      });

      // ダブルクリック：編集モード時に編集ポップアップを開く
      ann.addEventListener('dblclick', (e) => {
        if (document.body.classList.contains('is-view-mode')) return;
        e.preventDefault();
        e.stopPropagation();
        openEditPopup(ann);
      });
    }
