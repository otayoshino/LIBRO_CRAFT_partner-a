#!/usr/bin/env python3
# /// script
# dependencies = [
#   "gspread",
#   "google-auth",
# ]
# ///
"""
直近のコミット情報をGoogleスプレッドシートに1行追記するスクリプト。
git hooks/post-commit から呼び出す想定。
"""

import subprocess
import sys
from datetime import datetime

import gspread
from google.oauth2.service_account import Credentials

# ===== 設定値(環境に合わせて書き換える) =====
SERVICE_ACCOUNT_FILE: str = "/Users/meitec-yagisawa/github/LIBRO_CRAFT/secrets/git-hook-for-libro-craft-log-fe3fff41b0e2.json"  # サービスアカウントのJSONキー
SPREADSHEET_ID: str = "113RueYrs2clAqzevWCYmbx7tXR83z-y6tyC_ylTW3M8"  # スプレッドシートURLの /d/ と /edit の間の文字列
SHEET_NAME: str = "開発ログ"  # 書き込み先のシート(タブ)名


# .claude/skills/git-commit-convention/SKILL.md で定義されているプレフィックス
KNOWN_COMMIT_TYPES = {"feat", "fix", "refactor", "chore"}


def get_latest_commit() -> tuple[str, str, str]:
    """直近のコミットの (ハッシュ, 作者, メッセージ) を取得する"""
    result = subprocess.run(
        ["git", "log", "-1", "--pretty=format:%h|%an|%s"],
        capture_output=True,
        text=True,
        check=True,
    )
    commit_hash, author, message = result.stdout.split("|", 2)
    return commit_hash, author, message


def parse_commit_type(message: str) -> str:
    """コミットメッセージ先頭の `feat:` 等のプレフィックスからコミットタイプを抽出する"""
    prefix, sep, _ = message.partition(":")
    if sep and prefix.strip() in KNOWN_COMMIT_TYPES:
        return prefix.strip()
    return ""


def append_to_sheet(commit_hash: str, author: str, commit_type: str, message: str) -> None:
    """スプレッドシートの末尾に1行追記する"""
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=scopes)
    client = gspread.authorize(creds)

    sheet = client.open_by_key(SPREADSHEET_ID).worksheet(SHEET_NAME)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sheet.append_row([timestamp, commit_hash, author, commit_type, message])


def main() -> None:
    try:
        commit_hash, author, message = get_latest_commit()
        commit_type = parse_commit_type(message)
        append_to_sheet(commit_hash, author, commit_type, message)
        print(f"✅ スプレッドシートに記録しました: {commit_hash}")
    except Exception as e:
        # フックの失敗でコミット自体を止めたくないので、エラーは表示だけして正常終了させる
        print(f"⚠️ スプレッドシート記録に失敗しました: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
