---
name: add-annotation-type
description: app/index.html に新規アノテーション種別（付箋・音声再生・ページリンク等と同様の新しい種類のボタン/オブジェクト）を追加する際に使用する。
---

# 新規アノテーション種別の追加

[app/js/config.js](../../../app/js/config.js) 内の `ANNOTATION_TYPE_CONFIG` に種別ごとのラベル・色・アイコンSVGを定義する構成になっている（既存種別: `pagelink` / `plusfile` / `externallink` / `audio` / `video` / `sticky` / `zu` / `kotae` / `daimon` / `shomei`）。

新規種別を追加する場合、以下の箇所すべてに対応が必要（どれか一つでも漏れると保存・読込・表示が壊れる）。

1. **定義**：`ANNOTATION_TYPE_CONFIG`（`config.js`）に種別を追加（ラベル・色・アイコンSVG）
2. **生成**：`openAnnotationSettingsDialog` / `confirmAnnotation`（[app/js/annotation-dialog.js](../../../app/js/annotation-dialog.js)）等に生成処理を追加
3. **保存**：`saveAnnotations`（単体JSONファイル出力用）・`saveAnnotationsAsZip`（独自ZIP出力用）の両方に対応（いずれも [app/js/storage.js](../../../app/js/storage.js)）
4. **読込**：`restoreAnnotationsFromArray`・`handleZipFile` の2箇所に対応（`storage.js`）
5. **表示更新**：`updateAnnotationVisibility`（[app/js/page-view.js](../../../app/js/page-view.js)）に表示切替ロジックを追加
6. **拡縮対応**：`scaleAnnotations`（`page-view.js`）にズーム時のサイズ・位置変換処理を追加
7. **LIBRO書き出し対応**（対応する場合のみ）：[app/js/libro-format.js](../../../app/js/libro-format.js) に変換ロジックを追加。現状LIBRO書き出しに対応済みなのは `pagelink` / `externallink` / `audio` の3種別のみ（詳細は [libro-integration Skill](../libro-integration/SKILL.md)）

## 注意

- localStorage経由（自動保存）と独自ZIP入出力（JSZip）の2系統が存在するため、片方だけ対応すると一方の保存経路でデータが失われる。
- 既存種別（例えば `zu`）の実装箇所を grep して同じパターンで実装すると漏れが少ない。
- ボタン位置・サイズの保存形式は紙面に対する`%`形式（後方互換で旧形式のxRatio/yRatio/wRatio/hRatio・px絶対値も読込のみ対応）。詳細は [ui-change-constraints](../ui-change-constraints/SKILL.md) 参照。新規種別でも位置・サイズを持つ場合はこの設計に合わせる。
