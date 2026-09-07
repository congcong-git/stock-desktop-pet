const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");

// src 样式文件名 → dist 产物文件名（两者命名不一致，故显式映射）
const CSS_FILES = [
  ["styles.css", "renderer.css"],
  ["pet.css", "pet.css"],
  ["media.css", "media.css"]
];

async function build() {
  fs.mkdirSync(distDir, { recursive: true });

  // 管理面板（V1.0 完整界面）
  await esbuild.build({
    entryPoints: [path.join(srcDir, "renderer.jsx")],
    bundle: true,
    outfile: path.join(distDir, "renderer.js"),
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    target: ["chrome108"],
    loader: {
      ".js": "jsx"
    }
  });

  // 桌面宠物（V2.0 透明小窗）
  await esbuild.build({
    entryPoints: [path.join(srcDir, "pet.jsx")],
    bundle: true,
    outfile: path.join(distDir, "pet.js"),
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    target: ["chrome108"],
    loader: {
      ".js": "jsx"
    }
  });

  // 宠物素材库（V2.1 可视化素材管理窗口）
  await esbuild.build({
    entryPoints: [path.join(srcDir, "media.jsx")],
    bundle: true,
    outfile: path.join(distDir, "media.js"),
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    target: ["chrome108"],
    loader: {
      ".js": "jsx"
    }
  });

  fs.copyFileSync(path.join(srcDir, "index.html"), path.join(distDir, "index.html"));
  fs.copyFileSync(path.join(srcDir, "pet.html"), path.join(distDir, "pet.html"));
  fs.copyFileSync(path.join(srcDir, "media.html"), path.join(distDir, "media.html"));

  // 样式：src 为唯一源头，按映射同步到 dist（dist 下不再手工维护）
  for (const [sourceName, distName] of CSS_FILES) {
    fs.copyFileSync(path.join(srcDir, sourceName), path.join(distDir, distName));
  }

  // 桌面宠物素材：复制 pet 目录（表情 PNG 已透明处理）
  const petAssetsDir = path.join(srcDir, "assets", "pet");
  const distPetAssetsDir = path.join(distDir, "assets", "pet");
  copyDirSync(petAssetsDir, distPetAssetsDir);

  // 去背景：复制 onnxruntime-web 运行时（UMD 入口 + wasm）到 dist/ort/
  // 说明：onnxruntime-web 以 vendor 形式随仓库分发（build/vendor/ort），
  //      不走 npm 依赖，规避不同 Node/Electron 环境的解析与打包差异。
  const ortSourceDir = path.join(rootDir, "build", "vendor", "ort");
  const ortDistDir = path.join(distDir, "ort");
  fs.mkdirSync(ortDistDir, { recursive: true });
  for (const ortFile of fs.readdirSync(ortSourceDir)) {
    if (/\.(js|mjs|wasm)$/.test(ortFile)) {
      fs.copyFileSync(path.join(ortSourceDir, ortFile), path.join(ortDistDir, ortFile));
    }
  }

  // 去背景：复制 AI 分割模型到 dist/models/
  const modelSourceDir = path.join(rootDir, "build", "models");
  const modelDistDir = path.join(distDir, "models");
  fs.mkdirSync(modelDistDir, { recursive: true });
  fs.copyFileSync(path.join(modelSourceDir, "u2netp.onnx"), path.join(modelDistDir, "u2netp.onnx"));
}

/** 兼容旧版 Node 的递归目录复制 */
function copyDirSync(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir)) {
    const from = path.join(sourceDir, entry);
    const to = path.join(targetDir, entry);
    if (fs.statSync(from).isDirectory()) {
      copyDirSync(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
