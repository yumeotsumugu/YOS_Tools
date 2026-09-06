// layers.js
// 右側のレイヤーパネルの描画と、ドラッグ&ドロップによる並び替えを担当する。

window.IM = window.IM || {};

(function (IM) {
  "use strict";

  const TYPE_ICONS = {
    image: "🖼",
    text: "T",
    rectangle: "▭",
    circle: "◯",
    table: "⊞",
  };

  // type:"shape" のオブジェクトは shapeKind ごとにアイコンを出し分ける
  const SHAPE_ICONS = {};
  Object.keys(IM.SHAPE_KIND_DEFS || {}).forEach((kind) => {
    SHAPE_ICONS[kind] = IM.SHAPE_KIND_DEFS[kind].icon;
  });

  function iconFor(obj) {
    if (obj.type === "shape") return SHAPE_ICONS[obj.shapeKind] || "▦";
    return TYPE_ICONS[obj.type] || "";
  }

  class LayerPanel {
  /**
   * @param {HTMLElement} containerEl レイヤー一覧を描画するul要素
   * @param {import("./canvas.js").CanvasManager} canvasManager
   */
  constructor(containerEl, canvasManager) {
    this.containerEl = containerEl;
    this.canvasManager = canvasManager;
    this.draggingId = null;

    canvasManager.onObjectsChange = () => this.render();
    canvasManager.onSelectionChange = () => this.render();
  }

  render() {
    const objects = this.canvasManager.objects;
    this.containerEl.innerHTML = "";

    if (objects.length === 0) {
      const empty = document.createElement("li");
      empty.className = "layer-empty";
      empty.textContent = "レイヤーはまだありません";
      this.containerEl.appendChild(empty);
      return;
    }

    // 配列の末尾(最前面)を一番上に表示する
    const reversed = [...objects].reverse();

    for (const obj of reversed) {
      this.containerEl.appendChild(this._createLayerItem(obj));
    }
  }

  _createLayerItem(obj) {
    const li = document.createElement("li");
    li.className = "layer-item";
    li.draggable = true;
    li.dataset.id = obj.id;
    if (this.canvasManager.isSelected(obj.id)) {
      li.classList.add("layer-item--selected");
    }

    const visBtn = document.createElement("button");
    visBtn.className = "layer-icon-btn";
    visBtn.title = "表示 / 非表示";
    visBtn.textContent = obj.visible ? "👁" : "🚫";
    visBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      obj.visible = !obj.visible;
      this.canvasManager.render();
      this.render();
    });

    const lockBtn = document.createElement("button");
    lockBtn.className = "layer-icon-btn";
    lockBtn.title = "ロック / ロック解除";
    lockBtn.textContent = obj.locked ? "🔒" : "🔓";
    lockBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      obj.locked = !obj.locked;
      this.render();
    });

    const label = document.createElement("span");
    label.className = "layer-label";
    label.textContent = `${iconFor(obj)} ${obj.name}`;

    const dupBtn = document.createElement("button");
    dupBtn.className = "layer-icon-btn";
    dupBtn.title = "複製 (Ctrl+D)";
    dupBtn.textContent = "⧉";
    dupBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.canvasManager.duplicateObject(obj.id);
    });

    const delBtn = document.createElement("button");
    delBtn.className = "layer-icon-btn layer-delete";
    delBtn.title = "削除";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.canvasManager.deleteObject(obj.id);
    });

    li.append(visBtn, lockBtn, label, dupBtn, delBtn);

    li.addEventListener("click", (e) => {
      this.canvasManager.selectObject(obj.id, { additive: e.shiftKey });
    });

    li.addEventListener("dragstart", () => {
      this.draggingId = obj.id;
      li.classList.add("layer-item--dragging");
    });
    li.addEventListener("dragend", () => {
      li.classList.remove("layer-item--dragging");
      this.draggingId = null;
    });
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!this.draggingId || this.draggingId === obj.id) return;
      this._reorderByDrop(this.draggingId, obj.id);
    });

    return li;
  }

  /** draggedId のレイヤーを targetId の直前(表示上)に移動する */
  _reorderByDrop(draggedId, targetId) {
    // 表示順(前面が上)のIDリストを作り、並べ替えてから内部配列(背面が先頭)へ戻す
    const displayOrder = [...this.canvasManager.objects].reverse().map((o) => o.id);
    const from = displayOrder.indexOf(draggedId);
    const to = displayOrder.indexOf(targetId);
    if (from === -1 || to === -1) return;

    displayOrder.splice(from, 1);
    displayOrder.splice(to, 0, draggedId);

    const newInternalOrder = [...displayOrder].reverse();
    this.canvasManager.reorderObjects(newInternalOrder);
    this.render();
  }
  }

  Object.assign(IM, { LayerPanel });
})(window.IM);
