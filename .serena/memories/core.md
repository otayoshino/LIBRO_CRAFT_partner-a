\# LIBRO_CRAFT (ContentsBuilder / LIBRO+CRAFT)

PDFページ画像にアノテーション（付箋・音声・ページリンク等）を付与するオーサリングツール。将来 LIBRO 本体の book データ形式と直接読み書きする計画（未実装）。プロジェクト全体の背景・アノテーション種別一覧・保存方式・Skill対応表はリポジトリ直下の `CLAUDE.md` に既にまとまっているので重複記載しない。

\## 重要: CLAUDE.md の記述とのズレ

`CLAUDE.md` は「app/index.html 一つに8000行」と書いているが、**2026-07時点で既に app/js/*.js に分割済み**（ESモジュール, `<script type="module" src="js/main.js">`）。詳細は `mem:frontend/core` を参照。CLAUDE.md はこの点で古いので、コード構造を確認する際は実ファイルを優先すること。

\## モジュール構成の詳細

`mem:frontend/core` — app/js/ の各モジュールの役割・依存関係・state オブジェクトの構造。

\## コマンド・技術スタック

`mem:tech_stack` — 言語・ビルドツールなし構成、依存CDN。
`mem:suggested_commands` — 開発サーバー起動など実際に使うコマンド。
