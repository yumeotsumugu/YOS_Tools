# QR Generator

URLやテキストを入力するだけでQRコードを生成するローカルWebツール。
生成も履歴の保存もすべてブラウザ内で完結し、外部サーバーへは送信されません。

## 使い方

`index.html` をブラウザで開くだけで動作します（インストール・サーバー不要）。

- **URL / テキスト**: QRに埋め込む内容を入力（日本語など非ASCIIはUTF-8バイトモードで自動処理）
- **誤り訂正レベル**: L / M / Q / H（高いほど汚れ・欠けに強いが情報量は減る）
- **書き出しサイズ / 余白 / 前景色 / 背景色（透明可）** を指定
- **PNG保存 / SVG保存 / 画像コピー**（クリップボード対応ブラウザのみ）
- **履歴**: 生成した内容は自動でこの端末のブラウザ内（localStorage）に最大50件保存。
  「使う」で復元、各行の「×」で個別削除、「すべて削除」で全消去。

## ファイル構成

```text
index.html            画面 + ロジック
lib/qrcode.min.js     QRコード生成 (qrcode-generator 1.4.4 / MIT License, Kazuhiko Arase)
```

## ライセンス

同梱の `lib/qrcode.min.js` は [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
（MIT License, © Kazuhiko Arase）を使用しています。
