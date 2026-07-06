---
name: libro-integration
description: LIBRO の book フォルダ形式（index.json / p####.json / 暗号化ページ画像 / annots / sounds）との相互変換、Pbve2000暗号化、アノテーションのインポート・エクスポートに関する作業を行う際に使用する。
---

# LIBRO 連携（book フォルダ形式との相互変換）

実装は [app/js/libro-format.js](../../../app/js/libro-format.js) に集約されている。詳細仕様は [docs/libro_integration_計画書.md](../../../docs/libro_integration_計画書.md) に集約されているので、実装前に必ず読むこと。ここでは実装時に見落としやすい要点のみをまとめる。

## 実装状況

- **インポート**（`parseLibroBookZip`）：既知・未知を問わず全アノテーションを読み込み、既知種別は編集可能なDOMオブジェクトへ、未知アノテーション・大問ボタンのHide/Showペアは編集不可のpassthroughデータとして保持する。
- **エクスポート**（`buildLibroBookExport` / `convertAnnotationToLibroAnnot`）：`pagelink`（`GoTo`+`FitPage`）・`externallink`（`URI`）・`audio`（`Launch`）の3種別のみLIBRO actionへ変換して書き出せる。それ以外（`video` / `plusfile` / `zu` / `kotae` / `shomei`）は変換ロジックが無く、新規作成分は書き出し時に失われる。
- **付箋グループ**（`convertStickyGroupToLibroAnnots`）：Hide/Showトグルペアとして書き出し対応済み。`libro-craft-meta`（独自メタデータ、`CRAFT_META_KEY`）に `role`/`group-id` を埋め込み再インポート時にグループ復元する。
- **大問ボタン**（`daimon`）：位置編集・削除をしていない場合に限り、読込時の生データをそのまま書き戻すpassthrough方式で消失を防いでいる（位置編集した場合は反映されない既知の制約）。
- **拡張トグルネットワーク**（色分けボタン・ステップボタン等、1:1トグルや大問ボタンの形状に収まらない、3要素以上が絡むHide/Show構造）：`.libro-network-slot`（`.libro-network-frame`を内部に持つ）として認識・再表示し、位置・サイズ編集のみ対応する（`convertPageAnnotations`内の余剰target判定→`expandNetworkClosure`によるBFS閉包検出、`renderNetworkGroups`で描画）。閲覧モードのクリック連動は各フレームが保持する元の`actions[]`をそのまま再生する汎用インタプリタ方式。選択・削除・Undo・編集ダイアログ・内容編集（フレーム追加削除・画像差し替え）・新規作成は未対応。書き出しは`state.libroNetworkPassthrough`から編集後のrectのみ上書きしたpassthroughで行う。

## bookフォルダ構成の要点

- `index.json`：書誌情報・ページ一覧・目次
- `p####.json`：ページごとのアノテーション・OCRデータ
- ページ画像（`p####-*.jpg`）・音声（`sounds/*.mp3`）：暗号化対象
- `annots/*.png`：アノテーション用画像。**平文（暗号化対象外）**

## Pbve2000 暗号化方式

- エンコード：先頭に `Pbve2000`（8バイト）ヘッダーを付加し、全体を `0xCC` でXOR
- デコード：先頭8バイトを除去し、残りを `0xCC` でXOR

## annots[] の actions（4種類のみ既知）

| action | 用途 |
|---|---|
| `GoTo` + `FitPage` | ページ遷移リンク |
| `URI` | 外部リンク |
| `Launch` | 音声再生 |
| `Hide` / `Show` | 表示切替（付箋の開閉、答え表示等） |

付箋は「閉」「開」2枚の画像を `Hide`/`Show` で相互切替する方式で実現する（LIBROに専用のテキストノートactionは存在しない）。

## 実装上の絶対ルール

1. **未知のアノテーションは編集不可・削除しない**：ContentsBuilderが認識しない `actions` 構成のアノテーションは編集UIに出さず内部データとして保持し、書き出し時もそのまま書き戻す。`annots[]` を丸ごと再生成せず、既知アノテーションと未知アノテーションをマージして出力する。
2. **削除時はファイルも削除**：ContentsBuilderが管理するアノテーションを削除したら、対応する `annots/xxxxxx.png`（音声参照があれば `sounds/*.mp3`）も同時に削除する。未知アノテーションはそもそも削除操作の対象外。
3. **変換ロジックはインポート/エクスポート双方向で共有**：`annots[]` ⇄ ContentsBuilder内部データ構造の変換は同一ロジックで実装し、他ツール作成bookの再編集にも対応できるようにする。
4. **アノテーションID**：削除済みIDは再利用しない。新規IDは「そのページの使用中最大ID + 1」を発行する。

## 未確定事項（実装前に要確認）

- `annot-id-block-size` の正確な意味とID衝突回避ルール
- 本番接続方式（現状はzipダウンロード/アップロードが暫定運用）
- `index.json` 更新の要否
- Hide/Show ペアを `targets` 関係性のみから一意に復元できるか

これらに影響する実装を行う場合は、[docs/開発方針.md](../../../docs/開発方針.md) のマイルストーンとあわせてユーザーに確認すること。
