# YOS Tools

ブラウザだけで完結するローカルWebツール集。インストール・ビルド不要、データは外部送信なし。

開発・制作にあたってのルール（デザインの共通化、テーマ、ツール追加手順、Git 運用など）は
[`CLAUDE.md`](CLAUDE.md) にまとめてある。

## 構成

```text
YOS_Tools/
├── index.html             トップページ（ツール一覧・作者プロフィール・利用規約・更新履歴）
├── CLAUDE.md              開発ガイド（制作ルール）
├── CHANGELOG.md           変更履歴（YOS Tools 全体で一元管理）
├── assets/                共通CSS・共通テーマスクリプト・共通アイコン
├── PDF_Craft/             PDF加工ツール（単体でも動作）
├── ColorPaletteMaster/    カラーパレット作成ツール（単体でも動作）
├── ImageMaker/            画像メーカー（単体でも動作）
├── QR_Generator/          QRコード生成ツール（単体でも動作）
├── QR_Scan/               QRコード読み取りツール（単体でも動作）
├── Calc/                  関数電卓（単体でも動作）
├── TextCleaner/           テキスト整形ツール（単体でも動作）
└── ImageConverter/        画像形式変換ツール（単体でも動作）
```

## 使い方

公開版は <https://yumeotsumugu.github.io/YOS_Tools/> で使えます。
Web 上でファイルを扱うのが気になる場合は、
[ZIP をダウンロード](https://github.com/yumeotsumugu/YOS_Tools/archive/refs/heads/main.zip)
して展開し、`index.html` をブラウザで開けば完全ローカルで使えます（または簡易サーバー経由）。
カードから各ツールへ移動します。

```sh
# 簡易サーバーの例
python -m http.server 8000
# → http://localhost:8000/
```

ページ内リンクはすべて `index.html` 付き（完全ローカルの `file://` でも動くように）。
GitHub Pages で URL から `index.html` を隠す整形は `assets/theme.js` が全ページで行う
（`http(s)` で `/index.html` 付きに来たら、アドレスバーをディレクトリ表記に整える）。

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
   ヘッダーに共通の `img.yt-mark`（`../assets/icon.png`）・`.yt-back` リンク（`href="../index.html"`）・
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

## ライセンス

YOS Tools は夢生ツムグの個人制作物です。ソースコード・デザイン・文章等の権利は、
特に記載のない限り夢生ツムグに帰属します。

- 個人・法人、営利・非営利を問わず、**ツールの利用は自由**です。
- ソースコードの**再配布・転載・自作発言、およびそれらを目的とした複製・改変は禁止**します
  （学習・技術的な参考としての閲覧は自由）。
- アイコン・画像・フォント・ライブラリ等の素材には第三者が権利を有するものが含まれ、
  各権利者の利用条件に従います。本リポジトリはそれらの抽出・転載・再配布を許可しません。
- 個人制作のツールであり、現状のまま（AS IS）提供されます。利用は自己責任でお願いします。

詳細はトップページの「利用規約・ライセンス」を参照してください。
