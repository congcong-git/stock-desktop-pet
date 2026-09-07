/**
 * 宠物素材去背景（静态图）
 *
 * 使用 U2Net 轻量版（u2netp）ONNX 模型，在渲染进程用 onnxruntime-web 的 WASM 后端推理，
 * 得到前景概率 mask 后按阈值与羽化参数合成 alpha 通道，输出透明 PNG。
 *
 * 依赖：页面需先引入 ./ort/ort.min.js（UMD，挂到 window.ort），
 *      模型与 wasm 位于 ./models/ 与 ./ort/。
 *
 * 设计要点：
 * - 推理只做一次（较慢，约 0.3~1.5s），mask 缓存在内存
 * - 阈值 / 羽化调整只重做合成（毫秒级），可实时预览
 */

/**
 * 打包运行（app.asar）时 dist 内文件无法被 fetch，主进程会把 ort / models
 * 复制到 userData/assets 并经 ?assets= 传入；开发模式走相对路径。
 */
function resolveAssetBase() {
  try {
    if (typeof window === "undefined" || !window.location) return "";
    const value = new URLSearchParams(window.location.search).get("assets");
    return value ? decodeURIComponent(value) : "";
  } catch (_error) {
    return "";
  }
}

const ASSET_BASE = resolveAssetBase();
const assetUrl = (relative) => {
  if (!ASSET_BASE) return `./${relative}`;
  const normalized = ASSET_BASE.replace(/\\/g, "/").replace(/^file:\/\/\//, "");
  return `file:///${encodeURI(normalized)}/${relative}`;
};
const MODEL_URL = assetUrl("models/u2netp.onnx");
const WASM_DIR = `${assetUrl("ort")}/`;
const INPUT_SIZE = 320;
// U2Net 训练时使用的归一化参数
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
// mask 二值化的软过渡宽度：避免硬边锯齿，同时保留可调阈值的手感
const SOFT_EDGE = 0.14;

let sessionPromise = null;

function getOrt() {
  const ort = typeof window !== "undefined" ? window.ort : null;
  if (!ort) throw new Error("推理引擎未加载（ort.min.js 缺失）");
  return ort;
}

/** 加载模型（单例，重复调用复用同一个 session） */
export function loadModel() {
  if (sessionPromise) return sessionPromise;
  const ort = getOrt();
  ort.env.wasm.wasmPaths = WASM_DIR;
  // file:// 下 SharedArrayBuffer 通常不可用，强制单线程，避免启动失败
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";
  sessionPromise = ort.InferenceSession.create(MODEL_URL, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all"
  }).catch((error) => {
    sessionPromise = null;
    throw error;
  });
  return sessionPromise;
}

/** 图片 URL → HTMLImageElement */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = url;
  });
}

/** 缩放并归一化成模型输入：NCHW float32 */
function buildInputTensor(image) {
  const canvas = document.createElement("canvas");
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const pixels = INPUT_SIZE * INPUT_SIZE;
  const tensor = new Float32Array(pixels * 3);
  let offset = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    const mean = MEAN[channel];
    const std = STD[channel];
    for (let i = 0; i < pixels; i += 1) {
      tensor[offset] = (data[i * 4 + channel] / 255 - mean) / std;
      offset += 1;
    }
  }
  return tensor;
}

/**
 * 推理出前景 mask
 * @returns {HTMLCanvasElement} 与模型输出同尺寸的灰度图，亮度即前景概率
 */
export async function computeMask(image) {
  const ort = getOrt();
  const session = await loadModel();
  const inputName = session.inputNames[0];
  const tensor = new ort.Tensor("float32", buildInputTensor(image), [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const outputs = await session.run({ [inputName]: tensor });
  const result = outputs[session.outputNames[0]];
  const raw = result.data;
  const dims = result.dims || [];
  const size = dims[dims.length - 1] || INPUT_SIZE;

  // 输出值域不固定，先按 min-max 归一化到 0~1
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < raw.length; i += 1) {
    const value = raw[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min || 1;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const value = (raw[i] - min) / range;
    const gray = Math.max(0, Math.min(255, Math.round(value * 255)));
    imageData.data[i * 4] = gray;
    imageData.data[i * 4 + 1] = gray;
    imageData.data[i * 4 + 2] = gray;
    imageData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * 用 mask 合成透明图
 * @param {HTMLImageElement} image 原图
 * @param {HTMLCanvasElement} mask computeMask 的结果
 * @param {{threshold?: number, feather?: number}} options
 * @returns {HTMLCanvasElement} 带 alpha 的画布
 */
export function applyMask(image, mask, options = {}) {
  const threshold = typeof options.threshold === "number" ? options.threshold : 0.5;
  const feather = typeof options.feather === "number" ? options.feather : 1;
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  // mask 放大到原图尺寸，羽化借助浏览器 canvas 的模糊滤镜
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (feather > 0) {
    maskCtx.filter = `blur(${feather}px)`;
  }
  maskCtx.drawImage(mask, 0, 0, width, height);
  maskCtx.filter = "none";
  const maskPixels = maskCtx.getImageData(0, 0, width, height).data;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const output = ctx.getImageData(0, 0, width, height);
  const data = output.data;

  const low = threshold - SOFT_EDGE / 2;
  for (let i = 0; i < width * height; i += 1) {
    const probability = maskPixels[i * 4] / 255;
    let alpha = SOFT_EDGE > 0 ? (probability - low) / SOFT_EDGE : (probability >= threshold ? 1 : 0);
    alpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    data[i * 4 + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(output, 0, 0);
  return canvas;
}

/** canvas → PNG 二进制（供主进程落盘） */
export function canvasToPngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("生成图片失败"));
        return;
      }
      blob
        .arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)))
        .catch(reject);
    }, "image/png");
  });
}
