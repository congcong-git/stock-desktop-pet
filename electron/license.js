/**
 * 离线授权模块（主进程）
 *
 * 设计要点：
 * 1. 应用只内置**公钥**，激活码由开发者用私钥签发（tools/gen-license.js），因此用户无法伪造；
 * 2. 激活码**绑定机器指纹**，拷贝到别的机器立即失效，这是"最多 3 台"的技术落地点；
 * 3. 授权校验全部在主进程完成：未授权不创建宠物窗口、不刷新行情，改渲染层 JS 绕不过；
 * 4. 授权文件带 machineId 与 lastSeenAt，可识别"改系统时间"等异常（为将来有效期预留）。
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { app } = require("electron");

// Base32（RFC 4648）：激活码用 Base32 编码，字母表不含 "-"，所以 "-" 可安全用作抄写分隔符
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input) {
  const clean = String(input || "").toUpperCase().replace(/[=\s]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("invalid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 公钥（Ed25519）：由 tools/gen-license.js keygen 生成后写入，私钥不进代码、不进仓库
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEANMV8ipv5ru2kUqCP1s+jFB5gjfVny0T6PZuuFUIVpjA=
-----END PUBLIC KEY-----`;

const LICENSE_FILE_NAME = "license.dat";
const CLOCK_SKEW_TOLERANCE_MS = 24 * 60 * 60 * 1000; // 允许的系统时间回拨容差

// 硬件厂商常见的占位值，不能作为指纹依据
const INVALID_FINGERPRINT_VALUES = new Set([
  "",
  "to be filled by o.e.m.",
  "to be filled by o.e.m",
  "default string",
  "none",
  "null",
  "n/a",
  "unknown",
  "0",
  "00000000-0000-0000-0000-000000000000",
  "03000200-0400-0500-0006-000700080009"
]);

let cachedMachineId = null;

function licenseFilePath() {
  return path.join(app.getPath("userData"), LICENSE_FILE_NAME);
}

/** 执行 PowerShell 取一项硬件信息，失败返回空串（不抛错、不影响启动） */
function queryWindowsFact(script) {
  try {
    const output = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, encoding: "utf8", timeout: 8000 }
    );
    return String(output || "").trim();
  } catch (_error) {
    return "";
  }
}

function isValidFact(value) {
  return !INVALID_FINGERPRINT_VALUES.has(String(value || "").trim().toLowerCase());
}

/**
 * 机器指纹：主板序列号 + CPU ID + 系统 UUID + 系统盘序列号 + 主机名，取 SHA-256 前 16 位。
 * 任一项取不到都有降级，保证任何时候都能算出一个稳定的机器码（否则用户会被卡死）。
 */
function getMachineId() {
  if (cachedMachineId) return cachedMachineId;

  const parts = [];
  if (process.platform === "win32") {
    parts.push(queryWindowsFact("(Get-CimInstance Win32_BaseBoard).SerialNumber"));
    parts.push(queryWindowsFact("(Get-CimInstance Win32_Processor).ProcessorId"));
    parts.push(queryWindowsFact("(Get-CimInstance Win32_ComputerSystemProduct).UUID"));
    parts.push(queryWindowsFact("(Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\").VolumeSerialNumber"));
  }

  // 通用兜底：主机名 + 平台 + 架构，保证总有稳定素材
  parts.push(os.hostname());
  parts.push(`${process.platform}/${process.arch}`);

  const meaningful = parts.filter(isValidFact);
  const digest = crypto.createHash("sha256").update(meaningful.join("|")).digest("hex");
  cachedMachineId = digest
    .slice(0, 16)
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, "$1-");
  return cachedMachineId;
}

function readLicenseFile() {
  try {
    return JSON.parse(fs.readFileSync(licenseFilePath(), "utf8"));
  } catch (_error) {
    return null;
  }
}

function writeLicenseFile(data) {
  try {
    fs.writeFileSync(licenseFilePath(), `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return true;
  } catch (_error) {
    return false;
  }
}

/** 把用户粘贴的激活码还原成标准格式：去掉空白、分隔线、全角字符 */
function normalizeCode(raw) {
  return String(raw || "")
    .replace(/[\s\u3000]/g, "")
    .replace(/[—–－]/g, "-")
    .replace(/-/g, "")
    .trim();
}

/** 验签并取出 payload（不校验机器是否匹配，交给调用方） */
function verifySignature(code) {
  const packed = normalizeCode(code);
  const pieces = packed.split(".");
  if (pieces.length !== 2 || !pieces[0] || !pieces[1]) {
    return { ok: false, reason: "malformed" };
  }
  try {
    const payloadBuffer = base32Decode(pieces[0]);
    const signature = base32Decode(pieces[1]);
    const valid = crypto.verify(null, payloadBuffer, PUBLIC_KEY_PEM, signature); // Ed25519
    if (!valid) return { ok: false, reason: "invalid-signature" };
    const payload = JSON.parse(payloadBuffer.toString("utf8"));
    if (!payload || typeof payload.mid !== "string") return { ok: false, reason: "malformed" };
    return { ok: true, payload };
  } catch (_error) {
    return { ok: false, reason: "malformed" };
  }
}

const REASON_TEXT = {
  "no-license": "尚未激活",
  malformed: "激活码格式不正确",
  "invalid-signature": "激活码无效（签名校验未通过）",
  "machine-mismatch": "激活码与本机不匹配（每台机器需单独签发）",
  expired: "授权已过期",
  "clock-rollback": "检测到系统时间异常，请校准后重试"
};

/**
 * 当前授权状态。返回 { ok, reason, info }
 * ok=true 时 info 含 owner / machineId / activatedAt / permanent
 */
function getStatus() {
  const machineId = getMachineId();
  const stored = readLicenseFile();
  if (!stored || !stored.code) {
    return { ok: false, reason: "no-license", machineId };
  }

  const verified = verifySignature(stored.code);
  if (!verified.ok) return { ok: false, reason: verified.reason, machineId };
  if (verified.payload.mid !== machineId) {
    return { ok: false, reason: "machine-mismatch", machineId };
  }
  if (verified.payload.exp && Date.now() > Number(verified.payload.exp)) {
    return { ok: false, reason: "expired", machineId };
  }

  // 系统时间回拨检测（为按有效期授权预留；永久授权下主要防止篡改环境因素）
  const now = Date.now();
  const lastSeenAt = Number(stored.lastSeenAt || 0);
  if (lastSeenAt && now < lastSeenAt - CLOCK_SKEW_TOLERANCE_MS) {
    return { ok: false, reason: "clock-rollback", machineId };
  }
  writeLicenseFile({ ...stored, lastSeenAt: now });

  return {
    ok: true,
    machineId,
    info: {
      owner: verified.payload.owner || "未署名用户",
      machineId,
      activatedAt: stored.activatedAt || verified.payload.iat,
      permanent: !verified.payload.exp
    }
  };
}

/** 激活：验签 + 机器匹配 + 落盘 */
function activate(rawCode) {
  const verified = verifySignature(rawCode);
  if (!verified.ok) return { ok: false, message: REASON_TEXT[verified.reason] || "激活码无效" };

  const machineId = getMachineId();
  if (verified.payload.mid !== machineId) {
    return { ok: false, message: `${REASON_TEXT["machine-mismatch"]}（本机 ${machineId}）` };
  }
  if (verified.payload.exp && Date.now() > Number(verified.payload.exp)) {
    return { ok: false, message: REASON_TEXT.expired };
  }

  const now = Date.now();
  const written = writeLicenseFile({
    code: normalizeCode(rawCode),
    machineId,
    owner: verified.payload.owner || "未署名用户",
    activatedAt: now,
    lastSeenAt: now
  });
  if (!written) return { ok: false, message: "授权文件写入失败，请确认磁盘可写" };
  return { ok: true };
}

module.exports = {
  getMachineId,
  getStatus,
  activate,
  reasonText: (reason) => REASON_TEXT[reason] || "授权状态异常"
};
