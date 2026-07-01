\# よく使うコマンド (Darwin)

- 開発サーバー起動: `python server.py`（0.0.0.0:8080, `app/` 配下を配信。CORS付与・no-store・`POST /upload?filename=xxx` でのバイナリアップロード対応。詳細は CLAUDE.md）。
- ビルド/lint/test/typecheck コマンドは存在しない（タスク完了の確認は目視・手動動作確認のみ）。
- `sample_books/` は .gitignore 対象の生成物ディレクトリ（LIBRO book形式のサンプルデータ置き場、libro-integration作業時に参照）。
- git/ls/grep等の標準コマンドはDarwin標準シェル(zsh)でLinuxと差異なし。
