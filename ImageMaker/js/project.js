// project.js
// プロジェクトのJSON保存/読込、IndexedDBへの自動保存を担当する。
//
// 保存内容の方針(設計書 29〜31章):
// - version / name / canvas(width,height,background) / objects[] / settings{} をJSONに保存
// - 画像はBase64のdataURL(オブジェクトのsrcフィールド)としてJSON内に埋め込む
//   → JSONファイル単体で復元できることを優先する
// - IndexedDBには「JSONと同じ形のデータ」をそのまま保存し、自動保存・最近のプロジェクト一覧に使う

window.IM = window.IM || {};

(function (IM) {
  "use strict";

  const { downloadBlob } = IM;

  const DB_NAME = "ImageMakerDB";
  const DB_VERSION = 2; // v2: カスタムフォント用ストアを追加
  const STORE_NAME = "projects";
  const FONT_STORE_NAME = "customFonts";
  const PROJECT_FORMAT_VERSION = "1.0";

  // ---------------------------------------------------------------
  // シリアライズ / デシリアライズ
  // ---------------------------------------------------------------

  /** CanvasManagerの現在の状態を、保存可能なプレーンオブジェクトに変換する */
  function serializeProject(canvasManager, name) {
    return {
      version: PROJECT_FORMAT_VERSION,
      name: name || "無題のプロジェクト",
      savedAt: new Date().toISOString(),
      canvas: {
        width: canvasManager.width,
        height: canvasManager.height,
        background: canvasManager.background,
      },
      objects: canvasManager.objects.map(serializeObject),
      settings: {},
    };
  }

  /** imageElement(HTMLImageElementなのでJSON化できない)を除いたコピーを作る */
  function serializeObject(obj) {
    const { imageElement, sourceObjects, ...rest } = obj;
    // sourceObjects(結合前の元レイヤー)がある場合、再帰的にimageElementを除去して保持する
    if (sourceObjects && sourceObjects.length > 0) {
      rest.sourceObjects = sourceObjects.map(serializeObject);
    }
    return rest;
  }

  /**
   * 保存データ(JSONパース済み、またはIndexedDBから取得した同形のオブジェクト)から
   * CanvasManagerへ渡せる状態(imageElement復元済み)を組み立てる。
   */
  async function deserializeProject(data) {
    if (!data || !data.canvas || !Array.isArray(data.objects)) {
      throw new Error("プロジェクトファイルの形式が正しくありません");
    }
    const objects = await Promise.all(data.objects.map(deserializeObject));
    return {
      name: data.name || "無題のプロジェクト",
      canvas: data.canvas,
      objects,
      settings: data.settings || {},
    };
  }

  /** オブジェクト1件を復元する(画像objのimageElementと、結合レイヤーのsourceObjectsを再帰的に復元) */
  async function deserializeObject(obj) {
    const result = { ...obj };
    if (obj.type === "image" && obj.src) {
      result.imageElement = await loadImageFromSrc(obj.src);
    }
    if (obj.sourceObjects && obj.sourceObjects.length > 0) {
      result.sourceObjects = await Promise.all(obj.sourceObjects.map(deserializeObject));
    }
    return result;
  }

  function loadImageFromSrc(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("画像の復元に失敗しました"));
      img.src = src;
    });
  }

  // ---------------------------------------------------------------
  // JSONファイルとしての保存/読込
  // ---------------------------------------------------------------

  /** プロジェクトをJSONファイルとしてダウンロードさせる */
  function downloadProjectJson(canvasManager, name, filename) {
    const data = serializeProject(canvasManager, name);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    downloadBlob(blob, filename);
  }

  /** ユーザーが選択したJSONファイルを読み込み、復元済みのプロジェクトデータを返す */
  function loadProjectFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const data = JSON.parse(reader.result);
          const project = await deserializeProject(data);
          resolve(project);
        } catch (err) {
          reject(err instanceof Error ? err : new Error("プロジェクトファイルの読み込みに失敗しました"));
        }
      };
      reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました"));
      reader.readAsText(file);
    });
  }

  // ---------------------------------------------------------------
  // IndexedDBによる自動保存・最近のプロジェクト
  // ---------------------------------------------------------------

  let dbPromise = null;

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("このブラウザはIndexedDBに対応していません"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains(FONT_STORE_NAME)) {
          db.createObjectStore(FONT_STORE_NAME, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDBを開けませんでした"));
    });
    return dbPromise;
  }

  /** 自動保存: 指定したidのレコードとしてプロジェクトデータを保存(上書き)する */
  async function saveProjectRecord(id, projectData) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({
        id,
        name: projectData.name,
        updatedAt: Date.now(),
        data: projectData,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** 更新日時の新しい順に最近のプロジェクト一覧を取得する */
  async function listRecentProjects(limit = 8) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const index = tx.objectStore(STORE_NAME).index("updatedAt");
      const results = [];
      const req = index.openCursor(null, "prev");
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && results.length < limit) {
          results.push({ id: cursor.value.id, name: cursor.value.name, updatedAt: cursor.value.updatedAt });
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** IndexedDBに保存された生データ(serializeProjectと同形式)を取得する */
  async function loadProjectRecord(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteProjectRecord(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  Object.assign(IM, {
    serializeProject,
    deserializeProject,
    downloadProjectJson,
    loadProjectFromFile,
    loadImageFromSrc,
    saveProjectRecord,
    listRecentProjects,
    loadProjectRecord,
    deleteProjectRecord,
    openImageMakerDB: openDatabase,
    FONT_STORE_NAME,
  });
})(window.IM);
