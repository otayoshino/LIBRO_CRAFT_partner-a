\# タスク完了時の確認

自動テスト・lint・typecheckは存在しないため、以下の手動確認が完了条件:
1. `python server.py` を起動し、`http://localhost:8080/app/` （または `/app/index.html`）をブラウザで開いて動作確認する。
2. ブラウザの開発者コンソールにJSエラーが出ていないか確認する（ESモジュールのimportミスは実行時まで検出されない）。
3. UI/アノテーション関連の変更は `.claude/skills/ui-change-constraints/SKILL.md` の制約に抵触していないか確認する。
4. LIBRO連携・暗号化まわりの変更は `.claude/skills/libro-integration/SKILL.md` の仕様との整合を確認する。
