# YOS Tools — 開発ガイド

このリポジトリで作業するときのルールをまとめる。新しいツールの追加・既存ツールの
修正はここに沿って行う。

## このリポジトリについて

- **ブラウザだけで完結する静的Webツール集**。インストール・ビルド不要。
- 入力データ（画像・PDF・テキストなど）は**外部へ送信しない**。すべて端末内で処理する。
- 各ツールは `ツール名/index.html` の単体でも動作する。
- 公開先は GitHub Pages（`https://<user>.github.io/YOS_Tools/`）。

## やり取りのルール（重要）

- **ユーザーとのやり取りはすべて日本語**で行う。
  - AskUserQuestion の質問文・選択肢ラベル・説明・ヘッダーも日本語。
  - 作業の要約・説明・提案も日本語。
  - コミットメッセージも日本語。
  - コード内のコメントも日本語（既存コードもそうなっている）。
- 英語のままにしてよいのはコード識別子・技術用語・URL・ファイル名程度。地の文は日本語。
- ユーザーは実装そのものは任せてよいと考えているが、**確認内容が読めないと不安**なので、
  確認・相談は必ず日本語で分かるように書く。

## ディレクトリ構成

```text
YOS_Tools/
├── index.html             トップページ（ツール一覧・作者プロフィール・利用規約）
├── assets/
│   ├── common.css         全ツール共通のデザインシステム
│   ├── theme.js           全ツール共通のテーマ設定（システム/ライト/ダーク）
│   ├── icon.png           共通ブランドアイコン（おとり様 @ai_romoti 作）
│   └── icon-32.png        favicon 用
├── PDF_Craft/             PDF加工
├── ColorPaletteMaster/    カラーパレット作成
├── ImageMaker/            画像メーカー（TRPG・ココフォリア素材向け）
├── QR_Generator/          QRコード生成
└── TextCleaner/           テキスト整形
```

## 共通化のルール

### スタイル — `assets/common.css`

- カラートークン（`--navy` `--blue` `--bg` `--paper` `--line` `--ink` `--muted`
  `--faint` `--soft` `--ok` `--ng` `--warn` `--star`）、タイポグラフィ（`--font-body`
  = Zen Kaku Gothic New / `--font-head` = DM Sans）、形・影（`--radius` `--shadow-card`
  ほか）、共通パーツ（`.yt-mark` `.yt-back` `.yt-btn` `.yt-card` `.yt-eyebrow`
  `.yt-field` `.yt-privacy` `.yt-toast` `.yt-theme-toggle`）を定義。
- 各ツールの `index.html` は `<head>` の先頭で
  `<link rel="stylesheet" href="../assets/common.css">`（トップは `assets/common.css`）を読む。
- **固有スタイルだけ**を各ツール側（インライン `<style>` か `ツール名/css/style.css`）に持つ。
  共通ファイルより後に読み込むこと。
- 色は必ずトークンで指定する。ハードコードした 16 進色は避ける
  （ダークモードが崩れる）。半透明のアクセントは
  `color-mix(in srgb, var(--blue) N%, transparent)` を使う。

### ダークモード

- `common.css` が `@media (prefers-color-scheme: dark)` と `:root[data-theme="..."]`
  の両方でトークンを反転する。トークンを使っていれば自動で追従する。
- 白背景前提の入力欄などは `background-color` を明示すること（省略すると
  ダークモードで「白背景 × 明るい文字」になる）。

### テーマ設定 — `assets/theme.js`

- 「システム / ライト / ダーク」を**全ツール共有**（`localStorage` キー `yos.theme`）。
- 各ツールは `<head>` で `<script src="../assets/theme.js"></script>` を読み込み、
  ヘッダーに `<button data-yos-theme-toggle></button>` を1つ置くだけ。
  アイコン・クリック動作・タブ間同期はスクリプトが付与する。
- `theme.js` は**URL整形**も兼ねる（全ページ共通）。`http(s)` で `/index.html` 付きに
  来たら `history.replaceState` でアドレスバーをディレクトリ表記に整える。`file://` では何もしない。

### ブランド・ナビゲーション

- ブランドマークは `assets/icon.png`（favicon も同じ）。`.yt-mark` クラスを付ける。
- ページ内リンク（トップ→各ツールの `path`、各ツールの「← ツール一覧」）は
  **`index.html` 付き**にする（`href="../"` や `"フォルダ/"` だと完全ローカル `file://` で
  フォルダ一覧が開いてしまう）。GitHub Pages で URL から `index.html` を隠す整形は
  `assets/theme.js` が全ページで行う（上記「テーマ設定」参照）。
- 各ツールに「端末内処理／データは外部に送信されません」を明記する（`.yt-privacy` など）。

### ライセンス・クレジット

- 権利表記・利用規約はトップページの `#terms`（`<details>`）に集約。
  各ツールからは `href="../index.html#terms"` でリンクするだけにする。
- YOS Tools は夢生ツムグの個人制作物。ソース・デザイン・文章の権利は夢生ツムグに帰属。
  **ツールの利用は自由／ソースの再配布・転載・自作発言・改変は禁止**（学習・技術参考の
  閲覧は自由）。素材（アイコン・フォント・ライブラリ等）は各権利者の条件に従う。
- アイコンのクレジット：おとり様（<https://x.com/ai_romoti>）。
- 開発補助：Claude Code（Anthropic）。

## 新しいツールを追加する手順

1. `YOS_Tools/` 直下にツール用フォルダを作り、`index.html` を置く（単体で動くこと）。
2. `<head>` で `../assets/common.css` と `../assets/theme.js` を読み込む。
3. ヘッダーに共通の `img.yt-mark`（`../assets/icon.png`）、
   `.yt-back`（`href="../index.html"`）、`<button data-yos-theme-toggle></button>` を置く。
4. ダークモード対応・「端末内処理」明記・トークンでの配色を守る。
5. トップページ `index.html` の `tools` 配列に1件追加する
   （`name` / `icon` / `status`（`'live'` or `'soon'`）/ `path` / `desc` / `tags`）。
6. `README.md` の構成ツリーに1行追加する。

## コーディング規約

- 素の HTML / CSS / JavaScript のみ。外部 CDN・ビルドツール・フレームワークは使わない。
  ライブラリが必要なら `ツール名/lib/` に同梱する（例: PDF_Craft, QR_Generator）。
- JavaScript は基本 IIFE + `'use strict'`。既存ツールの書き方に合わせる。
- 設定の永続化は `localStorage`。キーは `yos.<ツール>.<用途>.v<番号>` の形
  （例: `yos.qr.opts.v1` `yos.textcleaner.opts.v1` `yos.theme`）。
- ダウンロードは `<a download>` を動的生成してクリックする方式で統一。

## Git 運用

- **コミット・プッシュはユーザーから明示的に指示があったときだけ**行う。
- このリポジトリは個人プロジェクトのため、`main` に直接コミットする
  （ブランチ・PR は作らない。履歴も1機能1コミットで直コミットしている）。
- コミットメッセージは**日本語**。1行目は簡潔に、必要なら箇条書きで詳細を書く。
- コミットメッセージ末尾に `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` を付ける。

## 確認・検証

- 変更後は簡易サーバで表示を確認するのが望ましい：
  `python -m http.server 8000` → <http://localhost:8000/>
- DOM に依存しないロジック（テキスト整形・色変換・テーマ切替など）は
  `node` で単体テストしてから渡す。
- 変更したファイルだけがステージされているか `git status` で確認する。
