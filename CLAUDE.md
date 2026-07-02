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

### 単一ファイル構成

アプリ本体は [app/index.html](app/index.html) 一つに HTML/CSS/JavaScript がすべて記述されている（約8000行）。モジュール分割・ビルドツールは使用していない。CDN経由で `JSZip`（ZIP入出力）を読み込む。

### 状態管理

グローバル変数によるシンプルな状態管理（クラスやフレームワークは使用しない）:
- `currentPage` / `totalPages` / `bookPages`：LIBRO bookページ表示関連
- `zoomLevel` / フィットモード：拡大縮小・フィット状態
- `annIdCounter` / `daimonCounter` / `kotaeCounter` / `shomeiCounter` / `stickyGroupCounter`：アノテーションID採番
- `mediaBlobs`：ZIP内の音声・動画・PDFファイルを BlobURL に変換してキャッシュ
- `STORAGE_KEY`（`ContentsBuilder_v2_annotations`）：`localStorage` への自動保存キー
- Undo/Redo は `pushUndo(op)` / `undo()` / `redo()` によるコマンド履歴方式

### アノテーション種別

`ANNOTATION_TYPE_CONFIG`（app/index.html 内）に種別ごとのラベル・色・アイコンSVGを定義。種別: `pagelink`（ページリンク）, `plusfile`, `externallink`（外部リンク）, `audio`（音声再生）, `video`（動画再生）, `sticky`（付箋）, `zu`（図）, `kotae`（答ボタン）, `daimon`（大問ボタン）, `shomei`（証明ボタン）。

新規種別を追加する場合の修正箇所チェックリストは [add-annotation-type Skill](.claude/skills/add-annotation-type/SKILL.md) を参照。

### 保存・読み込みの2系統

- **localStorage**：`saveAnnotations()` / `loadAnnotations()` による自動保存（ページ内で完結）
- **ZIP入出力**：`saveAnnotationsAsZip()` / `handleZipFile()` による `annotations.json` ＋ メディアファイル一式のエクスポート／インポート（JSZip使用）。将来的な LIBRO 連携（book フォルダ形式との相互変換）の暫定的な代替手段（[docs/libro_integration_計画書.md](docs/libro_integration_計画書.md) の「4-1. データフロー」参照）。

### モード切替

`switchToViewMode()` / `switchToEditMode()` によりオーサリング（編集）モードと閲覧モードを切り替える。編集モードでは `activateAnnotationMode(type)` によりページ上へのアノテーション配置（ドラッグ描画）が可能になる。

### LIBRO 連携（計画中・未実装）

LIBRO の book フォルダ形式（`index.json` / `p####.json` / 暗号化ページ画像 / `annots/` / `sounds/`）との相互変換は計画段階。詳細仕様と実装ルールは [libro-integration Skill](.claude/skills/libro-integration/SKILL.md)（元資料: [docs/libro_integration_計画書.md](docs/libro_integration_計画書.md)）を参照。

## 開発時の注意事項

- コミットメッセージは日本語で記述する。
- UI・デザイン変更を行う際の制約事項（変更禁止のCSS・レイアウト、位置保存形式の移行方針）は [ui-change-constraints Skill](.claude/skills/ui-change-constraints/SKILL.md) を参照。

## 関連Skill

タスクに応じて以下のSkillを参照すること（作業内容に該当する場合は自動的に読み込まれる）。

| Skill | 用途 |
| --- | --- |
| [libro-integration](.claude/skills/libro-integration/SKILL.md) | LIBROのbook形式との相互変換・暗号化まわりの作業 |
| [add-annotation-type](.claude/skills/add-annotation-type/SKILL.md) | 新規アノテーション種別の追加 |
| [ui-change-constraints](.claude/skills/ui-change-constraints/SKILL.md) | CSS/HTML/レイアウトなどUI変更作業 |
| [git-commit-convention](.claude/skills/git-commit-convention/SKILL.md) | コミット作成時のメッセージ規約 |
