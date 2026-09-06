// apng.js
// APNG(Animated PNG)の生成を担当する。
//
// ブラウザにはAPNGを直接書き出すAPIが無いため、以下の方針で自前実装する:
// 1. 各フレームを通常のPNGとしてCanvasから書き出す(canvas.toBlob("image/png"))
// 2. 各PNGファイルをチャンク単位(IHDR/IDAT/IEND等)に分解する
// 3. APNG仕様に沿って acTL / fcTL / fdAT チャンクを組み立て、
//    1枚目のPNGのIDATはそのまま「デフォルト画像 兼 1フレーム目」として使い、
//    2枚目以降のIDATはシーケンス番号を付けて fdAT に変換して連結する
// 参考: https://wiki.mozilla.org/APNG_Specification

window.IM = window.IM || {};

(function (IM) {
  "use strict";

  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  // ---------------------------------------------------------------
  // CRC32 (PNG/zlibと同じ多項式)
  // ---------------------------------------------------------------
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  // ---------------------------------------------------------------
  // バイト操作ヘルパー
  // ---------------------------------------------------------------
  function u32be(n) {
    return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
  }

  function u16be(n) {
    return new Uint8Array([(n >>> 8) & 0xff, n & 0xff]);
  }

  function concatBytes(arrays) {
    let total = 0;
    for (const a of arrays) total += a.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
      out.set(a, offset);
      offset += a.length;
    }
    return out;
  }

  function asciiBytes(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
    return out;
  }

  // ---------------------------------------------------------------
  // PNGチャンクの分解・組み立て
  // ---------------------------------------------------------------

  /** PNGバイト列をチャンク配列に分解する。各要素は { type, data(中身のみ), raw(チャンク全体) } */
  function parsePngChunks(bytes) {
    const chunks = [];
    let offset = 8; // シグネチャ分をスキップ
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset < bytes.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7]
      );
      const dataStart = offset + 8;
      const data = bytes.subarray(dataStart, dataStart + length);
      const chunkEnd = dataStart + length + 4; // +4 = CRC分
      const raw = bytes.subarray(offset, chunkEnd);
      chunks.push({ type, data, raw });
      offset = chunkEnd;
    }
    return chunks;
  }

  /** type(4文字) + data から、length/CRC込みの完全なチャンクバイト列を作る */
  function buildChunk(type, data) {
    const typeBytes = asciiBytes(type);
    const body = concatBytes([typeBytes, data]);
    const crc = crc32(body);
    return concatBytes([u32be(data.length), body, u32be(crc)]);
  }

  function buildFcTLData({ sequenceNumber, width, height, delayMs }) {
    // delay_num/delay_den で「秒」を表す。delay_denを1000に固定しmsをそのまま分子にする。
    const delayNum = Math.max(1, Math.min(65535, Math.round(delayMs)));
    return concatBytes([
      u32be(sequenceNumber),
      u32be(width),
      u32be(height),
      u32be(0), // x_offset
      u32be(0), // y_offset
      u16be(delayNum),
      u16be(1000), // delay_den
      new Uint8Array([0]), // dispose_op = NONE (前フレームをそのまま残す)
      new Uint8Array([0]), // blend_op = SOURCE (上書き。フレームは常に全面描画のため)
    ]);
  }

  function buildActlData({ numFrames, numPlays }) {
    return concatBytes([u32be(numFrames), u32be(numPlays)]);
  }

  /**
   * 複数のPNG Blob(全フレーム同じ幅・高さ)をAPNGにまとめる。
   * @param {{frameBlobs: Blob[], delaysMs: number[], loopCount: number}} options
   *   loopCount: 0 = 無限ループ、それ以外はその回数だけ再生
   * @returns {Promise<Blob>} APNG(PNG互換)のBlob
   */
  async function encodeAPNG({ frameBlobs, delaysMs, loopCount = 0 }) {
    if (!frameBlobs || frameBlobs.length === 0) {
      throw new Error("フレームが1枚もありません");
    }

    const framesBytes = await Promise.all(
      frameBlobs.map(async (blob) => new Uint8Array(await blob.arrayBuffer()))
    );

    const firstChunks = parsePngChunks(framesBytes[0]);
    const ihdrChunk = firstChunks.find((c) => c.type === "IHDR");
    const iendChunk = firstChunks.find((c) => c.type === "IEND");
    if (!ihdrChunk || !iendChunk) {
      throw new Error("PNGの解析に失敗しました(IHDR/IENDが見つかりません)");
    }
    const ihdrView = new DataView(
      ihdrChunk.data.buffer,
      ihdrChunk.data.byteOffset,
      ihdrChunk.data.byteLength
    );
    const width = ihdrView.getUint32(0);
    const height = ihdrView.getUint32(4);

    const parts = [new Uint8Array(PNG_SIGNATURE), ihdrChunk.raw];

    parts.push(buildChunk("acTL", buildActlData({ numFrames: framesBytes.length, numPlays: loopCount })));

    let seq = 0;

    // フレーム0: デフォルト画像を兼ねるため、fcTLの直後に元のIDATチャンクをそのまま置く
    parts.push(
      buildChunk(
        "fcTL",
        buildFcTLData({ sequenceNumber: seq, width, height, delayMs: delaysMs[0] })
      )
    );
    seq += 1;
    for (const c of firstChunks) {
      if (c.type === "IDAT") parts.push(c.raw);
    }

    // フレーム1以降: fcTL + fdAT(元IDATのデータをシーケンス番号付きで包み直す)
    for (let i = 1; i < framesBytes.length; i++) {
      const chunks = parsePngChunks(framesBytes[i]);
      const idatChunks = chunks.filter((c) => c.type === "IDAT");

      parts.push(
        buildChunk(
          "fcTL",
          buildFcTLData({ sequenceNumber: seq, width, height, delayMs: delaysMs[i] })
        )
      );
      seq += 1;

      for (const idat of idatChunks) {
        const fdatData = concatBytes([u32be(seq), idat.data]);
        parts.push(buildChunk("fdAT", fdatData));
        seq += 1;
      }
    }

    parts.push(iendChunk.raw);

    const finalBytes = concatBytes(parts);
    return new Blob([finalBytes], { type: "image/png" });
  }

  // ---------------------------------------------------------------
  // アニメーションプリセットの数式
  // ---------------------------------------------------------------

  /**
   * プリセットアニメーションの、進行度tにおける変形量を計算する。
   * @param {string} preset - "blink"|"fade"|"flicker"|"moveVertical"|"moveHorizontal"|"scale"|"rotate"|"shake"
   * @param {number} tRaw - 0〜1未満: アニメーション全体での進行度
   * @param {number} speedCycles - 全体の長さの中で何周期繰り返すか(速度)
   * @param {number} strengthPercent - 強さ(0〜100)
   * @returns {object} 部分的な変形パッチ (opacity / dxRatio / dyRatio / dxPx / dyPx / scale / rotationDeg)
   */
  function computeAnimationTransform(preset, tRaw, speedCycles, strengthPercent) {
    const s = Math.max(0, Math.min(100, strengthPercent)) / 100;
    const cycles = Math.max(1, speedCycles);
    const t = (tRaw * cycles) % 1; // 周期内の進行度(0〜1)

    switch (preset) {
      case "blink":
        return { opacity: t < 0.5 ? 1 : Math.max(0, 1 - s) };
      case "fade":
        return { opacity: 1 - s * (0.5 - 0.5 * Math.cos(2 * Math.PI * t)) };
      case "flicker":
        return { opacity: 1 - s * Math.abs(Math.sin(t * 2 * Math.PI * 6)) };
      case "moveVertical":
        return { dyRatio: Math.sin(2 * Math.PI * t) * s * 0.3 };
      case "moveHorizontal":
        return { dxRatio: Math.sin(2 * Math.PI * t) * s * 0.3 };
      case "scale":
        return { scale: 1 + s * 0.3 * Math.sin(2 * Math.PI * t) };
      case "rotate":
        return { rotationDeg: 360 * cycles * tRaw };
      case "shake":
        return {
          dxPx: Math.sin(tRaw * cycles * 2 * Math.PI * 8) * s * 10,
          dyPx: Math.cos(tRaw * cycles * 2 * Math.PI * 11) * s * 6,
        };
      default:
        return {};
    }
  }

  const ANIMATION_PRESETS = [
    { value: "blink", label: "点滅" },
    { value: "fade", label: "フェード" },
    { value: "flicker", label: "明滅" },
    { value: "moveVertical", label: "上下移動" },
    { value: "moveHorizontal", label: "左右移動" },
    { value: "scale", label: "拡大縮小" },
    { value: "rotate", label: "回転" },
    { value: "shake", label: "揺れ" },
  ];

  Object.assign(IM, {
    encodeAPNG,
    computeAnimationTransform,
    ANIMATION_PRESETS,
    parsePngChunks, // テスト・デバッグ用に公開
  });
})(window.IM);
