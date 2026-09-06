// utils.js
// 汎用ヘルパー関数群。特定の機能に依存しない小さな関数のみを置く。
// ES Modulesは file:// で開いた際にブラウザのCORS制限で読み込めないため、
// 素の <script> 読み込みでも動くよう window.IM 名前空間に関数を登録する方式にしている。

window.IM = window.IM || {};

(function (IM) {
  "use strict";

  let idCounter = 0;

  /**
   * オブジェクトの一意なIDを生成する。
   * 例: object_0001
   */
  function generateId(prefix = "object") {
    idCounter += 1;
    const random = Math.random().toString(36).slice(2, 7);
    return `${prefix}_${String(idCounter).padStart(4, "0")}_${random}`;
  }

  /** 値をmin〜maxの範囲に収める */
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function degToRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function radToDeg(rad) {
    return (rad * 180) / Math.PI;
  }

  /**
   * dataURLをファイルとしてダウンロードさせる
   */
  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /**
   * Blobをファイルとしてダウンロードさせる
   */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    downloadDataUrl(url, filename);
    // 生成したURLは少し遅らせて解放する
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** ファイルをHTMLImageElementとして読み込む(Promise化) */
  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました"));
      reader.readAsDataURL(file);
    });
  }

  /** ユーザー向けの簡易エラーメッセージを表示する */
  function showUserError(message) {
    const toast = document.getElementById("toast");
    if (!toast) {
      // フォールバック
      alert(message);
      return;
    }
    toast.textContent = message;
    toast.classList.add("toast--visible");
    window.clearTimeout(showUserError._timer);
    showUserError._timer = window.setTimeout(() => {
      toast.classList.remove("toast--visible");
    }, 3200);
  }

  /**
   * ユーザー入力のファイル名を、OS横断で安全なファイル名に整形する。
   * 拡張子は含めない(呼び出し側で付与する)。空になった場合はfallbackを使う。
   */
  function sanitizeFilename(name, fallback = "output") {
    let cleaned = String(name || "")
      .trim()
      .replace(/[\\/:*?"<>|]/g, "_") // Windows等で使えない文字
      .replace(/\s+/g, "_")
      .replace(/^\.+/, "") // 先頭のドットは隠しファイル化を防ぐため除去
      .slice(0, 100);
    return cleaned || fallback;
  }

  Object.assign(IM, {
    generateId,
    clamp,
    degToRad,
    radToDeg,
    downloadDataUrl,
    downloadBlob,
    loadImageFromFile,
    showUserError,
    sanitizeFilename,
  });
})(window.IM);
