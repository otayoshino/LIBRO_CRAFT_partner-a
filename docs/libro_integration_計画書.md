    # Libro連携機能 開発計画書

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | ContentsBuilder（オーサリングUI）で作成したアノテーション（付箋・音声再生・ページリンク・外部リンク等）を、Libro+ が読み込めるbookフォルダ形式に書き出す機能を実装する |
| 背景 | 現状ContentsBuilderはフロントエンドのオーサリング画面のみが存在し、作成したデータをLibroのbook形式へ変換・配置する手段がない |
| スコープ | Libro用JSON書き出し機能（暗号化・保存・配信を含む） |

---

## 調査結果（Libro bookフォルダの実物解析に基づく）

### 1. bookフォルダ構成

```
<16進数フォルダ（book root）>/
├── index.json            … 書誌情報・ページ一覧・目次（outline）
├── fulltext.json         … 全文テキスト
├── p0001.json            … ページ1のアノテーション・OCRデータ
├── p0001-1.jpg           … ページ1画像（1倍）※暗号化
├── p0001-2.jpg           … ページ1画像（1/2縮小）※暗号化
├── p0001-4.jpg           … ページ1画像（1/4縮小）※暗号化
├── p0001-8.jpg           … ページ1画像（1/8縮小）※暗号化
├── p0001-16.jpg          … ページ1画像（1/16縮小、存在する場合）※暗号化
├── p0002.json … (以下ページ数分繰り返し)
├── annots/               … アノテーション用画像（PNG）※平文（未暗号化）
│   └── 000300.png ...
└── sounds/               … 音声ファイル（mp3）※暗号化
    └── in_w3_k001.mp3 ...
```

### 2. 暗号化方式（Pbve2000形式）

- 対象：ページ画像（`p####-*.jpg`）、音声ファイル（`sounds/*.mp3`）
- 対象外：`annots/` 配下のPNG画像（平文のまま配置してよい。ビューアは暗号化の有無に関わらずそのまま読み込む）
- エンコード：元データの先頭に `Pbve2000` という8バイトの文字列ヘッダーを付加した上で、データ全体を `0xCC` でXOR
- デコード：先頭8バイトを除去し、残りを `0xCC` でXORすると元データが復元される
- ビューア側の実装例（共有いただいた内容）：
  ```js
  const r = await fetch(filepath);
  const uint = new Uint8Array(await r.arrayBuffer());
  const blob = new Blob(uint.slice(8).map(a => a ^ 0xCC));
  ```

### 3. `index.json` の構造（概要）

```json
{
  "text": "fulltext.json",
  "metadata": { "title": "..." },
  "configs": {
    "has-cover-page": false,
    "rl-reading-order": "left",
    "annot-id-block-size": 300,
    "generator": "...",
    "page-fit": "page",
    "page-fit-for-single": "page",
    "real-page-count": 31
  },
  "outline": [ { "description": "...", "dest-page": 4, "children": [...] } ],
  "pages": [
    {
      "width": 2480, "height": 3507, "dpi": 300.0,
      "json": "p0001.json",
      "images": { "1/1": "p0001-1.jpg", "1/2": "p0001-2.jpg", "1/4": "p0001-4.jpg", "1/8": "p0001-8.jpg" }
    }
  ]
}
```

- `configs.annot-id-block-size`：ページごとのアノテーションIDの割り当て単位と推測される（詳細は要検証。次節「未確定事項」参照）

### 4. ページJSON（`p####.json`）の構造

主なキー：`text`, `zones`（OCR座標データ。アノテーションとは無関係）, `links`, `width`, `height`, `dpi`, `images`, `parent-page`, `annots`, `annot-range`

`annots` 配列の各要素：

```json
{
  "filename": "annots/005700.png",
  "rect": [594, 1767, 130, 130],
  "hidden": true,
  "actions": [ { "...action定義..." } ]
}
```

- `filename`：アノテーション画像（PNG・平文）のパス。ファイル名の数値部分がそのままアノテーションID
- `rect`：`[x, y, width, height]`（ページ画像のピクセル座標系、絶対値）
- `hidden`：初期表示時に非表示にするかどうか（省略時は表示）
- `annot-range`：そのページで使用しているアノテーションIDの範囲 `[最小, 最大]`（ID重複防止用と推測）

#### 確認できた `actions` の種類（4種）

| action | 用途 | パラメータ例 |
|---|---|---|
| `GoTo` + `FitPage` | ページ遷移リンク（implementation_guide_v2.md B-2 相当） | `{ "action": "GoTo", "page": 4 }`, `{ "action": "FitPage" }` |
| `URI` | 外部リンク | `{ "action": "URI", "uri": "https://..." }` |
| `Launch` | 音声再生 | `{ "action": "Launch", "filename": "sounds/in_w3_k001.mp3" }` |
| `Hide` / `Show` | 表示切替（targetsで指定した他のアノテーションIDを非表示／表示） | `{ "action": "Hide", "targets": [2100, 2102] }` |

> **付箋機能について：** Libroには「テキストノート」を表す専用のaction種別は存在しない。付箋は「閉じた状態のアイコン画像」と「開いた状態の画像（付箋本文をラスタ画像として描き込んだもの）」の2枚のアノテーションを `Hide`/`Show` で相互に切り替える方式で実現する（既存の答え表示・図差し替えと同じ仕組み）。

---

## 実装方針

### 4-1. データフロー

> **位置づけの注意：** ContentsBuilderは最終的にLibro本体に組み込まれ、Libroが保有するbookストレージへ直接アクセス（API・共有サーバー等）してbookデータを取得・保存する構成を目指す。現時点ではこの本番接続が未整備のため、**zipファイルによるダウンロード／アップロードは暫定的な運用手段**である（①・⑦の部分が将来的にAPI直結に置き換わる想定）。データの中身（JSON変換ロジック・暗号化処理）はzip運用・API直結のどちらでも共通して使えるように設計する。

```
[Libro book ストレージ]
       │ ① （暫定）zipでローカルにダウンロード　／　（最終形）API/共有サーバーから直接取得
       ▼
[ContentsBuilder オーサリングUI]
       │ ② 既存ページ画像・annotsを読み込み表示
       │ ③ 付箋・音声・リンク等を編集
       ▼
[書き出し処理]
       │ ④ p####.json の annots[] / links[] を生成
       │ ⑤ 付箋テキストを画像化してPNG生成（annots/に平文保存）
       │ ⑥ 新規音声ファイルをPbve2000形式で暗号化（sounds/に保存）
       ▼
[保存・配信]
       │ ⑦ （暫定）zipでアップロード　／　（最終形）API/共有サーバーへ直接書き込み
       ▼
[Libro 本番環境]
```

### 4-2. 未知のアノテーションは「編集不可・削除しない」方針で保持する

LibroはAPI拡張や新規コンポーネント追加が活発なため、ContentsBuilderが想定する4種類のaction（GoTo+FitPage / URI / Launch / Hide+Show）以外の組み合わせや、リバースエンジニアリングで把握していない独自actionが本番bookに混在する可能性がある。

- インポート時：`actions`の構成がContentsBuilderの既知パターンに一致しないアノテーションは、**編集UI上には表示・編集対象として出さないが、内部データとしてはそのまま保持する**
- エクスポート時：上記の「未知のアノテーション」は変更を加えず、そのまま`annots[]`に書き戻す（誤って削除・上書きしない）
- `p####.json`の`annots[]`を丸ごと再生成するのではなく、「ContentsBuilderが管理しているアノテーション」と「未知のまま保持するアノテーション」をマージして出力する実装にする

### 4-2b. アノテーション削除時の画像ファイルの扱い

ContentsBuilderが管理しているアノテーションをユーザーが削除した場合、対応する`annots/xxxxxx.png`（および音声参照があれば`sounds/*.mp3`）も同時に削除し、ストレージにゴミファイルを残さない。
（4-2の「未知のアノテーション」はそもそも削除操作の対象に含まれないため、本方針と矛盾しない）

### 4-3. JSONモジュールは入出力（インポート/エクスポート）両対応とする

Libroの `p####.json` の `annots[]` は、ContentsBuilderでの**再編集時にも読み込む**必要がある（一方向の書き出し専用にはしない）。そのため、変換ロジックは次のように双方向で設計する。

```
Libro annots[]（JSON） ──インポート──▶ ContentsBuilder 内部データ構造（付箋/音声/リンク等のオブジェクト）
ContentsBuilder 内部データ構造 ──エクスポート──▶ Libro annots[]（JSON）
```

- インポート時：`actions` の種別（GoTo+FitPage / URI / Launch / Hide+Show）からアノテーション種別を判定し、ContentsBuilderの対応するオブジェクト種別（ページリンク／外部リンク／音声再生／付箋）へ復元する
- エクスポート時：ContentsBuilderのオブジェクトを対応する `actions` 構成に変換する
- 同一の変換ロジック（JSONモジュール）をインポート・エクスポート双方で共有することで、既存book（他ツールで作成されたものも含む）を読み込んで再編集→書き出す運用に対応できるようにする
- Hide/Show を使う付箋・答え表示等は、`kind`/`group` のような補助情報が無くても、`actions` の `targets` 関係性だけからペア（閉/開）を復元できる必要がある。判定ロジックの設計時に検証する

### 4-3b. CRAFT独自の判別用メタデータ（`libro-craft-meta`）

**背景：** 大問ボタンとグループ付箋の一括開閉マスターは `actions`（Hide/Show）の構造だけでは原理的に区別できないケースが実データで確認されている（例：`p0004.json` の大問ボタンと `p0016.json` のグループ付箋マスターが同一形状）。また、1個の論理トグルが複数画像の重ね合わせで構成されるケース（例：`p0016.json` の id4503/4504/4508/4509/4510クラスタ）も、`targets`の相互参照だけからは正確に復元できない。これらは他システム由来bookでは構造ヒューリスティックによる推測に頼らざるを得ないが、**ContentsBuilder（LIBRO CRAFT）自身が書き出したbookに限っては、種別を一意に判定できる独自メタデータを埋め込むことで曖昧さを解消する**。

**キー設計の方針：** Libro+ は未知のプロパティを無視する（ヒアリング済み）。ただし手元のサンプルbook JSONは全プロパティを含んでいない可能性があり、新設するキー名が将来の公式スキーマと偶然一致するリスクを完全には排除できない。そのため、**衝突しうるキーを「ラッパーオブジェクト1個」に限定**し、中身（type/role/group-id等）は完全にCRAFT専用の名前空間として自由に設計する。キー名は既存スキーマの命名規則（kebab-case：`has-cover-page`, `annot-id-block-size` 等）に合わせつつ、一般的すぎる単語を避けた `libro-craft-meta` とし、`index.json` 側・`annots[]` 側の両方で同一キー名を使う。

#### book全体マーカー（`index.json` の `configs.libro-craft-meta`）

```json
"configs": {
  "generator": "pdf2image 2.0.69.0",
  "libro-craft-meta": {
    "editor": "libro_craft",
    "schema-version": 1
  }
}
```

- `editor`：このbookが（少なくとも一度）LIBRO CRAFTで書き出されたことを示す固定値。既存の `generator`（元PDFの生成ツール情報）は上書きせず、由来の情報を保持したまま併存させる
- `schema-version`：本メタデータ仕様自体のバージョン番号。将来仕様を変更する際の互換判定に用いる

#### アノテーション単位マーカー（各 `annots[]` 要素の `libro-craft-meta`）

`pagelink`/`uri`/`launch` は既存の `actions` 構成のみで一意に判定できるため付与不要。曖昧さの原因である Hide/Show トグル系（`sticky`/`kotae`/`daimon`/`shomei`/`zu`）にのみ付与する。

```json
{
  "filename": "annots/0101.png",
  "rect": [100, 200, 50, 100],
  "actions": [ "...既存のHide/Show定義..." ],
  "libro-craft-meta": {
    "type": "sticky",
    "role": "closed",
    "group-id": "grp-42"
  }
}
```

- `type`：`ANNOTATION_TYPE_CONFIG` の種別（`sticky`/`kotae`/`daimon`/`shomei`/`zu`）と対応させる。現状エクスポート実装があるのは `sticky` のみ（`kotae`/`daimon`/`shomei`/`zu` は書き出し自体が未実装のため、`type` にこれらの値が入ることは今のところ無い）
- `role`：この要素1件の状態を表す `closed`（閉/初期表示）または `open`（開/解答表示）。CRAFT付箋グループの「マスター一括トグル＋個別メンバー」という二層構造は現行の編集UI（`toggleStickyGroup`）に存在しない（全メンバーが対等に連動するN対N対称モデルのみ）ため、`leader`/`member` のような追加区分は導入していない。二層構造の編集UI自体が実装されるタイミングで本フィールドの拡張を検討する
- `group-id`：同一の論理トグル単位（付箋グループの全メンバー）に属する `annots[]` 要素同士を紐付けるID。CRAFT側の `data-group-id`（`grp-N`）をそのまま使う。グループ化されていない単独付箋にも一意な合成id（`__solo-<id>`）を割り当て、常に付与する。1グループにつき `role:"closed"` の要素と `role:"open"` の要素が同数（メンバー数分）存在し、同一メンバーのclosed/open対応は同一 `rect` を持つことで復元する（`convertStickyGroupToLibroAnnots` がメンバーごとに同一rectでclosed/open両方を生成するため、新規フィールド無しで一意に対応付けできる）
- 複数画像重ねクラスタ（`p0016.json` id4503系列相当の、1状態が複数枚のPNGで構成されるケース）はCRAFTの編集UI・エクスポート実装のいずれにも存在しないため対象外。他システム由来bookで発生した場合は引き続き構造ヒューリスティックのフォールバックに委ねる

#### インポート時の判定優先順位

1. `libro-craft-meta` が存在し内容が有効な場合：それを最優先で採用する（構造ヒューリスティック不要・確実に判定できる）。ページ内で `libro-craft-meta` 付き要素と無し要素が混在していても、前者はメタデータから、後者は構造ヒューリスティックから、それぞれ独立してグループ復元する
2. 存在しない場合（他システム由来のbook、またはCRAFT書き出し前の要素）：既存の構造ヒューリスティック（`findTogglePairs`/`detectDaimonGroup`）にフォールバックする（現状の安全側動作を維持）

実装：`app/js/libro-format.js` の `extractCraftMetaTogglePairs()`（インポート側）、`convertStickyGroupToLibroAnnots()`（エクスポート側、`libro-craft-meta` 付与）、`buildLibroBookExport()`（book全体マーカーを `index.json` に書き込み）。`renderTogglePairs()` は `group-id` を持つ2件以上のメンバーに対し、通常のCRAFT付箋グループと同じ `dataset.groupId` を設定し、既存のグループ一括開閉ロジック（`addStickyClickHandler`）をそのまま再利用する。

#### 未検証・未確定事項

- Libro+ 本番ビューアが実際にこの未知キーを無視して問題なく動作するかの実機最終確認（開発チームへのヒアリングでは「無視される」との回答済み）
- `daimon`/`kotae`/`shomei`/`zu` のエクスポート自体が未実装（4-4の#4参照）。これらの書き出しに着手する際、大問グループの二層構造（個別開閉メンバー＋マスター一括開閉）をCRAFTの編集UIでどう表現するかも合わせて設計する必要があり、その時点で `role` の値を拡張する可能性がある

### 4-4. 実装が必要な機能

| # | 機能 | 概要 |
|---|------|------|
| 1 | bookフォルダ読み込み | ローカルにダウンロードしたbook hexフォルダ（index.json + p####.json + 画像群）を読み込み、ContentsBuilderの内部データ構造に変換する |
| 2 | Pbve2000 復号 | ページ画像表示のため、暗号化済みjpgをデコードして表示する（ビューアと同じロジック） |
| 3 | JSONインポート（annots[] → 内部データ） | 既存の `annots[]`（4-2参照）をContentsBuilderの付箋・音声・ページリンク・外部リンクオブジェクトへ変換する |
| 4 | JSONエクスポート（内部データ → annots[]） | ContentsBuilderのオブジェクトをLibroの `annots[]` スキーマ（filename/rect/hidden/actions）に変換する |
| 5a | アノテーションID欠番管理 | 削除されたIDは再利用しない。新規IDは常に「そのページで使用中の最大ID + 1」を発行する（過去の参照との衝突を避けるため） |
| 5 | 付箋の画像化 | 付箋の「閉じたアイコン」「開いた状態（テキスト入り）」をそれぞれPNGとしてラスタライズし、Hide/Show のペアとして出力する |
| 6 | アノテーションID割り当て | 既存IDと衝突しない新規IDを割り当てる（`annot-range` / `annot-id-block-size` のルールに従う。要検証） |
| 7 | Pbve2000 暗号化 | 新規音声ファイル（mp3）を書き出し時にPbve2000形式で暗号化する |
| 8 | JSON書き出し | `p####.json` の更新（annots追加・annot-range更新）、`index.json` の更新（必要な場合） |
| 9 | アップロード機能 | 書き出した一式（更新済みJSON・暗号化済みmp3・annots画像）を本番ストレージへ自動配置する |

---

## 未確定事項（実装前に確認・検証が必要）

| # | 項目 | 内容 |
|---|------|------|
| 1 | アノテーションID割り当てルール | `annot-id-block-size`（例：300）の正確な意味と、新規ID発行時に既存IDと衝突しないための具体的なルールを検証する必要がある |
| 2 | 本番接続方法（zip運用からの移行） | 現時点はzipダウンロード→編集→zipアップロードが暫定運用。最終形ではLibro本体のbookストレージにAPI等で直接アクセスする想定だが、API仕様・認証方式・移行タイミングは未確定 |
| 3 | `index.json` 更新の要否 | 付箋等の新規アノテーション追加が `index.json`（outlineやpages等）に影響を与えるかどうかは未検証 |
| 4 | 既存 `server.py` との関係 | 現在の開発用プレビューサーバー（`app/_media` へのアップロード機能）を、本番アップロード機能の土台として拡張するか、別実装にするかは未定 |
| 5 | Hide/Show ペアの判定ロジック | `kind`/`group` を使わずに `targets` の関係性だけから「付箋の開閉ペア」「答え表示のペア」等を一意に復元できるか、複数annotサンプルで検証が必要。CRAFT自身が書き出したbookについては4-3bの `libro-craft-meta` で解消する方針だが、他システム由来bookは引き続き構造ヒューリスティックに頼る |

---

## 次のステップ

- [ ] アノテーションID割り当てルールの検証（複数ページ・複数annotを含むbookサンプルでの `annot-range` 規則の確認）
- [x] `libro-craft-meta`（4-3b）の `role`/`group-id` 詳細設計と、エクスポート/インポート両処理への実装（付箋グループのみ。daimon/kotae/shomei/zuは書き出し自体が未実装のため対象外）
- [ ] 本番アップロード先の接続方式の確認（Libro担当者への確認事項）
- [ ] 付箋の画像化（テキスト→PNG変換）の実装方式の検討（Canvas API等）
- [ ] 上記をふまえた詳細設計・実装スケジュールの策定
