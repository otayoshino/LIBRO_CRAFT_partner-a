# UI・機能 実装指示書 v2

**対象ファイル：** `index.html`
**ベース：** 変更前の元コード（v0）
**最終確認バージョン：** v16

---

## 制約事項（変更禁止）

- トップバーの背景色（`#647cc0`）・AUTHORING MODEラベル色・アイコン一切
- 既存のページレイアウト（`.main` / `.view` / `.page` 構造）
- JavaScript のロジック・関数の既存動作
- 既存の色変数・テーマカラー（サイドバー `#353c47` 等）

---

# PART A　デザイン変更（v0→v16 の確定済み変更）

## A-1　パネルボタンのホバーモーション

**対象CSS：** `.side .panel ul li` およびその派生セレクター

> ⚠️ `translateY` による上方向移動は使用禁止。サイドバーの `overflow-x: hidden` によりボタン上部が見切れるため、`box-shadow` のみで浮き感を表現する。

```css
.side .panel ul li {
  transition: background 0.18s ease, box-shadow 0.18s ease, opacity 0.2s;
  border: 1.5px solid transparent;
  box-shadow: 0 1px 2px rgba(0,0,0,0.08);
  position: relative;
  overflow: hidden;
}

/* ホバー：box-shadowで浮き感 */
.side .panel ul li:hover {
  background: #ffffff;
  border-color: #c8c8c8;
  box-shadow: 0 4px 12px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.1);
}

/* ホバー時：アイコン・テキストの色変化 */
.side .panel ul li:hover div svg {
  fill: #2a6fcf;
  transition: fill 0.18s ease;
}
.side .panel ul li:hover p {
  color: #2a6fcf;
  transition: color 0.18s ease;
}

/* クリック押下 */
.side .panel ul li:active {
  transform: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  background: #dde8f8;
  transition: box-shadow 0.08s ease, background 0.08s ease;
}

/* アクティブ選択中 */
.side .panel ul li.is-ann-active {
  background: #4a88d8;
  border-color: #3a6fc0;
  box-shadow: 0 2px 8px rgba(74,136,216,0.35);
}
.side .panel ul li.is-ann-active:hover {
  background: #3a78c8;
  border-color: #2a60b0;
  box-shadow: 0 4px 12px rgba(74,136,216,0.45), 0 1px 3px rgba(74,136,216,0.2);
  transform: none;
}
.side .panel ul li.is-ann-active:active {
  transform: none;
  box-shadow: 0 1px 3px rgba(74,136,216,0.2);
}
.side .panel ul li.is-ann-active div svg { fill: #fff; color: #fff; }
.side .panel ul li.is-ann-active p { color: #fff; }
.side .panel ul li.is-ann-active:hover div svg { fill: #fff; }
.side .panel ul li.is-ann-active:hover p { color: #fff; }

/* SVG・テキストのtransition */
.side .panel ul li div svg { fill: #444; transition: fill 0.18s ease; }
.side .panel ul li p { transition: color 0.18s ease; }
```

---

## A-2　付箋グループ切替アイコン変更

**対象HTML：** 付箋グループ切替 `<li>` 内の `<svg>` を以下に差し替え

> ⚠️ `stroke` を一切使用しない。`fill="currentColor"` のみで統一すること。

```html
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
  <path fill-rule="evenodd" d="M2 1a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H2zm0 1h16v16H2V2z"/>
  <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1"/>
  <rect x="11"  y="3.5" width="5.5" height="5.5" rx="1"/>
  <rect x="3.5" y="11"  width="5.5" height="5.5" rx="1"/>
  <rect x="11"  y="11"  width="5.5" height="5.5" rx="1"/>
</svg>
```

---

## A-3　縦組みレイアウト（panel-stack）追加

```css
.side .panel ul {
  padding-top: 4px; /* ホバー時の見切れ防止 */
}
.side .panel ul.panel-stack {
  flex-direction: column;
}
.side .panel ul.panel-stack li {
  width: 100%;
  flex-direction: row;
  justify-content: flex-start;
  gap: 10px;
  padding: 0 12px;
  height: 34px;
}
.side .panel ul.panel-stack li div { flex-shrink: 0; }
.side .panel ul.panel-stack li p { margin-top: 0; }
```

---

## A-4　4パネルのアコーディオン化

### CSS追加

```css
.side .panel-title.is-accordion {
  width: 100%;
  box-sizing: border-box;
  background: none;
  border: none;
  border-top: 1px solid #3a3f4a;
  padding: 9px 0;
  margin: 0;
  cursor: pointer;
  font-family: inherit;
  letter-spacing: inherit;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 6px;
  text-align: left;
  transition: opacity 0.15s;
}
.side .panel-title.is-accordion:hover { opacity: 0.75; }
.side .panel-title.is-accordion.no-border { border-top: none; }

.acc-chevron {
  margin-left: auto;
  flex-shrink: 0;
  transition: transform 0.22s ease;
}
.side .panel-title.is-accordion.is-closed .acc-chevron {
  transform: rotate(-90deg);
}

.acc-body {
  overflow: visible;
  max-height: 2000px;
  transition: max-height 0.3s ease, opacity 0.22s ease;
  opacity: 1;
}
.acc-body.is-closed {
  max-height: 0 !important;
  opacity: 0;
  overflow: hidden;
}
```

### HTML変更パターン

**変更前：**
```html
<p class="panel-title"><svg>〜</svg> パネル名</p>
<div class="panel">〜コンテンツ〜</div>
```

**変更後：**
```html
<button class="panel-title is-accordion [no-border]" onclick="toggleAcc('acc〇〇', this)">
  <svg>〜（既存アイコン）〜</svg>
  パネル名
  <svg class="acc-chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>
  </svg>
</button>
<div class="acc-body" id="acc〇〇">
  〜コンテンツ〜
</div>
```

**4パネルの対応表：**

| パネル名 | acc-body id | no-border | コンテンツのラップ対象 |
|---|---|---|---|
| オーサリングパネル | `accAuthoring` | ✅ | `<div class="panel">` |
| 付箋パーツ操作 | `accStickyOps` | ❌ | `<div class="panel">` |
| 詳細設定 | `accDetail` | ❌ | `<div id="sideDetailPanel">` |
| 整列 | `accAlign` | ❌ | `<div id="alignPanel">` |

### JavaScript追加

`switchToViewMode` 関数の直前に挿入：

```javascript
function toggleAcc(bodyId, btn) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  const closing = !body.classList.contains('is-closed');
  body.classList.toggle('is-closed', closing);
  btn.classList.toggle('is-closed', closing);
}
```

---

## A-5　ボタン名称変更

```html
<!-- 変更前 -->
<p class="size_s">付箋非表示</p>
<!-- 変更後 -->
<p class="size_s">付箋を隠す</p>
```

---

## A-6　オーサリングパネル　ボタン構成・順序

`<ul>` に `class="panel-stack"` を付与。以下の順で縦組み配置：

1. 付箋
2. 音声再生
3. 動画再生
4. 図ボタン
5. Plusファイル
6. ページリンク
7. 外部リンク

> 削除：大問ボタン・答・証明（A-7へ移動）

---

## A-7　付箋パーツ操作パネル　ボタン構成・順序

`<ul>` に `class="panel-stack"` を付与。以下の順で縦組み配置：

1. 大問ボタン　← オーサリングパネルから移動
2. 付箋グループ切替
3. 付箋を隠す
4. 答　← オーサリングパネルから移動
5. 証明　← オーサリングパネルから移動

---

## A-8　ツールチップの表示遅延

**対象CSS：** `[data-tip]:hover::after`

現在は即時表示されているツールチップを、ホバーからしばらく経過後に表示されるように変更する。

```css
/* 変更前 */
[data-tip]:hover::after {
  /* 遅延なし */
}

/* 変更後 */
[data-tip]::after {
  /* 既存スタイルはそのまま */
  opacity: 0;
  transition: opacity 0.1s ease 0.8s; /* 0.8秒後にフェードイン */
}
[data-tip]:hover::after {
  opacity: 1;
}
```

> 遅延時間（`0.8s`）は後で調整可能な値として実装すること。説明文テキストの変更は別途指示予定。

---

## A-9　スライドナビゲーションボタン追加

ビューエリア（`.view`）の左右端に、半透明の前後ページ送りボタンを追加する。

### HTML追加位置

`.view` 内、`#pageContainer` の直前に追加：

```html
<button class="slide-nav slide-nav--prev" id="slideNavPrev" onclick="changePage(-1)" title="前のページ">
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"/>
  </svg>
</button>
<button class="slide-nav slide-nav--next" id="slideNavNext" onclick="changePage(1)" title="次のページ">
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/>
  </svg>
</button>
```

### CSS追加

```css
.slide-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 50;
  width: 40px;
  height: 64px;
  background: rgba(0,0,0,0.25);
  border: none;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, opacity 0.15s;
  opacity: 0.5;
}
.slide-nav:hover { background: rgba(0,0,0,0.45); opacity: 1; }
.slide-nav.is-hidden { opacity: 0; pointer-events: none; }
.slide-nav--prev { left: 8px; }
.slide-nav--next { right: 8px; }
```

### JavaScript追加

ページ変更後に先頭・末尾でボタンを非表示にする処理を `updatePageDisplay` 関数内に追加：

```javascript
// updatePageDisplay() 内の末尾に追加
const prevBtn = document.getElementById('slideNavPrev');
const nextBtn = document.getElementById('slideNavNext');
if (prevBtn) prevBtn.classList.toggle('is-hidden', currentPage <= 1);
if (nextBtn) nextBtn.classList.toggle('is-hidden', currentPage >= totalPages);
```

> `changePage(delta)` は既存の `currentPage` 変数と `updatePageDisplay()` を利用して実装する。既存のページ送り処理があればそちらと共通化すること。

---

# PART B　機能追加・バグ修正

## B-1　答ボタンのラベル変更（セレクトボックス追加）

答ボタン（`.kotae-btn`）を選択したとき、詳細設定パネルのフォームに「ボタンラベル」選択欄を追加する。

### 仕様

- 選択肢例：「答」「解答」「答え」「Answer」「確認」（実際の選択肢は後で確定予定）
- 選択内容はボタンの表示テキストに即時反映される
- JSONデータとして保存・読み込み対象とする

### 実装方針

1. `openAnnotationSettingsDialog` 関数内の `kotae` タイプ処理に、ラベル選択用のフォーム行を追加する
2. `ANNOTATION_TYPE_CONFIG` の `kotae` エントリにラベル選択肢を定義する
3. ボタン生成時・JSONロード時にラベルを反映する

```javascript
// ANNOTATION_TYPE_CONFIG の kotae に追加
labelOptions: ['答', '解答', '答え', 'Answer', '確認'],
```

```html
<!-- 詳細設定フォームに追加するHTML構造（JS側でinnerHTMLに挿入） -->
<dt>ボタンラベル</dt>
<dd>
  <div class="d-select-wrap">
    <select class="d-select" id="kotaeLabelSelect">
      <option value="答">答</option>
      <option value="解答">解答</option>
      <option value="答え">答え</option>
      <option value="Answer">Answer</option>
      <option value="確認">確認</option>
    </select>
  </div>
</dd>
```

> 選択肢の文言は後で変更予定のため、定数（配列）として管理すること。

---

## B-2　ページ遷移ボタン追加（オーサリングパネル）

オーサリングパネルに「ページ遷移」ボタンを追加する。クリックするとページ番号を入力するダイアログまたはインライン入力で指定したページへ遷移する。

### HTML追加

A-6 のオーサリングパネルのボタンリストに追加（外部リンクの次）：

```html
<li onclick="openPageJumpDialog()" data-tip="ページ番号を指定してジャンプ">
  <div>
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 16h8v-2H8v2zm0-4h8v-2H8v2z"/>
    </svg>
  </div>
  <p class="size_s">ページ遷移</p>
</li>
```

### JavaScript追加

```javascript
function openPageJumpDialog() {
  const page = parseInt(prompt(`移動するページ番号を入力（1〜${totalPages}）`, currentPage), 10);
  if (!isNaN(page) && page >= 1 && page <= totalPages) {
    currentPage = page;
    updatePageDisplay();
  }
}
```

> `prompt` はシンプルな実装例。デザインに合わせてモーダルUIへの変更を推奨。

---

## B-3　図ボタンへの外部画像追加

図ボタン（`zu` タイプ）の詳細設定フォームに、外部から画像ファイルを読み込めるフィールドを追加する。

### 仕様

- ファイル選択インプット（`<input type="file" accept="image/*">`）をフォームに追加
- 選択された画像はBase64エンコードしてボタンデータ（JSON）に保存する
- 画像は図ボタンのオーバーレイまたは背景として表示する

### 実装方針

1. `zu` タイプの詳細設定フォームに画像選択フィールドを追加
2. FileReader APIでBase64変換し、ボタン要素の `dataset.image` に保存
3. `saveAnnotations` / `loadAnnotations` でBase64データを含めてシリアライズ

```javascript
// 画像読み込み処理
function handleZuImageUpload(input, targetEl) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    targetEl.dataset.image = e.target.result;
    targetEl.style.backgroundImage = `url(${e.target.result})`;
    targetEl.style.backgroundSize = 'contain';
    targetEl.style.backgroundRepeat = 'no-repeat';
    targetEl.style.backgroundPosition = 'center';
  };
  reader.readAsDataURL(file);
}
```

---

## B-4　拡大率変更時の画像サイズズレ修正

**現象：** ズームレベル変更時、紙面（PDF canvas）はスケール変換されるが、紙面に貼り付けた画像データのサイズが変わらずズレが生じる。

**原因：** `scaleAnnotations` 関数が付箋・アノテーションオブジェクトの位置・サイズをスケール変換しているが、`zu` タイプの画像要素が対象外になっている可能性がある。

**対応方針：**

1. `scaleAnnotations(ratio)` 関数内で、`.zu-obj` および画像を持つ要素も変換対象に含める
2. `resizePage()` 呼び出し後に画像要素のサイズ・位置を再計算する処理を追加する

```javascript
// scaleAnnotations 内に追加（既存の付箋・アノテーション変換処理と同じ形式で）
document.querySelectorAll('.zu-obj').forEach(el => {
  el.style.left  = (parseFloat(el.style.left)  * ratio) + 'px';
  el.style.top   = (parseFloat(el.style.top)   * ratio) + 'px';
  el.style.width = (parseFloat(el.style.width) * ratio) + 'px';
  el.style.height= (parseFloat(el.style.height)* ratio) + 'px';
});
```

---

## B-5　ディスプレイサイズによるメニュー拡大率の崩れ修正

**現象：** 異なる解像度・DPIのディスプレイで表示したとき、サイドバーのUIが拡大・縮小されてしまう。

**原因：** ブラウザのデフォルトズームやデバイスピクセル比（`devicePixelRatio`）の影響でCSSピクセルが変わる。

**対応方針：**

サイドバーの幅・フォントサイズ・ボタン高さをすべて `px` 固定値で定義し、`vw` / `vh` / `em` / `rem` を使わない。加えてビューポート設定を明示する。

```html
<!-- <head> 内のmetaタグを確認・追加 -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
```

```css
/* サイドバー幅を固定 */
.side.authoring {
  width: 270px;        /* 固定値のまま維持 */
  min-width: 270px;
  max-width: 270px;
  flex-shrink: 0;
}
/* フォントサイズをpx固定 */
body { font-size: 14px; }
```

> 根本解決にはアプリ側でデバイスピクセル比を考慮したスケール補正が必要な場合がある。詳細は実装時に確認すること。

---

## B-6　異なる画面サイズ間でのボタン位置ズレ修正

**現象：** 画面サイズの異なるディスプレイで作成したボタンデータ（JSON）を読み込むと、ボタンが意図した位置からずれて表示される。

**原因：** ボタンの位置が「ピクセル座標（絶対値）」で保存されているため、紙面の表示サイズが変わるとズレが生じる。

**対応方針：** ボタンの位置・サイズを**紙面に対する相対値（0〜1の比率）**で保存・読み込みするように変更する。

### 保存時（saveAnnotations内）

```javascript
const pageEl = document.getElementById('pageLeft');
const pageW = pageEl.offsetWidth;
const pageH = pageEl.offsetHeight;

// 保存データに絶対値ではなく比率を記録
const obj = {
  // ...既存のプロパティ...
  xRatio: parseFloat(el.style.left)  / pageW,
  yRatio: parseFloat(el.style.top)   / pageH,
  wRatio: parseFloat(el.style.width) / pageW,
  hRatio: parseFloat(el.style.height)/ pageH,
};
```

### 読み込み時（loadAnnotations内）

```javascript
const pageEl = document.getElementById('pageLeft');
const pageW = pageEl.offsetWidth;
const pageH = pageEl.offsetHeight;

// 比率から絶対値に変換して配置
el.style.left   = (item.xRatio * pageW) + 'px';
el.style.top    = (item.yRatio * pageH) + 'px';
el.style.width  = (item.wRatio * pageW) + 'px';
el.style.height = (item.hRatio * pageH) + 'px';
```

### ウィンドウリサイズ時の追従

```javascript
// 既存の window resize イベント内に追加
window.addEventListener('resize', () => {
  // 既存処理（resizePage, scaleAnnotations）の後に追加
  repositionAnnotationsByRatio(); // 比率に基づいて全ボタンを再配置
});

function repositionAnnotationsByRatio() {
  const pageEl = document.getElementById('pageLeft');
  const pageW = pageEl.offsetWidth;
  const pageH = pageEl.offsetHeight;
  document.querySelectorAll('[data-x-ratio]').forEach(el => {
    el.style.left   = (parseFloat(el.dataset.xRatio) * pageW) + 'px';
    el.style.top    = (parseFloat(el.dataset.yRatio) * pageH) + 'px';
    el.style.width  = (parseFloat(el.dataset.wRatio) * pageW) + 'px';
    el.style.height = (parseFloat(el.dataset.hRatio) * pageH) + 'px';
  });
}
```

> **後方互換性：** 旧形式（絶対値のみ）のJSONを読み込んだ場合のフォールバック処理を必ず実装すること（`xRatio` が存在しない場合は絶対値をそのまま使用するなど）。

---

# 変更一覧サマリー

## PART A　デザイン変更

| # | 変更箇所 | 種別 |
|---|---|---|
| A-1 | パネルボタンのホバー・クリックモーション | CSS修正 |
| A-2 | 付箋グループ切替アイコン差し替え | SVG差し替え |
| A-3 | panel-stack縦組みスタイル追加 | CSS追加 |
| A-4 | 4パネルのアコーディオン化 | CSS・HTML・JS追加 |
| A-5 | 「付箋非表示」→「付箋を隠す」名称変更 | HTML修正 |
| A-6 | オーサリングパネルのボタン構成・順序変更 | HTML修正 |
| A-7 | 付箋パーツ操作パネルのボタン構成・順序変更 | HTML修正 |
| A-8 | ツールチップの表示遅延（0.8秒後） | CSS修正 |
| A-9 | スライドナビゲーションボタン追加（左右矢印） | HTML・CSS・JS追加 |

## PART B　機能追加・バグ修正

| # | 変更箇所 | 種別 |
|---|---|---|
| B-1 | 答ボタンのラベル変更（セレクトボックス） | JS・HTML追加 |
| B-2 | ページ遷移ボタン追加（オーサリングパネル） | HTML・JS追加 |
| B-3 | 図ボタンへの外部画像追加機能 | JS・HTML追加 |
| B-4 | 拡大率変更時の画像サイズズレ修正 | JS修正 |
| B-5 | ディスプレイサイズによるメニュー崩れ修正 | CSS・HTML修正 |
| B-6 | 異なる画面サイズ間のボタン位置ズレ修正 | JS修正（保存・読込・リサイズ） |

---

## 未確定事項（後日確認）

| 項目 | 内容 |
|---|---|
| B-1 | 答ボタンのラベル選択肢の最終文言 |
| A-8 | ツールチップの説明文テキスト（変更予定） |
| A-8 | ツールチップの遅延時間の最終調整値 |
