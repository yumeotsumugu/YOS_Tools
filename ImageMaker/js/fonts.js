// fonts.js
// テキストで使えるフォントを管理する。
//
// 「有名なフォント」は、あらかじめ index.html でGoogle Fontsを読み込んでおき、
// ここでは選択肢の一覧(BUILTIN_FONTS)だけを定義する。
//
// 「指定のフォルダに置いたら使えるようにしたい」という要望について:
// ブラウザ上で動くWebアプリ(サーバーなし・file://で開く運用)には、
// セキュリティ上の理由で「特定フォルダを常に監視して自動的に読み込む」仕組みが無い。
// そのため本ツールでは、フォントファイルを一度選んで追加すると、
// ブラウザ内(IndexedDB)に保存され、次回以降は選び直さなくても自動的に使えるようになる
// 方式を採用する。「フォルダに置いておけばずっと使える」に近い体験を、
// ファイル選択1回だけで実現する。

window.IM = window.IM || {};

(function (IM) {
  "use strict";

  const { generateId } = IM;

  /** あらかじめ用意する定番フォント(先頭3つはOS標準フォント、以降はGoogle Fonts) */
  const BUILTIN_FONTS = [
    { value: "sans-serif", label: "ゴシック体(標準)" },
    { value: "serif", label: "明朝体(標準)" },
    { value: "monospace", label: "等幅(標準)" },
    { value: "'Noto Sans JP', sans-serif", label: "Noto Sans JP" },
    { value: "'Noto Serif JP', serif", label: "Noto Serif JP" },
    { value: "'M PLUS Rounded 1c', sans-serif", label: "M PLUS Rounded 1c" },
    { value: "'Kosugi Maru', sans-serif", label: "Kosugi Maru" },
    { value: "'Sawarabi Mincho', serif", label: "Sawarabi Mincho" },
    { value: "'Yusei Magic', sans-serif", label: "Yusei Magic" },
    { value: "'Shippori Mincho', serif", label: "Shippori Mincho" },
    { value: "'Dela Gothic One', sans-serif", label: "Dela Gothic One" },
    { value: "'RocknRoll One', sans-serif", label: "RocknRoll One" },
    { value: "'Zen Kaku Gothic New', sans-serif", label: "Zen Kaku Gothic New" },
  ];

  // このセッションで document.fonts に登録済みのFontFaceを id で引けるようにしておく(削除時に使用)
  const registeredFontFaces = new Map();

  function getDb() {
    return IM.openImageMakerDB();
  }

  function stripExtension(filename) {
    return String(filename || "").replace(/\.[^./\\]+$/, "");
  }

  /**
   * フォントファイルを追加する。読み込んで即座に使えるようにし、
   * IndexedDBにも保存して次回以降も自動的に使えるようにする。
   * @param {File} file - .ttf/.otf/.woff/.woff2 等のフォントファイル
   * @returns {Promise<{id:string, displayName:string}>}
   */
  async function addCustomFontFile(file) {
    const buffer = await file.arrayBuffer();
    const id = generateId("font");
    const displayName = stripExtension(file.name) || "カスタムフォント";

    const fontFace = new FontFace(id, buffer);
    await fontFace.load();
    document.fonts.add(fontFace);
    registeredFontFaces.set(id, fontFace);

    const db = await getDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IM.FONT_STORE_NAME, "readwrite");
      // Blob/FileはブラウザによってIndexedDBでの互換性に差があるため、
      // 確実に構造化複製できるArrayBufferとして保存する。
      tx.objectStore(IM.FONT_STORE_NAME).put({
        id,
        displayName,
        fileName: file.name,
        arrayBuffer: buffer,
        addedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    return { id, displayName };
  }

  /** IndexedDBに保存されているカスタムフォントの一覧(メタデータのみ)を取得する */
  async function listCustomFonts() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IM.FONT_STORE_NAME, "readonly");
      const req = tx.objectStore(IM.FONT_STORE_NAME).getAll();
      req.onsuccess = () => {
        const records = req.result || [];
        resolve(records.map((r) => ({ id: r.id, displayName: r.displayName, fileName: r.fileName })));
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** カスタムフォントを削除する(IndexedDBと現在のセッションの両方から) */
  async function deleteCustomFont(id) {
    const db = await getDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IM.FONT_STORE_NAME, "readwrite");
      tx.objectStore(IM.FONT_STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const face = registeredFontFaces.get(id);
    if (face) {
      document.fonts.delete(face);
      registeredFontFaces.delete(id);
    }
  }

  /**
   * 起動時に呼び出す。IndexedDBに保存済みの全カスタムフォントを読み込み、
   * 使用可能な状態にする。
   * @returns {Promise<Array<{id:string, displayName:string}>>}
   */
  async function loadStoredCustomFonts() {
    let records;
    try {
      const db = await getDb();
      records = await new Promise((resolve, reject) => {
        const tx = db.transaction(IM.FONT_STORE_NAME, "readonly");
        const req = tx.objectStore(IM.FONT_STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      return []; // IndexedDB未対応環境等では静かに諦める
    }

    const loaded = [];
    for (const record of records) {
      try {
        const fontFace = new FontFace(record.id, record.arrayBuffer);
        await fontFace.load();
        document.fonts.add(fontFace);
        registeredFontFaces.set(record.id, fontFace);
        loaded.push({ id: record.id, displayName: record.displayName });
      } catch (err) {
        // 壊れたフォントファイル等は読み飛ばす
      }
    }
    return loaded;
  }

  Object.assign(IM, {
    BUILTIN_FONTS,
    addCustomFontFile,
    listCustomFonts,
    deleteCustomFont,
    loadStoredCustomFonts,
  });
})(window.IM);
