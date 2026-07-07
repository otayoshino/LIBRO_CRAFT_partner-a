# アノテーションJSONと編集画面の対応表

オーサリングパネルの「追加ボタン」ごとに、内部データ（`annotations.json` / 各要素の `savedData` ・ `dataset`）と、編集画面（サイドバー詳細設定パネル／ダブルクリック編集ポップアップ）で実際に設定できる項目を突き合わせた一覧。各ボタンの末尾に「ご要望」欄を用意してあるので、変更したい内容があれば記入してください。

対象コード: [app/js/config.js](../app/js/config.js)（種別定義）、[app/js/annotation-dialog.js](../app/js/annotation-dialog.js)（編集フォーム生成）、[app/js/storage.js](../app/js/storage.js)（JSON入出力）、[app/js/sticky.js](../app/js/sticky.js) / [app/js/buttons.js](../app/js/buttons.js)（付箋パーツ操作）

---

## 1. オーサリングパネル（新規配置ボタン）

画面左サイドバー「オーサリングパネル」に並ぶ6ボタン（[app/index.html:146-186](../app/index.html#L146-L186)）。

| # | ボタン | 種別キー | 表示タイプ選択 | LIBRO書き出し対応 |
|---|---|---|---|---|
| 1 | 付箋 | `sticky` | なし（付箋専用） | 非対応 |
| 2 | 音声再生 | `audio` | アイコン／マーカー | 対応（`Launch`） |
| 3 | 動画再生 | `video` | アイコン／マーカー | 非対応 |
| 4 | Plusファイル | `plusfile` | アイコン／マーカー | 非対応 |
| 5 | ページリンク | `pagelink` | アイコン／マーカー／紙面カラー | 対応（`GoTo`+`FitPage`） |
| 6 | 外部リンク | `externallink` | アイコン／マーカー | 対応（`URI`） |

### 1-1. 付箋（sticky）

| JSONプロパティ | 内容 | 編集画面での設定可否 |
|---|---|---|
| `style`（left/top/width/height） | 位置・サイズ | ○ サイドパネル「位置」「変形」 |
| `savedData.annColor` | 背景色（青／緑／黄） | ○ サイドパネル「塗り」 |
| `savedData.annFont` | フォントサイズ（標準/大/小） | **× UIなし（デッドコード）**。`openBulkStickyDialog`（未使用関数）にのみ定義があり、どのボタンからも呼び出されない。仮に値が入ってもCSSに反映するロジックが無く見た目は変わらない |
| 本文テキスト | （相当するプロパティ自体が存在しない） | **× そもそも入力欄が無い**。「付箋」という名前だが実体はテキストを持たない色付き矩形で、クリックで表示/非表示を切り替えるだけの部品 |
| `groupId` | 付箋グループ紐付け | △ 「付箋グループ切替」ボタンで一括ON/OFFのみ。個別のグループ名指定・所属確認UIなし |
| `daimonId`／`kotaeId`／`shomeiId` | 大問／答／証明ボタンとの紐付け | △ 各ボタン作成時にのみ付与。後から紐付け解除する専用UIなし |
| `fuhyoji`／`kotaeOrigBg`／`shomeiOrigBg`／`shomeiOutline` | 内部状態（元の色・表示制御） | － 直接編集は想定されていない内部管理用 |

**ご要望：**

-これは、既存の `sample_books/8a24127cb94d4a158ae43954184af569/p0004.json` でいうところの...
```json
{
    "filename": "annots/0900.png",
    "rect": [1952, 1117, 494, 76],
    "hidden": true,
    "actions": [
    {
        "action": "Hide",
        "targets": [900]
    },
    {
        "action": "Show",
        "targets": [901]
    }
    ]
}
```
と、
```json
{
    "filename": "annots/0901.png",
    "rect": [1952, 1117, 494, 76],
    "actions": [
    {
        "action": "Hide",
        "targets": [901]
    },
    {
        "action": "Show",
        "targets": [900]
    }
    ]
},

```
に相当するもの。

**既存付箋プロパティ説明**
filename: アノテーション画像の相対パス（画像のファイル名が id に相当する）
rect: left/top/width/height
hidden: boolean（※記載ない場合は false となる）
actions: actions

**actions プロパティの説明**
action:  Hide/Show （押下時の振る舞い）
targets: [ids]（配列なので、グループの場合は、複数個設定される）

### 1-2. 音声再生（audio）

| JSONプロパティ | 内容 | 編集画面での設定可否 |
|---|---|---|
| `savedData.annDisplayType` | アイコン／マーカー | ○ ダブルクリック編集ポップアップ |
| `style`／`annColor` | 位置・サイズ・塗り色 | ○ |
| `savedData.annFile` | 音声ファイル名（拡張子なし） | ○ テキスト入力＋ドラッグ&ドロップ対応 |
| `savedData.annPlayMode` | コントローラー表示有無 | ○ ラジオボタン |
| `savedData.annLabel` | マーカー表示テキスト | **× UIなし**。値はJSONに存在し保存・復元処理も参照するが、入力欄がどこにも無いため常に既定ラベル「音声再生」になる |

**ご要望：**

-

### 1-3. 動画再生（video）

| JSONプロパティ | 内容 | 編集画面での設定可否 |
|---|---|---|
| `savedData.annDisplayType` | アイコン／マーカー | ○ |
| `style`／`annColor` | 位置・サイズ・塗り色 | ○ |
| `savedData.annVideoSrc` | 内部ファイル／外部タグ | ○ ラジオボタン |
| `savedData.annFile` | 動画ファイル名 | ○ テキスト入力＋ドラッグ&ドロップ対応 |
| `savedData.annShowMode` | ページ内／別タブ | ○ ラジオボタン |
| `savedData.annLabel` | マーカー表示テキスト | **× UIなし**（音声再生と同様） |

**ご要望：**

-

### 1-4. Plusファイル（plusfile）

| JSONプロパティ | 内容 | 編集画面での設定可否 |
|---|---|---|
| `savedData.annDisplayType` | アイコン／マーカー | ○ |
| `style`／`annColor` | 位置・サイズ・塗り色 | ○ |
| `savedData.annShowMode` | ページ内／別タブ | ○ ラジオボタン |
| `savedData.annFile` | ディレクトリ名 | △ テキスト入力のみ。**音声・動画にあるドラッグ&ドロップのドロップゾーンが無い** |
| `savedData.annLabel` | マーカー表示テキスト | **× UIなし** |

**ご要望：**

-

### 1-5. ページリンク（pagelink）

| JSONプロパティ | 内容 | 編集画面での設定可否 |
|---|---|---|
| `savedData.annDisplayType` | アイコン／マーカー／紙面カラー（3種中この種別のみ「紙面カラー」選択肢あり） | ○ |
| `style`／`annColor` | 位置・サイズ・塗り色 | ○ |
| `savedData.annTarget` | リンク先ページ番号 | ○ 数値入力 |
| `savedData.annLabel` | マーカー表示テキスト | **× UIなし** |

**ご要望：**

-

### 1-6. 外部リンク（externallink）

| JSONプロパティ | 内容 | 編集画面での設定可否 |
|---|---|---|
| `savedData.annDisplayType` | アイコン／マーカー | ○ |
| `style`／`annColor` | 位置・サイズ・塗り色 | ○ |
| `savedData.annUrl` | リンク先URL | ○ テキスト入力 |
| `savedData.annLabel` | マーカー表示テキスト | **× UIなし** |

**ご要望：**

-

---

## 2. 付箋パーツ操作（紐付け・表示制御ボタン）

サイドバー「付箋パーツ操作」に並ぶボタン（[app/index.html:203-236](../app/index.html#L203-L236)）。いずれも新規オブジェクトを配置するのではなく、選択中の付箋に対して働きかける操作。

| # | ボタン | 対象JSONプロパティ | 編集画面での設定可否 |
|---|---|---|---|
| 1 | 大問ボタン作成 | `className=daimon-btn`／`daimonId` | △ 位置（ドラッグ移動）のみ変更可。サイズ・色はCSS固定で変更不可（ボタン系要素は`applyLiveUpdate`で位置以外を除外）。ラベルは「大問」固定でテキスト変更不可。紐付け対象は作成時の選択状態でのみ確定し、後から付け外しするUIなし |
| 2 | 付箋グループ切替 | `groupId` | △ トグルのみ。グループ名は自動採番（`grp-N`）で編集不可 |
| 3 | 付箋を隠す | `fuhyoji`／背景色白化 | △ ONにするボタンのみ。**サイドパネルからOFFへ戻す専用ボタンが無い**（Undoでのみ取り消し可能） |
| 4 | 答ボタン作成 | `className=kotae-btn`／`kotaeId`／`kotaeOrigBg` | △ 位置のみ変更可。ラベル「答」固定、紐付け解除UIなし |
| 5 | 証明ボタン作成 | `className=shomei-btn`／`shomeiId`／`shomeiOrigBg`／`shomeiOutline` | △ 位置のみ変更可。ラベル「証明」固定、紐付け解除UIなし |

いずれもLIBRO形式書き出しは非対応（対応済みは「ページリンク」「外部リンク」「音声再生」の3種のみ）。

**ご要望：**

-

---

## 3. パネルに存在しない種別（参考）

| 種別キー | 状況 |
|---|---|
| `zu`（図） | `ANNOTATION_TYPE_CONFIG`に定義があり、Undo・保存・復元・大問ボタン紐付けの各ロジックは存在するが、**ページ上に配置するボタンがどこにも無い**。作成不可能な幽霊種別（過去実装の残骸の可能性）。 |

**ご要望：**

-

---

## 4. 共通の乖離まとめ

- **`annLabel`（マーカー表示テキスト）が全種別で編集不可**：JSONには存在し保存・復元処理も対応しているが、入力欄が無いため常に種別デフォルト名（「音声再生」「ページリンク」等）表示になる。
- **`annFont`（付箋フォントサイズ）と付箋の紐付く操作系ダイアログ（`openBulkStickyDialog`）はデッドコード**：呼び出し元が存在しない。
- **`plusfile`だけファイルドロップゾーンが無い**：`audio`／`video`との実装の非対称。
- **ボタン系オブジェクト（大問／答／証明）はラベル文言・サイズ・色が固定**で、位置移動以外の見た目のカスタマイズ手段が編集画面に無い。
- **紐付け解除UIが無い**：大問／答／証明ボタンと付箋の紐付けは作成時のみで、後から個別に外す操作がサイドバーに存在しない。
