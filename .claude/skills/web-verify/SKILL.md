---
name: web-verify
description: app/index.html のUI・機能変更後にWeb画面を目視確認する際に使用する。server.py起動からヘッドレスPlaywrightでの自動確認までの手順をまとめたもの。
---

# Web画面の確認方法（ヘッドレスPlaywright）

このプロジェクトはビルドステップを持たない静的HTML＋バニラJSのため、変更確認は必ず実ブラウザ相当の環境で行う。

以前は Chrome の「Claude in Chrome」拡張機能に目視確認を依頼する方式だったが、これは本セッションとは別のClaude実行環境であり、確認結果を直接受け取れず信頼性が低かった。代わりに、Claude Code自身がヘッドレスブラウザを操作し、コンソールエラー・DOM状態・スクリーンショットを直接取得して検証する。

## 前提：Playwrightのセットアップ（初回のみ・全プロジェクト共有）

`~/.claude/tools/playwright-verify` にPlaywrightを一度だけインストールしておく（プロジェクト固有ではないため、リポジトリ外の共有ディレクトリに置く）。

```bash
# 未インストールの場合のみ実行
mkdir -p ~/.claude/tools/playwright-verify
cd ~/.claude/tools/playwright-verify
npm init -y
npm install playwright
node_modules/.bin/playwright install chromium
```

既にインストール済みか確認するには `ls ~/.claude/tools/playwright-verify/node_modules/playwright` を実行する。

## 手順

1. `python server.py` をバックグラウンドで起動する（既に起動済みなら `lsof -i :8080 -sTCP:LISTEN` でPIDを確認し流用する）。
2. スクラッチディレクトリに確認用スクリプト（`.mjs`）を都度書く。テンプレート：

```js
import { chromium } from '/Users/meitec-yagisawa/.claude/tools/playwright-verify/node_modules/playwright/index.mjs';

const browser = await chromium.launch();
const page = await browser.newPage(); // 毎回新しいcontext相当（localStorageは空の状態）

// コンソールエラー・ページ例外は必ず収集する。正常時は0件のはず
page.on('console', msg => { if (msg.type() === 'error') console.log('[console.error]', msg.text()); });
page.on('pageerror', err => console.log('[pageerror]', err.message));

await page.goto('http://localhost:8080/app/', { waitUntil: 'networkidle' });

// ここに確認したい操作を書く（クリック・入力・ドラッグ等）
// 例: await page.getByText('音声再生', { exact: true }).click();

// 必要ならJS側の状態を直接検証する（目視より確実）
// const count = await page.evaluate(() => window.stickyGroupCounter);
// console.log('stickyGroupCounter:', count);

await page.screenshot({ path: '/path/to/scratchpad/verify.png' });
await browser.close();
console.log('DONE');
```

3. `node /path/to/scratchpad/verify.mjs` を実行する。
   - `console.error` / `pageerror` の出力は標準出力にそのまま流れるので、テキストとして直接確認できる。1件でも出力があれば不具合の強いシグナルとして扱う。
   - `page.evaluate()` でグローバル変数やDOM状態を取得し、期待値と数値・文字列で突き合わせることで、目視より確実な検証ができる。
4. スクリーンショットは `Read` ツールでファイルを直接読み込んで目視確認する（Claude Codeは画像を読める）。
5. 確認後、動作に問題があれば該当コードを修正し、再度スクリプトを実行して確認する（`localStorage` の自動保存 (`ContentsBuilder_v2_annotations`) が影響するテストでは `page.newContext()` を使うか、`page.evaluate(() => localStorage.clear())` で明示的にクリアしてから検証すること）。
6. 確認用スクリプトとスクリーンショットはスクラッチディレクトリに置き、確認が終わったら残す必要はない（リポジトリにはコミットしない）。

## ドラッグ操作（アノテーション配置）の確認

キャンバス上へのドラッグ描画（付箋・大問ボタン等の配置）は `page.mouse.move()` → `page.mouse.down()` → `page.mouse.move()` → `page.mouse.up()` の順で座標を明示的に動かす。Playwrightの `dragTo()` はネイティブのHTML5ドラッグ用で、このアプリの独自ドラッグ実装には適合しない場合がある。

## 注意事項

- サーバーは `0.0.0.0:8080` でリッスンするため、同一LAN上の他PCからも `http://<ローカルIP>:8080/app/` でアクセス可能。
- キャッシュは `no-store` で無効化されているため、リロード（＝スクリプト再実行）だけで最新コードが反映される。
- 音声・動画の自動再生はヘッドレス環境のポリシー上ブロックされる場合がある。再生系の確認は「エラーが出ないこと」「UI状態が変わること」を中心に見て、実際の音声出力確認が必要な場合はhironari🦊に依頼する。
