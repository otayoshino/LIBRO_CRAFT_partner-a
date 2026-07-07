# ContentsBuilder（LIBRO＋CRAFT）

Webブック（PDF由来のページ画像）に付箋・音声再生・ページリンク・外部リンクなどのアノテーションを追加編集するオーサリングツールです。

最終的には LIBRO が生成する book データ（暗号化ページ画像＋JSON）を直接読み書きし、LIBRO 本体に組み込まれる想定です（詳細は [docs/libro_integration_計画書.md](docs/libro_integration_計画書.md)）。現状はスタンドアロンのモックからアノテーション編集アプリへ移行中の段階です（[docs/開発方針.md](docs/開発方針.md)）。

## セットアップ・起動方法

ビルドステップ・パッケージマネージャは不要です（純粋な静的HTML＋バニラJS）。Python 3 があれば起動できます。

```bash
python server.py
```

- `0.0.0.0:8080` でリッスンする簡易HTTPサーバーが起動します。
- ブラウザで `http://localhost:8080/app/` を開いてください。
- 同一LAN上の他PCからも `http://<ローカルIP>:8080/app/` でアクセス可能です。
- CORS ヘッダー付与、キャッシュ無効化（`no-store`）、`POST /upload?filename=xxx` によるバイナリファイルアップロード（保存先: `app/_media/`）に対応しています。

自動テストは存在しません。

## ディレクトリ構成

```
app/
  index.html        HTML本体のみ（<head> で JSZip セルフホスト版を読込、<body> 末尾で js/main.js を type="module" で読込）
  js/                ES Modules で分割されたJavaScript本体
    main.js          エントリーポイント。グローバル公開処理を含む
    config.js        アノテーション種別ごとの設定（ANNOTATION_TYPE_CONFIG）
    state.js         状態管理オブジェクト（state）
    mode.js          編集モード／閲覧モードの切替
    page-view.js      ページ表示・ズーム・フィット
    storage.js        IndexedDB自動保存
    autosave.js        自動保存の定期実行
    undo-redo.js       Undo/Redo（コマンド履歴方式）
    buttons.js          大問・答・証明ボタン関連
    sticky.js           付箋関連
    annotation-dialog.js       アノテーション編集ダイアログ
    annotation-interaction.js  アノテーションのドラッグ配置・操作
    annotation-actions.js      アノテーションの追加・削除等のアクション
    libro-format.js    LIBRO bookフォルダ形式との相互変換
    ui-common.js       UI共通処理
    vendor/            JSZipなどのセルフホストライブラリ
  css/style.css       CSS本体
  icons/sprite.svg    SVGアイコンスプライト
docs/                 仕様書・開発方針などのドキュメント
script/                開発ログ記録などの補助スクリプト
server.py              開発用プレビューサーバー
```

## アーキテクチャ概要

### 状態管理

`app/js/state.js` の `state` オブジェクトによるシンプルな状態管理です（クラスやフレームワークは使用しません）。

- `currentPage` / `totalPages` / `bookPages`：LIBRO bookページ表示関連
- `zoomLevel` / `fitMode`：拡大縮小・フィット状態
- `annIdCounter` / `daimonCounter` / `kotaeCounter` / `shomeiCounter` / `stickyGroupCounter`：アノテーションID採番
- `mediaBlobs`：ZIP内の音声・動画・PDFファイルを BlobURL に変換してキャッシュ
- Undo/Redo は `app/js/undo-redo.js` の `pushUndo(op)` / `undo()` / `redo()` によるコマンド履歴方式

### アノテーション種別

`ANNOTATION_TYPE_CONFIG`（[app/js/config.js](app/js/config.js)）に種別ごとのラベル・色・アイコンSVGを定義しています。種別は以下の通りです。

| 種別キー | 内容 |
| --- | --- |
| `pagelink` | ページリンク |
| `plusfile` | Plusファイル |
| `externallink` | 外部リンク |
| `audio` | 音声再生 |
| `video` | 動画再生 |
| `sticky` | 付箋 |
| `zu` | 図 |
| `kotae` | 答ボタン |
| `daimon` | 大問ボタン |
| `shomei` | 証明ボタン |

### 保存・読み込みの3系統

1. **IndexedDB自動保存**：`app/js/autosave.js` がDOMのアノテーション状態を定期的にIndexedDB（`ContentsBuilderAutoSave`）へスナップショット保存し、次回同一book読み込み完了時に復元確認を行います（ページ内で完結）。
2. **独自ZIP形式**：`saveAnnotationsAsZip()` による `annotations.json` ＋ メディアファイル一式のエクスポート。
3. **LIBRO book形式**：`saveAnnotationsAsLibroBook()` によるLIBRO bookフォルダ形式（暗号化ページ画像＋JSON）でのエクスポート。ページリンク・外部リンク・音声再生の3種別のみ対応、他は未対応です。

読み込みはいずれも `handleZipFile()` が入口で、ZIPルート直下に `index.json` があればLIBRO book形式、なければ独自ZIP形式として自動判別します。

### モード切替

`switchToViewMode()` / `switchToEditMode()`（[app/js/mode.js](app/js/mode.js)）によりオーサリング（編集）モードと閲覧モードを切り替えます。編集モードでは `activateAnnotationMode(type)` によりページ上へのアノテーション配置（ドラッグ描画）が可能です。

### LIBRO 連携

LIBRO の book フォルダ形式（`index.json` / `p####.json` / 暗号化ページ画像 / `annots/` / `sounds/`）との相互変換は [app/js/libro-format.js](app/js/libro-format.js) に実装済みです（インポートは全種別対応、エクスポートはページリンク・外部リンク・音声再生・Plusファイルに加え、動画のうちLIBRO由来のtoMovie/toMovieBNRリンクのみ対応。それ以外（動画の内部ファイル/外部タグ指定・図・答/証明ボタン）は未対応）。詳細仕様と実装ルールは [libro-integration Skill](.claude/skills/libro-integration/SKILL.md)（元資料: [docs/libro_integration_計画書.md](docs/libro_integration_計画書.md)）を参照してください。

## 開発時の注意事項

- コミットメッセージは日本語で記述する（[git-commit-convention Skill](.claude/skills/git-commit-convention/SKILL.md) 参照）。
- UI・デザイン変更を行う際の制約事項は [ui-change-constraints Skill](.claude/skills/ui-change-constraints/SKILL.md) を参照。
- 新規アノテーション種別を追加する場合の修正箇所チェックリストは [add-annotation-type Skill](.claude/skills/add-annotation-type/SKILL.md) を参照。
- UI・機能変更後のWeb画面目視確認手順は [web-verify Skill](.claude/skills/web-verify/SKILL.md) を参照。

## 関連ドキュメント・Skill

| ドキュメント / Skill | 用途 |
| --- | --- |
| [docs/libro_integration_計画書.md](docs/libro_integration_計画書.md) | LIBRO連携の全体計画 |
| [docs/開発方針.md](docs/開発方針.md) | 開発方針 |
| [docs/開発ログ_サーバについて.md](docs/開発ログ_サーバについて.md) | サーバに関する開発ログ |
| [libro-integration Skill](.claude/skills/libro-integration/SKILL.md) | LIBROのbook形式との相互変換・暗号化まわりの作業 |
| [add-annotation-type Skill](.claude/skills/add-annotation-type/SKILL.md) | 新規アノテーション種別の追加 |
| [ui-change-constraints Skill](.claude/skills/ui-change-constraints/SKILL.md) | CSS/HTML/レイアウトなどUI変更作業 |
| [git-commit-convention Skill](.claude/skills/git-commit-convention/SKILL.md) | コミット作成時のメッセージ規約 |
| [git-hooks Skill](.claude/skills/git-hooks/SKILL.md) | post-commitフックによる開発ログのGoogleスプレッドシート自動記録 |
| [web-verify Skill](.claude/skills/web-verify/SKILL.md) | UI・機能変更後のWeb画面目視確認手順 |
| [doc-refactor Skill](.claude/skills/doc-refactor/SKILL.md) | ドキュメントとコードの乖離点検・整理 |
