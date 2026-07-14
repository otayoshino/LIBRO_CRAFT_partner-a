---
name: libro-integration
description: LIBRO の book フォルダ形式（index.json / p####.json / 暗号化ページ画像 / annots / sounds）との相互変換、Pbve2000暗号化、アノテーションのインポート・エクスポートに関する作業を行う際に使用する。
---

# LIBRO 連携（book フォルダ形式との相互変換）

実装は [app/js/libro-format.js](../../../app/js/libro-format.js) に集約されている。詳細仕様は [docs/libro_integration_計画書.md](../../../docs/libro_integration_計画書.md) に集約されているので、実装前に必ず読むこと。ここでは実装時に見落としやすい要点のみをまとめる。

## 実装状況

- **インポート**（`parseLibroBookZip`）：既知・未知を問わず全アノテーションを読み込み、既知種別は編集可能なDOMオブジェクトへ、未知アノテーション・大問ボタンのHide/Showペアは編集不可のpassthroughデータとして保持する。
- **エクスポート**（`buildLibroBookExport` / `convertAnnotationToLibroAnnot`）：`pagelink`（`GoTo`+`FitPage`）・`externallink`（`URI`）・`audio`（`Launch`）・`plusfile`（`URI`の`toAppendix(...)`）の4種別、および`video`のうちLIBRO由来の`toMovie`/`toMovieBNR`リンク（`annVideoSrc: '2'`）はLIBRO actionへ変換して書き出せる。`video`の内部ファイル/外部タグ指定（`annVideoSrc: '0'/'1'`）・`kotae` / `shomei`は変換ロジックが無く、新規作成分は書き出し時に失われる。
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
| `URI` | 外部リンク、またはLIBROビューア側でeval実行される擬似関数呼び出し（下表参照） |
| `Launch` | 音声再生 |
| `Hide` / `Show` | 表示切替（付箋の開閉、答え表示等） |

付箋は「閉」「開」2枚の画像を `Hide`/`Show` で相互切替する方式で実現する（LIBROに専用のテキストノートactionは存在しない）。

### `URI` の `uri` 文字列に埋め込まれる擬似関数呼び出し

`uri` フィールドは実URL（`https://...`）だけでなく、LIBROビューア側でeval実行される
`to関数名(引数,...)` 形式の擬似プロトコルも格納する（`parseLibroLinkFunction`で判定）。

| 関数 | 用途 | 対応状況 |
|---|---|---|
| `toAppendix(フォルダ名, 表示モード)` | Plusファイル | `plusfile`としてインポート/エクスポート対応済み |
| `toMovie(...)` / `toMovieBNR(...)` | 動画再生（JStream短縮URL or AWS指定） | `video`（`annVideoSrc: '2'`）としてインポート対応済み。引数の意味は未解析のため丸括弧内を生文字列のまま編集・書き戻す |
| `toFlashcard(...)` | フラッシュカード | LIBRO CRAFTでは作成不可な機能のため対象外（外部リンクとして保持されるのみ） |
| `toListening(...)` | カラオケボタン（音声同期ハイライト） | 同上、対象外 |

## 実装上の絶対ルール

1. **未知のアノテーションは編集不可・削除しない**：ContentsBuilderが認識しない `actions` 構成のアノテーションは編集UIに出さず内部データとして保持し、書き出し時もそのまま書き戻す（ID正規化に伴うfilename/targets書換えを除き無変更）。`annots[]` を丸ごと再生成せず、既知アノテーションと未知アノテーションをマージして出力する。
2. **削除時はファイルも削除**：ContentsBuilderが管理するアノテーションを削除したら、対応する `annots/xxxxxx.png`（音声参照があれば `sounds/*.mp3`）も同時に削除する。未知アノテーションはそもそも削除操作の対象外。
3. **変換ロジックはインポート/エクスポート双方向で共有**：`annots[]` ⇄ ContentsBuilder内部データ構造の変換は同一ロジックで実装し、他ツール作成bookの再編集にも対応できるようにする。
4. **アノテーションID**：削除済みIDは再利用しない。新規IDは「そのページの使用中最大ID + 1」を発行する。

## アノテーションIDの位置ベースモデル（確定済み）

LIBRO+ビューアはHide/Showの`targets`を「`annot-range[0]` + `annots`配列内の位置」で解決する位置ベースモデルである（実機検証で確定。ファイル名の数値はID解決に使われない）。このため`buildLibroBookExport`は書き出し時に各ページのアノテーションIDを次の規則で正規化する（実装は`libroMarkerFilename`直後の`filenameToNumericId`とページループ内の正規化パスを参照）。

- **`annot-range`は半開区間**：`[先頭ID, 先頭ID+件数]`。上限は最大IDを含まない（例：1件のみなら`[N, N+1]`）
- **配列内の位置がそのままID**：位置`i`のアノテーションのIDは必ず`annot-range[0]+i`（連番・穴なし・交錯なし）
- **付箋の閉/開ペア（グループ付箋は各メンバーのペア）は隣接ID**：実データ準拠で「開（`hidden`）が先＝小ID、閉が後＝大ID」の順に並べる
- **base（`annot-range[0]`）の決定**：既存ページは元の`annot-range[0]`を踏襲。新規にアノテーションが追加されたページは「ページ1なら`1`、それ以外は`(ページ番号-1)×annot-id-block-size`（デフォルト300）」で新規発行する
- **ID変更に伴う副作用**：ID変更があったアノテーションは`annots/XXXX.png`をリネームし（旧ファイルは削除）、Hide/Show `targets`もページ内の新IDへ書き換える。対応する新IDが見つからないtargets（他ページの要素を参照する複合ボタン等）は変更せず警告のみ出す

**既知の制約**：この正規化はページ単位で独立して行うため、他ページの要素を横断的に参照するHide/Show（大問マスターボタン等）が参照先ページ側でID変更された場合、参照元は追従できない（現状は実害が無い限り許容）。

**書き出しは非破壊処理**：`buildLibroBookExport`はセッション状態（`state.libroBook`の`zip`・`indexJson`・`unencryptedAssetPaths`）を一切変更しない。冒頭でこれらをすべて作業用にコピーし、ID正規化に伴うリネーム・削除・書き換えはコピーに対してのみ行う（JSZipの`files`辞書エントリだけを新インスタンスへ再代入する軽量コピー。詳細は関数内コメント参照）。このためDOM側の`dataset.closedFile`/`openFile`等は常に「元zipのファイル名」を指し続け、同一セッションで何度書き出しても結果は決定論的になる（既存付箋の閉/開画像がスワップして壊れる、といった再エクスポート時の不整合は起こらない）。

## 未確定事項（実装前に要確認）

- 本番接続方式（現状はzipダウンロード/アップロードが暫定運用）

これらに影響する実装を行う場合は、[docs/開発方針.md](../../../docs/開発方針.md) のマイルストーンとあわせてユーザーに確認すること。
