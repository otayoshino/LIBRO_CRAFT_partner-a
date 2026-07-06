    import { mediaBlobs } from './state.js';

    /** アノテーション永続化ストレージキー */
    export const STORAGE_KEY = 'ContentsBuilder_v2_annotations';

    export const UNDO_MAX  = 50;


    /** 付箋背景色マップ（dialogConfigs.stickyの annColor 選択肢インデックスに対応） */
    export const STICKY_COLOR_MAP = ['#4488cc', '#5ac46e', '#f7e04b'];


    /** アノテーション種別ごとの設定 */
    export const ANNOTATION_TYPE_CONFIG = {
      pagelink: {
        label: 'ページリンク', color: 'rgba(68,114,196,0.6)',
        iconSvg: '<path d="M17 7h-4v2h4c1.65 0 3 1.35 3 3s-1.35 3-3 3h-4v2h4c2.76 0 5-2.24 5-5s-2.24-5-5-5zm-6 8H7c-1.65 0-3-1.35-3-3s1.35-3 3-3h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-2zm1-4h-4v2h4v-2z"/>',
      },
      plusfile: {
        label: 'Plusファイル', color: 'rgba(112,173,71,0.6)',
        iconSvg: '<path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 10h-3v3h-2v-3H10v-2h3V7h2v3h3v2zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z"/>',
      },
      externallink: {
        label: '外部リンク', color: 'rgba(0,168,198,0.6)',
        iconSvg: '<path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>',
      },
      audio: {
        label: '音声再生', color: 'rgba(112,48,160,0.6)',
        iconSvg: '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>',
      },
      video: {
        label: '動画再生', color: 'rgba(192,0,0,0.6)',
        iconSvg: '<path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>',
      },
      sticky: { label: '付箋', color: null, iconSvg: '' },
      zu:     { label: '図',  color: null, iconSvg: '' },
      kotae:  { label: '答ボタン',  color: null, iconSvg: '' },
      daimon: { label: '大問ボタン', color: null, iconSvg: '' },
      shomei: { label: '証明ボタン', color: null, iconSvg: '' },
    };


    /**
     * ANNOTATION_TYPE_CONFIG.color の rgba(...) 文字列から "R,G,B" 部分だけを取り出す。
     * 紙面カラー型（.dt-page-color）の枠線・背景色を種別ごとに変えるため、
     * CSSカスタムプロパティ --ann-type-rgb 経由でCSS側に渡す用途で使う。
     */
    export function annTypeRgbTriplet(rgbaColor) {
      const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(rgbaColor || '');
      return m ? `${m[1]},${m[2]},${m[3]}` : '68,114,196';
    }

    /**
     * マーカー型／紙面カラー型アノテーション要素（.ann-object）の中身（種別アイコン・ラベル）を構築する。
     * 新規作成・更新・コピー貼付・Undo復元・保存データ復元の各箇所から共通で呼び出す
     * （呼び出し前に位置・サイズ・classNameは設定済みであること。アイコン型 .ann-icon-obj は対象外）。
     */
    export function renderAnnObjectContent(el, type, displayType, label) {
      const cfg = ANNOTATION_TYPE_CONFIG[type];
      el.innerHTML = '';

      if (displayType === 'page-color') {
        el.style.setProperty('--ann-type-rgb', annTypeRgbTriplet(cfg?.color));
      } else {
        el.style.removeProperty('--ann-type-rgb');
      }

      if (cfg?.iconSvg) {
        const iconWrap = document.createElement('span');
        iconWrap.className = 'ann-type-icon';
        iconWrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${cfg.iconSvg}</svg>`;
        el.appendChild(iconWrap);
      }

      if (displayType !== 'page-color') {
        const span = document.createElement('span');
        span.className = 'ann-label';
        span.textContent = (label || '').trim() || cfg?.label || type;
        el.appendChild(span);
      }
    }

    /**
     * 画像アイコン型アノテーション要素（.ann-image-obj）の中身（<img>）を構築する。
     * savedData.annIconImage をキーに mediaBlobs から画像を取得する。
     * 新規作成・更新・コピー貼付・Undo復元・保存データ復元の各箇所から共通で呼び出す。
     */
    export function renderAnnImageContent(el, savedData) {
      const src = mediaBlobs[savedData?.annIconImage] || '';
      el.innerHTML = src ? `<img src="${src}" alt="">` : '';
    }


    /** アノテーションオブジェクトの塗り色選択肢 */
    export const ANN_COLOR_OPTIONS = [
      { label: '青',   value: 'rgba(68,136,204,0.6)' },
      { label: '緑',   value: 'rgba(90,196,110,0.6)' },
      { label: '黄',   value: 'rgba(247,220,58,0.6)' },
    ];


    /** アイコン型オブジェクトの背景グラデーション色一覧 */
    export const ICON_COLOR_OPTIONS = [
      { label: '青', value: 'linear-gradient(180deg, #67d0ff, #4c9ae2 30%, #366da0)' },
      { label: '緑', value: 'linear-gradient(180deg, #7ddf8a, #4cae5e 30%, #2d7a3d)' },
      { label: '黄', value: 'linear-gradient(180deg, #ffe066, #e0b800 30%, #a07800)' },
    ];


    /** 付箋の色一覧 */
    export const STICKY_COLORS = [
      { label: '青',   value: '#4488cc' },
      { label: '緑',   value: '#5ac46e' },
      { label: '黄',   value: '#f7e04b' },
    ];


    /** 大問/答/証明ボタンのプリセットスタイル（既存の固定色をそのまま選択肢化） */
    export const BTN_COLOR_OPTIONS = [
      { label: '青（大問）', value: '#4a6fa8' },
      { label: '赤（答）',   value: '#a85a4a' },
      { label: '紫（証明）', value: '#7a4aa8' },
    ];
