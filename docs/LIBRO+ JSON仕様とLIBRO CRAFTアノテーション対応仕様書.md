# LIBRO+ JSON仕様とLIBRO CRAFTアノテーション対応仕様書

LIBRO+ が生成・読み込む book フォルダ形式（`index.json` / `p####.json` / `annots/` 等）の正式仕様と、LIBRO CRAFT（本リポジトリ）が内部で扱うアノテーションデータモデルとの対応関係をまとめた開発参照資料。今後の実装判断（インポート/エクスポート対応範囲の拡張、新規アノテーション種別の追加等）に使うことを目的とした確定仕様書であり、要望・TODO管理は行わない（要望管理は別途Issue等で行うこと）。

**記載方針**：全項目に「実装済み／未実装／未検証」を明記し、コード上の根拠（ファイル名・関数名）を併記する。未実装の項目について推測の設計案は書かない。LIBRO+側の仕様はサンプルbook（`sample_books/8a24127cb94d4a158ae43954184af569`、LIBRO+提供のボタン種別デモ book、実ページ31・annots 776件）を全件パースして検証した内容のみを記載し、ビューア内部の描画ロジック自体は未確認のため、JSON構造からの推定である旨は都度明記する。

対象コード: [app/js/libro-format.js](../app/js/libro-format.js)（LIBRO⇔CRAFT変換）、[app/js/config.js](../app/js/config.js)（CRAFT種別定義）、[app/js/storage.js](../app/js/storage.js)（保存・書き出し）、[app/js/buttons.js](../app/js/buttons.js) / [app/js/sticky.js](../app/js/sticky.js)（大問/答/証明ボタン・付箋の操作）。関連資料: [docs/libro_integration_計画書.md](libro_integration_計画書.md)、[libro-integration Skill](../.claude/skills/libro-integration/SKILL.md)。

---

## 1. LIBRO+ book フォーマット仕様

### 1-1. book フォルダ構成

```
<book root>/
├── index.json            … 書誌情報・ページ一覧・目次（outline）・configs
├── fulltext.json          … 全ページの全文テキスト（配列、index.jsonのpages配列と同じ件数・順序）
├── p0001.json … p00NN.json  … ページごとのアノテーション・OCRデータ
├── p0001-1.jpg / -2.jpg / -4.jpg / -8.jpg / -16.jpg  … ページ画像（等倍・1/2・1/4・1/8・1/16縮小） ※暗号化
├── annots/                … アノテーション用画像（PNG）※平文（暗号化対象外）
│   └── 000300.png ...
└── sounds/                … 音声ファイル（mp3）※暗号化
    └── in_w3_k001.mp3 ...
```

検証に使ったサンプルbookでは、`index.json.pages` の件数（46件）と「実ページ数」（`configs.real-page-count: 31`）が一致しない。詳細は1-4節を参照。

### 1-2. `index.json`

| キー | 内容 | 検証状況 |
|---|---|---|
| `text` | `fulltext.json` へのファイル名参照（`"fulltext.json"`固定値） | 実データで確認済み |
| `metadata.title` | 書誌タイトル | 実データで確認済み |
| `configs.has-cover-page` | boolean。サンプルでは`false` | 値のみ確認、意味の実挙動は未検証 |
| `configs.rl-reading-order` | `"left"`。読み進め方向（右綴じ/左綴じ）と推測 | 値のみ確認、意味は未検証 |
| `configs.annot-id-block-size` | ページごとのアノテーションID割当ブロック幅（サンプルでは`300`） | **意味を数式で確定済み**（1-5節） |
| `configs.generator` | 元PDF変換ツールの情報（例：`"pdf2image 2.0.69.0"`） | 実データで確認済み |
| `configs.page-fit` / `configs.page-fit-for-single` | `"page"`。ページ全体フィット表示指定と推測 | 値のみ確認、実挙動は未検証 |
| `configs.toc-page` | 目次ページの遷移先ページ番号（サンプルでは`32`＝実ページ2+3の見開き合成ページ） | 実データで確認済み（1-4節参照） |
| `configs.real-page-count` | 実ページ数（サンプルでは`31`） | 実データで確認済み |
| `configs.libro-craft-meta` | CRAFT独自拡張プロパティ（4節参照） | 実装済み（CRAFTが書き出したbookにのみ付与） |
| `outline` | 目次項目の配列。`description`（見出し文字列）/`dest-page`（遷移先ページ番号）/`children`（入れ子） | 実データで確認済み |
| `pages` | ページメタ情報の配列（1-3節） | 実データで確認済み |

### 1-3. `index.json` の `pages[]`（ページメタ情報）

```json
{
  "width": 4960, "height": 7015, "dpi": 600.0,
  "json": "p0001.json",
  "images": { "1/1": "p0001-1.jpg", "1/2": "p0001-2.jpg", "1/4": "p0001-4.jpg", "1/8": "p0001-8.jpg", "1/16": "p0001-16.jpg" }
}
```

見開き合成ページ（1-4節）の場合はこれに加えて `sub-pages`（実ページへの参照）を持つ。`images`のキー（`1/1`〜`1/16`）は解像度倍率で、5段階すべてが揃わないページは無い（サンプル全46ページで確認）。`pages`配列のインデックス+1が、`GoTo`アクション等で参照される「ページ番号」に対応する（1始まり）。

### 1-4. 見開き（見開き表示・スプレッド）合成ページの仕組み【既存資料未記載・今回新規判明】

サンプルbookは実ページ31件（page 1〜31）に加え、`index.json.pages`に15件の**見開き合成ページ**（page 32〜46）を追加で持つ。これは「2ページを横に結合した1枚の画像として見開き表示する」ためのLIBRO+側の仕組みで、以下の構造を持つ。

- **実ページ側**（例：`p0006.json`）は `parent-page` フィールドで対応する合成ページ番号（例：`34`）を持つ。ページ1（表紙相当）のみ`parent-page`を持たない。
- **合成ページ側**（例：`p0034.json`）は、実ページを持つ`json`と異なり、独自の結合画像（例：`p0034-1.jpg`、幅は実ページの2倍＝9920px）と、`sub-pages`（`[{rect:[0,0,4960,7015], page:6}, {rect:[4960,0,4960,7015], page:7}]`のように、結合画像内でのオフセット矩形と対応する実ページ番号の配列）を持つ。
- 合成ページ自身の`annots[]`は、各半分をクリックすると対応する実ページへ`GoTo`するだけの、可視要素を持たない当たり判定2件のみで構成される（`filename: "annots/ffff.png"`＝4×4pxの透明PNG、1-6節のセンチネルファイル）。
- 実ページ数（31）と`pages`配列の件数（46）が一致しないため、**`index.json.configs.real-page-count`／`parent-page`／`sub-pages`を考慮しないと、見開き合成ページを独立した「本来存在しないページ」として誤って数え上げてしまう**（3節の既知の制約を参照）。

**見開き単位のHide/Show連動の実装方法**：デモページ「解答ボタン（見開き単位）」（実ページ7）を解析したところ、一括開閉ボタンは合成ページ側ではなく**実ページ側`p0007.json`のtargetsに、隣接する実ページ`p0006.json`側のアノテーションIDを直接含める**形で実装されていた（例：`annots/1814.png`のHideアクションのtargetsに、p0007自身のID(1800番台)とp0006のID(1500番台)が混在）。合成ページの`sub-pages`が持つオフセット矩形と組み合わせ、見開き表示時に両実ページのannotsを同一座標系に重ねて描画していると推測されるが、LIBRO+ビューア内部の描画ロジック自体は未確認のため、この点は構造からの推定である。

### 1-5. アノテーションIDの採番規則（`annot-id-block-size`の意味を確定）

サンプルbook全ページ（annotsを持つ42ページ全件）を検証した結果、以下の式が例外なく成立することを確認した。

> そのページのID範囲開始値 = **(ページ番号 − 1) × `annot-id-block-size`**（サンプルでは300）

例：page4→900、page6→1500、page7→1800、page8→2100 … page28→8100（全て一致）。各ページの`annot-range`は「そのページで実際に使用しているIDのmin/max」であり、300件の枠を使い切る必要はない（例：page4は`annot-range:[900,948]`で49件のみ使用）。既存資料で「未検証」としていたこの規則は本調査で確定した。

### 1-6. ページJSON（`p####.json`）の構造

| キー | 内容 | 有無 |
|---|---|---|
| `text` | そのページの全文テキスト（`fulltext.json`と重複する内容） | 全46ページに存在 |
| `zones` | OCR座標データ（段落/行/単語の入れ子配列、`[x,y,w,h,flag]`形式）。**アノテーションとは無関係** | 31ページに存在（残り15＝見開き合成ページには無し） |
| `links` | 配列。サンプル全ページで空配列のみ確認 | 全ページに存在するが用途未確認・本サンプルでは不使用 |
| `width` / `height` / `dpi` | ページ画像の寸法・解像度 | 全ページに存在 |
| `images` | 解像度別画像ファイル名（`index.json`の`pages[]`と同内容） | 全ページに存在 |
| `parent-page` | 対応する見開き合成ページ番号（実ページのみ） | 30ページに存在 |
| `sub-pages` | 結合元の実ページ番号とオフセット矩形（見開き合成ページのみ） | 15ページに存在 |
| `annot-range` | そのページで使用中のアノテーションIDの`[min, max]` | annotsを持つ42ページに存在 |
| `annots` | アノテーション本体の配列（1-7節） | annotsが1件以上あるページのみ存在（無い場合はキー自体が無い。空配列ではない） |

### 1-7. `annots[]` 要素の詳細仕様

```json
{
  "filename": "annots/0900.png",
  "rect": [1952, 1117, 494, 76],
  "hidden": true,
  "actions": [ { "action": "Hide", "targets": [900] }, { "action": "Show", "targets": [901] } ]
}
```

| フィールド | 内容 |
|---|---|
| `filename` | アノテーション画像（PNG・平文）への相対パス。ファイル名の数値部分がそのままアノテーションID（例：`0900.png`→ID 900）。**例外**：`annots/ffff.png`は4×4pxの透明PNGで、可視要素を持たない当たり判定専用のセンチネルファイル（1-4節の見開きナビゲーション等で使用、776件中30件） |
| `rect` | `[x, y, width, height]`。ページ画像のピクセル座標系での絶対値 |
| `hidden` | 初期表示時に非表示にするか。**省略可能**（省略時は表示＝false扱い。サンプル776件中436件のみ明示） |
| `actions` | 押下時の振る舞い（1-8節）。**省略可能**（776件中105件は`actions`自体が無い＝他要素からShow/Hideされるだけの受動的な表示専用画像で、自身はクリック不可） |

### 1-8. `actions` の種別カタログ

サンプルbook全776件のannotsを走査した結果、使用されている action キーワードは以下の6種のみであることを確認した（これ以外は本サンプルでは一切出現しない）。

| action | 出現回数 | 用途 |
|---|---|---|
| `Hide` | 753 | 指定targetsのアノテーションを非表示にする |
| `Show` | 755 | 指定targetsのアノテーションを表示する |
| `GoTo` | 58 | 指定ページ番号へ遷移する（`page`フィールド） |
| `FitPage` | 56 | ページ全体フィット表示にする（`GoTo`と併用） |
| `URI` | 14 | 外部URLを開く、またはビューア側で解釈される疑似プロトコル関数呼び出し（1-9節） |
| `Launch` | 15 | 指定`filename`（`sounds/*.mp3`）を再生する |

**`GoTo`には実データ上2つの異なるパターンがあり、既存資料の「`GoTo`+`FitPage`」という単純な表記は不正確**なので訂正する。

| パターン | actions構成 | 用途・件数 |
|---|---|---|
| ページ内リンク | `[{action:"GoTo",page:N}, {action:"FitPage"}, {action:"FitPage"}]`（**FitPageが2回重複**） | 目次ページ本文中のリンク。28件全てで完全一致 |
| 見開きナビゲーション | `[{action:"GoTo",page:N}]`（FitPage無し） | 見開き合成ページの当たり判定。30件全てで完全一致 |

現行の`app/js/libro-format.js`の`classifyActions()`は「`GoTo`かつ`FitPage`の両方を含む」ことを`pagelink`（ページリンク）判定の条件にしているため、後者（FitPage無しの単独`GoTo`）は現状「未知アノテーション」として扱われる（**未検証の既知の制約**。詳細は3節参照）。

**Hide/Show の構造パターンについて**：目次のoutlineに列挙されている18種類の見た目ラベル（解答ボタン［大問単位／ページ単位／見開き単位］・重要語句ボタン・表示ボタン［横組み／縦組み］・答ボタン・表ボタン・日本語ボタン・図ボタン［通常／解説あり］・例ボタン・ステップボタン・証明ボタン・色分けボタン）を全て解析したが、**専用のaction種別は一切存在せず、全て`Hide`/`Show`の組合せのみで実装されている**。見た目の違いは、annots画像の内容とtargetsグラフの形状（1:1相互トグル／N:N一括グループトグル／自己トグル+グループトグルの複合／3+ノードの多段階循環等）だけで作られている。具体的な構造パターンは5節（CRAFT実装予定なしの種別）で詳述する。

### 1-9. `URI` に埋め込まれる疑似プロトコル関数

`URI`アクションの`uri`フィールドは実URL（`https://...`）だけでなく、LIBRO+ビューア側でeval実行されると推測される`to関数名(引数,...)`形式の文字列も格納する。実データで確認できた5種類：

| 関数 | 用途 | 引数の解読状況 | CRAFT対応状況 |
|---|---|---|---|
| `toAppendix("フォルダ名", 表示モード)` | Plusファイル（デジタルアニメーション） | 第1引数＝フォルダ名、第2引数＝表示モード（実データは`1`固定） | 実装済み（`plusfile`） |
| `toMovie("id", "base64A", "base64B")` | 動画再生（J-Stream） | 第1引数＝プレイヤーID文字列。第2・第3引数はBase64エンコードされた数値文字列（例：`"NDExNQ=="`→デコードすると`"4115"`）であることを確認。デコード後の数値が何を指すか（コンテンツID／再生範囲等）までは未解読 | 実装済み（`video`、`annVideoSrc:'2'`）。引数の意味自体は未解析のため生文字列のまま保持 |
| `toMovieBNR("path", flag)` | 動画再生（AWS） | 第1引数＝S3的なパス文字列、第2引数＝実データ全サンプルで`1`固定 | 実装済み（`video`、`annVideoSrc:'2'`）。同上 |
| `toListening("id", flag)` | カラオケボタン（音声同期ハイライト） | 第1引数＝音声ID文字列、第2引数＝`1`固定 | **未対応**（CRAFTに作成手段が無いためスコープ外、外部リンク扱いのまま保持） |
| `toFlashcard("deckId", "variant", flag)` | フラッシュカード | 第1引数＝デッキID、第2引数＝バリアント番号文字列（実データは`"2"`）、第3引数＝`1`固定 | **未対応**（同上） |

### 1-10. `fulltext.json`

`index.json.pages`と同じ件数（46件）・同じ順序の配列で、各要素がそのページの全文テキスト（`string`）。実ページ（page1〜31相当のindex 0〜30）にはテキストが入るが、見開き合成ページ（index 31〜45）は空文字列。`p####.json`側の`text`キーと内容が重複している。

### 1-11. `annots/` フォルダと `sounds/` フォルダ

- `annots/`：アノテーション画像（PNG、平文）。ページを問わずフラットな1フォルダに全ページ分（サンプルでは749ファイル）が格納され、ファイル名の数値部分がアノテーションIDと対応する。センチネルファイル`ffff.png`（4×4px透明）は当たり判定専用。
- `sounds/`：音声ファイル（mp3、Pbve2000暗号化）。`Launch`アクションの`filename`から参照される。

### 1-12. Pbve2000 暗号化方式

- 対象：ページ画像（`p####-*.jpg`）、音声ファイル（`sounds/*.mp3`）。`annots/*.png`は対象外（平文）。
- エンコード：元データ先頭に`Pbve2000`（8バイト文字列）ヘッダーを付加し、全体を`0xCC`でXOR。
- デコード：先頭8バイトを除去し、残りを`0xCC`でXOR。

---

## 2. LIBRO CRAFT のアノテーションモデル

`ANNOTATION_TYPE_CONFIG`（[app/js/config.js](../app/js/config.js)）に定義される10種別。種別ごとに`savedData`（`dataset.savedData`にJSON文字列として保持）と`dataset`直下プロパティ、DOM表現（class名）を持つ。

### 2-1. マーカー/紙面カラー/画像アイコン共通型（pagelink・plusfile・externallink・audio・video）

DOM上は`.ann-object`（マーカー/紙面カラー型）または`.ann-image-obj`（画像アイコン型）。`annDisplayType`により3種の見た目を切り替える：`marker`（アイコン+ラベル）／`page-color`（紙面色ハイライト、pagelinkのみ選択可）／`image`（LIBRO元画像やアップロード画像をそのまま`<img>`表示、pagelink/plusfile/externallink/audio/video共通）。

| 種別 | savedDataプロパティ | 内容 |
|---|---|---|
| 共通 | `annDisplayType` | `'marker'` / `'page-color'`（pagelinkのみ）/ `'image'` |
| 共通 | `annIconImage` / `annImageScale` / `annImageNaturalW` / `annImageNaturalH` | 画像アイコン型：表示画像ファイル名（`mediaBlobs`キー）・表示比率(%)・アップロード時の原寸サイズ |
| pagelink | `annTarget` | リンク先ページ番号 |
| plusfile | `annFile` | ディレクトリ名 |
| plusfile | `annShowMode` | `'0'`＝ページ内（LIBRO+ではモーダル表示）／`'1'`＝別タブ／`'2'`＝フローティング |
| externallink | `annUrl` | リンク先URL |
| audio | `annFile` | 音声ファイル名（拡張子なし） |
| audio | `annPlayMode` | コントローラー表示有無 |
| video | `annVideoSrc` | `'0'`＝内部ファイル／`'1'`＝外部タグ／`'2'`＝LIBROリンク（toMovie/toMovieBNR由来） |
| video | `annFile` | 内部ファイル指定時の動画ファイル名 |
| video | `annVideoFn` / `annVideoArg` | `annVideoSrc:'2'`時：関数名（`toMovie`/`toMovieBNR`）と生の引数文字列 |
| video | `annShowMode` | ページ内／別タブ |
| 共通 | `annLabel` | マーカー表示テキスト（JSONには存在するが入力UIが無いため常に既定ラベル） |
| 共通 | `annColor` | 塗り色 |
| 共通 | `style`（left/top/width/height） | 位置・サイズ |

### 2-2. 付箋（sticky）

DOM上は`.sticky-note`。LIBRO+には「テキストノート」に相当する専用actionが存在しないため、CRAFTも「閉」「開」2枚の画像をHide/Showで相互切替する方式で表現する（1-8節参照）。

| プロパティ | 種別 | 内容 |
|---|---|---|
| `style`（left/top/width/height） | 共通 | 位置・サイズ |
| `savedData.annColor` | savedData | 背景色（青/緑/黄） |
| `savedData.annFont` | savedData | フォントサイズ。**UIが無いデッドコード**（`openBulkStickyDialog`という未使用関数にのみ定義） |
| `dataset.groupId` | dataset | 付箋グループの紐付け（`grp-N`）。グループ内は全メンバーが対等に連動するN:N対称モデル（個別開閉可能なメンバー＋別途マスター一括開閉、という二層構造は無い） |
| `dataset.daimonId` / `kotaeId` / `shomeiId` | dataset | 大問／答／証明ボタンとの紐付け |
| `dataset.fuhyoji` / `kotaeOrigBg` / `shomeiOrigBg` / `shomeiOutline` | dataset | 内部状態（元の色・表示制御用） |
| `dataset.libroToggle` / `closedId` / `openId` / `closedFile` / `openFile` / `stickyOpenId` / `stickyColorOverride` | dataset | LIBRO由来付箋の再エクスポート用内部管理プロパティ（4節参照） |

### 2-3. 大問／答／証明ボタン（daimon・kotae・shomei）

DOM上は`.daimon-btn` / `.kotae-btn` / `.shomei-btn`。ネイティブ描画（`renderButtonVisual`、[app/js/buttons.js](../app/js/buttons.js)）で、画像素材またはプリセット色のいずれかを表示する。

| プロパティ | 内容 |
|---|---|
| `savedData.btnPreset` | プリセットカラー（`BTN_COLOR_OPTIONS`：大問＝青／答＝赤／証明＝紫） |
| `savedData.btnScale` | 拡大率 |
| `savedData.btnImageFile` | 画像素材ファイル名（LIBRO由来ボタンの実物PNGを流用する場合） |
| `dataset.btnHasImage` | `btnImageFile`の有無から導出される内部フラグ（savedDataには含まれない） |
| `dataset.daimonId` / `kotaeId` / `shomeiId` | 自身のID（付箋側からの紐付け参照用） |

LIBRO由来の大問ボタン（`dataset.libroToggle==='1'`）は、位置・サイズ以外の書き換え手段が無く、ズーム追従のみ`.libro-toggle`修飾クラスで個別対応している（詳細は4節）。

### 2-4. 図（zu）

`ANNOTATION_TYPE_CONFIG`に定義があり、Undo・保存・復元・大問ボタン紐付けの各ロジックは存在するが、**ページ上に配置するボタンがどこにも無い作成不可能な幽霊種別**（過去実装の残骸の可能性）。savedDataプロパティの実体は未調査（作成経路が無いため）。

---

## 3. 組込み方針（CRAFT⇔LIBRO+ 変換ルール）

インポート（`parseLibroBookZip`/`convertPageAnnotations`）・エクスポート（`buildLibroBookExport`/`convertAnnotationToLibroAnnot`）とも[app/js/libro-format.js](../app/js/libro-format.js)に実装。変換ロジックは双方向で共有する。

### 3-1. 単純action型（1annot=1動作）

| CRAFT種別 | LIBRO+ annots表現 | インポート時の変換 | エクスポート時の変換 | 対応状況 |
|---|---|---|---|---|
| pagelink | `GoTo`+`FitPage`+`FitPage` | `annDisplayType:'page-color'`, `annTarget: GoToのpage` | `[{GoTo,page:annTarget},{FitPage}]`（FitPageは1回のみ書き出す。実データの重複FitPageは書き出し時には再現しない） | 実装済み |
| externallink | `URI`（`toMovie`等の既知パターンに一致しない場合） | `annDisplayType:'marker'`, `annUrl: uri文字列` | `{URI, uri:annUrl}` | 実装済み |
| audio | `Launch` | `annDisplayType:'marker'`, `annFile: ファイル名(拡張子除去)`, `annPlayMode:'0'` | `{Launch, filename:"sounds/"+annFile+".mp3"}` | 実装済み |
| plusfile | `URI`＋`toAppendix(folder,mode)` | `annDisplayType:'marker'`, `annFile:folder`, `annShowMode:mode` | `{URI, uri:'toAppendix("'+annFile+'",'+annShowMode+')'}` | 実装済み |
| video（LIBROリンクのみ） | `URI`＋`toMovie(...)`/`toMovieBNR(...)` | `annDisplayType:'marker'`, `annVideoSrc:'2'`, `annVideoFn`, `annVideoArg`（生文字列） | `{URI, uri:annVideoFn+'('+annVideoArg+')'}` | 実装済み（`annVideoSrc`が`'0'`/`'1'`＝内部ファイル/外部タグ指定の場合はLIBRO側に対応actionが無いため書き出し非対応） |

いずれも画像アイコン型（`annDisplayType:'image'`）の場合、元画像（`annots/xxxx.png`）が無変更なら既存zipエントリをそのまま維持し、差し替え時のみ平文PNGのまま上書きする（`annots/*.png`は暗号化対象外。[libro_image_display_type_feature.md](../.claude/skills/libro-integration/SKILL.md)相当のロジック）。

### 3-2. Hide/Show系（付箋・大問ボタン）

| CRAFT種別 | LIBRO+ annots表現 | 対応状況 |
|---|---|---|
| sticky（付箋、単独 or CRAFT作成のグループ） | closed/open 2枚（Nメンバーなら2N枚）のHide/Showペア。`group-id`で全メンバーを束ねる（4節） | 実装済み（`convertStickyGroupToLibroAnnots`） |
| daimon（LIBRO由来、位置・削除の変更なし） | 生データをそのまま無変更で書き戻す（passthrough方式） | 実装済みだが制約あり：**位置をドラッグ移動してから書き出すと変更が反映されず元の位置のまま書き戻される**（再生成ロジック自体が未実装のため） |
| daimon（CRAFT上での新規作成） | ― | **未実装**（`storage.js`の`supportedTypes`に`daimon`が含まれないため、書き出し時にトースト警告のうえ除外される） |
| kotae / shomei / zu | ― | **未実装**（作成・編集は可能だが、LIBRO形式書き出しには一切対応しない。書き出し時にトースト警告のうえ除外される） |

### 3-3. 現状の既知の制約（未検証・未修正）

- **見開き合成ページの誤読込み**：`libro-format.js`の`parseLibroBookZip`/`buildLibroBookExport`はいずれも`indexJson.pages`を`real-page-count`/`parent-page`/`sub-pages`を考慮せず単純に連番展開している（該当箇所を`grep`し参照ゼロを確認済み）。本サンプルのような見開き合成ページを含むbookを読み込むと、本来31ページの書籍が46ページとして表示されるはずである（実ブラウザでの目視検証は未実施）。
- **`GoTo`単独（FitPage無し）パターンの未対応**：`classifyActions()`が`GoTo`+`FitPage`の両方を要求するため、見開きナビゲーション用の`GoTo`単独annotsは現状「未知アノテーション」として扱われる。
- **多対多・連鎖Hide/Show（大問・グループ付箋以外の構造）の扱い**：1:1ペアにも大問ボタンの形にも収まらない構造（色分けボタン・ステップボタン等）は「拡張トグルネットワーク」として`.libro-network-slot`で認識・再描画され、**位置・サイズ編集および編集後の再書き出しに対応済み**（内容編集・新規作成・選択削除・Undo・編集ダイアログは非対応）。5節で詳述する。

---

## 4. 新規プロパティ仕様（`libro-craft-meta`）

LIBRO+は未知のプロパティを無視する（開発チームへのヒアリングで確認済み、実機での最終確認は未実施）。大問ボタンとグループ付箋の一括開閉マスターは`actions`構造だけでは原理的に区別できないケースが実データで確認されているため、CRAFT自身が書き出したbookに限り、種別を一意に判定できる独自メタデータを埋め込む。

### 4-1. book全体マーカー（`index.json.configs.libro-craft-meta`）

```json
"configs": {
  "generator": "pdf2image 2.0.69.0",
  "libro-craft-meta": { "editor": "libro_craft", "schema-version": 1 }
}
```

このbookが少なくとも一度CRAFTで書き出されたことを示す固定値。既存の`generator`は上書きせず併存させる。実装済み（`buildLibroBookExport`）。

### 4-2. アノテーション単位マーカー（各`annots[]`要素の`libro-craft-meta`）

```json
{
  "filename": "annots/0101.png", "rect": [100, 200, 50, 100],
  "actions": [ "...既存のHide/Show定義..." ],
  "libro-craft-meta": { "type": "sticky", "role": "closed", "group-id": "grp-42" }
}
```

`pagelink`/`uri`/`launch`系は`actions`構成のみで一意判定できるため付与不要。曖昧さの原因であるHide/Showトグル系（`sticky`/`kotae`/`daimon`/`shomei`/`zu`）にのみ付与する対象。

| フィールド | 内容 | 実装状況 |
|---|---|---|
| `type` | `ANNOTATION_TYPE_CONFIG`の種別名 | 実装済みの値は`'sticky'`のみ（`kotae`/`daimon`/`shomei`/`zu`はエクスポート自体が未実装のためこの値が入ることは無い） |
| `role` | `'closed'`（閉/初期表示）または`'open'`（開/解答表示）。CRAFT付箋グループは「マスター一括トグル＋個別開閉メンバー」の二層構造を持たない（全メンバー対等連動のN:N対称モデルのみ）ため、`leader`/`member`等の追加区分は導入していない | 実装済み |
| `group-id` | 同一論理トグル単位に属する全`annots[]`要素を紐付けるID。CRAFTの`data-group-id`（`grp-N`）をそのまま使用。ソロ付箋にも合成id（`__solo-<id>`）を常に付与する | 実装済み |

同一group-id内のclosed/openメンバー対応は、新規フィールドを追加せず**rectの一致**で復元する（`convertStickyGroupToLibroAnnots`がメンバーごとに同一rectでclosed/open両方を生成するため）。

### 4-3. インポート時の判定優先順位

1. `libro-craft-meta`が存在し内容が有効な場合：最優先で採用（構造ヒューリスティック不要）。
2. 存在しない場合（他システム由来のbook、CRAFT書き出し前の要素）：既存の構造ヒューリスティック（`findTogglePairs`/`detectDaimonGroup`）にフォールバックする。

実装：`extractCraftMetaTogglePairs()`（インポート）／`convertStickyGroupToLibroAnnots()`（エクスポート、meta付与）／`buildLibroBookExport()`（book全体マーカー書込み）／`renderTogglePairs()`（`group-id`を`dataset.groupId`として設定し既存の一括開閉ロジックを再利用）。

### 4-4. 未確定事項

`daimon`/`kotae`/`shomei`/`zu`のエクスポート自体が未実装（3-2節参照）。これらの書き出しに着手する際、大問グループの二層構造（個別開閉メンバー＋マスター一括開閉）をCRAFT編集UI上でどう作成・表現するかを別途設計する必要があり、その時点で`role`の値を拡張する可能性がある（拡張の具体案は未確定のため記載しない）。

---

## 5. LIBRO+ には存在するが LIBRO CRAFT では実装予定がない種別

以下はLIBRO+のサンプルbookで実在が確認できた機能だが、LIBRO CRAFTの`ANNOTATION_TYPE_CONFIG`には対応する種別が存在せず、**本フェーズでは実装予定がない**（ユーザー確認済み）。実装予定が無くても、今後の判断材料として構造を確定記載する。

### 5-1. ステップボタン（P17でデモ）

同一位置（同一rect）に3〜4枚のアイコン画像を積層し、クリックのたびに「自分自身をHide→次のアイコンをShow＋対応するコンテンツ画像をShow」を繰り返す**多段階（3+）循環Hide/Showチェーン**。最後のアイコンをクリックすると全コンテンツをHideして最初のアイコンに戻る（リセット）。

実データ例（P17末尾グループ、4段階）：

| ID | rect | 役割 | actions概要 |
|---|---|---|---|
| 4871 | 470,782,122,122 | ステップ1アイコン | Hide[4871], Show[4868, 4874] |
| 4872 | 同上 | ステップ2アイコン | Hide[4872], Show[4869, 4871] |
| 4873 | 同上 | 初期表示アイコン | Hide[4873], Show[4870, 4872] |
| 4874 | 同上 | 最終アイコン（クリックでリセット） | Hide[4874,4870,4869,4868], Show[4873] |
| 4868/4869/4870 | 2590,818,1252,823 | ステップ1/2/3のコンテンツ画像（同一rectに重なる、actions無しの受動表示） | ― |

単純な2状態トグル（付箋・答ボタン）とも、大問ボタンのN:N一斉トグルとも異なる第3の構造パターンであることを確認した。

### 5-2. 色分けボタン（P19でデモ）

同一ページに性質の異なる2つの仕組みが混在する。

**(a) 凡例の非排他的多重トグル**：凡例10項目それぞれが「押下前⇄押下後」の1:1トグルだが、Show側は自分専用のカラーマップ画像（大きな固定rectに重なる背景画像）を表示するのみで、**他の凡例項目の表示状態には一切干渉しない**。すなわち10個を互いに独立してON/OFFできる（排他制御なし）。

実データ例：
```json
{"filename": "annots/5400.png", "actions": [{"action":"Show","targets":[5401]}, {"action":"Hide","targets":[5400]}, {"action":"Show","targets":[5402]}]}
{"filename": "annots/5402.png", "actions": [{"action":"Hide","targets":[5401]}, {"action":"Show","targets":[5400]}, {"action":"Hide","targets":[5402]}]}
```

**(b) 本文ハイライトの大問型構造**：同一ページ内に、大問ボタンと同型の「マスター一括Show/Hide＋個別1:1ペア」構造が2セット存在する（凡例部分とは独立した別の仕組み）。

### 5-3. 「拡張トグルネットワーク」としてのCRAFT側の扱い

上記5-1・5-2はいずれも、CRAFT側の`ANNOTATION_TYPE_CONFIG`に対応種別が無く**新規作成・内容編集は不可**だが、インポート時に「拡張トグルネットワーク」（`.libro-network-slot`、内部に`.libro-network-frame`を複数持つ）として**認識・再描画され、位置・サイズの編集および編集後の再書き出しには対応している**（`expandNetworkClosure`によるBFS閉包検出＋`buildNetworkGroup`によるrect単位のスロット化、[app/js/libro-format.js](../app/js/libro-format.js)）。閲覧モードのクリック動作は、各フレームが保持する元の`actions[]`をそのまま再生する汎用インタプリタ方式で実現しており、大問ボタンのpassthrough（3-2節）と異なり**位置編集は書き出しに反映される**（`storage.js`の`networkRawAnnots`がDOM上の現在位置からrectを都度上書きするため）。選択・削除・Undo・編集ダイアログ・内容編集（フレーム追加削除・画像差し替え）は非対応。

### 5-4. その他のLIBRO+専用機能（実装予定なし）

| 機能 | LIBRO+側の実装 | CRAFTでの状況 |
|---|---|---|
| カラオケボタン | `URI`＋`toListening(id, 1)` | CRAFTに作成手段が無いためスコープ外。インポート時は外部リンク扱いのまま保持（1-9節） |
| フラッシュカード | `URI`＋`toFlashcard(deckId, variant, 1)` | 同上 |
| 動画の内部ファイル/外部タグ指定（`annVideoSrc:'0'`/`'1'`） | LIBRO+側に対応する`action`構成が無い | CRAFT上での作成・編集は可能だが、LIBRO形式書き出し時にLIBRO側の対応actionが無いため未対応のまま |

---

## 6. 参照コード一覧

| ファイル | 役割 |
|---|---|
| [app/js/config.js](../app/js/config.js) | `ANNOTATION_TYPE_CONFIG`（CRAFT種別定義）、色オプション各種 |
| [app/js/libro-format.js](../app/js/libro-format.js) | LIBRO+ book⇔CRAFT内部データの相互変換（インポート：`parseLibroBookZip`/`convertPageAnnotations`、エクスポート：`buildLibroBookExport`/`convertAnnotationToLibroAnnot`/`convertStickyGroupToLibroAnnots`、`libro-craft-meta`：`extractCraftMetaTogglePairs`、拡張トグルネットワーク：`expandNetworkClosure`/`buildNetworkGroup`/`renderNetworkGroups`） |
| [app/js/storage.js](../app/js/storage.js) | `saveAnnotationsAsLibroBook()`（書き出し対象の収集・`supportedTypes`判定） |
| [app/js/buttons.js](../app/js/buttons.js) | 大問／答／証明ボタンの描画・操作（`renderButtonVisual`） |
| [app/js/sticky.js](../app/js/sticky.js) | 付箋の操作（`groupStickyNotes`/`toggleStickyGroup`） |
| [app/js/annotation-dialog.js](../app/js/annotation-dialog.js) | 編集フォーム生成（`savedData`各プロパティの入出力） |
| [docs/libro_integration_計画書.md](libro_integration_計画書.md) | LIBRO連携機能の開発計画・データフロー・未確定事項 |
| [.claude/skills/libro-integration/SKILL.md](../.claude/skills/libro-integration/SKILL.md) | 実装時に見落としやすい要点のまとめ |
