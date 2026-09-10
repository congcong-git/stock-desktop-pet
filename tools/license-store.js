/**
 * 授权签发核心逻辑：命令行工具（gen-license.js）与可视化工具（license-admin）共用。
 * 私钥只存在于本机 keys/private.pem，绝不进代码、不进仓库、不进安装包。
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const keysDir = path.join(rootDir, "keys");
const privateKeyPath = path.join(keysDir, "private.pem");
const publicKeyPath = path.join(keysDir, "public.pem");
const ledgerPath = path.join(keysDir, "licenses.json");

const MAX_MACHINES = 3;

// Base32（RFC 4648）：字母表不含 "-" 与易混字符（0/1/8/9），激活码里可安全用 "-" 分隔
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function ensureKeysDir() {
  if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true });
}

function hasPrivateKey() {
  return fs.existsSync(privateKeyPath);
}

function readLedger() {
  if (!fs.existsSync(ledgerPath)) return { max: MAX_MACHINES, machines: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    return { max: parsed.max || MAX_MACHINES, machines: Array.isArray(parsed.machines) ? parsed.machines : [] };
  } catch (_error) {
    return { max: MAX_MACHINES, machines: [] };
  }
}

function writeLedger(ledger) {
  ensureKeysDir();
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function normalizeMachineId(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

function formatCode(code) {
  return code.replace(/(.{8})(?=.)/g, "$1-");
}

function generateKeyPair() {
  ensureKeysDir();
  // Ed25519：签名 64 字节，激活码比 RSA-2048 短一大截，验签也更快
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  fs.writeFileSync(privateKeyPath, privateKey, "utf8");
  fs.writeFileSync(publicKeyPath, publicKey, "utf8");
  return { publicKey, privateKey };
}

function readPublicKey() {
  if (!fs.existsSync(publicKeyPath)) return "";
  return fs.readFileSync(publicKeyPath, "utf8");
}

function signPayload(payload) {
  const privateKey = fs.readFileSync(privateKeyPath, "utf8");
  const payloadBuffer = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = crypto.sign(null, payloadBuffer, privateKey); // Ed25519
  return `${base32Encode(payloadBuffer)}.${base32Encode(signature)}`;
}

/**
 * 签发：返回 { ok, code?, record?, message? }
 * 同一机器重复签发会覆盖记录，不额外占用名额。
 */
function issue({ machineId: rawMachineId, owner: rawOwner }) {
  const machineId = normalizeMachineId(rawMachineId);
  const owner = String(rawOwner || "").trim() || "未署名用户";
  if (!machineId) return { ok: false, message: "请输入机器码" };
  if (!hasPrivateKey()) return { ok: false, message: "缺少私钥 keys/private.pem，请先生成密钥" };

  const ledger = readLedger();
  const existing = ledger.machines.find((item) => item.machineId === machineId);
  if (!existing && ledger.machines.length >= ledger.max) {
    return { ok: false, message: `名额已满（${ledger.machines.length}/${ledger.max}），请先解绑一台旧机器` };
  }

  const payload = {
    v: 1,
    mid: machineId, // 绑定机器：换机器即失效，也是"最多 3 台"的落地点
    owner,
    iat: Date.now(),
    exp: null // 永久有效
  };

  let code;
  try {
    code = signPayload(payload);
  } catch (_error) {
    return { ok: false, message: "签名失败，请确认私钥可用" };
  }

  const record = { machineId, owner, issuedAt: payload.iat, code };
  const machines = existing
    ? ledger.machines.map((item) => (item.machineId === machineId ? record : item))
    : ledger.machines.concat(record);
  writeLedger({ max: ledger.max, machines });

  return { ok: true, code: formatCode(code), record, used: machines.length, max: ledger.max };
}

function revoke(rawMachineId) {
  const machineId = normalizeMachineId(rawMachineId);
  const ledger = readLedger();
  const machines = ledger.machines.filter((item) => item.machineId !== machineId);
  if (machines.length === ledger.machines.length) {
    return { ok: false, message: `未找到该机器：${machineId}` };
  }
  writeLedger({ max: ledger.max, machines });
  return { ok: true, used: machines.length, max: ledger.max };
}

function list() {
  const ledger = readLedger();
  return {
    max: ledger.max,
    used: ledger.machines.length,
    hasKey: hasPrivateKey(),
    machines: ledger.machines.map((item) => ({
      machineId: item.machineId,
      owner: item.owner,
      issuedAt: item.issuedAt,
      code: formatCode(item.code)
    }))
  };
}

module.exports = {
  MAX_MACHINES,
  keysDir,
  privateKeyPath,
  publicKeyPath,
  ensureKeysDir,
  hasPrivateKey,
  generateKeyPair,
  readPublicKey,
  normalizeMachineId,
  formatCode,
  issue,
  revoke,
  list
};
