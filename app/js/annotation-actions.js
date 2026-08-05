import { openAnnotationSettingsDialog, openEditPopup } from './annotation-dialog.js';
import { ANNOTATION_TYPE_CONFIG } from './config.js';
import { updatePageDisplay } from './page-view.js';
import { selectedStickySet, state } from './state.js';
import { closeDialog, resolveMediaSrc } from './storage.js';
import { escapeHtml, showToast, updateStatus } from './ui-common.js';


    /** Plusファイルの表示方法（annShowMode）とUI表記の対応。設定ダイアログのラジオ表記に合わせる。 */
    const PLUSFILE_SHOW_MODE_LABEL = { '0': 'ページ内', '1': '別タブ', '2': 'フローティング' };

    /**
     * 閲覧モードで window.open してよいURLかを判定する。
     * http/https のみ許可し、スキーム無し（'www.example.com'）は補完せず不許可とする。
     * javascript: / data: はこの判定で自動的に除外される。
     *
     * 注意：この判定はクリック時専用。保存・書き出し時には使わないこと。
     * annUrl には LIBRO 側でeval実行される擬似関数（toFlashcard(...) 等）が
     * 生文字列のまま入る仕様で、libro-format.js がそのまま URI へ書き戻すため、
     * 保存時に弾くと round-trip が壊れてデータが欠損する。
     * @param {string} url
     * @returns {boolean}
     */
    function isHttpUrl(url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch (_) {
        return false;
      }
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    }

    /**
     * 別タブ表示用「CRAFTでは閲覧できません」ページのBlobURL。
     * 内容が固定のため1本だけ生成して使い回す（解放するとタブのリロードが
     * 失敗するため revokeObjectURL は呼ばない。数百バイトのため実害なし）。
     */
    let _plusfileUnavailablePageUrl = null;

    /**
     * Plusファイルを「別タブ」で開いたときに表示するメッセージページのURLを返す。
     * data: URL はChromeがトップレベル遷移を禁止しているため使えず、blob: を用いる。
     * @returns {string}
     */
    function getPlusfileUnavailablePageUrl() {
      if (_plusfileUnavailablePageUrl) return _plusfileUnavailablePageUrl;
      const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>CRAFTでは閲覧できません</title>
<style>
  body { margin: 0; height: 100vh; display: flex; flex-direction: column;
         align-items: center; justify-content: center; gap: 8px;
         font-family: sans-serif; background: #fff; }
  .msg { margin: 0; font-size: 16px; font-weight: 700; color: #444; }
  .sub { margin: 0; font-size: 13px; color: #888; }
</style>
</head>
<body>
<p class="msg">CRAFTでは閲覧できません</p>
<p class="sub">表示方法: 別タブ</p>
</body>
</html>`;
      _plusfileUnavailablePageUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      return _plusfileUnavailablePageUrl;
    }

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
          // Plusファイルの実体（appendixディレクトリ）はCRAFTの管理対象外で、
          // プレビューは常に空になる（仕様。詳細は docs/plans の調査メモ参照）。
          // 実体を読み込もうとせず「閲覧できません」と明示した画面を出す。
          // 実体を一切ロードしないため、細工bookから任意HTMLを読み込ませる経路も存在しない。
          const showModeLabel = PLUSFILE_SHOW_MODE_LABEL[showMode] || showMode;
          if (showMode === '1') {
            // 別タブ：同じ文言のメッセージページ（BlobURL）を開く
            window.open(getPlusfileUnavailablePageUrl(), '_blank', 'noopener');
            updateStatus();
          } else {
            // ページ内（'0'）／フローティング（'2'）はどちらもポップアップで表示する。
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
                <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escapeHtml(file)}</span>
                <span class="plusfile-close" id="plusfileClose">×</span>
              </div>
              <div class="plusfile-unavailable">
                <p class="plusfile-unavailable-msg">CRAFTでは閲覧できません</p>
                <p class="plusfile-unavailable-sub">表示方法: ${escapeHtml(showModeLabel)}</p>
              </div>
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
          if (!url) { updateStatus(); break; }
          // annUrl には実URLのほか、LIBRO側でeval実行される擬似関数
          // （toFlashcard(...) / toListening(...) 等）が生文字列のまま入る。
          // CRAFTでは開けないため、http/https以外は開かずに通知する。
          // 設定値そのものは編集モードの設定ダイアログで確認できるため、トーストには含めない。
          // 判定はここ（クリック時）だけで行い、保存・書き出し時は annUrl を一切加工しない。
          if (isHttpUrl(url)) {
            window.open(url, '_blank', 'noopener');
          } else {
            showToast('CRAFTでは閲覧できません');
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
           * @param {string} titleText - タイトルバーに表示するテキスト（内部でエスケープする）
           * @param {string} bodyHtml  - モーダル本体に挿入するHTML。
           *   innerHTMLへそのまま渡すため、**開発者が管理するHTMLのみ**を渡すこと。
           *   book由来の文字列（savedData.annFile 等）を直接渡してはならない（XSSになる）。
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
            // 外部タグ（HTML断片）はLIBRO+側でのみ展開される。
            // CRAFTでは描画せず「閲覧できません」を表示する（外部リンク・Plusファイルと同じ方針）。
            // book由来の文字列をHTMLとして解釈しないことでXSSを防ぐ。
            // なお外部タグ指定はエクスポート自体が未対応のため、書き出し結果には影響しない。
            openVideoModal('動画', `
              <div class="video-unavailable">
                <p class="video-unavailable-msg">CRAFTでは閲覧できません</p>
                <p class="video-unavailable-sub">動画ソース: 外部タグ指定</p>
              </div>
            `);
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
