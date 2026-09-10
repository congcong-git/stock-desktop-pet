#!/usr/bin/env node
/**
 * 牛来桌宠 · 离线授权签发工具（命令行版，不参与打包）
 * 更推荐可视化版：npm run license-admin
 *
 * 命令：
 *   node tools/gen-license.js keygen                          生成密钥对（只需一次）
 *   node tools/gen-license.js public                          打印公钥（写入 electron/license.js）
 *   node tools/gen-license.js issue --machine=XXXX-XXXX-XXXX-XXXX --owner=张三
 *   node tools/gen-license.js issue --machine=XXXX --owner-file=owner.txt   中文归属用这个（避免控制台编码问题）
 *   node tools/gen-license.js list                            查看已签发机器与名额
 *   node tools/gen-license.js revoke --machine=XXXX-XXXX-XXXX-XXXX          解绑，释放名额
 */
const fs = require("fs");
const store = require("./license-store");

function parseArgs(argv) {
  const args = { command: argv[2] || "", options: {} };
  for (let i = 3; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const [key, value] = token.slice(2).split("=");
      args.options[key] = value === undefined ? true : value;
    }
  }
  return args;
}

/** 归属名：Windows PowerShell 传中文参数可能损坏，支持从 UTF-8 文件读取 */
function resolveOwner(options) {
  const ownerFile = options["owner-file"];
  if (ownerFile && typeof ownerFile === "string") {
    return fs.readFileSync(ownerFile, "utf8").trim();
  }
  return String(options.owner || "").trim();
}

function commandKeygen() {
  if (store.hasPrivateKey() && process.argv.indexOf("--force") === -1) {
    console.log("密钥对已存在，跳过。如需重签请加 --force（旧激活码将全部失效）。");
    return;
  }
  store.generateKeyPair();
  console.log(`已生成密钥对：\n  ${store.privateKeyPath}\n  ${store.publicKeyPath}`);
  console.log("\n请把公钥写入 electron/license.js 的 PUBLIC_KEY_PEM（执行：node tools/gen-license.js public）。");
}

function commandPublic() {
  const key = store.readPublicKey();
  if (!key) {
    console.error("还没有公钥，请先执行 keygen。");
    process.exit(1);
  }
  console.log(key);
}

function commandIssue(options) {
  const result = store.issue({
    machineId: options.machine,
    owner: resolveOwner(options)
  });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(`\n机器：${result.record.machineId}\n归属：${result.record.owner}\n\n激活码：\n${result.code}\n`);
  console.log(`名额占用：${result.used}/${result.max}`);
}

function commandList() {
  const data = store.list();
  console.log(`名额：${data.used}/${data.max}\n`);
  if (!data.machines.length) {
    console.log("（暂无签发记录）");
    return;
  }
  data.machines.forEach((item, index) => {
    console.log(`${index + 1}. ${item.machineId}  ${item.owner}  签发于 ${new Date(item.issuedAt).toLocaleString()}`);
  });
}

function commandRevoke(options) {
  const result = store.revoke(options.machine);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(`已解绑 ${store.normalizeMachineId(options.machine)}，名额占用：${result.used}/${result.max}`);
}

function main() {
  const args = parseArgs(process.argv);
  switch (args.command) {
    case "keygen":
      commandKeygen();
      break;
    case "public":
      commandPublic();
      break;
    case "issue":
      commandIssue(args.options);
      break;
    case "list":
      commandList();
      break;
    case "revoke":
      commandRevoke(args.options);
      break;
    default:
      console.log(
        "用法：\n" +
          "  node tools/gen-license.js keygen\n" +
          "  node tools/gen-license.js public\n" +
          "  node tools/gen-license.js issue --machine=XXXX-XXXX-XXXX-XXXX --owner=张三\n" +
          "  node tools/gen-license.js list\n" +
          "  node tools/gen-license.js revoke --machine=XXXX-XXXX-XXXX-XXXX\n\n" +
          "可视化版：npm run license-admin"
      );
  }
}

main();
