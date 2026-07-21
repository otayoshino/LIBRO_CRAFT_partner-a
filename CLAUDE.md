# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

**ContentsBuilder（LIBRO＋CRAFT）** は、Webブック（PDF由来のページ画像）に付箋・音声再生・ページリンク・外部リンクなどのアノテーションを追加編集するオーサリングツール。最終的には LIBRO が生成する book データ（暗号化ページ画像＋JSON）を直接読み書きし、LIBRO 本体に組み込まれる想定（詳細は [docs/libro_integration_計画書.md](docs/libro_integration_計画書.md)）。現状はスタンドアロンのモックからアノテーション編集アプリへ移行中の段階（[docs/開発方針.md](docs/開発方針.md)）。

## 開発コマンド

```bash
python server.py
```

- `0.0.0.0:8080` でリッスンする簡易HTTPサーバー（`server.py`）。同一LAN上の他PCからも `http://<ローカルIP>:8080/app/` でアクセス可能。
- CORS ヘッダー付与、キャッシュ無効化（`no-store`）、`POST /upload?filename=xxx` によるバイナリファイルアップロード（保存先: `app/_media/`、現状ディレクトリ未作成）に対応。
- ビルドステップ・パッケージマネージャ・自動テストは存在しない（純粋な静的HTML＋バニラJS）。

## アーキテクチャ

### ファイル構成

- [app/index.html](app/index.html)：HTML本体のみ（約400行）。`<head>` で `js/vendor/jszip.min.js`（JSZip セルフホスト版、CDN不使用）を読み込み、`<body>` 末尾で [app/js/main.js](app/js/main.js) を `type="module"` として読み込む。
- `app/js/`：ES Modules で分割されたJavaScript本体（`main.js` / `config.js` / `state.js` / `mode.js` / `page-view.js` / `storage.js` / `autosave.js` / `undo-redo.js` / `buttons.js` / `sticky.js` / `annotation-dialog.js` / `annotation-interaction.js` / `annotation-actions.js` / `libro-format.js` / `ui-common.js`、計約8000行）。ビルドツールは使用せずブラウザネイティブのESモジュールとして読み込む。`main.js` 末尾の `Object.assign(window, {...})` で、HTML側の `onclick` などインラインハンドラから呼べる関数をグローバル公開している。
- `app/css/style.css`：CSS本体。`app/icons/sprite.svg`：SVGアイコンスプライト。

### 状態管理

`app/js/state.js` の `state` オブジェクトによるシンプルな状態管理（クラスやフレームワークは使用しない）:

- `currentPage` / `totalPages` / `bookPages`：LIBRO bookページ表示関連
- `zoomLevel` / `fitMode`：拡大縮小・フィット状態
- `annIdCounter` / `daimonCounter` / `kotaeCounter` / `shomeiCounter` / `stickyGroupCounter`：アノテーションID採番
- `mediaBlobs`（`state.js` でモジュールスコープの定数として定義）：ZIP内の音声・動画・PDFファイルを BlobURL に変換してキャッシュ
- Undo/Redo は `app/js/undo-redo.js` の `pushUndo(op)` / `undo()` / `redo()` によるコマンド履歴方式

### アノテーション種別

`ANNOTATION_TYPE_CONFIG`（[app/js/config.js](app/js/config.js)）に種別ごとのラベル・色・アイコンSVGを定義。種別: `pagelink`（ページリンク）, `plusfile`, `externallink`（外部リンク）, `audio`（音声再生）, `video`（動画再生）, `sticky`（付箋）, `kotae`（答ボタン）, `daimon`（大問ボタン）, `shomei`（証明ボタン）。

新規種別を追加する場合の修正箇所チェックリストは [add-annotation-type Skill](.claude/skills/add-annotation-type/SKILL.md) を参照。

### 保存・読み込み

- **IndexedDB自動保存**：`app/js/autosave.js` がDOMのアノテーション状態を定期的にIndexedDB（`ContentsBuilderAutoSave`）へスナップショット保存し、次回同一book読み込み完了時に復元確認を行う（ページ内で完結）
- **LIBRO book形式エクスポート**：`saveAnnotationsAsLibroBook()` によるLIBRO bookフォルダ形式（暗号化ページ画像＋JSON）でのエクスポート。手動保存はこの1系統のみ（単体JSON保存・独自ZIP形式エクスポートは廃止済み）。対応種別の詳細は [libro-integration Skill](.claude/skills/libro-integration/SKILL.md)

読み込みは `handleZipFile()` が入口で、ZIPルート直下に `index.json` があればLIBRO book形式、なければ独自ZIP形式（過去にエクスポートした `annotations.json` ＋メディア一式）として自動判別する。

### モード切替

`switchToViewMode()` / `switchToEditMode()`（[app/js/mode.js](app/js/mode.js)）によりオーサリング（編集）モードと閲覧モードを切り替える。編集モードでは `activateAnnotationMode(type)` によりページ上へのアノテーション配置（ドラッグ描画）が可能になる。

### LIBRO 連携

LIBRO の book フォルダ形式（`index.json` / `p####.json` / 暗号化ページ画像 / `annots/` / `sounds/`）との相互変換は [app/js/libro-format.js](app/js/libro-format.js) に実装済み（インポートは全種別対応、エクスポートはページリンク・外部リンク・音声再生・Plusファイルに加え、動画の内部ファイル指定（toMovieBNR）とJ-stream指定（toMovie）に対応。それ以外（動画の外部タグ指定・図・答/証明ボタン）は未対応）。詳細仕様と実装ルールは [libro-integration Skill](.claude/skills/libro-integration/SKILL.md)（元資料: [docs/libro_integration_計画書.md](docs/libro_integration_計画書.md)）を参照。

## 開発時の注意事項

- コミットメッセージは日本語で記述する。
- UI・デザイン変更を行う際の制約事項（変更禁止のCSS・レイアウト、位置保存形式の後方互換ルール）は [ui-change-constraints Skill](.claude/skills/ui-change-constraints/SKILL.md) を参照。
- 非同期処理（await連鎖等）でユーザーが処理待ちを意識する10秒以上のブロッキングが見込まれる場合は、逐次実装のまま高速化を図るのではなく、バッチ並列化・Web Worker化など実装方式自体を再検討すること。

## 関連Skill

タスクに応じて以下のSkillを参照すること（作業内容に該当する場合は自動的に読み込まれる）。

| Skill | 用途 |
| --- | --- |
| [libro-integration](.claude/skills/libro-integration/SKILL.md) | LIBROのbook形式との相互変換・暗号化まわりの作業 |
| [add-annotation-type](.claude/skills/add-annotation-type/SKILL.md) | 新規アノテーション種別の追加 |
| [ui-change-constraints](.claude/skills/ui-change-constraints/SKILL.md) | CSS/HTML/レイアウトなどUI変更作業 |
| [git-commit-convention](.claude/skills/git-commit-convention/SKILL.md) | コミット作成時のメッセージ規約 |
| [git-hooks](.claude/skills/git-hooks/SKILL.md) | post-commitフックによる開発ログのGoogleスプレッドシート自動記録 |
| [web-verify](.claude/skills/web-verify/SKILL.md) | UI・機能変更後のWeb画面目視確認手順 |
| [doc-refactor](.claude/skills/doc-refactor/SKILL.md) | ドキュメントとコードの乖離点検・整理 |
