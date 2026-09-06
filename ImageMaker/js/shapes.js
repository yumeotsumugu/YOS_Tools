// shapes.js
// type: "shape" のオブジェクト(矢印・吹き出し・星・多角形など)の描画を担当する。
// canvas.js(編集画面)とexport.js(PNG/APNGフレーム書き出し)の両方から
// 同じロジックを使えるよう、ここに一本化している。
//
// 呼び出し側の前提: ctx は既に該当オブジェクトの中心へtranslate/rotate/flip済みで、
// ローカル座標(0,0)〜(obj.width, obj.height)に図形を描けばよい状態になっている。

window.IM = window.IM || {};

(function (IM) {
  "use strict";

  const { clamp, degToRad } = IM;

  // 塗り+輪郭線で描く図形(閉じた多角形・曲線)。線・矢印系はここに含めない。
  const STROKE_ONLY_KINDS = new Set(["line", "lineArrow", "arrowElbow", "arrowUturn", "freehand"]);

  /** type:"shape" オブジェクトを描画する。fill/stroke系かline系かで処理を振り分ける。 */
  function renderShape(ctx, obj) {
    if (STROKE_ONLY_KINDS.has(obj.shapeKind)) {
      drawStrokeShape(ctx, obj);
      return;
    }
    const baseAlpha = ctx.globalAlpha; // オブジェクト全体の不透明度(呼び出し側で設定済み)
    ctx.beginPath();
    buildShapePath(ctx, obj, obj.width, obj.height);
    ctx.closePath();
    ctx.globalAlpha = baseAlpha * (obj.fillOpacity ?? 1);
    ctx.fillStyle = IM.buildFillStyle(ctx, obj);
    ctx.fill();
    if (obj.strokeWidth > 0) {
      ctx.globalAlpha = baseAlpha * (obj.strokeOpacity ?? 1);
      ctx.lineWidth = obj.strokeWidth;
      ctx.strokeStyle = obj.stroke || "#000000";
      ctx.stroke();
    }
    ctx.globalAlpha = baseAlpha;
  }

  // ---------------------------------------------------------------
  // 塗りつぶし系図形のパス構築
  // ---------------------------------------------------------------

  function buildShapePath(ctx, obj, w, h) {
    switch (obj.shapeKind) {
      case "arrow":
        buildArrowPath(ctx, obj, w, h);
        break;
      case "speechRect":
        buildSpeechRectPath(ctx, obj, w, h, 0);
        break;
      case "speechRoundRect":
        buildSpeechRectPath(ctx, obj, w, h, obj.cornerRadius || 16);
        break;
      case "speechOval":
        buildSpeechOvalPath(ctx, obj, w, h);
        break;
      case "star":
        buildStarPath(ctx, obj, w, h);
        break;
      case "polygon":
        buildPolygonPath(ctx, obj, w, h);
        break;
      case "sticky":
        buildStickyPath(ctx, obj, w, h);
        break;
      case "triangleRight":
        buildTriangleRightPath(ctx, obj, w, h);
        break;
      case "trapezoid":
        buildTrapezoidPath(ctx, obj, w, h);
        break;
      case "partialCircle":
        buildPartialCirclePath(ctx, obj, w, h);
        break;
      case "heart":
        buildHeartPath(ctx, w, h);
        break;
      case "cloud":
        buildCloudPath(ctx, w, h);
        break;
      case "cross":
        buildCrossPath(ctx, obj, w, h);
        break;
      default:
        ctx.rect(0, 0, w, h); // 未知の種類は四角形にフォールバック
        break;
    }
  }

  /** ブロック矢印(右向き基準。他の向きは回転で対応する) */
  function buildArrowPath(ctx, obj, w, h) {
    const headLen = w * clamp(obj.headSizeRatio ?? 0.4, 0.05, 0.95);
    const stemW = h * clamp(obj.stemWidthRatio ?? 0.5, 0.05, 1);
    const shaftTop = (h - stemW) / 2;
    const shaftBottom = shaftTop + stemW;
    const shaftRight = w - headLen;
    const points = [
      { x: 0, y: shaftTop },
      { x: shaftRight, y: shaftTop },
      { x: shaftRight, y: 0 },
      { x: w, y: h / 2 },
      { x: shaftRight, y: h },
      { x: shaftRight, y: shaftBottom },
      { x: 0, y: shaftBottom },
    ];
    buildRoundedPolygonPath(ctx, points, obj.cornerRadius || 0);
  }

  /** 吹き出し(四角/角丸共通)。radius=0で角丸なしになる */
  function buildSpeechRectPath(ctx, obj, w, h, radius) {
    const tailW = clamp(obj.tailSize ?? 30, 4, w * 0.8);
    const tailH = Math.min(h * 0.35, tailW * 0.9);
    const bodyH = h - tailH;
    const tailPos = clamp(obj.tailPos ?? 0.25, 0, 1);
    const tailCenterX = tailW / 2 + tailPos * (w - tailW);

    if (radius > 0) {
      const r = Math.min(radius, bodyH / 2, w / 2);
      ctx.moveTo(r, 0);
      ctx.lineTo(w - r, 0);
      ctx.arcTo(w, 0, w, r, r);
      ctx.lineTo(w, bodyH - r);
      ctx.arcTo(w, bodyH, w - r, bodyH, r);
      ctx.lineTo(tailCenterX + tailW / 2, bodyH);
      ctx.lineTo(tailCenterX, h);
      ctx.lineTo(tailCenterX - tailW / 2, bodyH);
      ctx.lineTo(r, bodyH);
      ctx.arcTo(0, bodyH, 0, bodyH - r, r);
      ctx.lineTo(0, r);
      ctx.arcTo(0, 0, r, 0, r);
    } else {
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w, bodyH);
      ctx.lineTo(tailCenterX + tailW / 2, bodyH);
      ctx.lineTo(tailCenterX, h);
      ctx.lineTo(tailCenterX - tailW / 2, bodyH);
      ctx.lineTo(0, bodyH);
    }
  }

  /** 吹き出し(丸)。楕円の輪郭上に正確に接続する位置でしっぽを描く */
  function buildSpeechOvalPath(ctx, obj, w, h) {
    const tailW = clamp(obj.tailSize ?? 30, 4, w * 0.5);
    const tailH = Math.min(h * 0.3, tailW);
    const bodyH = h - tailH;
    const cx = w / 2;
    const cy = bodyH / 2;
    const rx = w / 2;
    const ry = bodyH / 2;

    const tailPos = clamp(obj.tailPos ?? 0.25, 0, 1);
    // しっぽの付け根が楕円の端に寄りすぎて計算が不安定にならないよう、安全な範囲に収める
    const maxOffset = rx * 0.7;
    const tailCenterX = cx + (tailPos * 2 - 1) * maxOffset;

    // 楕円の下半分の輪郭上で、指定x座標に対応するy座標を求める
    function ellipseBottomY(x) {
      const dx = clamp((x - cx) / rx, -0.98, 0.98);
      return cy + ry * Math.sqrt(1 - dx * dx);
    }

    const leftX = tailCenterX - tailW / 2;
    const rightX = tailCenterX + tailW / 2;
    const leftY = ellipseBottomY(leftX);
    const rightY = ellipseBottomY(rightX);

    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.moveTo(leftX, leftY);
    ctx.lineTo(tailCenterX, h);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
  }

  /** 星(頂点数・とがり具合・角の丸みを指定可能) */
  function buildStarPath(ctx, obj, w, h) {
    const points = Math.max(3, Math.round(obj.points ?? 5));
    const innerRatio = clamp(obj.innerRatio ?? 0.5, 0.1, 0.9);
    const cx = w / 2;
    const cy = h / 2;
    const outerR = Math.min(w, h) / 2;
    const innerR = outerR * innerRatio;
    const step = Math.PI / points;
    const pts = [];
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = -Math.PI / 2 + i * step;
      pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    }
    buildRoundedPolygonPath(ctx, pts, obj.cornerRadius || 0);
  }

  /** 正多角形(辺の数・角の丸みを指定可能) */
  function buildPolygonPath(ctx, obj, w, h) {
    const sides = Math.max(3, Math.round(obj.sides ?? 6));
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2;
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
      pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    }
    buildRoundedPolygonPath(ctx, pts, obj.cornerRadius || 0);
  }

  /** 付箋(右下折り/左下折り、角の丸みを指定可能) */
  function buildStickyPath(ctx, obj, w, h) {
    const fold = clamp(obj.foldSize ?? 24, 8, Math.min(w, h) * 0.6);
    const corner = obj.foldCorner === "bottomLeft" ? "bottomLeft" : "bottomRight";
    const pts =
      corner === "bottomRight"
        ? [
            { x: 0, y: 0 },
            { x: w, y: 0 },
            { x: w, y: h - fold },
            { x: w - fold, y: h },
            { x: 0, y: h },
          ]
        : [
            { x: 0, y: 0 },
            { x: w, y: 0 },
            { x: w, y: h },
            { x: fold, y: h },
            { x: 0, y: h - fold },
          ];
    buildRoundedPolygonPath(ctx, pts, obj.cornerRadius || 0);
  }

  /** 直角三角形(直角は左下。他の向きは回転・反転で対応。角の丸みを指定可能) */
  function buildTriangleRightPath(ctx, obj, w, h) {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: h },
      { x: w, y: h },
    ];
    buildRoundedPolygonPath(ctx, pts, obj.cornerRadius || 0);
  }

  /** 台形(上辺の幅の比率・角の丸みを指定可能) */
  function buildTrapezoidPath(ctx, obj, w, h) {
    const topRatio = clamp(obj.topWidthRatio ?? 0.6, 0.05, 1);
    const topW = w * topRatio;
    const inset = (w - topW) / 2;
    const pts = [
      { x: inset, y: 0 },
      { x: inset + topW, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    buildRoundedPolygonPath(ctx, pts, obj.cornerRadius || 0);
  }

  /** 部分円(扇形。開始・終了角度を指定可能) */
  function buildPartialCirclePath(ctx, obj, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2;
    const start = degToRad(obj.startAngle ?? 0);
    const end = degToRad(obj.endAngle ?? 270);
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end, false);
    ctx.closePath();
  }

  /** ハート */
  function buildHeartPath(ctx, w, h) {
    const topCurveY = h * 0.3;
    ctx.moveTo(w / 2, h);
    ctx.bezierCurveTo(-w * 0.1, h * 0.55, w * 0.05, 0, w / 2, topCurveY);
    ctx.bezierCurveTo(w * 0.95, 0, w * 1.1, h * 0.55, w / 2, h);
  }

  /** 雲形。大きさの異なる円を底辺の帯に重ねて、輪郭のはっきりした雲にする */
  function buildCloudPath(ctx, w, h) {
    const baseline = h * 0.68;
    const bumps = [
      { x: w * 0.16, y: baseline - h * 0.04, r: h * 0.22 },
      { x: w * 0.34, y: baseline - h * 0.22, r: h * 0.3 },
      { x: w * 0.56, y: baseline - h * 0.28, r: h * 0.34 },
      { x: w * 0.77, y: baseline - h * 0.16, r: h * 0.28 },
      { x: w * 0.9, y: baseline - h * 0.02, r: h * 0.18 },
    ];
    bumps.forEach((b) => {
      ctx.moveTo(b.x + b.r, b.y);
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    });
    // 底辺を一直線に揃えるための帯(円と同じ巻き方向で重ね、塗りをつなげる)
    ctx.moveTo(w * 0.1, baseline);
    ctx.lineTo(w * 0.9, baseline);
    ctx.lineTo(w * 0.9, baseline + h * 0.14);
    ctx.lineTo(w * 0.1, baseline + h * 0.14);
    ctx.closePath();
  }

  /** 十字(太さの比率・角の丸みを指定可能) */
  function buildCrossPath(ctx, obj, w, h) {
    const thickness = clamp(obj.thicknessRatio ?? 0.35, 0.1, 0.9);
    const tW = w * thickness;
    const tH = h * thickness;
    const x0 = (w - tW) / 2;
    const x1 = x0 + tW;
    const y0 = (h - tH) / 2;
    const y1 = y0 + tH;
    const pts = [
      { x: x0, y: 0 },
      { x: x1, y: 0 },
      { x: x1, y: y0 },
      { x: w, y: y0 },
      { x: w, y: y1 },
      { x: x1, y: y1 },
      { x: x1, y: h },
      { x: x0, y: h },
      { x: x0, y: y1 },
      { x: 0, y: y1 },
      { x: 0, y: y0 },
      { x: x0, y: y0 },
    ];
    buildRoundedPolygonPath(ctx, pts, obj.cornerRadius || 0);
  }

  /**
   * 頂点の並びから、角を丸めた多角形パスを作る汎用ヘルパー。
   * 半径は各辺の半分を超えないよう自動的にクランプする(角同士の丸みが重ならないようにするため)。
   * radiusが0(または実質0)の場合は通常の直線の多角形になる。
   */
  function buildRoundedPolygonPath(ctx, points, radius) {
    const n = points.length;
    if (n < 3) return;

    let r = Math.max(0, radius || 0);
    if (r > 0) {
      for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        r = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2);
      }
    }

    if (r <= 0.01) {
      points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      return;
    }

    const last = points[n - 1];
    const first = points[0];
    ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
    for (let i = 0; i < n; i++) {
      const curr = points[i];
      const next = points[(i + 1) % n];
      ctx.arcTo(curr.x, curr.y, next.x, next.y, r);
    }
    ctx.closePath();
  }

  // ---------------------------------------------------------------
  // 線・矢印系(塗りつぶしではなく線として描く)
  // ---------------------------------------------------------------

  function drawStrokeShape(ctx, obj) {
    const w = obj.width;
    const h = obj.height;
    const strokeWidth = Math.max(1, obj.strokeWidth || 4);
    const color = obj.fill || "#000000"; // 線系は「塗り色」をそのまま線の色として使う

    ctx.save();
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(obj.dashed ? [strokeWidth * 2.5, strokeWidth * 1.8] : []);

    const arrowSize = Math.max(8, strokeWidth * 2.6);

    switch (obj.shapeKind) {
      case "line": {
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        break;
      }
      case "lineArrow": {
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        if (obj.arrowEnd !== false) drawArrowHead(ctx, { x: 0, y: h / 2 }, { x: w, y: h / 2 }, arrowSize);
        if (obj.arrowStart) drawArrowHead(ctx, { x: w, y: h / 2 }, { x: 0, y: h / 2 }, arrowSize);
        break;
      }
      case "arrowElbow": {
        const p0 = { x: w * 0.25, y: 0 };
        const p1 = { x: w * 0.25, y: h * 0.8 };
        const p2 = { x: w * 0.92, y: h * 0.8 };
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        drawArrowHead(ctx, p1, p2, arrowSize);
        break;
      }
      case "arrowUturn": {
        const centerX = w / 2;
        const radius = w * 0.3;
        const topY = h * 0.3;
        const endY = h * 0.85;
        ctx.beginPath();
        ctx.moveTo(centerX - radius, h);
        ctx.lineTo(centerX - radius, topY);
        ctx.arc(centerX, topY, radius, Math.PI, 0, false);
        ctx.lineTo(centerX + radius, endY);
        ctx.stroke();
        drawArrowHead(ctx, { x: centerX + radius, y: topY }, { x: centerX + radius, y: endY }, arrowSize);
        break;
      }
      case "freehand": {
        const pts = obj.points || [];
        if (pts.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        // 点と点の中間点をなめらかに繋ぐ(手描き線がガタつかないようにする簡易スムージング)
        for (let i = 1; i < pts.length - 1; i++) {
          const midX = (pts[i].x + pts[i + 1].x) / 2;
          const midY = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
        break;
      }
      default:
        break;
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  /** from→to方向を向く三角形の矢じりをtoの位置に描く */
  function drawArrowHead(ctx, from, to, size) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const spread = Math.PI / 7;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - size * Math.cos(angle - spread), to.y - size * Math.sin(angle - spread));
    ctx.lineTo(to.x - size * Math.cos(angle + spread), to.y - size * Math.sin(angle + spread));
    ctx.closePath();
    ctx.fill();
  }

  // ---------------------------------------------------------------
  // テーブル(表)
  // ---------------------------------------------------------------

  /** type:"table" オブジェクトを描画する。行・列は均等割りのシンプルな表。 */
  function renderTable(ctx, obj) {
    const rows = obj.rows;
    const cols = obj.cols;
    const cellW = obj.width / cols;
    const cellH = obj.height / rows;
    const cellStyles = obj.cellStyles || [];

    function styleFor(r, c) {
      return (cellStyles[r] && cellStyles[r][c]) || {};
    }

    // セル背景(「背景を透過する」がONの場合、個別に色指定されたセルだけ塗る)
    for (let r = 0; r < rows; r++) {
      const isHeader = obj.headerRow && r === 0;
      for (let c = 0; c < cols; c++) {
        const style = styleFor(r, c);
        if (obj.transparentBg && !style.bg) continue;
        ctx.fillStyle = style.bg || (isHeader ? obj.headerBgColor : obj.cellBgColor) || "#ffffff";
        ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
      }
    }

    // 罫線
    if (obj.borderWidth > 0) {
      ctx.strokeStyle = obj.borderColor || "#000000";
      ctx.lineWidth = obj.borderWidth;
      for (let r = 0; r <= rows; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * cellH);
        ctx.lineTo(obj.width, r * cellH);
        ctx.stroke();
      }
      for (let c = 0; c <= cols; c++) {
        ctx.beginPath();
        ctx.moveTo(c * cellW, 0);
        ctx.lineTo(c * cellW, obj.height);
        ctx.stroke();
      }
    }

    // セル文字(はみ出す場合はmaxWidth指定で自動的に少し縮めて収める簡易対応)
    ctx.textBaseline = "middle";
    ctx.font = `${obj.fontSize}px ${obj.fontFamily || "sans-serif"}`;
    const maxTextWidth = Math.max(4, cellW - 10);
    const padding = 6;
    for (let r = 0; r < rows; r++) {
      const isHeader = obj.headerRow && r === 0;
      for (let c = 0; c < cols; c++) {
        const text = (obj.cellTexts[r] && obj.cellTexts[r][c]) || "";
        if (!text) continue;
        const style = styleFor(r, c);
        const align = style.align || obj.cellAlign || "center";
        ctx.textAlign = align;
        ctx.fillStyle = style.color || (isHeader ? obj.headerTextColor : obj.cellTextColor) || "#1a1a1a";

        let cx;
        if (align === "left") cx = c * cellW + padding;
        else if (align === "right") cx = (c + 1) * cellW - padding;
        else cx = c * cellW + cellW / 2;
        const cy = r * cellH + cellH / 2;
        ctx.fillText(text, cx, cy, maxTextWidth);
      }
    }
  }

  Object.assign(IM, { renderShape, renderTable });
})(window.IM);
