// app.js
// アプリケーションのエントリーポイント。
// スタート画面(キャンバスサイズ選択) → メイン編集画面 の制御と、
// ツールバー・プロパティパネル・レイヤーパネル・書き出しの結線を行う。

window.IM = window.IM || {};

(function (IM) {
  "use strict";

  const { CanvasManager, LayerPanel, exportToPNG, HistoryManager } = IM;
  const { createImageObject, createTextObject, createRectObject, createCircleObject, createShapeObject, defaultFilters } = IM;
  const { createTableObject, resizeTableGrid, createEmptyCellStyle } = IM;
  const { getObjectCorners, SHAPE_KIND_LIST } = IM;
  const { loadImageFromFile, showUserError, generateId, downloadBlob, sanitizeFilename } = IM;
  const { encodeAPNG, computeAnimationTransform, ANIMATION_PRESETS, renderObjectsToCanvas } = IM;
  const {
    serializeProject,
    deserializeProject,
    downloadProjectJson,
    loadProjectFromFile,
    loadImageFromSrc,
    saveProjectRecord,
    listRecentProjects,
    loadProjectRecord,
    deleteProjectRecord,
  } = IM;
  const { BUILTIN_FONTS, addCustomFontFile, listCustomFonts, deleteCustomFont, loadStoredCustomFonts } = IM;

  const CANVAS_PRESETS = [
    { label: "1920 × 1080", width: 1920, height: 1080 },
    { label: "1280 × 720", width: 1280, height: 720 },
    { label: "1080 × 1080", width: 1080, height: 1080 },
    { label: "800 × 600", width: 800, height: 600 },
    { label: "600 × 600", width: 600, height: 600 },
    { label: "400 × 400", width: 400, height: 400 },
  ];

  let canvasManager = null;
  let layerPanel = null;
  let historyManager = null;
  let clipboardObjects = []; // Ctrl+C / Ctrl+V 用のクリップボード(アプリ内メモリのみ)
  let apngImages = []; // APNG「複数画像から作る」タブで追加した画像 [{id, img, name}]
  const previewTimers = {}; // APNGプレビューのタイマーID(タブごと)
  let currentProjectId = null; // 自動保存(IndexedDB)で使う現在のプロジェクトID
  let currentProjectName = "無題のプロジェクト";
  let autosaveTimer = null;
  let customFontsCache = []; // IndexedDBに保存済みのカスタムフォント一覧 [{id, displayName}]
  let editorInitialized = false; // bindToolbar等のイベント購読を初回のみ行うためのフラグ
  let isOpeningProject = false; // 「最近のプロジェクト」等の連続クリックで多重に開かれるのを防ぐガード

  const LINE_FAMILY_KINDS = new Set(["line", "lineArrow", "arrowElbow", "arrowUturn", "freehand"]);

  document.addEventListener("DOMContentLoaded", () => {
    initStartScreen();
    bindGuideModal();
    applyPlatformShortcutLabels();
    loadStoredCustomFonts().then((list) => {
      customFontsCache = list;
    });
  });

// ---------------------------------------------------------------
// macOS対応: ショートカット表示の切り替え
// ---------------------------------------------------------------

/** macOS(Safari/Chrome等)で開いているかを判定する */
function isMacPlatform() {
  const platform = (navigator.platform || "").toLowerCase();
  if (platform.includes("mac")) return true;
  const uaPlatform = (navigator.userAgentData && navigator.userAgentData.platform) || "";
  if (uaPlatform.toLowerCase().includes("mac")) return true;
  return /macintosh|mac os x/i.test(navigator.userAgent || "");
}

/**
 * macOSでは Ctrl ではなく ⌘(Command) を使うのが標準のため、
 * ヘッダーのボタンやフッターの案内、使い方ガイドの表記を実行環境に合わせて切り替える。
 * (キー操作自体はCtrl/⌘のどちらでも動作するよう既に両対応済み)
 */
function applyPlatformShortcutLabels() {
  if (!isMacPlatform()) return;
  const modKey = "⌘";

  const undoBtn = document.getElementById("undoBtn");
  if (undoBtn) undoBtn.title = `元に戻す (${modKey}+Z)`;
  const redoBtn = document.getElementById("redoBtn");
  if (redoBtn) redoBtn.title = `やり直す (${modKey}+Shift+Z)`;

  const footerHint = document.querySelector(".footer-hint");
  if (footerHint) {
    footerHint.textContent = `Shift+クリックで複数選択 / Delete削除 / ${modKey}+Zで元に戻す / ${modKey}+Dで複製`;
  }

  document.querySelectorAll(".guide-shortcut-table td:first-child").forEach((cell) => {
    if (cell.textContent.includes("Ctrl")) {
      cell.textContent = cell.textContent.replace(/Ctrl/g, modKey);
    }
  });
}

// ---------------------------------------------------------------
// スタート画面
// ---------------------------------------------------------------

function initStartScreen() {
  const presetContainer = document.getElementById("presetList");
  let selectedPreset = CANVAS_PRESETS[0];

  CANVAS_PRESETS.forEach((preset, index) => {
    const btn = document.createElement("button");
    btn.className = "preset-btn";
    btn.textContent = preset.label;
    if (index === 0) btn.classList.add("preset-btn--active");
    btn.addEventListener("click", () => {
      selectedPreset = preset;
      document.getElementById("customWidth").value = preset.width;
      document.getElementById("customHeight").value = preset.height;
      document
        .querySelectorAll(".preset-btn")
        .forEach((b) => b.classList.remove("preset-btn--active"));
      btn.classList.add("preset-btn--active");
    });
    presetContainer.appendChild(btn);
  });

  document.getElementById("customWidth").value = selectedPreset.width;
  document.getElementById("customHeight").value = selectedPreset.height;

  document.getElementById("startCreateBtn").addEventListener("click", () => {
    const width = parseInt(document.getElementById("customWidth").value, 10);
    const height = parseInt(document.getElementById("customHeight").value, 10);
    const bgType = document.querySelector('input[name="bgType"]:checked').value;
    const bgColor = document.getElementById("bgColorPicker").value;
    const projectName = sanitizeProjectName(document.getElementById("projectNameInput").value);

    if (!width || !height || width < 10 || height < 10) {
      showUserError("キャンバスサイズが正しくありません。数値を確認してください。");
      return;
    }

    startEditor(
      {
        width,
        height,
        background:
          bgType === "color" ? { type: "color", color: bgColor } : { type: "transparent" },
      },
      { projectId: generateId("project"), projectName }
    );
  });

  bindOpenProject();
  renderRecentProjectsList();
}

function sanitizeProjectName(name) {
  const trimmed = String(name || "").trim();
  return trimmed || "無題のプロジェクト";
}

// --- プロジェクトを開く(JSONファイル) ---

function bindOpenProject() {
  const fileInput = document.getElementById("openProjectFileInput");
  document.getElementById("openProjectBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    fileInput.value = "";
    if (!file || isOpeningProject) return;
    isOpeningProject = true;
    try {
      const project = await loadProjectFromFile(file);
      startEditor(
        { width: project.canvas.width, height: project.canvas.height, background: project.canvas.background },
        { projectId: generateId("project"), projectName: project.name, objects: project.objects }
      );
    } catch (err) {
      showUserError("プロジェクトファイルを読み込めませんでした。破損しているか、対応していない形式です。");
    } finally {
      isOpeningProject = false;
    }
  });
}

// --- 最近のプロジェクト(IndexedDB自動保存分) ---

async function renderRecentProjectsList() {
  const section = document.getElementById("recentProjectsSection");
  const list = document.getElementById("recentProjectsList");
  try {
    const recents = await listRecentProjects(8);
    if (!recents || recents.length === 0) {
      section.style.display = "none";
      return;
    }
    section.style.display = "block";
    list.innerHTML = "";
    recents.forEach((entry) => {
      list.appendChild(buildRecentProjectItem(entry));
    });
  } catch (err) {
    // IndexedDB未対応環境などでは静かに諦める(最近のプロジェクトは無くても致命的ではない)
    section.style.display = "none";
  }
}

function buildRecentProjectItem(entry) {
  const li = document.createElement("li");
  li.className = "recent-project-item";

  const name = document.createElement("span");
  name.className = "recent-project-name";
  name.textContent = entry.name || "無題のプロジェクト";

  const date = document.createElement("span");
  date.className = "recent-project-date";
  date.textContent = formatRelativeDate(entry.updatedAt);

  const delBtn = document.createElement("button");
  delBtn.className = "recent-project-delete";
  delBtn.textContent = "✕";
  delBtn.title = "削除";
  delBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await deleteProjectRecord(entry.id);
      renderRecentProjectsList();
    } catch (err) {
      showUserError("削除に失敗しました。");
    }
  });

  li.append(name, date, delBtn);
  li.addEventListener("click", () => openRecentProject(entry.id));
  return li;
}

function formatRelativeDate(timestamp) {
  const d = new Date(timestamp);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

async function openRecentProject(id) {
  if (isOpeningProject) return;
  isOpeningProject = true;
  try {
    const raw = await loadProjectRecord(id);
    if (!raw) {
      showUserError("プロジェクトが見つかりませんでした。");
      renderRecentProjectsList();
      return;
    }
    const project = await deserializeProject(raw);
    startEditor(
      { width: project.canvas.width, height: project.canvas.height, background: project.canvas.background },
      { projectId: id, projectName: project.name, objects: project.objects }
    );
  } catch (err) {
    showUserError("プロジェクトを開けませんでした。");
  } finally {
    isOpeningProject = false;
  }
}

// ---------------------------------------------------------------
// メイン編集画面
// ---------------------------------------------------------------

function startEditor(projectConfig, options = {}) {
  document.getElementById("startScreen").classList.add("hidden");
  document.getElementById("editorScreen").classList.remove("hidden");

  currentProjectId = options.projectId || generateId("project");
  currentProjectName = options.projectName || "無題のプロジェクト";
  document.getElementById("autosaveStatus").textContent = "";

  const canvasEl = document.getElementById("mainCanvas");
  canvasManager = new CanvasManager(canvasEl, projectConfig);

  // プロジェクトを開いた/最近のプロジェクトから復元した場合、オブジェクトを反映する(履歴には積まない)
  if (options.objects && options.objects.length > 0) {
    canvasManager.objects = options.objects;
  }

  historyManager = new HistoryManager(canvasManager);
  canvasManager.history = historyManager;
  historyManager.onChange = () => {
    updateUndoRedoButtons();
    scheduleAutosave();
  };
  canvasManager.onDragEnd = () => scheduleAutosave();

  document.getElementById("canvasSizeLabel").textContent = `${projectConfig.width} × ${projectConfig.height}`;

  layerPanel = new LayerPanel(document.getElementById("layerList"), canvasManager);
  layerPanel.render();

  canvasManager.onSelectionChange = () => {
    renderPropertiesPanel(canvasManager.getSelectedObjects());
    layerPanel.render();
  };

  // DOMのイベント購読は初回のみ行う(2回目以降はcanvasManager等の変数を
  // クロージャ経由で参照しているだけなので、再購読すると同じ操作が何重にも発火してしまう)
  if (!editorInitialized) {
    bindToolbar();
    bindZoomControls();
    bindExport();
    bindHistoryControls();
    bindSnapToggle();
    bindLayersToggle();
    bindLayersResize();
    bindKeyboardShortcuts();
    bindApngModal();
    bindSaveProject();
    bindHomeButton();
    bindProjectNameHeaderInput();
    editorInitialized = true;
  }

  // 新しいCanvasManagerごとに毎回リセットしたい初期状態
  canvasManager.setZoom(100);
  document.getElementById("snapToggle").checked = canvasManager.snapEnabled;
  document.getElementById("projectNameHeaderInput").value = currentProjectName;
  canvasManager.penStrokeColor = document.getElementById("penColorInput").value;
  canvasManager.penStrokeWidth = parseFloat(document.getElementById("penWidthInput").value);
  canvasManager.penDashed = document.getElementById("penDashedInput").checked;
  document.getElementById("penToolBtn").classList.remove("tool-btn--active");
  document.getElementById("penOptions").classList.add("hidden");
  document.getElementById("canvasWrap").classList.remove("pen-mode");

  renderPropertiesPanel([]);
  updateUndoRedoButtons();
  canvasManager.render();

  // Webフォント(Google Fonts等)の読み込み完了後に一度再描画して、確実に反映させる
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (canvasManager) canvasManager.render();
    });
  }

  // 復元済みプロジェクトを開いた直後の状態も1件自動保存しておく
  if (options.objects) scheduleAutosave();
}

// ---------------------------------------------------------------
// ツールバー(追加パネル)
// ---------------------------------------------------------------

function bindToolbar() {
  document.getElementById("addTextBtn").addEventListener("click", () => {
    exitPenMode();
    const obj = createTextObject({ x: canvasCenterX() - 150, y: canvasCenterY() - 30 });
    canvasManager.addObject(obj);
  });

  document.getElementById("addRectBtn").addEventListener("click", () => {
    exitPenMode();
    const obj = createRectObject({ x: canvasCenterX() - 100, y: canvasCenterY() - 70 });
    canvasManager.addObject(obj);
  });

  document.getElementById("addCircleBtn").addEventListener("click", () => {
    exitPenMode();
    const obj = createCircleObject({ x: canvasCenterX() - 80, y: canvasCenterY() - 80 });
    canvasManager.addObject(obj);
  });

  document.getElementById("addTableBtn").addEventListener("click", () => {
    exitPenMode();
    const obj = createTableObject({ x: canvasCenterX() - 150, y: canvasCenterY() - 100 });
    canvasManager.addObject(obj);
  });

  bindShapePicker();
  bindPenTool();

  const imageInput = document.getElementById("imageFileInput");
  document.getElementById("addImageBtn").addEventListener("click", () => imageInput.click());
  imageInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    imageInput.value = "";
    if (!file) return;
    await addImageFromFile(file);
  });

  // キャンバスへの画像ドラッグ&ドロップ
  const canvasWrap = document.getElementById("canvasWrap");
  canvasWrap.addEventListener("dragover", (e) => e.preventDefault());
  canvasWrap.addEventListener("drop", async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      await addImageFromFile(file);
    }
  });

  const customFontInput = document.getElementById("customFontFileInput");
  customFontInput.addEventListener("change", async (e) => {
    const files = [...e.target.files];
    customFontInput.value = "";
    if (files.length === 0) return;
    await handleCustomFontFiles(files);
  });
}

async function addImageFromFile(file) {
  try {
    exitPenMode();
    const img = await loadImageFromFile(file);
    const maxDim = Math.min(canvasManager.width, canvasManager.height) * 0.6;
    const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
    const width = img.width * ratio;
    const height = img.height * ratio;
    const obj = createImageObject({
      x: canvasCenterX() - width / 2,
      y: canvasCenterY() - height / 2,
      width,
      height,
      imageElement: img,
      src: img.src,
    });
    canvasManager.addObject(obj);
  } catch (err) {
    showUserError("画像を読み込めませんでした。対応していない形式か、ファイルが破損している可能性があります。");
  }
}

function canvasCenterX() {
  return canvasManager.width / 2;
}
function canvasCenterY() {
  return canvasManager.height / 2;
}

/** 左パネルに矢印・吹き出し・星などの図形ボタンを、四角形/円と同じ並びで常時表示する */
function bindShapePicker() {
  const list = document.getElementById("shapeButtonList");
  SHAPE_KIND_LIST.forEach((def) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tool-btn";
    btn.textContent = `${def.icon} ${def.label}`;
    btn.addEventListener("click", () => addShapeObject(def.kind));
    list.appendChild(btn);
  });
}

function addShapeObject(shapeKind) {
  exitPenMode();
  const obj = createShapeObject({ x: 0, y: 0, shapeKind });
  obj.x = canvasCenterX() - obj.width / 2;
  obj.y = canvasCenterY() - obj.height / 2;
  canvasManager.addObject(obj);
}

/** ペンツール(フリーハンド描画)。ドラッグして自由に線を描き、指を離すとオブジェクトとして確定する */
function bindPenTool() {
  const btn = document.getElementById("penToolBtn");
  const options = document.getElementById("penOptions");
  const widthInput = document.getElementById("penWidthInput");
  const colorInput = document.getElementById("penColorInput");
  const dashedInput = document.getElementById("penDashedInput");
  const canvasWrap = document.getElementById("canvasWrap");

  btn.addEventListener("click", () => {
    canvasManager.penMode = !canvasManager.penMode;
    btn.classList.toggle("tool-btn--active", canvasManager.penMode);
    options.classList.toggle("hidden", !canvasManager.penMode);
    canvasWrap.classList.toggle("pen-mode", canvasManager.penMode);
    if (canvasManager.penMode) canvasManager.clearSelection();
  });

  widthInput.addEventListener("input", () => {
    canvasManager.penStrokeWidth = parseFloat(widthInput.value);
  });
  colorInput.addEventListener("input", () => {
    canvasManager.penStrokeColor = colorInput.value;
  });
  dashedInput.addEventListener("change", () => {
    canvasManager.penDashed = dashedInput.checked;
  });
}

/** ペンツールが有効な場合、他のツールを使う前に解除しておく */
function exitPenMode() {
  if (!canvasManager || !canvasManager.penMode) return;
  canvasManager.penMode = false;
  document.getElementById("penToolBtn").classList.remove("tool-btn--active");
  document.getElementById("penOptions").classList.add("hidden");
  document.getElementById("canvasWrap").classList.remove("pen-mode");
}

// ---------------------------------------------------------------
// プロパティパネル(右側・選択中オブジェクトの設定)
// ---------------------------------------------------------------

function renderPropertiesPanel(selection) {
  const panel = document.getElementById("propertiesPanel");
  panel.innerHTML = "";

  if (!selection || selection.length === 0) {
    const empty = document.createElement("p");
    empty.className = "properties-empty";
    empty.textContent = "オブジェクトを選択してください";
    panel.appendChild(empty);
    return;
  }

  panel.appendChild(buildArrangeSection(selection));

  if (selection.length === 1) {
    const obj = selection[0];

    if (obj.locked) {
      const note = document.createElement("p");
      note.className = "properties-locked-note";
      note.textContent = "🔒 ロック中は編集できません(レイヤーパネルで解除してください)";
      panel.appendChild(note);
    }

    const disabled = !!obj.locked;

    panel.appendChild(buildCommonFields(obj, disabled));

    if (obj.type === "text") panel.appendChild(buildTextFields(obj, disabled));
    if (obj.type === "rectangle" || obj.type === "circle") panel.appendChild(buildShapeFields(obj, disabled));
    if (obj.type === "shape") {
      if (LINE_FAMILY_KINDS.has(obj.shapeKind)) {
        panel.appendChild(buildLineFields(obj, disabled));
      } else {
        panel.appendChild(buildShapeFields(obj, disabled));
        panel.appendChild(buildShapeKindExtras(obj, disabled));
      }
    }
    if (obj.type === "image") panel.appendChild(buildFilterFields(obj, disabled));
    if (obj.type === "table") panel.appendChild(buildTableFields(obj, disabled));

    const actions = document.createElement("div");
    actions.className = "property-actions";
    const dupBtn = document.createElement("button");
    dupBtn.className = "property-action-btn";
    dupBtn.textContent = "⧉ 複製";
    dupBtn.disabled = disabled;
    dupBtn.addEventListener("click", () => canvasManager.duplicateObject(obj.id));
    const delBtn = document.createElement("button");
    delBtn.className = "property-action-btn property-action-btn--danger";
    delBtn.textContent = "✕ 削除";
    delBtn.disabled = disabled;
    delBtn.addEventListener("click", () => canvasManager.deleteObject(obj.id));
    actions.append(dupBtn, delBtn);
    panel.appendChild(actions);
  } else {
    const note = document.createElement("p");
    note.className = "properties-empty";
    note.textContent = `${selection.length}件のオブジェクトを選択中`;
    panel.appendChild(note);

    const actions = document.createElement("div");
    actions.className = "property-actions";
    const dupBtn = document.createElement("button");
    dupBtn.className = "property-action-btn";
    dupBtn.textContent = "⧉ すべて複製";
    dupBtn.addEventListener("click", () => canvasManager.duplicateSelection());
    const delBtn = document.createElement("button");
    delBtn.className = "property-action-btn property-action-btn--danger";
    delBtn.textContent = "✕ すべて削除";
    delBtn.addEventListener("click", () => canvasManager.deleteSelection());
    actions.append(dupBtn, delBtn);
    panel.appendChild(actions);
  }
}

/** 重ね順・整列・均等配置をまとめた「配置」セクション(1件以上選択中に表示) */
function buildArrangeSection(selection) {
  const fragment = document.createElement("div");
  fragment.className = "property-group arrange-section";

  fragment.appendChild(subTitle("重ね順"));
  const zRow1 = document.createElement("div");
  zRow1.className = "arrange-btn-row";
  zRow1.appendChild(arrangeButton("⬆ 前面へ", () => canvasManager.bringForward()));
  zRow1.appendChild(arrangeButton("⬇ 背面へ", () => canvasManager.sendBackward()));
  const zRow2 = document.createElement("div");
  zRow2.className = "arrange-btn-row";
  zRow2.appendChild(arrangeButton("⤒ 最前面へ", () => canvasManager.bringToFront()));
  zRow2.appendChild(arrangeButton("⤓ 最背面へ", () => canvasManager.sendToBack()));
  fragment.append(zRow1, zRow2);

  fragment.appendChild(subTitle("素材を整列させる"));
  const alignRow1 = document.createElement("div");
  alignRow1.className = "arrange-btn-row";
  alignRow1.appendChild(arrangeButton("⭱ 上揃え", () => runAlign("top")));
  alignRow1.appendChild(arrangeButton("⇤ 左揃え", () => runAlign("left")));
  const alignRow2 = document.createElement("div");
  alignRow2.className = "arrange-btn-row";
  alignRow2.appendChild(arrangeButton("⇕ 中央揃え", () => runAlign("centerY")));
  alignRow2.appendChild(arrangeButton("⇔ 中央揃え", () => runAlign("centerX")));
  const alignRow3 = document.createElement("div");
  alignRow3.className = "arrange-btn-row";
  alignRow3.appendChild(arrangeButton("⭳ 下揃え", () => runAlign("bottom")));
  alignRow3.appendChild(arrangeButton("⇥ 右揃え", () => runAlign("right")));
  fragment.append(alignRow1, alignRow2, alignRow3);

  fragment.appendChild(subTitle("均等配置"));
  const distDisabled = selection.length < 3;
  const distRow = document.createElement("div");
  distRow.className = "arrange-btn-row";
  distRow.appendChild(arrangeButton("⬍ 垂直に", () => runDistribute("vertical"), distDisabled));
  distRow.appendChild(arrangeButton("⬌ 水平に", () => runDistribute("horizontal"), distDisabled));
  fragment.appendChild(distRow);
  const arrangeRowBtn = arrangeButton("☰ 整列する", () => runArrangeRow(), selection.length < 2);
  arrangeRowBtn.classList.add("arrange-btn-full");
  fragment.appendChild(arrangeRowBtn);

  fragment.appendChild(subTitle("レイヤー"));
  if (selection.length >= 2) {
    const mergeBtn = arrangeButton("🔗 レイヤーを結合", () => mergeSelectedObjects(), false);
    mergeBtn.classList.add("arrange-btn-full");
    fragment.appendChild(mergeBtn);
  } else if (selection.length === 1 && selection[0].sourceObjects && selection[0].sourceObjects.length > 0) {
    const unmergeBtn = arrangeButton("🔓 結合を解除", () => unmergeSelectedObject(), false);
    unmergeBtn.classList.add("arrange-btn-full");
    fragment.appendChild(unmergeBtn);
  } else {
    const mergeBtn = arrangeButton("🔗 レイヤーを結合", () => {}, true);
    mergeBtn.classList.add("arrange-btn-full");
    mergeBtn.title = "2つ以上選択すると結合できます";
    fragment.appendChild(mergeBtn);
  }

  return fragment;
}

function runAlign(type) {
  canvasManager.alignSelection(type);
  renderPropertiesPanel(canvasManager.getSelectedObjects());
}

function runDistribute(axis) {
  const ok = axis === "horizontal" ? canvasManager.distributeHorizontal() : canvasManager.distributeVertical();
  if (!ok) {
    showUserError("均等配置には3つ以上のオブジェクトを選択してください。");
    return;
  }
  renderPropertiesPanel(canvasManager.getSelectedObjects());
}

function runArrangeRow() {
  const ok = canvasManager.arrangeRow();
  if (!ok) {
    showUserError("整列するには2つ以上のオブジェクトを選択してください。");
    return;
  }
  renderPropertiesPanel(canvasManager.getSelectedObjects());
}

/**
 * 選択中の複数オブジェクトを1枚の画像に結合する(レイヤー結合)。
 * 選択範囲全体を包むバウンディングボックスのサイズでオフスクリーンに合成描画し、
 * それを新しい画像オブジェクトとして元のオブジェクト群と置き換える。
 */
async function mergeSelectedObjects() {
  const objs = canvasManager.getSelectedObjects().filter((o) => !o.locked);
  if (objs.length < 2) {
    showUserError("結合するには2つ以上のオブジェクトを選択してください。");
    return;
  }

  const idSet = new Set(objs.map((o) => o.id));
  // 現在のz順(配列順)を保ったまま対象を取り出す
  const orderedObjs = canvasManager.objects.filter((o) => idSet.has(o.id));

  const allCorners = orderedObjs.flatMap((o) => getObjectCorners(o));
  const minX = Math.min(...allCorners.map((c) => c.x));
  const minY = Math.min(...allCorners.map((c) => c.y));
  const maxX = Math.max(...allCorners.map((c) => c.x));
  const maxY = Math.max(...allCorners.map((c) => c.y));
  const width = Math.max(1, Math.round(maxX - minX));
  const height = Math.max(1, Math.round(maxY - minY));

  // 合成用キャンバスのローカル座標系(0,0起点)に合わせて位置をずらす
  const shifted = orderedObjs.map((o) => ({ ...o, x: o.x - minX, y: o.y - minY }));
  const mergedCanvas = renderObjectsToCanvas(shifted, { type: "transparent" }, width, height);
  const dataUrl = mergedCanvas.toDataURL("image/png");

  let img;
  try {
    img = await loadImageFromSrc(dataUrl);
  } catch (err) {
    showUserError("レイヤーの結合に失敗しました。もう一度お試しください。");
    return;
  }

  const mergedObj = createImageObject({ x: minX, y: minY, width, height, imageElement: img, src: dataUrl });
  mergedObj.name = `結合レイヤー(${orderedObjs.length}件)`;
  mergedObj.sourceObjects = orderedObjs; // 結合前の元オブジェクト群を保持しておく(結合解除用)

  canvasManager.mergeInto(mergedObj, [...idSet]);
}

/** 選択中のオブジェクトが結合レイヤーであれば、結合前の状態に戻す */
function unmergeSelectedObject() {
  const obj = canvasManager.getSelectedObject();
  if (!obj || !obj.sourceObjects || obj.sourceObjects.length === 0) return;
  canvasManager.unmergeInto(obj);
}

function arrangeButton(label, onClick, disabled = false) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "arrange-btn";
  btn.textContent = label;
  btn.disabled = disabled;
  btn.addEventListener("click", onClick);
  return btn;
}

function buildCommonFields(obj, disabled) {
  const fragment = document.createElement("div");
  fragment.className = "property-group";

  const rows = [
    numberField("X", obj.x, (v) => commitUpdate(obj, { x: v }), disabled),
    numberField("Y", obj.y, (v) => commitUpdate(obj, { y: v }), disabled),
    numberField("幅", obj.width, (v) => commitUpdate(obj, { width: Math.max(10, v) }), disabled),
    numberField("高さ", obj.height, (v) => commitUpdate(obj, { height: Math.max(10, v) }), disabled),
    numberField("回転", Math.round(obj.rotation), (v) => commitUpdate(obj, { rotation: v }), disabled),
    liveRangeField("不透明度", obj.opacity, 0, 1, 0.01, (v) => liveUpdate(obj, { opacity: v }), disabled),
  ];
  rows.forEach((r) => fragment.appendChild(r));
  return fragment;
}

function buildTextFields(obj, disabled) {
  const fragment = document.createElement("div");
  fragment.className = "property-group";

  const textarea = document.createElement("textarea");
  textarea.className = "property-textarea";
  textarea.value = obj.text;
  textarea.rows = 3;
  textarea.disabled = disabled;
  bindLiveThenCommit(textarea, "input", () => liveUpdate(obj, { text: textarea.value }));
  fragment.appendChild(labeled("内容", textarea));
  fragment.appendChild(
    checkboxField(
      "ボックス内で自動改行する",
      obj.wrapText !== false,
      (v) => commitUpdate(obj, { wrapText: v }),
      disabled
    )
  );

  fragment.appendChild(buildFontSelector(obj, disabled));
  fragment.appendChild(numberField("サイズ", obj.fontSize, (v) => commitUpdate(obj, { fontSize: v }), disabled));
  fragment.appendChild(liveColorField("文字色", obj.color, (v) => liveUpdate(obj, { color: v }), disabled));

  const alignSelect = document.createElement("select");
  alignSelect.disabled = disabled;
  ["left", "center", "right"].forEach((val) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = { left: "左揃え", center: "中央揃え", right: "右揃え" }[val];
    if (obj.align === val) opt.selected = true;
    alignSelect.appendChild(opt);
  });
  alignSelect.addEventListener("change", () => commitUpdate(obj, { align: alignSelect.value }));
  fragment.appendChild(labeled("横の揃え", alignSelect));

  const vAlignSelect = document.createElement("select");
  vAlignSelect.disabled = disabled;
  ["top", "middle", "bottom"].forEach((val) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = { top: "上揃え", middle: "中央揃え", bottom: "下揃え" }[val];
    if ((obj.verticalAlign || "top") === val) opt.selected = true;
    vAlignSelect.appendChild(opt);
  });
  vAlignSelect.addEventListener("change", () => commitUpdate(obj, { verticalAlign: vAlignSelect.value }));
  fragment.appendChild(labeled("縦の揃え", vAlignSelect));

  fragment.appendChild(checkboxField("太字", obj.bold, (v) => commitUpdate(obj, { bold: v }), disabled));
  fragment.appendChild(checkboxField("斜体", obj.italic, (v) => commitUpdate(obj, { italic: v }), disabled));

  // 縁取り
  const outlineGroup = document.createElement("div");
  outlineGroup.className = "property-subgroup";
  outlineGroup.appendChild(subTitle("縁取り"));
  outlineGroup.appendChild(
    numberField("太さ", obj.outlineWidth || 0, (v) => commitUpdate(obj, { outlineWidth: Math.max(0, v) }), disabled)
  );
  outlineGroup.appendChild(liveColorField("色", obj.outlineColor, (v) => liveUpdate(obj, { outlineColor: v }), disabled));
  fragment.appendChild(outlineGroup);

  // シャドウ
  const shadowGroup = document.createElement("div");
  shadowGroup.className = "property-subgroup";
  shadowGroup.appendChild(subTitle("シャドウ"));
  shadowGroup.appendChild(checkboxField("有効にする", obj.shadowEnabled, (v) => commitUpdate(obj, { shadowEnabled: v }), disabled));
  shadowGroup.appendChild(liveColorField("色", obj.shadowColor, (v) => liveUpdate(obj, { shadowColor: v }), disabled));
  shadowGroup.appendChild(numberField("X", obj.shadowOffsetX, (v) => commitUpdate(obj, { shadowOffsetX: v }), disabled));
  shadowGroup.appendChild(numberField("Y", obj.shadowOffsetY, (v) => commitUpdate(obj, { shadowOffsetY: v }), disabled));
  shadowGroup.appendChild(
    numberField("Blur", obj.shadowBlur || 0, (v) => commitUpdate(obj, { shadowBlur: Math.max(0, v) }), disabled)
  );
  fragment.appendChild(shadowGroup);

  return fragment;
}

/** テキストのフォント選択UI(定番フォント一覧 + カスタムフォント追加/管理) */
function buildFontSelector(obj, disabled) {
  const wrap = document.createElement("div");
  wrap.className = "property-subgroup";

  const select = document.createElement("select");
  select.disabled = disabled;
  populateFontSelect(select, obj.fontFamily);
  select.addEventListener("change", () => commitUpdate(obj, { fontFamily: select.value }));
  wrap.appendChild(labeled("フォント", select));

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "property-action-btn";
  addBtn.textContent = "＋ フォントを追加(.ttf/.otf/.woff)";
  addBtn.disabled = disabled;
  addBtn.addEventListener("click", () => document.getElementById("customFontFileInput").click());
  wrap.appendChild(addBtn);

  if (customFontsCache.length > 0) {
    const list = document.createElement("ul");
    list.className = "custom-font-list";
    customFontsCache.forEach((font) => {
      const li = document.createElement("li");
      li.className = "custom-font-item";
      const name = document.createElement("span");
      name.className = "custom-font-name";
      name.textContent = font.displayName;
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "custom-font-remove";
      delBtn.textContent = "✕";
      delBtn.title = "削除";
      delBtn.disabled = disabled;
      delBtn.addEventListener("click", async () => {
        await deleteCustomFont(font.id);
        customFontsCache = customFontsCache.filter((f) => f.id !== font.id);
        renderPropertiesPanel(canvasManager.getSelectedObjects());
      });
      li.append(name, delBtn);
      list.appendChild(li);
    });
    wrap.appendChild(list);
  }

  return wrap;
}

/** フォントの<select>を、定番フォント+カスタムフォントで組み立てる */
function populateFontSelect(select, currentValue) {
  select.innerHTML = "";

  const builtinGroup = document.createElement("optgroup");
  builtinGroup.label = "標準";
  BUILTIN_FONTS.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.value;
    opt.textContent = f.label;
    builtinGroup.appendChild(opt);
  });
  select.appendChild(builtinGroup);

  if (customFontsCache.length > 0) {
    const customGroup = document.createElement("optgroup");
    customGroup.label = "カスタムフォント";
    customFontsCache.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = `'${f.id}', sans-serif`;
      opt.textContent = f.displayName;
      customGroup.appendChild(opt);
    });
    select.appendChild(customGroup);
  }

  select.value = currentValue;
  if (select.value !== currentValue) {
    // 現在の値が一覧に無い(未読み込みのカスタムフォント等) → 案内用の選択肢を先頭に追加
    const opt = document.createElement("option");
    opt.value = currentValue;
    opt.textContent = "(不明なフォント)";
    select.insertBefore(opt, select.firstChild);
    select.value = currentValue;
  }
}

/** カスタムフォントファイルが選択された時の処理 */
async function handleCustomFontFiles(files) {
  for (const file of files) {
    try {
      const added = await addCustomFontFile(file);
      customFontsCache.push(added);
    } catch (err) {
      showUserError(`フォント「${file.name}」を読み込めませんでした。対応していない形式の可能性があります。`);
    }
  }
  renderPropertiesPanel(canvasManager.getSelectedObjects());
}

function buildShapeFields(obj, disabled) {
  const fragment = document.createElement("div");
  fragment.className = "property-group";
  fragment.appendChild(
    liveColorField(obj.gradientEnabled ? "塗り色1" : "塗り色", obj.fill, (v) => liveUpdate(obj, { fill: v }), disabled)
  );
  fragment.appendChild(
    checkboxField("グラデーションにする", obj.gradientEnabled, (v) => {
      commitUpdate(obj, { gradientEnabled: v });
      renderPropertiesPanel(canvasManager.getSelectedObjects());
    }, disabled)
  );
  if (obj.gradientEnabled) {
    fragment.appendChild(
      liveColorField("塗り色2", obj.gradientColor2, (v) => liveUpdate(obj, { gradientColor2: v }), disabled)
    );
    fragment.appendChild(
      liveRangeField("角度", obj.gradientAngle || 0, 0, 360, 1, (v) => liveUpdate(obj, { gradientAngle: v }), disabled)
    );
  }
  fragment.appendChild(
    liveRangeField("塗りの不透明度", obj.fillOpacity ?? 1, 0, 1, 0.01, (v) => liveUpdate(obj, { fillOpacity: v }), disabled)
  );
  fragment.appendChild(
    numberField("線幅", obj.strokeWidth || 0, (v) => commitUpdate(obj, { strokeWidth: Math.max(0, v) }), disabled)
  );
  fragment.appendChild(
    liveColorField("線色", normalizeColor(obj.stroke), (v) => liveUpdate(obj, { stroke: v }), disabled)
  );
  fragment.appendChild(
    liveRangeField("線の不透明度", obj.strokeOpacity ?? 1, 0, 1, 0.01, (v) => liveUpdate(obj, { strokeOpacity: v }), disabled)
  );
  if (obj.type === "rectangle") {
    fragment.appendChild(
      numberField("角丸", obj.cornerRadius || 0, (v) => commitUpdate(obj, { cornerRadius: Math.max(0, v) }), disabled)
    );
  }
  if (obj.type === "shape") {
    fragment.appendChild(buildFlipFields(obj, disabled));
  }
  return fragment;
}

/** 線・線矢印・折線矢印・Uターン矢印: 塗り/グラデーションではなく「線の色」中心のシンプルなUI */
function buildLineFields(obj, disabled) {
  const fragment = document.createElement("div");
  fragment.className = "property-group";
  fragment.appendChild(liveColorField("線の色", obj.fill, (v) => liveUpdate(obj, { fill: v }), disabled));
  fragment.appendChild(
    numberField("太さ", obj.strokeWidth ?? 4, (v) => commitUpdate(obj, { strokeWidth: Math.max(1, v) }), disabled)
  );
  fragment.appendChild(checkboxField("破線にする", !!obj.dashed, (v) => commitUpdate(obj, { dashed: v }), disabled));
  if (obj.shapeKind === "lineArrow") {
    fragment.appendChild(checkboxField("始点に矢印", !!obj.arrowStart, (v) => commitUpdate(obj, { arrowStart: v }), disabled));
    fragment.appendChild(
      checkboxField("終点に矢印", obj.arrowEnd !== false, (v) => commitUpdate(obj, { arrowEnd: v }), disabled)
    );
  }
  fragment.appendChild(buildFlipFields(obj, disabled));
  return fragment;
}

/** 左右反転・上下反転(矢印や三角形など向きのある図形で使う) */
function buildFlipFields(obj, disabled) {
  const wrap = document.createElement("div");
  wrap.className = "property-subgroup";
  wrap.appendChild(subTitle("反転"));
  wrap.appendChild(checkboxField("左右反転", !!obj.flipX, (v) => commitUpdate(obj, { flipX: v }), disabled));
  wrap.appendChild(checkboxField("上下反転", !!obj.flipY, (v) => commitUpdate(obj, { flipY: v }), disabled));
  return wrap;
}

/** 図形の種類ごとに固有のパラメータ(星の頂点数、台形の上辺幅など)を編集するUI */
function buildShapeKindExtras(obj, disabled) {
  const fragment = document.createElement("div");
  fragment.className = "property-subgroup";

  switch (obj.shapeKind) {
    case "arrow":
      fragment.appendChild(subTitle("矢印の形"));
      fragment.appendChild(
        liveRangeField("先端の大きさ", obj.headSizeRatio ?? 0.4, 0.1, 0.9, 0.01, (v) => liveUpdate(obj, { headSizeRatio: v }), disabled)
      );
      fragment.appendChild(
        liveRangeField("軸の太さ", obj.stemWidthRatio ?? 0.5, 0.1, 1, 0.01, (v) => liveUpdate(obj, { stemWidthRatio: v }), disabled)
      );
      break;
    case "star":
      fragment.appendChild(subTitle("星の形"));
      fragment.appendChild(
        numberField("頂点の数", obj.points ?? 5, (v) => commitUpdate(obj, { points: Math.max(3, Math.round(v)) }), disabled)
      );
      fragment.appendChild(
        liveRangeField("とがり具合", obj.innerRatio ?? 0.5, 0.1, 0.9, 0.01, (v) => liveUpdate(obj, { innerRatio: v }), disabled)
      );
      break;
    case "polygon":
      fragment.appendChild(subTitle("多角形の形"));
      fragment.appendChild(
        numberField("角の数", obj.sides ?? 6, (v) => commitUpdate(obj, { sides: Math.max(3, Math.round(v)) }), disabled)
      );
      break;
    case "trapezoid":
      fragment.appendChild(subTitle("台形の形"));
      fragment.appendChild(
        liveRangeField("上辺の幅", obj.topWidthRatio ?? 0.6, 0.05, 1, 0.01, (v) => liveUpdate(obj, { topWidthRatio: v }), disabled)
      );
      break;
    case "partialCircle":
      fragment.appendChild(subTitle("部分円の形"));
      fragment.appendChild(numberField("開始角度", obj.startAngle ?? 0, (v) => commitUpdate(obj, { startAngle: v }), disabled));
      fragment.appendChild(numberField("終了角度", obj.endAngle ?? 270, (v) => commitUpdate(obj, { endAngle: v }), disabled));
      break;
    case "cross":
      fragment.appendChild(subTitle("十字の形"));
      fragment.appendChild(
        liveRangeField("太さ", obj.thicknessRatio ?? 0.35, 0.1, 0.9, 0.01, (v) => liveUpdate(obj, { thicknessRatio: v }), disabled)
      );
      break;
    case "sticky": {
      fragment.appendChild(subTitle("付箋の形"));
      const select = document.createElement("select");
      select.disabled = disabled;
      [
        ["bottomRight", "右下折り"],
        ["bottomLeft", "左下折り"],
      ].forEach(([val, label]) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = label;
        if ((obj.foldCorner || "bottomRight") === val) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener("change", () => commitUpdate(obj, { foldCorner: select.value }));
      fragment.appendChild(labeled("折る角", select));
      fragment.appendChild(
        numberField("折り返しの大きさ", obj.foldSize ?? 24, (v) => commitUpdate(obj, { foldSize: Math.max(4, v) }), disabled)
      );
      break;
    }
    case "speechRect":
    case "speechRoundRect":
    case "speechOval":
      fragment.appendChild(subTitle("しっぽの形"));
      fragment.appendChild(
        liveRangeField("しっぽの位置", obj.tailPos ?? 0.25, 0, 1, 0.01, (v) => liveUpdate(obj, { tailPos: v }), disabled)
      );
      fragment.appendChild(
        numberField("しっぽの大きさ", obj.tailSize ?? 30, (v) => commitUpdate(obj, { tailSize: Math.max(4, v) }), disabled)
      );
      if (obj.shapeKind === "speechRoundRect") {
        fragment.appendChild(
          numberField("角の丸み", obj.cornerRadius ?? 16, (v) => commitUpdate(obj, { cornerRadius: Math.max(0, v) }), disabled)
        );
      }
      break;
    default:
      break;
  }

  // 直線の辺を持つ図形は、角を丸めるオプションを共通で出す(四角形以外の図形向け)
  const CORNER_ROUNDABLE_KINDS = new Set(["arrow", "star", "polygon", "sticky", "triangleRight", "trapezoid", "cross"]);
  if (CORNER_ROUNDABLE_KINDS.has(obj.shapeKind)) {
    fragment.appendChild(
      numberField("角の丸み", obj.cornerRadius || 0, (v) => commitUpdate(obj, { cornerRadius: Math.max(0, v) }), disabled)
    );
  }

  return fragment;
}

function buildFilterFields(obj, disabled) {
  const fragment = document.createElement("div");
  fragment.className = "property-group";
  fragment.appendChild(subTitle("フィルター"));

  const filters = obj.filters || defaultFilters();

  fragment.appendChild(
    liveRangeField("明るさ", filters.brightness, 0, 200, 1, (v) =>
      liveUpdate(obj, { filters: { ...obj.filters, brightness: v } })
    , disabled)
  );
  fragment.appendChild(
    liveRangeField("コントラスト", filters.contrast, 0, 200, 1, (v) =>
      liveUpdate(obj, { filters: { ...obj.filters, contrast: v } })
    , disabled)
  );
  fragment.appendChild(
    liveRangeField("彩度", filters.saturate, 0, 200, 1, (v) =>
      liveUpdate(obj, { filters: { ...obj.filters, saturate: v } })
    , disabled)
  );
  fragment.appendChild(
    liveRangeField("ぼかし", filters.blur, 0, 20, 0.5, (v) =>
      liveUpdate(obj, { filters: { ...obj.filters, blur: v } })
    , disabled)
  );
  fragment.appendChild(
    checkboxField("モノクロ", filters.grayscale, (v) => commitUpdate(obj, { filters: { ...obj.filters, grayscale: v } }), disabled)
  );
  fragment.appendChild(
    checkboxField("セピア", filters.sepia, (v) => commitUpdate(obj, { filters: { ...obj.filters, sepia: v } }), disabled)
  );

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "property-action-btn";
  resetBtn.textContent = "Reset";
  resetBtn.disabled = disabled;
  resetBtn.addEventListener("click", () => {
    commitUpdate(obj, { filters: defaultFilters() });
    renderPropertiesPanel(canvasManager.getSelectedObjects());
  });
  fragment.appendChild(resetBtn);

  return fragment;
}

/** テーブル(表)のプロパティUI: 行数/列数、見出し行、罫線・配色、各セルの内容編集 */
let tableCellSelection = { objectId: null, row: 0, col: 0 };

/** 選択中テーブルの「今編集対象にしているセル」を返す。別のテーブルに切り替わったらリセットする */
function getSelectedTableCell(obj) {
  if (tableCellSelection.objectId !== obj.id) {
    tableCellSelection = { objectId: obj.id, row: 0, col: 0 };
  }
  tableCellSelection.row = Math.min(tableCellSelection.row, obj.rows - 1);
  tableCellSelection.col = Math.min(tableCellSelection.col, obj.cols - 1);
  return tableCellSelection;
}

/** obj.cellStyles[r][c] にpatchをマージして反映する */
function updateCellStyle(obj, r, c, patch) {
  const newStyles = obj.cellStyles.map((row) => row.map((s) => ({ ...s })));
  newStyles[r][c] = { ...newStyles[r][c], ...patch };
  commitUpdate(obj, { cellStyles: newStyles });
}

function buildTableFields(obj, disabled) {
  const fragment = document.createElement("div");
  fragment.className = "property-group";

  fragment.appendChild(
    numberField("行数", obj.rows, (v) => {
      const newRows = Math.max(1, Math.min(20, Math.round(v)));
      const newTexts = resizeTableGrid(obj.cellTexts, newRows, obj.cols, () => "");
      const newStyles = resizeTableGrid(obj.cellStyles, newRows, obj.cols, createEmptyCellStyle);
      commitUpdate(obj, { rows: newRows, cellTexts: newTexts, cellStyles: newStyles });
      renderPropertiesPanel(canvasManager.getSelectedObjects());
    }, disabled)
  );
  fragment.appendChild(
    numberField("列数", obj.cols, (v) => {
      const newCols = Math.max(1, Math.min(10, Math.round(v)));
      const newTexts = resizeTableGrid(obj.cellTexts, obj.rows, newCols, () => "");
      const newStyles = resizeTableGrid(obj.cellStyles, obj.rows, newCols, createEmptyCellStyle);
      commitUpdate(obj, { cols: newCols, cellTexts: newTexts, cellStyles: newStyles });
      renderPropertiesPanel(canvasManager.getSelectedObjects());
    }, disabled)
  );
  fragment.appendChild(
    checkboxField("見出し行にする", obj.headerRow, (v) => {
      commitUpdate(obj, { headerRow: v });
      renderPropertiesPanel(canvasManager.getSelectedObjects());
    }, disabled)
  );
  fragment.appendChild(
    checkboxField("背景を透過する", !!obj.transparentBg, (v) => commitUpdate(obj, { transparentBg: v }), disabled)
  );

  fragment.appendChild(buildFontSelector(obj, disabled));
  fragment.appendChild(numberField("文字サイズ", obj.fontSize, (v) => commitUpdate(obj, { fontSize: v }), disabled));
  fragment.appendChild(buildAlignSelect("既定の文字揃え", obj.cellAlign || "center", (v) => commitUpdate(obj, { cellAlign: v }), disabled));

  const borderGroup = document.createElement("div");
  borderGroup.className = "property-subgroup";
  borderGroup.appendChild(subTitle("罫線"));
  borderGroup.appendChild(
    numberField("太さ", obj.borderWidth, (v) => commitUpdate(obj, { borderWidth: Math.max(0, v) }), disabled)
  );
  borderGroup.appendChild(liveColorField("色", obj.borderColor, (v) => liveUpdate(obj, { borderColor: v }), disabled));
  fragment.appendChild(borderGroup);

  const colorGroup = document.createElement("div");
  colorGroup.className = "property-subgroup";
  colorGroup.appendChild(subTitle("既定の配色"));
  if (obj.headerRow) {
    colorGroup.appendChild(
      liveColorField("見出し背景", obj.headerBgColor, (v) => liveUpdate(obj, { headerBgColor: v }), disabled)
    );
    colorGroup.appendChild(
      liveColorField("見出し文字", obj.headerTextColor, (v) => liveUpdate(obj, { headerTextColor: v }), disabled)
    );
  }
  colorGroup.appendChild(liveColorField("セル背景", obj.cellBgColor, (v) => liveUpdate(obj, { cellBgColor: v }), disabled));
  colorGroup.appendChild(liveColorField("文字色", obj.cellTextColor, (v) => liveUpdate(obj, { cellTextColor: v }), disabled));
  fragment.appendChild(colorGroup);

  // --- セルごとの内容・スタイル編集 ---
  const sel = getSelectedTableCell(obj);
  const cellsGroup = document.createElement("div");
  cellsGroup.className = "property-subgroup";
  cellsGroup.appendChild(subTitle("セルの内容・スタイル"));

  const miniGrid = document.createElement("div");
  miniGrid.className = "table-minigrid";
  miniGrid.style.gridTemplateColumns = `repeat(${obj.cols}, 1fr)`;
  for (let r = 0; r < obj.rows; r++) {
    for (let c = 0; c < obj.cols; c++) {
      const cellBtn = document.createElement("button");
      cellBtn.type = "button";
      cellBtn.className = "table-minigrid-cell";
      if (r === sel.row && c === sel.col) cellBtn.classList.add("table-minigrid-cell--active");
      cellBtn.title = `${r + 1}行${c + 1}列目`;
      cellBtn.textContent = (obj.cellTexts[r] && obj.cellTexts[r][c]) ? "●" : "";
      cellBtn.disabled = disabled;
      cellBtn.addEventListener("click", () => {
        tableCellSelection.row = r;
        tableCellSelection.col = c;
        renderPropertiesPanel(canvasManager.getSelectedObjects());
      });
      miniGrid.appendChild(cellBtn);
    }
  }
  cellsGroup.appendChild(miniGrid);

  const selectedNote = document.createElement("p");
  selectedNote.className = "table-selected-note";
  selectedNote.textContent = `選択中: ${sel.row + 1}行 ${sel.col + 1}列目`;
  cellsGroup.appendChild(selectedNote);

  const cellTextInput = document.createElement("input");
  cellTextInput.type = "text";
  cellTextInput.className = "table-cell-input";
  cellTextInput.disabled = disabled;
  cellTextInput.value = (obj.cellTexts[sel.row] && obj.cellTexts[sel.row][sel.col]) || "";
  cellTextInput.addEventListener("change", () => {
    const newTexts = obj.cellTexts.map((row) => [...row]);
    newTexts[sel.row][sel.col] = cellTextInput.value;
    commitUpdate(obj, { cellTexts: newTexts });
  });
  cellsGroup.appendChild(labeled("内容", cellTextInput));

  const cellStyle = (obj.cellStyles[sel.row] && obj.cellStyles[sel.row][sel.col]) || {};
  cellsGroup.appendChild(
    liveColorField(
      "このセルの背景",
      cellStyle.bg || obj.cellBgColor,
      (v) => updateCellStyle(obj, sel.row, sel.col, { bg: v }),
      disabled
    )
  );
  cellsGroup.appendChild(
    liveColorField(
      "このセルの文字色",
      cellStyle.color || obj.cellTextColor,
      (v) => updateCellStyle(obj, sel.row, sel.col, { color: v }),
      disabled
    )
  );
  cellsGroup.appendChild(
    buildAlignSelect(
      "このセルの揃え",
      cellStyle.align || "",
      (v) => updateCellStyle(obj, sel.row, sel.col, { align: v || null }),
      disabled,
      true
    )
  );

  const resetCellBtn = document.createElement("button");
  resetCellBtn.type = "button";
  resetCellBtn.className = "property-action-btn";
  resetCellBtn.textContent = "このセルのスタイルをリセット";
  resetCellBtn.disabled = disabled;
  resetCellBtn.addEventListener("click", () => {
    updateCellStyle(obj, sel.row, sel.col, { bg: null, color: null, align: null });
    renderPropertiesPanel(canvasManager.getSelectedObjects());
  });
  cellsGroup.appendChild(resetCellBtn);

  fragment.appendChild(cellsGroup);

  return fragment;
}

/** 左揃え/中央揃え/右揃えの<select>を作る。allowInheritがtrueの場合「(既定を使う)」の空選択肢を先頭に追加する */
function buildAlignSelect(labelText, value, onChange, disabled, allowInherit = false) {
  const select = document.createElement("select");
  select.disabled = disabled;
  const options = [];
  if (allowInherit) options.push(["", "(既定を使う)"]);
  options.push(["left", "左揃え"], ["center", "中央揃え"], ["right", "右揃え"]);
  options.forEach(([val, text]) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = text;
    if (value === val) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("change", () => onChange(select.value));
  return labeled(labelText, select);
}

/** 履歴に積まず即座に反映する(スライダー等の連続操作の途中経過用) */
function liveUpdate(obj, patch) {
  canvasManager.updateObject(obj.id, patch);
}

/** 履歴に1件積んでから反映する(単発の確定操作用) */
function commitUpdate(obj, patch) {
  canvasManager.commitObject(obj.id, patch);
}

function normalizeColor(color) {
  if (!color || color === "#00000000") return "#000000";
  return color;
}

// --- 入力フィールド生成ヘルパー ---

function subTitle(text) {
  const el = document.createElement("div");
  el.className = "property-subtitle";
  el.textContent = text;
  return el;
}

function labeled(labelText, inputEl) {
  const wrap = document.createElement("label");
  wrap.className = "property-row";
  const span = document.createElement("span");
  span.textContent = labelText;
  wrap.append(span, inputEl);
  return wrap;
}

function numberField(labelText, value, onChange, disabled = false) {
  const input = document.createElement("input");
  input.type = "number";
  input.value = Math.round(value * 100) / 100;
  input.disabled = disabled;
  input.addEventListener("change", () => onChange(parseFloat(input.value) || 0));
  return labeled(labelText, input);
}

/** 履歴を1ジェスチャー1件にまとめるスライダー */
function liveRangeField(labelText, value, min, max, step, onLive, disabled = false) {
  const input = document.createElement("input");
  input.type = "range";
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  input.disabled = disabled;
  bindLiveThenCommit(input, "input", () => onLive(parseFloat(input.value)));
  return labeled(labelText, input);
}

/** 履歴を1ジェスチャー1件にまとめるカラーピッカー */
function liveColorField(labelText, value, onLive, disabled = false) {
  const input = document.createElement("input");
  input.type = "color";
  input.value = value && value.startsWith("#") && value.length === 7 ? value : "#000000";
  input.disabled = disabled;
  bindLiveThenCommit(input, "input", () => onLive(input.value));
  return labeled(labelText, input);
}

/**
 * 連続的に発火するイベント(input)の間は履歴に積まずライブ反映し、
 * ジェスチャー完了(change)時点でまとめて1件だけ履歴に積む。
 */
function bindLiveThenCommit(el, liveEventName, applyLive) {
  let beforeSnapshot = null;
  el.addEventListener(liveEventName, () => {
    if (!beforeSnapshot) beforeSnapshot = historyManager.snapshot();
    applyLive();
  });
  el.addEventListener("change", () => {
    if (beforeSnapshot) {
      historyManager.commitSnapshot(beforeSnapshot);
      beforeSnapshot = null;
    }
  });
}

function checkboxField(labelText, checked, onChange, disabled = false) {
  const wrap = document.createElement("label");
  wrap.className = "property-row property-row--checkbox";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener("change", () => onChange(input.checked));
  const span = document.createElement("span");
  span.textContent = labelText;
  wrap.append(input, span);
  return wrap;
}

// ---------------------------------------------------------------
// ズーム
// ---------------------------------------------------------------

function bindZoomControls() {
  document.getElementById("zoomInBtn").addEventListener("click", () => {
    canvasManager.setZoom(canvasManager.zoom + 25);
  });
  document.getElementById("zoomOutBtn").addEventListener("click", () => {
    canvasManager.setZoom(canvasManager.zoom - 25);
  });

  // ズーム倍率を直接入力できるようにする
  const zoomInput = document.getElementById("zoomLabel");
  zoomInput.addEventListener("change", () => {
    const value = parseFloat(zoomInput.value);
    canvasManager.setZoom(Number.isFinite(value) ? value : 100);
  });

  // Ctrl(Macは⌘)+ホイールでズーム
  const canvasArea = document.querySelector(".canvas-area");
  canvasArea.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const zoomStep = -e.deltaY * 0.4;
      canvasManager.setZoom(canvasManager.zoom + zoomStep);
    },
    { passive: false }
  );
}

// ---------------------------------------------------------------
// スナップ切り替え
// ---------------------------------------------------------------

function bindSnapToggle() {
  const checkbox = document.getElementById("snapToggle");
  checkbox.addEventListener("change", () => {
    canvasManager.snapEnabled = checkbox.checked;
  });
}

// ---------------------------------------------------------------
// レイヤーパネルの開閉
// ---------------------------------------------------------------

function bindLayersToggle() {
  const toggleBtn = document.getElementById("layersToggleBtn");
  const layersPanel = document.getElementById("layersPanel");
  const editorBody = document.querySelector(".editor-body");
  toggleBtn.addEventListener("click", () => {
    const collapsed = layersPanel.classList.toggle("collapsed");
    editorBody.classList.toggle("layers-collapsed", collapsed);
    toggleBtn.textContent = collapsed ? "▶" : "◀";
    toggleBtn.title = collapsed ? "レイヤーパネルを開く" : "レイヤーパネルを閉じる";
  });
}

const LAYERS_WIDTH_STORAGE_KEY = "imagemaker_layers_width";

/** レイヤーパネル右端のハンドルをドラッグして幅を調整できるようにする。幅はブラウザに記憶される */
function bindLayersResize() {
  const handle = document.getElementById("layersResizeHandle");
  const editorBody = document.querySelector(".editor-body");
  const MIN_WIDTH = 140;
  const MAX_WIDTH = 400;

  let savedWidth = null;
  try {
    savedWidth = window.localStorage.getItem(LAYERS_WIDTH_STORAGE_KEY);
  } catch (err) {
    // プライベートブラウジング等でlocalStorageが使えない場合は既定幅のまま
  }
  if (savedWidth) {
    editorBody.style.setProperty("--layers-width", `${savedWidth}px`);
  }

  let dragging = false;
  let leftPanelWidth = 0;
  let latestWidth = null;

  handle.addEventListener("mousedown", (e) => {
    dragging = true;
    leftPanelWidth = document.querySelector(".panel-left").getBoundingClientRect().width;
    handle.classList.add("dragging");
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    latestWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX - leftPanelWidth));
    editorBody.style.setProperty("--layers-width", `${latestWidth}px`);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    if (latestWidth) {
      try {
        window.localStorage.setItem(LAYERS_WIDTH_STORAGE_KEY, String(latestWidth));
      } catch (err) {
        // 保存できなくても致命的ではないため無視する
      }
    }
  });
}

// ---------------------------------------------------------------
// Undo / Redo
// ---------------------------------------------------------------

function bindHistoryControls() {
  document.getElementById("undoBtn").addEventListener("click", () => {
    historyManager.undo();
    renderPropertiesPanel(canvasManager.getSelectedObjects());
    layerPanel.render();
  });
  document.getElementById("redoBtn").addEventListener("click", () => {
    historyManager.redo();
    renderPropertiesPanel(canvasManager.getSelectedObjects());
    layerPanel.render();
  });
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  if (!undoBtn || !redoBtn) return;
  undoBtn.disabled = !historyManager.canUndo();
  redoBtn.disabled = !historyManager.canRedo();
}

// ---------------------------------------------------------------
// 書き出し
// ---------------------------------------------------------------

function bindExport() {
  document.getElementById("exportBtn").addEventListener("click", async () => {
    try {
      const rawName = document.getElementById("exportFilenameInput").value;
      const filename = `${sanitizeFilename(rawName, "imagemaker_output")}.png`;
      await exportToPNG(canvasManager, { filename });
    } catch (err) {
      showUserError("書き出しに失敗しました。もう一度お試しください。");
    }
  });
}

// ---------------------------------------------------------------
// プロジェクトの保存(JSON書き出し)・自動保存(IndexedDB)
// ---------------------------------------------------------------

function bindSaveProject() {
  document.getElementById("saveProjectBtn").addEventListener("click", () => {
    const filename = `${sanitizeFilename(currentProjectName, "imagemaker_project")}.json`;
    downloadProjectJson(canvasManager, currentProjectName, filename);
  });
}

// ---------------------------------------------------------------
// ホームへ戻る
// ---------------------------------------------------------------

function bindHomeButton() {
  document.getElementById("homeBtn").addEventListener("click", () => {
    const proceed = window.confirm("ホーム画面に戻りますか？(編集内容は自動保存されています)");
    if (!proceed) return;
    returnToHome();
  });
}

/** 編集画面ヘッダーのプロジェクト名入力欄。変更したら自動保存の対象名にも反映する */
function bindProjectNameHeaderInput() {
  const input = document.getElementById("projectNameHeaderInput");
  input.addEventListener("change", () => {
    currentProjectName = sanitizeProjectName(input.value);
    input.value = currentProjectName;
    scheduleAutosave();
  });
}

function returnToHome() {
  // 進行中の処理を止めておく
  stopApngPreview("object");
  stopApngPreview("images");
  document.getElementById("apngModal").classList.add("hidden");

  document.getElementById("editorScreen").classList.add("hidden");
  document.getElementById("startScreen").classList.remove("hidden");

  // 現在のプロジェクトの状態をリセット(次に「新しく作る」を押した時のため)
  currentProjectId = null;
  currentProjectName = "無題のプロジェクト";
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  // プロジェクトをまたいで残ってしまう一時状態をリセットする
  // (これを怠ると、前のプロジェクトのコピー内容やAPNG用に追加した画像が
  //  次に開いたプロジェクトの作業中に紛れ込んで見える不具合になる)
  clipboardObjects = [];
  apngImages = [];
  tableCellSelection = { objectId: null, row: 0, col: 0 };
  renderApngImageList();

  // 直前まで編集していたプロジェクトが「最近のプロジェクト」に反映されるよう再描画する
  renderRecentProjectsList();
}

// ---------------------------------------------------------------
// 使い方ガイド
// ---------------------------------------------------------------

function bindGuideModal() {
  const overlay = document.getElementById("guideModal");
  document.querySelectorAll(".guide-open-btn").forEach((btn) => {
    btn.addEventListener("click", () => overlay.classList.remove("hidden"));
  });
  document.getElementById("guideCloseBtn").addEventListener("click", () => overlay.classList.add("hidden"));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.add("hidden");
  });
}

/** 変更が起きるたびに呼び、少し待ってからまとめてIndexedDBへ自動保存する */
function scheduleAutosave() {
  if (!currentProjectId || !canvasManager) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  // タイマー発火時にグローバル変数を読み直すのではなく、予約した時点の値を確定させておく。
  // (万一その間に別のプロジェクトへ切り替わっても、誤ったプロジェクトIDに
  //  以前の内容を書き込んでしまうことがないようにするため)
  const scheduledProjectId = currentProjectId;
  const scheduledCanvasManager = canvasManager;
  const scheduledProjectName = currentProjectName;
  autosaveTimer = setTimeout(() => {
    performAutosave(scheduledProjectId, scheduledCanvasManager, scheduledProjectName);
  }, 1200);
}

async function performAutosave(projectId, targetCanvasManager, projectName) {
  if (!projectId || !targetCanvasManager) return;
  try {
    const data = serializeProject(targetCanvasManager, projectName);
    await saveProjectRecord(projectId, data);
    // 保存した内容が今まさに表示中のプロジェクトの場合のみ、フッターの表示を更新する
    if (projectId === currentProjectId) updateAutosaveIndicator();
  } catch (err) {
    // 自動保存に失敗しても致命的ではないため、静かに諦める(次の変更で再試行される)
  }
}

function updateAutosaveIndicator() {
  const el = document.getElementById("autosaveStatus");
  if (!el) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  el.textContent = `自動保存 ${hh}:${mm}`;
}

// ---------------------------------------------------------------
// キーボードショートカット
// ---------------------------------------------------------------

function bindKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    const activeTag = document.activeElement?.tagName;
    const isEditingField = activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT";

    const ctrlOrCmd = e.ctrlKey || e.metaKey;

    if (ctrlOrCmd && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      historyManager.undo();
      renderPropertiesPanel(canvasManager.getSelectedObjects());
      layerPanel.render();
      return;
    }
    if ((ctrlOrCmd && e.key.toLowerCase() === "y") || (ctrlOrCmd && e.shiftKey && e.key.toLowerCase() === "z")) {
      e.preventDefault();
      historyManager.redo();
      renderPropertiesPanel(canvasManager.getSelectedObjects());
      layerPanel.render();
      return;
    }

    if (isEditingField) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      if (canvasManager.selectedIds.length > 0) {
        e.preventDefault();
        canvasManager.deleteSelection();
      }
      return;
    }

    if (ctrlOrCmd && e.key.toLowerCase() === "d") {
      e.preventDefault();
      if (canvasManager.selectedIds.length > 0) canvasManager.duplicateSelection();
      return;
    }

    if (ctrlOrCmd && e.key.toLowerCase() === "c") {
      const selected = canvasManager.getSelectedObjects();
      if (selected.length > 0) {
        clipboardObjects = selected.map((o) => ({ ...o }));
      }
      return;
    }

    if (ctrlOrCmd && e.key.toLowerCase() === "v") {
      if (clipboardObjects.length > 0) {
        e.preventDefault();
        const pasted = clipboardObjects.map((o) => ({
          ...o,
          id: generateId("object"),
          x: o.x + 24,
          y: o.y + 24,
        }));
        canvasManager.addObjects(pasted);
      }
      return;
    }
  });
}

// ---------------------------------------------------------------
// APNGモーダル
// ---------------------------------------------------------------

function bindApngModal() {
  const overlay = document.getElementById("apngModal");

  // プリセット選択肢を組み立てる
  const presetSelect = document.getElementById("apngPresetSelect");
  ANIMATION_PRESETS.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.value;
    opt.textContent = p.label;
    presetSelect.appendChild(opt);
  });

  document.getElementById("apngOpenBtn").addEventListener("click", () => {
    overlay.classList.remove("hidden");
    updateApngObjectTargetNote();
    renderApngImageList(); // 現在のapngImagesの状態と表示を必ず同期させる
  });
  document.getElementById("apngCloseBtn").addEventListener("click", closeApngModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeApngModal();
  });

  document.getElementById("apngTabBtnObject").addEventListener("click", () => switchApngTab("object"));
  document.getElementById("apngTabBtnImages").addEventListener("click", () => switchApngTab("images"));

  // ループ種別(無限/回数)のラジオでカウント入力の有効/無効を切り替える
  bindLoopRadioGroup("apngObjLoopType", "apngObjLoopCount");
  bindLoopRadioGroup("apngImgLoopType", "apngImgLoopCount");

  document.getElementById("apngObjPreviewBtn").addEventListener("click", previewObjectApng);
  document.getElementById("apngObjStopBtn").addEventListener("click", () => stopApngPreview("object"));
  document.getElementById("apngObjGenerateBtn").addEventListener("click", generateObjectApng);

  bindApngImageTab();
}

function bindLoopRadioGroup(radioName, countInputId) {
  const countInput = document.getElementById(countInputId);
  document.querySelectorAll(`input[name="${radioName}"]`).forEach((radio) => {
    radio.addEventListener("change", (e) => {
      countInput.disabled = e.target.value !== "count";
    });
  });
}

function closeApngModal() {
  document.getElementById("apngModal").classList.add("hidden");
  stopApngPreview("object");
  stopApngPreview("images");
}

function switchApngTab(tab) {
  const isObject = tab === "object";
  document.getElementById("apngPanelObject").classList.toggle("hidden", !isObject);
  document.getElementById("apngPanelImages").classList.toggle("hidden", isObject);
  document.getElementById("apngTabBtnObject").classList.toggle("modal-tab-btn--active", isObject);
  document.getElementById("apngTabBtnImages").classList.toggle("modal-tab-btn--active", !isObject);
  stopApngPreview("object");
  stopApngPreview("images");
  if (isObject) updateApngObjectTargetNote();
}

function updateApngObjectTargetNote() {
  const note = document.getElementById("apngObjectTargetNote");
  const selection = canvasManager.getSelectedObjects();
  const controlsDisabled = selection.length !== 1;
  document
    .querySelectorAll("#apngPanelObject .apng-controls select, #apngPanelObject .apng-controls input, #apngObjPreviewBtn, #apngObjGenerateBtn")
    .forEach((el) => {
      el.disabled = controlsDisabled;
    });
  if (selection.length === 0) {
    note.textContent = "対象: キャンバス上でオブジェクトを1つ選択してください";
  } else if (selection.length > 1) {
    note.textContent = "対象: オブジェクトを1つだけ選択してください(現在複数選択中)";
  } else {
    const typeLabel = { image: "画像", text: "テキスト", rectangle: "四角形", circle: "円" }[selection[0].type] || selection[0].type;
    note.textContent = `対象: ${selection[0].name}(${typeLabel})`;
  }
}

/** 現在のオブジェクトタブの設定値を読み取る */
function readObjectApngSettings() {
  const preset = document.getElementById("apngPresetSelect").value;
  const speedCycles = parseInt(document.getElementById("apngSpeedSelect").value, 10);
  const strength = parseFloat(document.getElementById("apngStrengthRange").value);
  const lengthSeconds = parseFloat(document.getElementById("apngLengthRange").value);
  const loopType = document.querySelector('input[name="apngObjLoopType"]:checked').value;
  const loopCount = loopType === "infinite" ? 0 : Math.max(1, parseInt(document.getElementById("apngObjLoopCount").value, 10) || 1);
  return { preset, speedCycles, strength, lengthSeconds, loopCount };
}

/** 選択中オブジェクトをプリセットアニメーションさせた各フレームのCanvas配列を生成する */
function buildObjectAnimationFrames(settings) {
  const target = canvasManager.getSelectedObject();
  if (!target) return null;

  const frameCount = Math.max(8, Math.min(60, Math.round(settings.lengthSeconds * 15)));
  const delayMs = (settings.lengthSeconds * 1000) / frameCount;
  const canvases = [];
  const delaysMs = [];

  for (let i = 0; i < frameCount; i++) {
    const t = i / frameCount;
    const transform = computeAnimationTransform(settings.preset, t, settings.speedCycles, settings.strength);
    const patch = buildAnimatedPatch(target, transform);
    const frameObjects = canvasManager.objects.map((o) => (o.id === target.id ? { ...o, ...patch } : o));
    const frameCanvas = renderObjectsToCanvas(frameObjects, canvasManager.background, canvasManager.width, canvasManager.height);
    canvases.push(frameCanvas);
    delaysMs.push(delayMs);
  }

  return { canvases, delaysMs };
}

/** アニメーションの変形量(computeAnimationTransformの戻り値)をオブジェクトへのパッチに変換する */
function buildAnimatedPatch(obj, transform) {
  const patch = {};
  if ("opacity" in transform) {
    patch.opacity = (obj.opacity ?? 1) * transform.opacity;
  }
  if ("dyRatio" in transform) {
    patch.y = obj.y + transform.dyRatio * obj.height;
  }
  if ("dxRatio" in transform) {
    patch.x = obj.x + transform.dxRatio * obj.width;
  }
  if ("dxPx" in transform || "dyPx" in transform) {
    patch.x = (patch.x ?? obj.x) + (transform.dxPx || 0);
    patch.y = (patch.y ?? obj.y) + (transform.dyPx || 0);
  }
  if ("scale" in transform) {
    const newWidth = obj.width * transform.scale;
    const newHeight = obj.height * transform.scale;
    patch.x = (patch.x ?? obj.x) - (newWidth - obj.width) / 2;
    patch.y = (patch.y ?? obj.y) - (newHeight - obj.height) / 2;
    patch.width = newWidth;
    patch.height = newHeight;
  }
  if ("rotationDeg" in transform) {
    patch.rotation = (obj.rotation || 0) + transform.rotationDeg;
  }
  return patch;
}

function previewObjectApng() {
  const settings = readObjectApngSettings();
  const result = buildObjectAnimationFrames(settings);
  if (!result) {
    showUserError("先にオブジェクトを1つ選択してください。");
    return;
  }
  playApngPreview("object", result.canvases, result.delaysMs, document.getElementById("apngObjectPreviewCanvas"));
}

async function generateObjectApng() {
  const settings = readObjectApngSettings();
  const result = buildObjectAnimationFrames(settings);
  if (!result) {
    showUserError("先にオブジェクトを1つ選択してください。");
    return;
  }
  try {
    const frameBlobs = await Promise.all(
      result.canvases.map((c) => new Promise((resolve) => c.toBlob(resolve, "image/png")))
    );
    const blob = await encodeAPNG({ frameBlobs, delaysMs: result.delaysMs, loopCount: settings.loopCount });
    const rawName = document.getElementById("apngObjFilenameInput").value;
    const filename = `${sanitizeFilename(rawName, "imagemaker_animation")}.png`;
    downloadBlob(blob, filename);
  } catch (err) {
    showUserError("APNGの生成に失敗しました。もう一度お試しください。");
  }
}

// --- 複数画像から作るタブ ---

function bindApngImageTab() {
  const fileInput = document.getElementById("apngImagesFileInput");
  document.getElementById("apngAddImagesBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (e) => {
    const files = [...e.target.files];
    fileInput.value = "";
    for (const file of files) {
      try {
        const img = await loadImageFromFile(file);
        apngImages.push({ id: generateId("apngimg"), img, name: file.name });
      } catch (err) {
        showUserError("画像を読み込めませんでした。対応していない形式か、ファイルが破損している可能性があります。");
      }
    }
    renderApngImageList();
  });

  document.getElementById("apngImgPreviewBtn").addEventListener("click", previewImagesApng);
  document.getElementById("apngImgStopBtn").addEventListener("click", () => stopApngPreview("images"));
  document.getElementById("apngImgGenerateBtn").addEventListener("click", generateImagesApng);

  renderApngImageList();
}

function renderApngImageList() {
  const list = document.getElementById("apngImageList");
  list.innerHTML = "";

  if (apngImages.length === 0) {
    const empty = document.createElement("li");
    empty.className = "apng-empty-note";
    empty.textContent = "画像が追加されていません";
    list.appendChild(empty);
    return;
  }

  let draggingId = null;

  apngImages.forEach((item) => {
    const li = document.createElement("li");
    li.className = "apng-image-item";
    li.draggable = true;
    li.dataset.id = item.id;

    const thumb = document.createElement("img");
    thumb.className = "apng-image-thumb";
    thumb.src = item.img.src;
    thumb.alt = item.name;

    const name = document.createElement("span");
    name.className = "apng-image-name";
    name.textContent = item.name;

    const removeBtn = document.createElement("button");
    removeBtn.className = "apng-image-remove";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      apngImages = apngImages.filter((i) => i.id !== item.id);
      renderApngImageList();
    });

    li.append(thumb, name, removeBtn);

    li.addEventListener("dragstart", () => {
      draggingId = item.id;
      li.classList.add("apng-image-item--dragging");
    });
    li.addEventListener("dragend", () => li.classList.remove("apng-image-item--dragging"));
    li.addEventListener("dragover", (e) => e.preventDefault());
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!draggingId || draggingId === item.id) return;
      const fromIdx = apngImages.findIndex((i) => i.id === draggingId);
      const toIdx = apngImages.findIndex((i) => i.id === item.id);
      const [moved] = apngImages.splice(fromIdx, 1);
      apngImages.splice(toIdx, 0, moved);
      renderApngImageList();
    });

    list.appendChild(li);
  });
}

function readImagesApngSettings() {
  const intervalMs = Math.max(10, parseInt(document.getElementById("apngIntervalInput").value, 10) || 100);
  const loopType = document.querySelector('input[name="apngImgLoopType"]:checked').value;
  const loopCount = loopType === "infinite" ? 0 : Math.max(1, parseInt(document.getElementById("apngImgLoopCount").value, 10) || 1);
  return { intervalMs, loopCount };
}

function buildImagesAnimationFrames(settings) {
  if (apngImages.length === 0) return null;
  const canvases = apngImages.map((item) =>
    buildImageFrameCanvas(item.img, canvasManager.background, canvasManager.width, canvasManager.height)
  );
  const delaysMs = apngImages.map(() => settings.intervalMs);
  return { canvases, delaysMs };
}

/** 1枚の画像をプロジェクトのキャンバスサイズに収めて描画したCanvasを作る(アスペクト比維持・中央配置) */
function buildImageFrameCanvas(img, background, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (background && background.type === "color") {
    ctx.fillStyle = background.color || "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  const ratio = Math.min(width / img.width, height / img.height, 1);
  const w = img.width * ratio;
  const h = img.height * ratio;
  ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
  return canvas;
}

function previewImagesApng() {
  const settings = readImagesApngSettings();
  const result = buildImagesAnimationFrames(settings);
  if (!result) {
    showUserError("先に画像を追加してください。");
    return;
  }
  playApngPreview("images", result.canvases, result.delaysMs, document.getElementById("apngImagesPreviewCanvas"));
}

async function generateImagesApng() {
  const settings = readImagesApngSettings();
  const result = buildImagesAnimationFrames(settings);
  if (!result) {
    showUserError("先に画像を追加してください。");
    return;
  }
  try {
    const frameBlobs = await Promise.all(
      result.canvases.map((c) => new Promise((resolve) => c.toBlob(resolve, "image/png")))
    );
    const blob = await encodeAPNG({ frameBlobs, delaysMs: result.delaysMs, loopCount: settings.loopCount });
    const rawName = document.getElementById("apngImgFilenameInput").value;
    const filename = `${sanitizeFilename(rawName, "imagemaker_apng")}.png`;
    downloadBlob(blob, filename);
  } catch (err) {
    showUserError("APNGの生成に失敗しました。もう一度お試しください。");
  }
}

// --- プレビュー共通処理 ---

function playApngPreview(key, canvases, delaysMs, previewCanvasEl) {
  stopApngPreview(key);
  if (!canvases || canvases.length === 0) return;

  previewCanvasEl.width = canvases[0].width;
  previewCanvasEl.height = canvases[0].height;
  const ctx = previewCanvasEl.getContext("2d");

  let idx = 0;
  function drawNext() {
    ctx.clearRect(0, 0, previewCanvasEl.width, previewCanvasEl.height);
    ctx.drawImage(canvases[idx], 0, 0);
    const delay = delaysMs[idx];
    idx = (idx + 1) % canvases.length;
    previewTimers[key] = setTimeout(drawNext, delay);
  }
  drawNext();
}

function stopApngPreview(key) {
  if (previewTimers[key]) {
    clearTimeout(previewTimers[key]);
    previewTimers[key] = null;
  }
}

})(window.IM);
