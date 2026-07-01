---
name: add-annotation-type
description: app/index.html に新規アノテーション種別（付箋・音声再生・ページリンク等と同様の新しい種類のボタン/オブジェクト）を追加する際に使用する。
---

# 新規アノテーション種別の追加

`app/index.html` 内の `ANNOTATION_TYPE_CONFIG` に種別ごとのラベル・色・アイコンSVGを定義する構成になっている（既存種別: `pagelink` / `plusfile` / `externallink` / `audio` / `video` / `sticky` / `zu` / `kotae` / `daimon` / `shomei`）。

新規種別を追加する場合、以下の箇所すべてに対応が必要（どれか一つでも漏れると保存・読込・表示が壊れる）。

1. **定義**：`ANNOTATION_TYPE_CONFIG` に種別を追加（ラベル・色・アイコンSVG）
2. **生成**：`openAnnotationSettingsDialog` / `confirmAnnotation` 等に生成処理を追加
3. **保存**：`saveAnnotations`（localStorage用）・`saveAnnotationsAsZip`（ZIP出力用）の両方に対応
4. **読込**：`loadAnnotations`・`restoreAnnotationsFromArray`・`handleZipFile` の3箇所すべてに対応
5. **表示更新**：`updateAnnotationVisibility` に表示切替ロジックを追加
6. **拡縮対応**：`scaleAnnotations` にズーム時のサイズ・位置変換処理を追加

## 注意

- localStorage経由（自動保存）とZIP入出力（JSZip）の2系統が存在するため、片方だけ対応すると一方の保存経路でデータが失われる。
- 既存種別（例えば `zu`）の実装箇所を grep して同じパターンで実装すると漏れが少ない。
- ボタン位置・サイズの保存形式は絶対px値から比率（xRatio/yRatio/wRatio/hRatio）への移行が計画中（[ui-change-constraints](../ui-change-constraints/SKILL.md) 参照）。新規種別でも位置・サイズを持つ場合はこの設計に合わせる。
