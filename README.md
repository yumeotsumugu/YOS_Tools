# YOS Tools

ブラウザだけで完結するローカルWebツール集。インストール・ビルド不要、データは外部送信なし。

## 構成

```text
YOS_Tools/
├── index.html             トップページ（各ツールへのリンク）
├── PDF_Craft/             PDF加工ツール（単体でも動作）
├── ColorPaletteMaster/    カラーパレット作成ツール（単体でも動作）
├── ImageMaker/            TRPG・ココフォリア素材メーカー（単体でも動作）
├── QR_Generator/          QRコード生成ツール（単体でも動作）
└── TextCleaner/           テキスト整形ツール（単体でも動作）
```

## 使い方

`index.html` をブラウザで開く（または簡易サーバー経由）。カードから各ツールへ移動します。

```sh
# 簡易サーバーの例
python -m http.server 8000
# → http://localhost:8000/
```

## デザインの統一

全ツール共通のカラートークン・タイポグラフィ・共通パーツ（ブランドマーク、`← ツール一覧`
ボタン、カード、プライバシーピル、ダークモード対応）は `assets/common.css` に集約している。
各ツールの `index.html` は `<link rel="stylesheet" href="../assets/common.css">`
（トップページは `assets/common.css`）を先頭で読み込み、固有スタイルだけを各自に持つ。

テーマ設定（システム / ライト / ダーク）は `assets/theme.js` が全ツール共有で管理する。
各ツールは `<head>` で `../assets/theme.js` を読み込み、ヘッダーに
`<button data-yos-theme-toggle></button>` を1つ置くだけでよい（アイコン・クリック動作は
スクリプトが付与し、`localStorage` の `yos.theme` に保存、ページ間・タブ間で同期する）。

## ツールを追加する

1. `YOS_Tools/` 直下にツール用フォルダを作り、`index.html` を置く
2. `index.html` の `<head>` で `../assets/common.css` と `../assets/theme.js` を読み込み、
   ヘッダーに共通の `img.yt-mark`（`../assets/icon.png`）・`.yt-back` リンク・
   `<button data-yos-theme-toggle></button>` を置く
3. `YOS_Tools/index.html` の `tools` 配列に1件追加する

```js
{
  name: 'ツール名',
  icon: '▤',
  status: 'live',              // 'live' = 公開 / 'soon' = 準備中
  path: 'フォルダ名/index.html', // このindex.htmlからの相対パス
  desc: '説明文',
  tags: ['タグ1', 'タグ2'],
}
```
