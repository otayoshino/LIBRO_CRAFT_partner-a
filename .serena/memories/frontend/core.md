\# app/ フロントエンド構造

app/index.html (387行) はエントリHTMLのみ。実装は app/js/*.js に ESモジュールとして分割済み（CLAUDE.md の「単一ファイル8000行」記述は古い）。CSSは app/css/style.css、アイコンは app/icons/sprite.svg（`<use>` 参照）に外出し済み。

\## エントリポイントと依存

`app/js/main.js` が全モジュールの named export を import して DOM イベントを配線する唯一のエントリ。新しい関数を足す/呼ぶ場合は必ずどのモジュールが担当領域か下記から判断し、それを import する（main.js に直接ロジックを書き足さない）。

\## モジュール一覧と責務

- `state.js` — 唯一のグローバル状態オブジェクト `state`（currentPage, zoomLevel, annIdCounter 等の全カウンター・フラグを1つのオブジェクトに集約）。加えて `mediaBlobs`, `undoStack`/`redoStack`, `selectedStickySet` を個別 export。CLAUDE.md が言う「グローバル変数によるシンプルな状態管理」は実際にはこの単一 `state` オブジェクトに統合済み。
- `config.js` — `STORAGE_KEY`（localStorage キー）と `ANNOTATION_TYPE_CONFIG`（アノテーション種別ごとのラベル・色・アイコン定義）。新規アノテーション種別追加はここが起点（`.claude/skills/add-annotation-type/SKILL.md` 参照）。
- `pdf-view.js` — PDF読み込み・ページ描画・ズーム/フィット。
- `annotation-interaction.js` (最大, 1482行) — ページ上でのドラッグ配置・ドラッグ選択・整列・コピペなど操作系。
- `annotation-dialog.js` (1068行) — アノテーション編集ダイアログ（クイック作成・確定処理）。
- `annotation-actions.js` — アノテーションに対する個別アクション。
- `buttons.js` — 大問/答/証明ボタン生成。
- `sticky.js` — 付箋・付箋グループ関連。
- `storage.js` (592行) — localStorage自動保存/読込、ZIP入出力（JSZip）、ダイアログ開閉。
- `undo-redo.js` — コマンド履歴方式のUndo/Redo。
- `mode.js` — 編集/閲覧モード切替。
- `ui-common.js` — 汎用UIヘルパー（アコーディオン等）。

\## LIBRO連携・UI変更・コミット規約

このリポジトリ固有のルールは `.claude/skills/` 配下の Skill（libro-integration, add-annotation-type, ui-change-constraints, git-commit-convention）に既にまとまっており、作業内容に応じて自動ロードされる。ここには重複記載しない。
