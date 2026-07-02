---
name: web-verify
description: app/index.html のUI・機能変更後にWeb画面を目視確認する際に使用する。server.py起動からChromeでの表示確認までの手順をまとめたもの。
---

# Web画面の確認方法

このプロジェクトはビルドステップを持たない静的HTML＋バニラJSのため、変更確認は必ず実ブラウザ表示で行う。

## 手順

1. `python server.py` をバックグラウンドで起動する（既に起動済みなら `lsof -i :8080 -sTCP:LISTEN` でPIDを確認し流用する）。
2. `open -a "Google Chrome" "http://localhost:8080/app/"` でChromeに表示させる。
   - このマシンには「Claude in Chrome」拡張機能がインストール・有効化されている。これは本CLIセッションとは別のClaude実行環境（ブラウザ拡張として動作）であり、本セッションのツールから直接操作することはできない。
   - 目視確認は hironari🦊 自身が行うか、必要であればブラウザ側のClaude in Chrome拡張に別途確認を依頼する。
3. 確認後、動作に問題があれば該当コードを修正し、再度Chromeをリロードして確認する（`localStorage` の自動保存 (`ContentsBuilder_v2_annotations`) が影響する場合はブラウザ側で明示的にリロードすること）。

## 注意事項

- サーバーは `0.0.0.0:8080` でリッスンするため、同一LAN上の他PCからも `http://<ローカルIP>:8080/app/` でアクセス可能（`server.py` 起動時のログにネットワークURLが表示される）。
- キャッシュは `no-store` で無効化されているため、リロードだけで最新コードが反映される。
