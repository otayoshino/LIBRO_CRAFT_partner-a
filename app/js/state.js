export const state = {
  /* -------- 状態管理 -------- */
  currentPage: 1,
  /** 総ページ数（LIBRO book読み込み後に更新） */
  totalPages: 1,
  /** 描画世代カウンター：非同期待機中に新しい renderPage が呼ばれたを検知する */
  _renderVersion: 0,
  /** ズーム変更後の再描画デバウンスタイマー */
  _reRenderTimer: null,
  zoomLevel: 100,
  selectedAnnotation: null,
  /** グレーアウトパネルで最後に表示した種別 */
  lastDetailType: 'sticky',
  /**
  * 選択中の付箋のグループ化状態をトグルする。
  * 全員グループ済み → 解除、それ以外 → グループ化（2件以上必要）。
  */
  /** 大問ボタンIDカウンター */
  daimonCounter: 0,
  /** 答ボタンIDカウンター */
  kotaeCounter: 0,
  /** 証明ボタンIDカウンター */
  shomeiCounter: 0,
  /** 現在アクティブなアノテーション種別（null = 描画モード無効） */
  currentDrawType: null,
  /** 描画開始座標（ページ相対） */
  drawStartPos: null,
  /** 描画プレビュー要素 */
  drawPreviewEl: null,
  /** 確定待ちの矩形情報 */
  pendingRect: null,
  /** アノテーションIDカウンター */
  annIdCounter: 0,
  /** 自動保存デバウンスタイマーID */
  _autoSaveTimer: null,
  /** ドラッグ選択（ラバーバンド）の開始座標（ページ相対px） */
  dragSelectStartPos: null,
  /** ドラッグ選択開始座標（clientX/Y：fixed配置の破線描画用） */
  dragSelectClientStart: null,
  /** ドラッグ選択中フラグ */
  isDragSelecting: false,
  /** ドラッグ選択プレビュー要素 */
  dragSelectPreviewEl: null,
  /** 描画ドラッグ開始座標（clientX/Y：fixed配置のプレビュー描画用） */
  drawClientStart: null,
  /** Spaceキーが押されているか（パンモード） */
  isSpaceHeld: false,
  /** パン（ビュースクロール）操作中かどうか */
  isPanning: false,
  /** パン開始時のマウス座標（オフセット基準値） */
  panStartX: 0,
  panStartY: 0,
  /** 現在のページコンテナのパンオフセット */
  panOffsetX: 0,
  panOffsetY: 0,
  /** 付箋グループIDカウンター */
  stickyGroupCounter: 0,
  /**
  * アノテーションコピー用クリップボード。
  * 各エントリは選択時のスナップショットを保持する。
  * @type {Array<{type:string, className:string, savedData:string, left:number, top:number, width:number, height:number, background:string, groupId:string|undefined}>}
  */
  annClipboard: [],
  /** 付箋シングル/ダブルクリック判定用タイマー */
  _stickyClickTimer: null,
  /* ページのアスペクト比（幅 / 高さ）。LIBRO book読み込み後に実際の比率で上書きされる */
  PAGE_ASPECT: 420 / 560,
  /* 現在のフィットモード */
  fitMode: 'height',
  /**
   * LIBRO bookフォルダ読込時のページ画像一覧。
   * 各要素: { pageNum, width, height, imageUrl, _img（描画キャッシュ用Imageオブジェクト） }
   */
  bookPages: null,
  /**
   * LIBRO book読込時の見開き開始境界。index.json の configs['real-page-count'] の値で、
   * このページ数を超えるページ番号は見開き（1ページ画像に2ページ分を含む）であることを示す。
   * real-page-count 未設定の book では null のまま。
   */
  realPageCount: null,
  /**
   * LIBRO book読込時、既知パターンに一致しなかった未知アノテーション、および
   * Hide/Showペア（付箋の開閉等）を構成する生アノテーションをページごとに保持する。
   * どちらも編集UIには出さず、書き出し時は変更せずそのまま annots[] に書き戻す。
   */
  libroUnknownAnnotations: [],
  /**
   * LIBRO book zip読込時の元zip・書誌情報を保持する（書き出し時に未変更ファイルを
   * そのまま維持するため）。LIBRO book以外を読み込んだ場合は null のまま。
   * { zip: JSZip, baseDir: string, indexJson: Object }
   */
  libroBook: null,
};

    /* -------- メディアBlobキャッシュ -------- */
    /**
     * ZIPから読み込んだ音声・動画ファイルのBlob URLを格納する辞書。
     * キー: "ファイル名.mp3" または "ファイル名.mp4"
     * 値: createObjectURL で生成したBlob URL
     */
    export const mediaBlobs = {};


    /** Undo スタック（最大 50 件） */
    export const undoStack = [];

    /** Redo スタック（最大 50 件） */
    export const redoStack = [];


    /** Shift+クリックで複数選択中の付箋要素セット */
    export const selectedStickySet = new Set();
