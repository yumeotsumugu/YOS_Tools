// objects.js
// キャンバス上の「オブジェクト」のデータモデルと、生成・幾何計算を担当する。
// 描画そのものは canvas.js が行う（データと描画を分離する）。

window.IM = window.IM || {};

(function (IM) {
  "use strict";

  const { generateId, degToRad } = IM;

  /**
   * すべてのオブジェクトが共通で持つ基本プロパティ
   */
  function createBaseObject(type, overrides = {}) {
    return {
      id: generateId("object"),
      type,
      name: overrides.name || defaultNameFor(type, overrides.shapeKind),
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      ...overrides,
    };
  }

  function defaultNameFor(type, shapeKind) {
    if (type === "shape" && shapeKind && SHAPE_KIND_DEFS[shapeKind]) {
      return SHAPE_KIND_DEFS[shapeKind].label;
    }
    const labels = {
      image: "画像",
      text: "テキスト",
      rectangle: "四角形",
      circle: "円",
      table: "テーブル",
    };
    return labels[type] || type;
  }

  /** 画像オブジェクトを生成する。imageElement は HTMLImageElement */
  function createImageObject({ x, y, width, height, imageElement, src }) {
    return createBaseObject("image", {
      x,
      y,
      width,
      height,
      imageElement,
      src,
      filters: {
        brightness: 100,
        contrast: 100,
        saturate: 100,
        blur: 0,
        grayscale: false,
        sepia: false,
      },
    });
  }

  /** 画像フィルターの初期値(Resetボタン用) */
  function defaultFilters() {
    return { brightness: 100, contrast: 100, saturate: 100, blur: 0, grayscale: false, sepia: false };
  }

  /** テキストオブジェクトを生成する */
  function createTextObject({ x, y, text = "テキスト" }) {
    return createBaseObject("text", {
      x,
      y,
      width: 300,
      height: 60,
      text,
      fontFamily: "sans-serif",
      fontSize: 32,
      bold: false,
      italic: false,
      color: "#1a1a1a",
      align: "left",
      verticalAlign: "top",
      wrapText: true,
      outlineWidth: 0,
      outlineColor: "#000000",
      shadowEnabled: false,
      shadowColor: "#000000",
      shadowOffsetX: 4,
      shadowOffsetY: 4,
      shadowBlur: 4,
    });
  }

  /** 四角形オブジェクトを生成する */
  function createRectObject({ x, y }) {
    return createBaseObject("rectangle", {
      x,
      y,
      width: 200,
      height: 140,
      fill: "#5b6bf5",
      stroke: "#000000",
      strokeWidth: 0,
      fillOpacity: 1,
      strokeOpacity: 1,
      cornerRadius: 0,
      gradientEnabled: false,
      gradientColor2: "#ffffff",
      gradientAngle: 90,
    });
  }

  /** 円(楕円)オブジェクトを生成する */
  function createCircleObject({ x, y }) {
    return createBaseObject("circle", {
      x,
      y,
      width: 160,
      height: 160,
      fill: "#5b6bf5",
      stroke: "#000000",
      strokeWidth: 0,
      fillOpacity: 1,
      strokeOpacity: 1,
      gradientEnabled: false,
      gradientColor2: "#ffffff",
      gradientAngle: 90,
    });
  }

  /** テーブル(表)オブジェクトを生成する。TRPGのランダム表やステータス表などに使う */
  function createTableObject({ x, y }) {
    const rows = 4;
    const cols = 3;
    const cellTexts = [];
    const cellStyles = [];
    for (let r = 0; r < rows; r++) {
      const textRow = [];
      const styleRow = [];
      for (let c = 0; c < cols; c++) {
        textRow.push(r === 0 ? `見出し${c + 1}` : "");
        styleRow.push(createEmptyCellStyle());
      }
      cellTexts.push(textRow);
      cellStyles.push(styleRow);
    }
    return createBaseObject("table", {
      x,
      y,
      width: 300,
      height: 200,
      rows,
      cols,
      cellTexts,
      cellStyles,
      headerRow: true,
      transparentBg: false,
      cellAlign: "center",
      fontFamily: "sans-serif",
      fontSize: 14,
      borderColor: "#000000",
      borderWidth: 1,
      headerBgColor: "#5b6bf5",
      headerTextColor: "#ffffff",
      cellBgColor: "#ffffff",
      cellTextColor: "#1a1a1a",
    });
  }

  /** セル個別スタイルの初期値。null は「テーブル全体の既定値を使う」を意味する */
  function createEmptyCellStyle() {
    return { bg: null, color: null, align: null };
  }

  /**
   * 行数・列数の変更時に、既存のセル内容(またはスタイル)をできるだけ保ったまま
   * 2次元配列を作り直す汎用関数。cellTexts・cellStylesの両方で使う。
   */
  function resizeTableGrid(grid, newRows, newCols, createDefault) {
    const result = [];
    for (let r = 0; r < newRows; r++) {
      const row = [];
      for (let c = 0; c < newCols; c++) {
        const existing = grid[r] && grid[r][c];
        row.push(existing !== undefined && existing !== null ? existing : createDefault());
      }
      result.push(row);
    }
    return result;
  }

  /**
   * 拡張図形(type: "shape")の種類ごとの定義。
   * 「矢印」は回転機能で4方向すべてに対応できるため1種類のみ、
   * 「破線」は線・線矢印のオプション(dashed)として統合している。
   * label/icon はツールバーの図形選択メニューにそのまま使う。
   */
  const SHAPE_KIND_DEFS = {
    arrow: { label: "矢印", icon: "➜", width: 180, height: 90, extra: { headSizeRatio: 0.4, stemWidthRatio: 0.5, cornerRadius: 0 } },
    arrowElbow: { label: "折線矢印", icon: "↳", width: 160, height: 160, extra: { strokeWidth: 4 } },
    arrowUturn: { label: "Uターン矢印", icon: "↩", width: 160, height: 140, extra: { strokeWidth: 4 } },
    speechRect: { label: "吹き出し(四角)", icon: "▭", width: 200, height: 130, extra: { tailPos: 0.25, tailSize: 30 } },
    speechRoundRect: {
      label: "吹き出し(角丸)",
      icon: "▢",
      width: 200,
      height: 130,
      extra: { tailPos: 0.25, tailSize: 30, cornerRadius: 16 },
    },
    speechOval: { label: "吹き出し(丸)", icon: "◯", width: 200, height: 130, extra: { tailPos: 0.25, tailSize: 30 } },
    star: { label: "星", icon: "★", width: 150, height: 150, extra: { points: 5, innerRatio: 0.5, cornerRadius: 0 } },
    polygon: { label: "正多角形", icon: "⬡", width: 150, height: 150, extra: { sides: 6, cornerRadius: 0 } },
    line: { label: "線", icon: "―", width: 200, height: 4, extra: { strokeWidth: 4, dashed: false } },
    lineArrow: {
      label: "線矢印",
      icon: "→",
      width: 200,
      height: 4,
      extra: { strokeWidth: 4, dashed: false, arrowStart: false, arrowEnd: true },
    },
    sticky: {
      label: "付箋",
      icon: "▨",
      width: 160,
      height: 140,
      extra: { foldCorner: "bottomRight", foldSize: 24, cornerRadius: 0 },
    },
    triangleRight: { label: "直角三角形", icon: "◺", width: 140, height: 140, extra: { cornerRadius: 0 } },
    trapezoid: { label: "台形", icon: "⏢", width: 180, height: 110, extra: { topWidthRatio: 0.6, cornerRadius: 0 } },
    partialCircle: { label: "部分円", icon: "◔", width: 150, height: 150, extra: { startAngle: 0, endAngle: 270 } },
    heart: { label: "ハート", icon: "♥", width: 150, height: 140, extra: {} },
    cloud: { label: "雲形", icon: "☁", width: 190, height: 130, extra: {} },
    cross: { label: "十字", icon: "✚", width: 140, height: 140, extra: { thicknessRatio: 0.35, cornerRadius: 0 } },
    // フリーハンドは「クリックして追加」ではなくペンツールで描いて生成するため、
    // SHAPE_KIND_LIST(図形選択メニュー)には含めない。定義自体はアイコン表示等のために残す。
    freehand: { label: "フリーハンド", icon: "✏️", width: 100, height: 100, extra: { strokeWidth: 4, dashed: false, points: [] } },
  };

  /** ツールバーの図形選択メニュー用に、定義順のリストを返す(フリーハンドは除く) */
  const SHAPE_KIND_LIST = Object.keys(SHAPE_KIND_DEFS)
    .filter((kind) => kind !== "freehand")
    .map((kind) => ({
      kind,
      label: SHAPE_KIND_DEFS[kind].label,
      icon: SHAPE_KIND_DEFS[kind].icon,
    }));

  /** ペンツールで描いたフリーハンドの線をオブジェクト化する */
  function createFreehandObject({ x, y, width, height, points }) {
    const obj = createShapeObject({ x, y, shapeKind: "freehand" });
    obj.x = x;
    obj.y = y;
    obj.width = width;
    obj.height = height;
    obj.points = points;
    return obj;
  }

  /** 拡張図形オブジェクトを生成する。 */
  function createShapeObject({ x, y, shapeKind }) {
    const def = SHAPE_KIND_DEFS[shapeKind];
    if (!def) throw new Error(`未知の図形です: ${shapeKind}`);
    return createBaseObject("shape", {
      x,
      y,
      width: def.width,
      height: def.height,
      shapeKind,
      fill: "#5b6bf5",
      stroke: "#000000",
      strokeWidth: 0,
      fillOpacity: 1,
      strokeOpacity: 1,
      gradientEnabled: false,
      gradientColor2: "#ffffff",
      gradientAngle: 90,
      flipX: false,
      flipY: false,
      ...def.extra,
    });
  }

  /**
   * オブジェクトの回転を考慮した4隅の座標(キャンバス基準)を返す
   * 戻り値: [{x,y}, {x,y}, {x,y}, {x,y}] 左上→右上→右下→左下
   */
  function getObjectCorners(obj) {
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const rad = degToRad(obj.rotation || 0);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const halfW = obj.width / 2;
    const halfH = obj.height / 2;

    const localCorners = [
      { x: -halfW, y: -halfH },
      { x: halfW, y: -halfH },
      { x: halfW, y: halfH },
      { x: -halfW, y: halfH },
    ];

    return localCorners.map(({ x, y }) => ({
      x: cx + x * cos - y * sin,
      y: cy + x * sin + y * cos,
    }));
  }

  /**
   * 指定した点(px, py)がオブジェクトの内部にあるか判定する。
   * オブジェクトのローカル座標系に逆変換してから矩形判定を行う。
   */
  function isPointInObject(obj, px, py) {
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const rad = degToRad(-(obj.rotation || 0));
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const dx = px - cx;
    const dy = py - cy;

    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    return (
      localX >= -obj.width / 2 &&
      localX <= obj.width / 2 &&
      localY >= -obj.height / 2 &&
      localY <= obj.height / 2
    );
  }

  /** オブジェクトの中心座標 */
  function getObjectCenter(obj) {
    return { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
  }

  Object.assign(IM, {
    createImageObject,
    defaultFilters,
    createTextObject,
    createRectObject,
    createCircleObject,
    createTableObject,
    createEmptyCellStyle,
    resizeTableGrid,
    createShapeObject,
    createFreehandObject,
    SHAPE_KIND_LIST,
    SHAPE_KIND_DEFS,
    getObjectCorners,
    isPointInObject,
    getObjectCenter,
  });
})(window.IM);
