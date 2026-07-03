---
name: git-hooks
description: post-commitフックによる開発ログのGoogleスプレッドシート自動記録の設定・仕様に関する作業を行う際に使用する。
---

# git-hooks（開発ログ記録）

コミットのたびにコミット情報をGoogleスプレッドシートへ自動記録する仕組み。今後すべてのコミットに適用する運用方針。

## 構成ファイル

| ファイル | 役割 |
| --- | --- |
| `.githooks/post-commit` | Gitのpost-commitフック本体（shell）。`uv run python script/post_commit_sheet.py` を呼ぶだけ |
| `script/post_commit_sheet.py` | 直近コミットの情報を取得し、Googleスプレッドシートに1行追記するPythonスクリプト |
| `secrets/*.json` | サービスアカウントの認証鍵（`.gitignore`・`.claudeignore` 対象、リポジトリには含めない） |

## セットアップ（初回のみ・各開発者のローカル環境で実施）

Gitはデフォルトで `.git/hooks/` しか見ないため、リポジトリ管理下の `.githooks/` を使うには明示的な設定が必要。

```bash
git config core.hooksPath .githooks
```

また `script/post_commit_sheet.py` は `uv run` で実行するため、`gspread` と `google-auth` の依存関係を解決できるようにしておく（`pyproject.toml`/`uv.lock` の整備、またはスクリプト冒頭にPEP 723のインラインメタデータを追加するなど）。

`script/post_commit_sheet.py` 内の `SERVICE_ACCOUNT_FILE` はローカル絶対パスのハードコードになっている。他の環境で使う場合はこのパスを実際のサービスアカウントJSONの配置場所に合わせて書き換える。

## スプレッドシートの列構成

`開発ログ` シートに以下の順で1行追記される（`append_to_sheet()` 参照）。

| 列 | 内容 | 例 |
| --- | --- | --- |
| A | 記録日時（`YYYY-MM-DD HH:MM:SS`） | `2026-07-03 16:23:10` |
| B | コミットハッシュ（短縮形） | `84ab533` |
| C | 作者名 | `hyagisawa` |
| D | コミットタイプ | `chore` |
| E | コミットメッセージ全文 | `chore: post-commitフックを追加` |

- コミットタイプ（D列）は [git-commit-convention](../git-commit-convention/SKILL.md) で定義された `feat` / `fix` / `refactor` / `chore` のいずれかをメッセージ先頭の `<prefix>: ` から抽出したもの（`parse_commit_type()`）。該当プレフィックスがない場合は空欄になる。
- 新しいコミットタイプ（prefix）を追加した場合は、`script/post_commit_sheet.py` の `KNOWN_COMMIT_TYPES` にも追記すること。

## 設計上の注意

- フックの失敗（認証エラー・ネットワークエラー・シート未共有など）でコミット自体を止めないよう、`main()` は例外を握りつぶしてログ出力のみ行う。この挙動は変更しない。
- サービスアカウントの認証鍵は絶対にコミットしない（`secrets/` は `.gitignore` 対象）。
