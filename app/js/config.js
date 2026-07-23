    import { mediaBlobs } from './state.js';

    export const UNDO_MAX  = 50;

    /** アイコン画像アップロードの許容上限（巨大ファイルによるブラウザ不安定化を防ぐ） */
    export const MAX_ICON_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
    export const MAX_ICON_IMAGE_DIMENSION  = 4096; // px（一辺の上限）


    /**
     * 付箋背景色マップ（savedData.annColor 選択肢インデックスに対応）。
     * 既存インデックス0-2（青/緑/黄）はLIBRO書き出し・読み込みとの後方互換のため変更せず、
     * 環境設定「付箋のデフォルトカラー」の紙色オプション用にインデックス3を末尾追加している。
     */
    export const STICKY_COLOR_MAP = ['#4488cc', '#5ac46e', '#f7e04b', '#ffffff'];


    /** アノテーション種別ごとの設定 */
    export const ANNOTATION_TYPE_CONFIG = {
      pagelink: {
        label: 'ページリンク', color: 'rgba(68,114,196,0.6)',
        iconViewBox: '0 0 576 512',
        iconSvg: '<path d="M419.5 96c-16.6 0-32.7 4.5-46.8 12.7-15.8-16-34.2-29.4-54.5-39.5 28.2-24 64.1-37.2 101.3-37.2 86.4 0 156.5 70 156.5 156.5 0 41.5-16.5 81.3-45.8 110.6l-71.1 71.1c-29.3 29.3-69.1 45.8-110.6 45.8-86.4 0-156.5-70-156.5-156.5 0-1.5 0-3 .1-4.5 .5-17.7 15.2-31.6 32.9-31.1s31.6 15.2 31.1 32.9c0 .9 0 1.8 0 2.6 0 51.1 41.4 92.5 92.5 92.5 24.5 0 48-9.7 65.4-27.1l71.1-71.1c17.3-17.3 27.1-40.9 27.1-65.4 0-51.1-41.4-92.5-92.5-92.5zM275.2 173.3c-1.9-.8-3.8-1.9-5.5-3.1-12.6-6.5-27-10.2-42.1-10.2-24.5 0-48 9.7-65.4 27.1L91.1 258.2c-17.3 17.3-27.1 40.9-27.1 65.4 0 51.1 41.4 92.5 92.5 92.5 16.5 0 32.6-4.4 46.7-12.6 15.8 16 34.2 29.4 54.6 39.5-28.2 23.9-64 37.2-101.3 37.2-86.4 0-156.5-70-156.5-156.5 0-41.5 16.5-81.3 45.8-110.6l71.1-71.1c29.3-29.3 69.1-45.8 110.6-45.8 86.6 0 156.5 70.6 156.5 156.9 0 1.3 0 2.6 0 3.9-.4 17.7-15.1 31.6-32.8 31.2s-31.6-15.1-31.2-32.8c0-.8 0-1.5 0-2.3 0-33.7-18-63.3-44.8-79.6z"/>',
      },
      plusfile: {
        label: 'Plusファイル', color: 'rgba(112,173,71,0.6)',
        iconViewBox: '0 0 384 512',
        iconSvg: '<path d="M0 64C0 28.7 28.7 0 64 0L213.5 0c17 0 33.3 6.7 45.3 18.7L365.3 125.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm208-5.5l0 93.5c0 13.3 10.7 24 24 24L325.5 176 208 58.5zM154.2 295.6c8.6-10.1 7.5-25.2-2.6-33.8s-25.2-7.5-33.8 2.6l-48 56c-7.7 9-7.7 22.2 0 31.2l48 56c8.6 10.1 23.8 11.2 33.8 2.6s11.2-23.8 2.6-33.8l-34.6-40.4 34.6-40.4zm112-31.2c-8.6-10.1-23.8-11.2-33.8-2.6s-11.2 23.8-2.6 33.8l34.6 40.4-34.6 40.4c-8.6 10.1-7.5 25.2 2.6 33.8s25.2 7.5 33.8-2.6l48-56c7.7-9 7.7-22.2 0-31.2l-48-56z"/>',
      },
      externallink: {
        label: '外部リンク', color: 'rgba(0,168,198,0.6)',
        iconSvg: '<path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>',
      },
      audio: {
        label: '音声再生', color: 'rgba(112,48,160,0.6)',
        iconViewBox: '0 0 384 512',
        iconSvg: '<path d="M0 64C0 28.7 28.7 0 64 0L213.5 0c17 0 33.3 6.7 45.3 18.7L365.3 125.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm208-5.5l0 93.5c0 13.3 10.7 24 24 24L325.5 176 208 58.5zm53.8 185.2c-9.1-6.3-21.5-4.1-27.8 5s-4.1 21.5 5 27.8c23.9 16.7 39.4 44.3 39.4 75.5s-15.6 58.9-39.4 75.5c-9.1 6.3-11.3 18.8-5 27.8s18.8 11.3 27.8 5c34.1-23.8 56.6-63.5 56.6-108.3S296 267.5 261.8 243.7zM80 312c-8.8 0-16 7.2-16 16l0 48c0 8.8 7.2 16 16 16l24 0 27.2 34c3 3.8 7.6 6 12.5 6l.3 0c8.8 0 16-7.2 16-16l0-128c0-8.8-7.2-16-16-16l-.3 0c-4.9 0-9.5 2.2-12.5 6l-27.2 34-24 0zm128 72.2c0 10.7 10.5 18.2 18.9 11.6 12.9-10.3 21.1-26.1 21.1-43.8s-8.2-33.5-21.1-43.8c-8.4-6.7-18.9 .9-18.9 11.6l0 64.5z"/>',
      },
      video: {
        label: '動画再生', color: 'rgba(192,0,0,0.6)',
        iconViewBox: '0 0 384 512',
        iconSvg: '<path d="M0 64C0 28.7 28.7 0 64 0L213.5 0c17 0 33.3 6.7 45.3 18.7L365.3 125.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm208-5.5l0 93.5c0 13.3 10.7 24 24 24L325.5 176 208 58.5zM80 304l0 96c0 17.7 14.3 32 32 32l96 0c17.7 0 32-14.3 32-32l0-24 35 35c3.2 3.2 7.5 5 12 5 9.4 0 17-7.6 17-17l0-94.1c0-9.4-7.6-17-17-17-4.5 0-8.8 1.8-12 5l-35 35 0-24c0-17.7-14.3-32-32-32l-96 0c-17.7 0-32 14.3-32 32z"/>',
      },
      sticky: { label: '付箋', color: null, iconSvg: '' },
      kotae:  { label: '答ボタン',  color: null, iconSvg: '' },
      daimon: { label: '大問ボタン', color: null, iconSvg: '' },
      shomei: { label: '証明ボタン', color: null, iconSvg: '' },
    };


    /**
     * ANNOTATION_TYPE_CONFIG.color の rgba(...) 文字列から "R,G,B" 部分だけを取り出す。
     * 紙面カラー型（.dt-page-color）の枠線・背景色を種別ごとに変えるため、
     * CSSカスタムプロパティ --ann-type-rgb 経由でCSS側に渡す用途で使う。
     */
    function annTypeRgbTriplet(rgbaColor) {
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
        iconWrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cfg.iconViewBox || '0 0 24 24'}">${cfg.iconSvg}</svg>`;
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
      el.innerHTML = src ? `<img src="${src}" alt="" draggable="false">` : '';
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


    /** 付箋の色一覧（STICKY_COLOR_MAPと同順・同インデックス） */
    export const STICKY_COLORS = [
      { label: '青',   value: '#4488cc' },
      { label: '緑',   value: '#5ac46e' },
      { label: '黄',   value: '#f7e04b' },
      { label: '紙色', value: '#ffffff' },
    ];


    /** 大問/答/証明ボタンのプリセットスタイル（既存の固定色をそのまま選択肢化） */
    export const BTN_COLOR_OPTIONS = [
      { label: '青（大問）', value: '#4a6fa8' },
      { label: '赤（答）',   value: '#a85a4a' },
      { label: '紫（証明）', value: '#7a4aa8' },
    ];


    /** 大問ボタン（プリセットモード）の押下状態の背景色。LIBRO実データ（annots/0920.png）実測色に合わせる */
    export const DAIMON_PRESSED_COLOR = '#666666';

    /**
     * 新規作成する大問ボタンの既定サイズの基準値。
     * LIBRO実データ（sample_books/8a24127cb94d4a158ae43954184af569/p0004.json の
     * ID920/921 ペア、rect [309, 666, 194, 116]、ページ画像 4960×7015px）に合わせる。
     * 全sample_books走査でも 194×116 が最多出現（52件）で、大問ボタンの標準寸法とみなせる。
     *
     * ページ画像の縦横比に依存しないよう「ページ幅に対する比率」＋「ボタン自身の縦横比」で保持し、
     * 実px への変換は buttons.js の getDaimonDefaultSizePx() が #pageLeft.offsetWidth を基準に行う。
     */
    export const DAIMON_DEFAULT_REF_RECT = { pageWidth: 4960, width: 194, height: 116 };

    /** 大問ボタン既定幅のページ幅比（194 / 4960 ≒ 0.0391） */
    export const DAIMON_DEFAULT_WIDTH_RATIO = DAIMON_DEFAULT_REF_RECT.width / DAIMON_DEFAULT_REF_RECT.pageWidth;

    /** 大問ボタン既定の縦横比 W:H（194 / 116 ≒ 1.6724） */
    export const DAIMON_DEFAULT_ASPECT = DAIMON_DEFAULT_REF_RECT.width / DAIMON_DEFAULT_REF_RECT.height;

    /** 大問ボタン既定幅の下限（極小ページ表示時にクリック不能になるのを防ぐ） */
    export const DAIMON_DEFAULT_MIN_WIDTH_PX = 24;

    /**
     * アイコン表示形式（.ann-icon-obj）の新規作成時の既定サイズの基準値。
     * LIBRO実データ（sample_books/8a24127cb94d4a158ae43954184af569/p0023.json の
     * annots/6606.png、rect [4486, 688, 192, 192]、ページ画像 4960×7015px）に合わせる。
     *
     * 同ページの音声ボタン（annots/6600.png、rect [659, 682, 1161, 192]）は
     * 「1161×192の完全透明PNG」＝テキスト帯を覆うクリック領域であって
     * アイコンの見た目のサイズではないため、既定サイズの基準には採らない。
     * ただしその帯の高さ（192）は正方形アイコンの一辺（192）と一致しており、
     * どちらの解釈でも 192 に収束する。
     *
     * ページ画像の縦横比に依存しないよう「ページ幅に対する比率」で保持し、
     * 実px への変換は getIconDefaultSizePx() が #pageLeft.offsetWidth を基準に行う
     * （DAIMON_DEFAULT_REF_RECT と同じ方式）。
     */
    export const ICON_DEFAULT_REF_RECT = { pageWidth: 4960, size: 192 };

    /** アイコン既定サイズのページ幅比（192 / 4960 ≒ 0.0387） */
    export const ICON_DEFAULT_SIZE_RATIO = ICON_DEFAULT_REF_RECT.size / ICON_DEFAULT_REF_RECT.pageWidth;

    /** アイコン既定サイズの下限（極小ページ表示時にクリック不能になるのを防ぐ） */
    export const ICON_DEFAULT_MIN_SIZE_PX = 20;

    /**
     * ページ基準サイズ（#pageLeft.offsetWidth）が取得できない場合のフォールバック値（px）。
     * book未読込時など。従来の固定既定値と同値。
     */
    export const ICON_DEFAULT_SIZE_PX = 48;

    /**
     * アイコン表示形式（.ann-icon-obj）の新規作成時の既定サイズを、現在のページ基準サイズ
     * （#pageLeft の offsetWidth）に対する px 値として算出する。offsetWidth はCSS transform
     * （ズーム）の影響を受けない基準サイズであり、アノテーションの style.left/top/width/height と
     * 同じ座標系になる。種別によらず共通で、1:1 を保証するため width/height の双方にこの値を使う。
     * @returns {number} 既定サイズ（px・小数を含む）
     */
    export function getIconDefaultSizePx() {
      const page = document.getElementById('pageLeft');
      const baseWidth = page?.offsetWidth || 0;
      if (!baseWidth) return ICON_DEFAULT_SIZE_PX;
      // 整数pxに丸めず小数のまま返す（getDaimonDefaultSizePx と同じ理由：
      // 書き出しrectを実データ寸法へ近づけるため。読み手はいずれも parseFloat）。
      return Math.max(ICON_DEFAULT_MIN_SIZE_PX, baseWidth * ICON_DEFAULT_SIZE_RATIO);
    }
