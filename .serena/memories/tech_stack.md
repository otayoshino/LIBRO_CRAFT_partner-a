\# 技術スタック

- 素のHTML/CSS/JavaScript（ESモジュール, `type="module"`）。ビルドツール・パッケージマネージャ・package.json は存在しない。フロントエンドの詳細構成は `mem:frontend/core`。
- 依存ライブラリはすべてCDN経由（npm管理なし）: pdf.js 3.11.174（PDF描画）, JSZip 3.10.1（ZIP入出力）。バージョン更新は app/index.html の `<script src="https://cdnjs...">` を直接書き換える。
- 開発用サーバーは `server.py`（Python標準ライブラリのみ、外部依存なし）。詳細は `mem:suggested_commands`。
- 自動テスト・リンター・フォーマッターは存在しない。
