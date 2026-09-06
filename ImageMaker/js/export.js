// export.js
// キャンバスの内容を画像ファイルとして書き出す。
// 編集画面上の市松模様(透明可視化用)は書き出しには含めない。

window.IM = window.IM || {};

(function (IM) {
  "use strict";

  const { downloadBlob, degToRad, clamp } = IM;
  const { getObjectCenter } = IM;
  const { buildFilterString, buildFillStyle, verticalAlignOffset, wrapTextLines } = IM;

  /**
   * CanvasManagerの内容をPNGとして書き出す。
   * @param {CanvasManager} canvasManager
   * @param {{filename?: string, scale?: number}} options
   */
  async function exportToPNG(canvasManager, options = {}) {
    const scale = options.scale || 1;
    const filename = options.filename || "imagemaker_output.png";

    const canvas = renderObjectsToCanvas(
      canvasManager.objects,
      canvasManager.background,
      canvasManager.width,
      canvasManager.height,
      scale
    );

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      throw new Error("PNGの生成に失敗しました");
    }
    downloadBlob(blob, filename);
  }

  /**
   * オブジェクト配列を新しいCanvasに描画して返す。
   * PNG書き出しとAPNGのフレーム生成の両方から共通で使う。
   * @param {Array} objects
   * @param {{type:string, color?:string}} background
   * @param {number} width
   * @param {number} height
   * @param {number} scale
   * @returns {HTMLCanvasElement}
   */
  function renderObjectsToCanvas(objects, background, width, height, scale = 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    // 背景(透明の場合は何も塗らない = 真の透過)
    if (background && background.type === "color") {
      ctx.fillStyle = background.color || "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }

    for (const obj of objects) {
      if (!obj.visible) continue;
      drawObjectForExport(ctx, obj);
    }

    return canvas;
  }

  // canvas.js の描画ロジックと重複するが、書き出しは「選択枠を描かない」
  // 独立した処理として持たせることで、書き出し専用の最適化がしやすくなる。
  function drawObjectForExport(ctx, obj) {
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
      case "shape":
        IM.renderShape(ctx, obj);
        break;
      case "table":
        IM.renderTable(ctx, obj);
        break;
      case "rectangle": {
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
        break;
      }
      case "circle": {
        const baseAlpha = ctx.globalAlpha;
        ctx.beginPath();
        ctx.ellipse(obj.width / 2, obj.height / 2, obj.width / 2, obj.height / 2, 0, 0, Math.PI * 2);
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
        break;
      }
      case "text": {
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
        break;
      }
      default:
        break;
    }

    ctx.restore();
  }

  function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  Object.assign(IM, { exportToPNG, renderObjectsToCanvas });
})(window.IM);
