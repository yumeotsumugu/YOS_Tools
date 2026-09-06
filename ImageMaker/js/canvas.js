// canvas.js
// Canvasへの描画、オブジェクトの選択・移動・拡大縮小・回転などの
// ポインター操作を一括して管理するクラス。

window.IM = window.IM || {};

(function (IM) {
  "use strict";

  const { degToRad, radToDeg, clamp, generateId } = IM;
  const { getObjectCorners, isPointInObject, getObjectCenter, createFreehandObject } = IM;

  const HANDLE_SCREEN_SIZE = 10; // 画面上での見た目のハンドルサイズ(px)
  const ROTATE_HANDLE_OFFSET = 28; // 上辺から回転ハンドルまでの距離(画面px換算前のcanvas px基準)
  const MIN_SIZE = 10; // オブジェクトの最小幅・高さ
  const SNAP_THRESHOLD_SCREEN_PX = 8; // スナップが効く距離(画面px換算)

  class CanvasManager {
  /**
   * @param {HTMLCanvasElement} canvasEl
   * @param {{width:number, height:number, background:{type:string,color?:string}}} projectConfig
   */
  constructor(canvasEl, projectConfig) {
    this.canvasEl = canvasEl;
    this.ctx = canvasEl.getContext("2d");
    this.width = projectConfig.width;
    this.height = projectConfig.height;
    this.background = projectConfig.background || { type: "transparent" };

    this.objects = []; // 配列の末尾ほど手前(最前面)
    this.selectedIds = []; // 選択中オブジェクトのID配列(複数選択対応)
    this.zoom = 100; // パーセント

    this.canvasEl.width = this.width;
    this.canvasEl.height = this.height;
    this.applyZoom();

    this.dragState = null; // { mode, ... }
    this.onSelectionChange = null; // callback
    this.onObjectsChange = null; // callback (レイヤー並び替え等の反映用)

    this.history = null; // app.js から HistoryManager を差し込む
    this.snapEnabled = true;
    this.activeGuides = null; // 移動中のスナップガイド線(描画用)
    this.onDragEnd = null; // ドラッグ操作(移動/拡縮/回転)完了時のコールバック(自動保存トリガー等に使用)

    // ペンツール(フリーハンド描画)関連
    this.penMode = false;
    this.penStrokeColor = "#1a1a1a";
    this.penStrokeWidth = 4;
    this.penDashed = false;

    this._bindPointerEvents();
  }

  // ---------------------------------------------------------------
  // 座標変換・ズーム
  // ---------------------------------------------------------------

  applyZoom() {
    const scale = this.zoom / 100;
    this.canvasEl.style.width = `${this.width * scale}px`;
    this.canvasEl.style.height = `${this.height * scale}px`;
  }

  setZoom(percent) {
    this.zoom = clamp(percent, 5, 1000);
    this.applyZoom();
    const zoomLabel = document.getElementById("zoomLabel");
    if (zoomLabel) zoomLabel.value = Math.round(this.zoom);
  }

  /** クライアント座標(マウス座標)をcanvas内部座標に変換する */
  clientToCanvas(clientX, clientY) {
    const rect = this.canvasEl.getBoundingClientRect();
    const scaleX = this.canvasEl.width / rect.width;
    const scaleY = this.canvasEl.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  /** 現在のズーム率でのcanvas1pxあたりの画面px数 */
  get screenPxPerCanvasPx() {
    return this.zoom / 100;
  }

  // ---------------------------------------------------------------
  // オブジェクト操作
  // ---------------------------------------------------------------

  addObject(obj) {
    this.history?.record();
    this.objects.push(obj);
    this.selectObject(obj.id);
    this.render();
    this._notifyObjectsChange();
    return obj;
  }

  /** 複数のオブジェクトを一括追加し、まとめて選択状態にする(貼り付け等で使用) */
  addObjects(newObjs) {
    if (!newObjs || newObjs.length === 0) return [];
    this.history?.record();
    this.objects.push(...newObjs);
    this.selectedIds = newObjs.map((o) => o.id);
    this.render();
    this._notifyObjectsChange();
    if (this.onSelectionChange) this.onSelectionChange();
    return newObjs;
  }

  getObjectById(id) {
    return this.objects.find((o) => o.id === id) || null;
  }

  /** 先頭(プライマリ)の選択オブジェクトを1件返す(単一選択向けのプロパティ編集などで使用) */
  getSelectedObject() {
    return this.selectedIds.length > 0 ? this.getObjectById(this.selectedIds[0]) : null;
  }

  /** 現在選択中の全オブジェクトを配列で返す */
  getSelectedObjects() {
    return this.selectedIds.map((id) => this.getObjectById(id)).filter(Boolean);
  }

  /** 後方互換用: 先頭の選択IDを返す */
  get selectedId() {
    return this.selectedIds.length > 0 ? this.selectedIds[0] : null;
  }

  isSelected(id) {
    return this.selectedIds.includes(id);
  }

  /**
   * オブジェクトを選択する。
   * options.additive = true の場合、Shiftクリックのように選択の追加/解除を行う。
   */
  selectObject(id, options = {}) {
    if (id === null) {
      this.selectedIds = [];
    } else if (options.additive) {
      if (this.selectedIds.includes(id)) {
        this.selectedIds = this.selectedIds.filter((i) => i !== id);
      } else {
        this.selectedIds = [...this.selectedIds, id];
      }
    } else {
      this.selectedIds = [id];
    }
    this.render();
    if (this.onSelectionChange) this.onSelectionChange();
  }

  /** 指定したID配列をまとめて選択状態にする */
  selectObjects(ids) {
    this.selectedIds = [...ids];
    this.render();
    if (this.onSelectionChange) this.onSelectionChange();
  }

  clearSelection() {
    this.selectObject(null);
  }

  deleteObject(id) {
    const target = id || this.selectedId;
    if (!target) return;
    this.history?.record();
    this.objects = this.objects.filter((o) => o.id !== target);
    this.selectedIds = this.selectedIds.filter((i) => i !== target);
    this.render();
    this._notifyObjectsChange();
    if (this.onSelectionChange) this.onSelectionChange();
  }

  /** 選択中の全オブジェクトを削除する */
  deleteSelection() {
    if (this.selectedIds.length === 0) return;
    this.history?.record();
    const idsToDelete = new Set(this.selectedIds);
    this.objects = this.objects.filter((o) => !idsToDelete.has(o.id));
    this.selectedIds = [];
    this.render();
    this._notifyObjectsChange();
    if (this.onSelectionChange) this.onSelectionChange();
  }

  /** 選択中オブジェクトを複製する(少しずらして配置し、複製後を選択状態にする) */
  duplicateObject(id) {
    const target = this.getObjectById(id || this.selectedId);
    if (!target) return null;
    this.history?.record();
    const clone = { ...target, x: target.x + 20, y: target.y + 20 };
    clone.id = generateId("object");
    this.objects.push(clone);
    this.selectObject(clone.id);
    this.render();
    this._notifyObjectsChange();
    return clone;
  }

  /** 選択中の全オブジェクトを複製する */
  duplicateSelection() {
    const targets = this.getSelectedObjects();
    if (targets.length === 0) return [];
    this.history?.record();
    const clones = targets.map((t) => {
      const clone = { ...t, x: t.x + 20, y: t.y + 20 };
      clone.id = generateId("object");
      return clone;
    });
    this.objects.push(...clones);
    this.selectedIds = clones.map((c) => c.id);
    this.render();
    this._notifyObjectsChange();
    if (this.onSelectionChange) this.onSelectionChange();
    return clones;
  }

  /** プロパティパネルからの数値変更などを反映する(履歴には積まない・連続操作向け) */
  updateObject(id, patch) {
    const obj = this.getObjectById(id);
    if (!obj) return;
    Object.assign(obj, patch);
    this.render();
  }

  /** 履歴に1エントリ積んでから変更を反映する(単発の確定操作向け) */
  commitObject(id, patch) {
    this.history?.record();
    this.updateObject(id, patch);
  }

  /** レイヤーパネルでの並び替え。配列を直接入れ替える */
  reorderObjects(newOrderIds) {
    this.history?.record();
    const map = new Map(this.objects.map((o) => [o.id, o]));
    this.objects = newOrderIds.map((id) => map.get(id)).filter(Boolean);
    this.render();
  }

  // ---------------------------------------------------------------
  // 重ね順(前面へ/背面へ/最前面へ/最背面へ)
  // ---------------------------------------------------------------

  /** 選択中オブジェクトを1つ前面へ(隣接する非選択オブジェクトと入れ替える) */
  bringForward() {
    if (this.selectedIds.length === 0) return;
    this.history?.record();
    const selectedSet = new Set(this.selectedIds);
    for (let i = this.objects.length - 2; i >= 0; i--) {
      if (selectedSet.has(this.objects[i].id) && !selectedSet.has(this.objects[i + 1].id)) {
        [this.objects[i], this.objects[i + 1]] = [this.objects[i + 1], this.objects[i]];
      }
    }
    this.render();
    this._notifyObjectsChange();
  }

  /** 選択中オブジェクトを1つ背面へ */
  sendBackward() {
    if (this.selectedIds.length === 0) return;
    this.history?.record();
    const selectedSet = new Set(this.selectedIds);
    for (let i = 1; i < this.objects.length; i++) {
      if (selectedSet.has(this.objects[i].id) && !selectedSet.has(this.objects[i - 1].id)) {
        [this.objects[i], this.objects[i - 1]] = [this.objects[i - 1], this.objects[i]];
      }
    }
    this.render();
    this._notifyObjectsChange();
  }

  /** 選択中オブジェクトを最前面へ(相対順序は維持) */
  bringToFront() {
    if (this.selectedIds.length === 0) return;
    this.history?.record();
    const selectedSet = new Set(this.selectedIds);
    const selected = this.objects.filter((o) => selectedSet.has(o.id));
    const rest = this.objects.filter((o) => !selectedSet.has(o.id));
    this.objects = [...rest, ...selected];
    this.render();
    this._notifyObjectsChange();
  }

  /** 選択中オブジェクトを最背面へ(相対順序は維持) */
  sendToBack() {
    if (this.selectedIds.length === 0) return;
    this.history?.record();
    const selectedSet = new Set(this.selectedIds);
    const selected = this.objects.filter((o) => selectedSet.has(o.id));
    const rest = this.objects.filter((o) => !selectedSet.has(o.id));
    this.objects = [...selected, ...rest];
    this.render();
    this._notifyObjectsChange();
  }

  // ---------------------------------------------------------------
  // 整列・均等配置
  // ---------------------------------------------------------------

  /**
   * 選択中オブジェクトを整列する。
   * 1件選択時: キャンバス基準で整列する。
   * 複数選択時: 選択オブジェクト全体のバウンディングボックス基準で整列する。
   * type: "left" | "centerX" | "right" | "top" | "centerY" | "bottom"
   */
  alignSelection(type) {
    const objs = this.getSelectedObjects().filter((o) => !o.locked);
    if (objs.length === 0) return;
    this.history?.record();
    if (objs.length === 1) {
      this._alignSingleToCanvas(objs[0], type);
    } else {
      const bounds = groupBounds(objs);
      objs.forEach((o) => alignToBounds(o, type, bounds));
    }
    this.render();
  }

  _alignSingleToCanvas(obj, type) {
    switch (type) {
      case "left":
        obj.x = 0;
        break;
      case "centerX":
        obj.x = this.width / 2 - obj.width / 2;
        break;
      case "right":
        obj.x = this.width - obj.width;
        break;
      case "top":
        obj.y = 0;
        break;
      case "centerY":
        obj.y = this.height / 2 - obj.height / 2;
        break;
      case "bottom":
        obj.y = this.height - obj.height;
        break;
      default:
        break;
    }
  }

  /** 選択オブジェクトを水平方向に等間隔配置する(3件以上必要)。成功可否を返す */
  distributeHorizontal() {
    const objs = this.getSelectedObjects().filter((o) => !o.locked);
    if (objs.length < 3) return false;
    this.history?.record();
    const sorted = [...objs].sort((a, b) => a.x - b.x);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalSpan = last.x + last.width - first.x;
    const sumWidths = sorted.reduce((s, o) => s + o.width, 0);
    const gap = (totalSpan - sumWidths) / (sorted.length - 1);
    let cursor = first.x;
    sorted.forEach((o) => {
      o.x = cursor;
      cursor += o.width + gap;
    });
    this.render();
    return true;
  }

  /** 選択オブジェクトを垂直方向に等間隔配置する(3件以上必要)。成功可否を返す */
  distributeVertical() {
    const objs = this.getSelectedObjects().filter((o) => !o.locked);
    if (objs.length < 3) return false;
    this.history?.record();
    const sorted = [...objs].sort((a, b) => a.y - b.y);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalSpan = last.y + last.height - first.y;
    const sumHeights = sorted.reduce((s, o) => s + o.height, 0);
    const gap = (totalSpan - sumHeights) / (sorted.length - 1);
    let cursor = first.y;
    sorted.forEach((o) => {
      o.y = cursor;
      cursor += o.height + gap;
    });
    this.render();
    return true;
  }

  /** 選択オブジェクトを1列に整列させる(左からX順に並べ、垂直中央を揃えて等間隔配置)。2件以上必要 */
  arrangeRow() {
    const objs = this.getSelectedObjects().filter((o) => !o.locked);
    if (objs.length < 2) return false;
    this.history?.record();
    const GAP = 20;
    const sorted = [...objs].sort((a, b) => a.x - b.x);
    const avgCenterY = sorted.reduce((s, o) => s + (o.y + o.height / 2), 0) / sorted.length;
    let cursor = sorted[0].x;
    sorted.forEach((o) => {
      o.x = cursor;
      o.y = avgCenterY - o.height / 2;
      cursor += o.width + GAP;
    });
    this.render();
    return true;
  }

  /**
   * レイヤー結合の確定処理。
   * removeIds のオブジェクトを配列から取り除き、その中で最前面だった位置に
   * mergedObj(合成済みの画像オブジェクト)を挿入する。
   * 実際の画像合成(Canvas描画・画像化)はapp.js側で行い、この関数は配列操作のみを担う。
   */
  mergeInto(mergedObj, removeIds) {
    const idSet = new Set(removeIds);
    const lastOriginalIndex = this.objects.reduce((acc, o, i) => (idSet.has(o.id) ? i : acc), -1);
    if (lastOriginalIndex === -1) return;

    this.history?.record();

    let insertAt = 0;
    this.objects.forEach((o, i) => {
      if (i <= lastOriginalIndex && !idSet.has(o.id)) insertAt++;
    });

    const remaining = this.objects.filter((o) => !idSet.has(o.id));
    remaining.splice(insertAt, 0, mergedObj);
    this.objects = remaining;
    this.selectedIds = [mergedObj.id];

    this.render();
    this._notifyObjectsChange();
    if (this.onSelectionChange) this.onSelectionChange();
  }

  /**
   * レイヤー結合の解除。mergedObj.sourceObjects(結合前の元オブジェクト群)を
   * mergedObjがあった位置にそのまま展開し直す。
   */
  unmergeInto(mergedObj) {
    const sourceObjects = mergedObj.sourceObjects;
    if (!sourceObjects || sourceObjects.length === 0) return;
    const index = this.objects.findIndex((o) => o.id === mergedObj.id);
    if (index === -1) return;

    this.history?.record();

    const restored = sourceObjects.map((o) => ({ ...o })); // 参照共有を避けるため複製
    const newObjects = [...this.objects];
    newObjects.splice(index, 1, ...restored);
    this.objects = newObjects;
    this.selectedIds = restored.map((o) => o.id);

    this.render();
    this._notifyObjectsChange();
    if (this.onSelectionChange) this.onSelectionChange();
  }

  _notifyObjectsChange() {
    if (this.onObjectsChange) this.onObjectsChange(this.objects);
  }

  // ---------------------------------------------------------------
  // 描画
  // ---------------------------------------------------------------

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    this._drawBackground(ctx);

    for (const obj of this.objects) {
      if (!obj.visible) continue;
      this._drawObject(ctx, obj);
    }

    if (this.selectedIds.length === 1) {
      const selected = this.getSelectedObject();
      if (selected && selected.visible) {
        this._drawSelectionUI(ctx, selected);
      }
    } else if (this.selectedIds.length > 1) {
      const objs = this.getSelectedObjects().filter((o) => o.visible);
      if (objs.length > 0) {
        this._drawMultiSelectionUI(ctx, objs);
      }
    }

    if (this.activeGuides) {
      this._drawGuides(ctx, this.activeGuides);
    }
  }

  /** 複数選択時: 各オブジェクトの枠 + 全体のバウンディングボックスを表示する(ハンドルは出さない) */
  _drawMultiSelectionUI(ctx, objs) {
    ctx.save();
    ctx.strokeStyle = "#5b6bf5";
    ctx.lineWidth = Math.max(1.5, 1.5 / this.screenPxPerCanvasPx);
    objs.forEach((obj) => {
      const corners = getObjectCorners(obj);
      ctx.beginPath();
      corners.forEach((c, i) => {
        if (i === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      });
      ctx.closePath();
      ctx.stroke();
    });

    const bounds = groupBounds(objs);
    ctx.setLineDash([6 / this.screenPxPerCanvasPx, 4 / this.screenPxPerCanvasPx]);
    ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    ctx.restore();
  }

  _drawGuides(ctx, guides) {
    ctx.save();
    ctx.strokeStyle = "#ff5b7f";
    ctx.lineWidth = Math.max(1, 1.5 / this.screenPxPerCanvasPx);
    ctx.setLineDash([6 / this.screenPxPerCanvasPx, 5 / this.screenPxPerCanvasPx]);
    if (guides.vertical !== null) {
      ctx.beginPath();
      ctx.moveTo(guides.vertical, 0);
      ctx.lineTo(guides.vertical, this.height);
      ctx.stroke();
    }
    if (guides.horizontal !== null) {
      ctx.beginPath();
      ctx.moveTo(0, guides.horizontal);
      ctx.lineTo(this.width, guides.horizontal);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawBackground(ctx) {
    if (this.background.type === "color") {
      ctx.fillStyle = this.background.color || "#ffffff";
      ctx.fillRect(0, 0, this.width, this.height);
    } else {
      // 透明背景 → 編集画面上でのみ市松模様を表示(書き出しには含めない)
      this._drawCheckerboard(ctx);
    }
  }

  _drawCheckerboard(ctx) {
    const size = 20;
    for (let y = 0; y < this.height; y += size) {
      for (let x = 0; x < this.width; x += size) {
        const isEven = ((x / size) + (y / size)) % 2 === 0;
        ctx.fillStyle = isEven ? "#f0f0f2" : "#e2e2e6";
        ctx.fillRect(x, y, size, size);
      }
    }
  }

  _drawObject(ctx, obj) {
    const center = getObjectCenter(obj);
    ctx.save();
    ctx.globalAlpha = clamp(obj.opacity, 0, 1);
    ctx.translate(center.x, center.y);
    ctx.rotate(degToRad(obj.rotation || 0));
    ctx.translate(-obj.width / 2, -obj.height / 2);
    if (obj.flipX || obj.flipY) {
      ctx.translate(obj.flipX ? obj.width : 0, obj.flipY ? obj.height : 0);
      ctx.scale(obj.flipX ? -1 : 1, obj.flipY ? -1 : 1);
    }

    switch (obj.type) {
      case "image":
        if (obj.imageElement) {
          ctx.filter = buildFilterString(obj.filters);
          ctx.drawImage(obj.imageElement, 0, 0, obj.width, obj.height);
          ctx.filter = "none";
        }
        break;
      case "rectangle":
        this._drawRect(ctx, obj);
        break;
      case "circle":
        this._drawCircle(ctx, obj);
        break;
      case "shape":
        // shapes.js は canvas.js より後に読み込まれるため、呼び出し時点で参照する
        IM.renderShape(ctx, obj);
        break;
      case "table":
        IM.renderTable(ctx, obj);
        break;
      case "text":
        this._drawText(ctx, obj);
        break;
      default:
        break;
    }

    ctx.restore();
  }

  _drawRect(ctx, obj) {
    const baseAlpha = ctx.globalAlpha;
    const r = clamp(obj.cornerRadius || 0, 0, Math.min(obj.width, obj.height) / 2);
    ctx.beginPath();
    if (r > 0) {
      roundedRectPath(ctx, 0, 0, obj.width, obj.height, r);
    } else {
      ctx.rect(0, 0, obj.width, obj.height);
    }
    ctx.globalAlpha = baseAlpha * (obj.fillOpacity ?? 1);
    ctx.fillStyle = buildFillStyle(ctx, obj);
    ctx.fill();
    if (obj.strokeWidth > 0) {
      ctx.globalAlpha = baseAlpha * (obj.strokeOpacity ?? 1);
      ctx.lineWidth = obj.strokeWidth;
      ctx.strokeStyle = obj.stroke || "#000000";
      ctx.stroke();
    }
    ctx.globalAlpha = baseAlpha;
  }

  _drawCircle(ctx, obj) {
    const baseAlpha = ctx.globalAlpha;
    ctx.beginPath();
    ctx.ellipse(
      obj.width / 2,
      obj.height / 2,
      obj.width / 2,
      obj.height / 2,
      0,
      0,
      Math.PI * 2
    );
    ctx.globalAlpha = baseAlpha * (obj.fillOpacity ?? 1);
    ctx.fillStyle = buildFillStyle(ctx, obj);
    ctx.fill();
    if (obj.strokeWidth > 0) {
      ctx.globalAlpha = baseAlpha * (obj.strokeOpacity ?? 1);
      ctx.lineWidth = obj.strokeWidth;
      ctx.strokeStyle = obj.stroke || "#000000";
      ctx.stroke();
    }
    ctx.globalAlpha = baseAlpha;
  }

  _drawText(ctx, obj) {
    const weight = obj.bold ? "bold" : "normal";
    const style = obj.italic ? "italic" : "normal";
    ctx.font = `${style} ${weight} ${obj.fontSize}px ${obj.fontFamily}`;
    ctx.fillStyle = obj.color || "#1a1a1a";
    ctx.textBaseline = "top";
    ctx.textAlign = obj.align || "left";

    let drawX = 0;
    if (obj.align === "center") drawX = obj.width / 2;
    if (obj.align === "right") drawX = obj.width;

    if (obj.shadowEnabled) {
      ctx.shadowColor = obj.shadowColor || "#000000";
      ctx.shadowOffsetX = obj.shadowOffsetX || 0;
      ctx.shadowOffsetY = obj.shadowOffsetY || 0;
      ctx.shadowBlur = obj.shadowBlur || 0;
    }

    const lines =
      obj.wrapText === false
        ? String(obj.text).split("\n")
        : wrapTextLines(ctx, obj.text, Math.max(10, obj.width - 8));
    const lineHeight = obj.fontSize * 1.3;
    const startY = verticalAlignOffset(obj, lines.length, lineHeight);
    lines.forEach((line, i) => {
      const ly = startY + i * lineHeight;
      if (obj.outlineWidth > 0) {
        ctx.lineWidth = obj.outlineWidth;
        ctx.strokeStyle = obj.outlineColor || "#000000";
        ctx.strokeText(line, drawX, ly);
      }
      ctx.fillText(line, drawX, ly);
    });
  }

  _drawSelectionUI(ctx, obj) {
    const corners = getObjectCorners(obj);
    const center = getObjectCenter(obj);

    ctx.save();
    ctx.strokeStyle = "#5b6bf5";
    ctx.lineWidth = Math.max(1.5, 2 / this.screenPxPerCanvasPx);
    ctx.setLineDash([]);
    ctx.beginPath();
    corners.forEach((c, i) => {
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.closePath();
    ctx.stroke();

    // 回転ハンドルへのガイド線(上辺中央から伸ばす)
    const topMid = midpoint(corners[0], corners[1]);
    const rotateHandlePos = this._rotateHandlePosition(obj);
    ctx.beginPath();
    ctx.moveTo(topMid.x, topMid.y);
    ctx.lineTo(rotateHandlePos.x, rotateHandlePos.y);
    ctx.stroke();

    // 4隅のリサイズハンドル
    const handleSize = HANDLE_SCREEN_SIZE / this.screenPxPerCanvasPx;
    ctx.fillStyle = "#ffffff";
    corners.forEach((c) => {
      ctx.beginPath();
      ctx.rect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
      ctx.fill();
      ctx.stroke();
    });

    // 回転ハンドル(丸)
    ctx.beginPath();
    ctx.arc(rotateHandlePos.x, rotateHandlePos.y, handleSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  _rotateHandlePosition(obj) {
    const corners = getObjectCorners(obj);
    const topMid = midpoint(corners[0], corners[1]);
    const rad = degToRad(obj.rotation || 0);
    const offset = ROTATE_HANDLE_OFFSET / this.screenPxPerCanvasPx;
    // オブジェクトのローカル「上」方向 (0,-1) を回転させた向きにハンドルを配置する
    const dirX = Math.sin(rad);
    const dirY = -Math.cos(rad);
    return {
      x: topMid.x + dirX * offset,
      y: topMid.y + dirY * offset,
    };
  }

  // ---------------------------------------------------------------
  // ポインターイベント(選択・移動・拡縮・回転)
  // ---------------------------------------------------------------

  _bindPointerEvents() {
    this.canvasEl.addEventListener("mousedown", (e) => this._onPointerDown(e));
    window.addEventListener("mousemove", (e) => this._onPointerMove(e));
    window.addEventListener("mouseup", () => this._onPointerUp());
  }

  _hitTestHandles(obj, canvasPoint) {
    const handleSize = HANDLE_SCREEN_SIZE / this.screenPxPerCanvasPx;
    const corners = getObjectCorners(obj);
    const handleNames = ["tl", "tr", "br", "bl"];
    for (let i = 0; i < corners.length; i++) {
      if (distance(corners[i], canvasPoint) <= handleSize) {
        return { type: "resize", corner: handleNames[i], index: i };
      }
    }
    const rotatePos = this._rotateHandlePosition(obj);
    if (distance(rotatePos, canvasPoint) <= handleSize) {
      return { type: "rotate" };
    }
    return null;
  }

  _onPointerDown(e) {
    const point = this.clientToCanvas(e.clientX, e.clientY);

    if (this.penMode) {
      this.dragState = { mode: "freehand", points: [point] };
      return;
    }

    // 選択中オブジェクトのハンドル判定は単一選択時のみ(複数選択時はハンドルを出さない)
    if (this.selectedIds.length === 1) {
      const selected = this.getSelectedObject();
      if (selected && !selected.locked) {
        const handleHit = this._hitTestHandles(selected, point);
        if (handleHit) {
          this._startHandleDrag(handleHit, selected, point);
          return;
        }
      }
    }

    // オブジェクト本体のヒットテスト(前面から)
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const obj = this.objects[i];
      if (!obj.visible) continue;
      if (isPointInObject(obj, point.x, point.y)) {
        if (e.shiftKey) {
          // Shiftクリック: 選択の追加/解除のみ行い、ドラッグは開始しない
          this.selectObject(obj.id, { additive: true });
          return;
        }
        if (!this.isSelected(obj.id)) {
          this.selectObject(obj.id);
        }
        // 複数選択中にその一員をクリックした場合は選択全体をまとめて移動する
        this._startGroupMoveDrag(point);
        return;
      }
    }

    if (!e.shiftKey) this.clearSelection();
  }

  /** 選択中オブジェクト全体(ロック中は除く)をまとめて移動するドラッグを開始する */
  _startGroupMoveDrag(point) {
    const targets = this.getSelectedObjects().filter((o) => !o.locked);
    if (targets.length === 0) return;
    this.history?.record();
    this.dragState = {
      mode: "move",
      startPoint: point,
      items: targets.map((o) => ({ id: o.id, startX: o.x, startY: o.y })),
    };
  }

  _startHandleDrag(handleHit, obj, point) {
    this.history?.record();
    if (handleHit.type === "rotate") {
      const center = getObjectCenter(obj);
      this.dragState = {
        mode: "rotate",
        objId: obj.id,
        center,
        startRotation: obj.rotation || 0,
        startAngle: Math.atan2(point.y - center.y, point.x - center.x),
      };
      return;
    }

    if (handleHit.type === "resize") {
      const corners = getObjectCorners(obj);
      const oppositeIndex = (handleHit.index + 2) % 4;
      const anchorCanvas = corners[oppositeIndex];
      const rad = degToRad(obj.rotation || 0);
      const ux = { x: Math.cos(rad), y: Math.sin(rad) };
      const uy = { x: -Math.sin(rad), y: Math.cos(rad) };
      // ドラッグする角のローカル符号 (top-left=(-,-), top-right=(+,-), bottom-right=(+,+), bottom-left=(-,+))
      const signs = [
        { sx: -1, sy: -1 },
        { sx: 1, sy: -1 },
        { sx: 1, sy: 1 },
        { sx: -1, sy: 1 },
      ][handleHit.index];

      this.dragState = {
        mode: "resize",
        objId: obj.id,
        anchorCanvas,
        ux,
        uy,
        signs,
        aspectRatio: obj.width / obj.height,
      };
    }
  }

  _onPointerMove(e) {
    if (!this.dragState) return;
    const point = this.clientToCanvas(e.clientX, e.clientY);

    if (this.dragState.mode === "freehand") {
      const points = this.dragState.points;
      const lastPoint = points[points.length - 1];
      // 点が近すぎる場合は間引く(データが不必要に重くなるのを防ぐ)
      if (Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) > 2) {
        points.push(point);
        this._renderFreehandPreview();
      }
      return;
    }

    if (this.dragState.mode === "move") {
      const dx = point.x - this.dragState.startPoint.x;
      const dy = point.y - this.dragState.startPoint.y;

      // スナップはプライマリ(先頭)オブジェクト基準で計算し、他は同じ量だけ平行移動する
      const primaryItem = this.dragState.items[0];
      const primaryObj = this.getObjectById(primaryItem.id);
      let snapDx = dx;
      let snapDy = dy;
      this.activeGuides = null;
      if (this.snapEnabled && primaryObj) {
        const snapped = this._applySnap(primaryObj, primaryItem.startX + dx, primaryItem.startY + dy);
        snapDx = snapped.x - primaryItem.startX;
        snapDy = snapped.y - primaryItem.startY;
        this.activeGuides = snapped.guides;
      }

      this.dragState.items.forEach((item) => {
        const obj = this.getObjectById(item.id);
        if (!obj) return;
        obj.x = item.startX + snapDx;
        obj.y = item.startY + snapDy;
      });
      this.render();
      return;
    }

    const obj = this.getObjectById(this.dragState.objId);
    if (!obj) return;

    if (this.dragState.mode === "rotate") {
      const { center, startRotation, startAngle } = this.dragState;
      const currentAngle = Math.atan2(point.y - center.y, point.x - center.x);
      const deltaDeg = radToDeg(currentAngle - startAngle);
      let newRotation = startRotation + deltaDeg;
      if (e.shiftKey) {
        newRotation = Math.round(newRotation / 15) * 15; // Shiftで15度刻みにスナップ
      }
      obj.rotation = newRotation;
      this.render();
      if (this.onSelectionChange) this.onSelectionChange();
      return;
    }

    if (this.dragState.mode === "resize") {
      const { anchorCanvas, ux, uy, signs } = this.dragState;
      const vx = point.x - anchorCanvas.x;
      const vy = point.y - anchorCanvas.y;
      const a = vx * ux.x + vy * ux.y; // ローカルx方向成分
      const b = vx * uy.x + vy * uy.y; // ローカルy方向成分

      let newWidth = Math.max(MIN_SIZE, signs.sx * a);
      let newHeight = Math.max(MIN_SIZE, signs.sy * b);

      if (e.shiftKey && this.dragState.aspectRatio) {
        // Shiftで縦横比を固定
        const ratio = this.dragState.aspectRatio;
        if (newWidth / newHeight > ratio) {
          newWidth = newHeight * ratio;
        } else {
          newHeight = newWidth / ratio;
        }
      }

      const anchorLocalNew = {
        x: -signs.sx * (newWidth / 2),
        y: -signs.sy * (newHeight / 2),
      };
      const centerNew = {
        x: anchorCanvas.x - (anchorLocalNew.x * ux.x + anchorLocalNew.y * uy.x),
        y: anchorCanvas.y - (anchorLocalNew.x * ux.y + anchorLocalNew.y * uy.y),
      };

      obj.width = newWidth;
      obj.height = newHeight;
      obj.x = centerNew.x - newWidth / 2;
      obj.y = centerNew.y - newHeight / 2;

      this.render();
      if (this.onSelectionChange) this.onSelectionChange();
    }
  }

  _onPointerUp() {
    if (this.dragState && this.dragState.mode === "freehand") {
      this._finalizeFreehandStroke();
      this.dragState = null;
      if (this.onDragEnd) this.onDragEnd();
      return;
    }

    const hadDrag = !!this.dragState;
    if (this.dragState) {
      this.dragState = null;
    }
    if (this.activeGuides) {
      this.activeGuides = null;
      this.render();
    }
    if (hadDrag && this.onDragEnd) this.onDragEnd();
  }

  /** ペンツールでドラッグ中の線を、確定前のプレビューとして重ねて描画する */
  _renderFreehandPreview() {
    this.render();
    const points = this.dragState.points;
    if (points.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.penStrokeColor;
    ctx.lineWidth = this.penStrokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(this.penDashed ? [this.penStrokeWidth * 2.5, this.penStrokeWidth * 1.8] : []);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
    ctx.restore();
  }

  /** ペンツールでの描画を確定し、フリーハンドのオブジェクトとして追加する */
  _finalizeFreehandStroke() {
    const points = this.dragState.points;
    if (points.length < 2) return; // クリックのみの場合は何も作らない

    const minX = Math.min(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxX = Math.max(...points.map((p) => p.x));
    const maxY = Math.max(...points.map((p) => p.y));
    const width = Math.max(4, maxX - minX);
    const height = Math.max(4, maxY - minY);
    const localPoints = points.map((p) => ({ x: p.x - minX, y: p.y - minY }));

    const obj = createFreehandObject({ x: minX, y: minY, width, height, points: localPoints });
    obj.fill = this.penStrokeColor;
    obj.strokeWidth = this.penStrokeWidth;
    obj.dashed = this.penDashed;

    this.addObject(obj);
  }

  /**
   * 移動中のオブジェクトをキャンバス中央・端にスナップさせる。
   * 戻り値: { x, y, guides } guidesは描画用のガイド線情報
   */
  _applySnap(obj, x, y) {
    const threshold = SNAP_THRESHOLD_SCREEN_PX / this.screenPxPerCanvasPx;
    const guides = { vertical: null, horizontal: null };

    const targetsX = [
      { value: 0, edge: "left" },
      { value: this.width / 2 - obj.width / 2, edge: "centerX" },
      { value: this.width - obj.width, edge: "right" },
    ];
    const targetsY = [
      { value: 0, edge: "top" },
      { value: this.height / 2 - obj.height / 2, edge: "centerY" },
      { value: this.height - obj.height, edge: "bottom" },
    ];

    let snappedX = x;
    for (const t of targetsX) {
      if (Math.abs(x - t.value) <= threshold) {
        snappedX = t.value;
        guides.vertical = t.edge === "centerX" ? this.width / 2 : t.edge === "left" ? 0 : this.width;
        break;
      }
    }

    let snappedY = y;
    for (const t of targetsY) {
      if (Math.abs(y - t.value) <= threshold) {
        snappedY = t.value;
        guides.horizontal = t.edge === "centerY" ? this.height / 2 : t.edge === "top" ? 0 : this.height;
        break;
      }
    }

    return { x: snappedX, y: snappedY, guides };
  }
  }

// ---------------------------------------------------------------
// 補助関数
// ---------------------------------------------------------------

/**
 * テキストの垂直方向の揃え(top/middle/bottom)に応じた描画開始Y座標を計算する。
 */
function verticalAlignOffset(obj, lineCount, lineHeight) {
  const totalTextHeight = lineCount * lineHeight;
  if (obj.verticalAlign === "middle") return (obj.height - totalTextHeight) / 2;
  if (obj.verticalAlign === "bottom") return obj.height - totalTextHeight;
  return 0; // top
}

/**
 * テキストをボックスの幅に収まるように折り返す。
 * ユーザーが入力した改行(\n)はそのまま段落の区切りとして扱い、
 * 各段落を1文字ずつ測りながらmaxWidthを超える手前で改行する。
 * (日本語は単語間にスペースが無いことが多いため、単語単位ではなく文字単位で折り返す)
 * ctx.font はあらかじめ呼び出し側で設定しておくこと。
 */
function wrapTextLines(ctx, text, maxWidth) {
  const paragraphs = String(text).split("\n");
  const resultLines = [];
  paragraphs.forEach((paragraph) => {
    if (paragraph === "") {
      resultLines.push("");
      return;
    }
    let currentLine = "";
    for (const ch of paragraph) {
      const testLine = currentLine + ch;
      if (currentLine !== "" && ctx.measureText(testLine).width > maxWidth) {
        resultLines.push(currentLine);
        currentLine = ch;
      } else {
        currentLine = testLine;
      }
    }
    resultLines.push(currentLine);
  });
  return resultLines;
}

/** 複数オブジェクトを包む軸並行バウンディングボックスを計算する(回転は考慮しない簡易版) */
function groupBounds(objs) {
  const minX = Math.min(...objs.map((o) => o.x));
  const minY = Math.min(...objs.map((o) => o.y));
  const maxX = Math.max(...objs.map((o) => o.x + o.width));
  const maxY = Math.max(...objs.map((o) => o.y + o.height));
  return { minX, minY, maxX, maxY };
}

/** 指定バウンディングボックスを基準にオブジェクトを整列させる */
function alignToBounds(obj, type, bounds) {
  switch (type) {
    case "left":
      obj.x = bounds.minX;
      break;
    case "centerX":
      obj.x = (bounds.minX + bounds.maxX) / 2 - obj.width / 2;
      break;
    case "right":
      obj.x = bounds.maxX - obj.width;
      break;
    case "top":
      obj.y = bounds.minY;
      break;
    case "centerY":
      obj.y = (bounds.minY + bounds.maxY) / 2 - obj.height / 2;
      break;
    case "bottom":
      obj.y = bounds.maxY - obj.height;
      break;
    default:
      break;
  }
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** obj.filters からCanvasの ctx.filter 用の文字列を組み立てる */
function buildFilterString(filters) {
  if (!filters) return "none";
  const parts = [];
  parts.push(`brightness(${filters.brightness ?? 100}%)`);
  parts.push(`contrast(${filters.contrast ?? 100}%)`);
  parts.push(`saturate(${filters.saturate ?? 100}%)`);
  if (filters.blur) parts.push(`blur(${filters.blur}px)`);
  if (filters.grayscale) parts.push("grayscale(1)");
  if (filters.sepia) parts.push("sepia(1)");
  return parts.join(" ");
}

/**
 * 図形の塗りスタイルを組み立てる。グラデーションが有効な場合は
 * オブジェクトのローカル座標系(0,0)〜(width,height)を基準に、
 * 指定角度に沿った線形グラデーションを生成する。
 */
function buildFillStyle(ctx, obj) {
  if (!obj.gradientEnabled) {
    return obj.fill || "#5b6bf5";
  }
  const w = obj.width;
  const h = obj.height;
  const cx = w / 2;
  const cy = h / 2;
  const rad = degToRad(obj.gradientAngle || 0);
  const len = Math.sqrt(w * w + h * h) / 2;
  const dx = Math.cos(rad) * len;
  const dy = Math.sin(rad) * len;
  const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  grad.addColorStop(0, obj.fill || "#5b6bf5");
  grad.addColorStop(1, obj.gradientColor2 || "#ffffff");
  return grad;
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

  Object.assign(IM, { CanvasManager, buildFilterString, buildFillStyle, verticalAlignOffset, wrapTextLines });
})(window.IM);
