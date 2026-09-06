const { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const https = require("https");
const http = require("http");
const zlib = require("zlib");
const iconv = require("iconv-lite");

const MAX_HISTORY_DAYS = 30;
const MAX_STOCK_CACHE = 300;

// 宠物外观（情绪素材替换，V2.0）
const MOOD_LABELS = { idle: "待机（持平）", happy: "开心（盈利）", sad: "沮丧（亏损）" };
const MEDIA_IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const MEDIA_VIDEO_EXTS = [".mp4", ".webm", ".mov", ".m4v"];
const MAX_MEDIA_SIZE_MB = 300;

// A 股每年固定休市的"月-日"，用于兜底交易日历（PRD 23.4）
const DEFAULT_FIXED_HOLIDAYS = ["01-01", "05-01", "10-01", "10-02", "10-03"];

const runtimeCache = {
  lastLiveResult: null,
  lastSnapshotKey: "",
  lastValidHoldingCodes: null,
  dataNotices: [],
  marketConfig: null,
  marketConfigLoadedAt: 0
};

function getDataDir() {
  return path.join(app.getPath("userData"), "Data");
}

function getFilePath(fileName) {
  return path.join(getDataDir(), fileName);
}

// —— 宠物外观（情绪素材替换）工具 ——

function getMoodMediaDir() {
  return path.join(app.getPath("userData"), "mood-media");
}

/** 依据扩展名判断素材类型：image / video / null（不支持） */
function mediaKindOf(name) {
  const ext = path.extname(name).toLowerCase();
  if (MEDIA_IMAGE_EXTS.includes(ext)) return "image";
  if (MEDIA_VIDEO_EXTS.includes(ext)) return "video";
  return null;
}

function toFileUrl(filePath) {
  return pathToFileURL(filePath).href;
}

/** 扫描素材目录，返回全部素材（name 与源文件名一致，可直接作绑定标识） */
function listMoodMedia() {
  const dir = getMoodMediaDir();
  if (!fs.existsSync(dir)) return [];
  const items = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const kind = mediaKindOf(entry.name);
    if (!kind) continue;
    items.push({ name: entry.name, kind, url: toFileUrl(path.join(dir, entry.name)) });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

/** 同名文件自动追加 "(2)""(3)"…，避免覆盖旧素材 */
function uniqueMediaDestPath(dir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = fileName;
  let index = 2;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${index})${ext}`;
    index += 1;
  }
  return path.join(dir, candidate);
}

/** 校验并复制单个素材文件进素材库；成功返回 { item }，失败返回 { error } */
function copyMediaFileToLibrary(sourcePath) {
  const kind = mediaKindOf(sourcePath);
  if (!kind) return { error: "unsupported" };

  let stat;
  try {
    stat = fs.statSync(sourcePath);
  } catch (_error) {
    return { error: "read" };
  }
  if (!stat.isFile()) return { error: "unsupported" };
  if (stat.size > MAX_MEDIA_SIZE_MB * 1024 * 1024) return { error: "too-large" };

  const dir = getMoodMediaDir();
  fs.mkdirSync(dir, { recursive: true });
  const destPath = uniqueMediaDestPath(dir, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, destPath);
  return { item: { name: path.basename(destPath), kind, url: toFileUrl(destPath) } };
}

/** 弹文件选择框导入单个图片/动图/视频素材；取消返回 null，成功返回 { name, kind, url } */
async function importMoodMediaFromDialog(sourceWindow, mood) {
  const moodLabel = MOOD_LABELS[mood] || "情绪";
  const result = await dialog.showOpenDialog(sourceWindow, {
    title: `更换${moodLabel}显示`,
    message: `选择「${moodLabel}」显示的素材：图片 / 动图 / 视频（透明背景推荐 webm 格式）`,
    properties: ["openFile"],
    filters: [
      { name: "图片与动图", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
      { name: "视频", extensions: ["mp4", "webm", "mov", "m4v"] },
      { name: "所有文件", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return null;

  const copied = copyMediaFileToLibrary(result.filePaths[0]);
  if (!copied.item) {
    await dialog.showMessageBox(sourceWindow, {
      type: "warning",
      title: copied.error === "too-large" ? "文件过大" : "不支持的素材",
      message:
        copied.error === "too-large"
          ? `所选文件超过 ${MAX_MEDIA_SIZE_MB}MB，请压缩后重试。`
          : "所选文件格式不受支持",
      detail: copied.error === "too-large" ? undefined : "请选择图片（png/jpg/webp/gif）或视频（mp4/webm/mov）文件。"
    });
    return null;
  }
  return copied.item;
}

/** 弹文件选择框批量导入素材（素材库入口）；返回 { items, rejected } */
async function importMediaFilesFromDialog(sourceWindow) {
  const result = await dialog.showOpenDialog(sourceWindow, {
    title: "导入素材到宠物素材库",
    message: "可多选：图片 / 动图 / 视频。透明背景的宠物素材推荐使用 webm 格式。",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "图片与动图", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
      { name: "视频", extensions: ["mp4", "webm", "mov", "m4v"] },
      { name: "所有文件", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return { items: [], rejected: 0 };

  const items = [];
  let rejected = 0;
  for (const sourcePath of result.filePaths) {
    const copied = copyMediaFileToLibrary(sourcePath);
    if (copied.item) items.push(copied.item);
    else rejected += 1;
  }
  return { items, rejected };
}

// —— 情绪素材绑定（主进程为唯一数据源：Data/mood-bindings.json，多窗口统一同步） ——
const MOOD_KEYS = ["idle", "happy", "sad"];

function normalizeBindings(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const mood of MOOD_KEYS) {
    const raw = value[mood];
    if (typeof raw === "string" && raw.trim()) out[mood] = raw.trim();
  }
  return out;
}

function readMoodBindings() {
  try {
    return normalizeBindings(JSON.parse(fs.readFileSync(getFilePath("mood-bindings.json"), "utf8")));
  } catch (_error) {
    return {};
  }
}

function writeMoodBindings(value) {
  const next = normalizeBindings(value);
  try {
    fs.mkdirSync(getDataDir(), { recursive: true });
    fs.writeFileSync(getFilePath("mood-bindings.json"), JSON.stringify(next, null, 2), "utf8");
  } catch (_error) {
    // 写盘失败不阻塞本次运行（绑定仍会广播同步到各窗口）
  }
  return next;
}

function pushDataNotice(text) {
  if (!runtimeCache.dataNotices.includes(text)) {
    runtimeCache.dataNotices.push(text);
  }
  if (runtimeCache.dataNotices.length > 8) {
    runtimeCache.dataNotices = runtimeCache.dataNotices.slice(-8);
  }
}

function getDefaultData() {
  return {
    "stocks.json": [],
    "watchlist.json": [],
    "holdings.json": [],
    "daily-status.json": {},
    "daily-history.json": {},
    "market-config.json": {
      holidays: [],
      extraTradingDays: [],
      fixedHolidays: DEFAULT_FIXED_HOLIDAYS
    }
  };
}

function ensureDataFiles() {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  Object.entries(getDefaultData()).forEach(([fileName, value]) => {
    const filePath = getFilePath(fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
    }
  });
}

/**
 * 读取本地 JSON：主文件损坏时优先用 .bak 备份恢复，
 * 备份也不可用时隔离损坏文件并返回默认值，保证软件可正常启动（PRD 18.3）。
 */
function readJson(fileName, fallback) {
  ensureDataFiles();
  const filePath = getFilePath(fileName);

  try {
    const content = fs.readFileSync(filePath, "utf8");
    if (!content.trim()) {
      throw new Error("文件内容为空");
    }
    return JSON.parse(content);
  } catch (primaryError) {
    const backupPath = `${filePath}.bak`;
    try {
      const backupValue = JSON.parse(fs.readFileSync(backupPath, "utf8"));
      fs.writeFileSync(filePath, JSON.stringify(backupValue, null, 2), "utf8");
      pushDataNotice(`${fileName} 读取失败，已自动从备份恢复。`);
      return backupValue;
    } catch (backupError) {
      try {
        if (fs.existsSync(filePath)) {
          fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
        }
      } catch (renameError) {
        // 隔离失败不阻断启动
      }
      pushDataNotice(`${fileName} 已损坏且无法恢复，已使用默认空数据。`);
      return fallback;
    }
  }
}

/** 原子写入：先写临时文件再 rename，写前保留一份 .bak（PRD 18.3） */
function writeJson(fileName, value) {
  ensureDataFiles();
  const filePath = getFilePath(fileName);
  const tmpPath = `${filePath}.tmp`;
  const nextContent = JSON.stringify(value, null, 2);

  try {
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    }
    fs.writeFileSync(tmpPath, nextContent, "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    fs.writeFileSync(filePath, nextContent, "utf8");
  }
}

function getMarketConfig() {
  const now = Date.now();
  if (runtimeCache.marketConfig && now - runtimeCache.marketConfigLoadedAt < 5 * 60 * 1000) {
    return runtimeCache.marketConfig;
  }

  const config = readJson("market-config.json", getDefaultData()["market-config.json"]) || {};
  const value = {
    holidays: Array.isArray(config.holidays) ? config.holidays : [],
    extraTradingDays: Array.isArray(config.extraTradingDays) ? config.extraTradingDays : [],
    fixedHolidays: Array.isArray(config.fixedHolidays) ? config.fixedHolidays : DEFAULT_FIXED_HOLIDAYS
  };

  runtimeCache.marketConfig = value;
  runtimeCache.marketConfigLoadedAt = now;
  return value;
}

function isTradingDay(date = new Date()) {
  const config = getMarketConfig();
  const dateKey = formatDateKey(date);

  if (config.extraTradingDays.includes(dateKey)) {
    return true;
  }
  if (config.holidays.includes(dateKey)) {
    return false;
  }

  const monthDay = dateKey.slice(5);
  if (config.fixedHolidays.includes(monthDay)) {
    return false;
  }

  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function getMarketPhase(date = new Date()) {
  if (!isTradingDay(date)) {
    return "非交易日";
  }

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  if (totalMinutes < 9 * 60 + 30) {
    return "开盘前";
  }
  if (totalMinutes < 11 * 60 + 30) {
    return "上午交易";
  }
  if (totalMinutes < 13 * 60) {
    return "午间休市";
  }
  if (totalMinutes < 15 * 60) {
    return "下午交易";
  }
  return "收盘后";
}

function isLiveMarketPhase(phase) {
  return phase === "上午交易" || phase === "下午交易";
}

function isSnapshotCaptureTime(date = new Date()) {
  if (!isTradingDay(date)) {
    return false;
  }

  const hours = date.getHours();
  const minutes = date.getMinutes();
  return (hours === 11 && minutes === 30) || (hours === 15 && minutes === 0);
}

function formatDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getProfitStatus(totalProfit) {
  if (totalProfit > 0) {
    return "盈利";
  }
  if (totalProfit < 0) {
    return "亏损";
  }
  return "持平";
}

function getTrend(current, previous) {
  if (typeof previous !== "number") {
    return "flat";
  }
  if (current > previous) {
    return "bull";
  }
  if (current < previous) {
    return "bear";
  }
  return "flat";
}

function inferMarketFromCode(code) {
  if (String(code).startsWith("6")) {
    return "sh";
  }
  if (String(code).startsWith("4") || String(code).startsWith("8")) {
    return "bj";
  }
  return "sz";
}

function toQuoteSymbol(code, market) {
  const prefix = market || inferMarketFromCode(code);
  return `${prefix}${code}`;
}

function normalizeStock(stock) {
  return {
    code: String(stock.code || "").trim(),
    name: String(stock.name || "").trim(),
    market: stock.market || inferMarketFromCode(stock.code)
  };
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const request = client.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 StockWatcher/1.0",
          "Accept-Encoding": "gzip,deflate"
        }
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          resolve(requestText(response.headers.location));
          return;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`请求失败: ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          try {
            const buffer = Buffer.concat(chunks);
            const encodingHeader = String(response.headers["content-encoding"] || "").toLowerCase();

            let bodyBuffer = buffer;
            if (encodingHeader.includes("gzip")) {
              bodyBuffer = zlib.gunzipSync(buffer);
            } else if (encodingHeader.includes("deflate")) {
              bodyBuffer = zlib.inflateSync(buffer);
            }

            const contentType = String(response.headers["content-type"] || "").toLowerCase();
            const text = contentType.includes("gbk")
              ? iconv.decode(bodyBuffer, "gbk")
              : bodyBuffer.toString("utf8");
            resolve(text);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("error", reject);
  });
}

async function searchStocks(keyword) {
  const query = String(keyword || "").trim();
  if (!query) {
    return [];
  }

  const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(
    query
  )}&type=14&count=10&token=D43BF722C8E33BDC906FB84D85E326E8`;

  const responseText = await requestText(url);
  const data = JSON.parse(responseText);
  const records = (((data || {}).QuotationCodeTable || {}).Data || []).slice(0, 10);

  return records.map((item) => ({
    code: item.Code,
    name: item.Name,
    market: item.MarketType === "1" ? "sh" : item.MarketType === "2" ? "sz" : inferMarketFromCode(item.Code),
    quoteId: item.QuoteID
  }));
}

function parseQuoteLine(line) {
  const matched = line.match(/^v_([a-z0-9]+)="(.*)";?$/i);
  if (!matched) {
    return null;
  }

  const symbol = matched[1];
  const fields = matched[2].split("~");
  if (!fields.length || !fields[1] || !fields[2]) {
    return null;
  }

  const currentPrice = Number(fields[3] || 0);
  const previousClose = Number(fields[4] || 0);
  const openPrice = Number(fields[5] || 0);
  const quote = {
    symbol,
    name: fields[1],
    code: fields[2],
    currentPrice,
    previousClose,
    openPrice,
    changeAmount: Number(fields[31] || currentPrice - previousClose),
    changePercent: Number(fields[32] || 0),
    highPrice: Number(fields[33] || 0),
    lowPrice: Number(fields[34] || 0),
    volume: Number(fields[36] || 0),
    amount: Number(fields[37] || 0),
    latestTime: fields[30] || ""
  };

  quote.openChangePercent =
    openPrice > 0 ? Number((((currentPrice - openPrice) / openPrice) * 100).toFixed(2)) : 0;

  return quote;
}

async function fetchQuotes(stocks) {
  if (!stocks.length) {
    return {};
  }

  const symbols = stocks.map((stock) => toQuoteSymbol(stock.code, stock.market)).join(",");
  const responseText = await requestText(`https://qt.gtimg.cn/q=${symbols}`);
  const lines = responseText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const quotes = {};
  lines.forEach((line) => {
    const parsed = parseQuoteLine(line);
    if (parsed) {
      quotes[parsed.code] = parsed;
    }
  });

  return quotes;
}

function buildDisplayRows(watchlist, holdings, quotes, previousQuotes) {
  const previousQuoteMap = previousQuotes || {};

  const watchlistRows = watchlist.map((stock, index) => {
    const liveQuote = quotes[stock.code];
    const fallbackQuote = previousQuoteMap[stock.code];
    const quote = liveQuote || fallbackQuote || null;
    const hasError = !liveQuote;

    return {
      index: index + 1,
      code: stock.code,
      name: stock.name,
      market: stock.market,
      quote,
      error: hasError && !quote ? "行情获取失败" : hasError ? "已使用上次有效行情" : ""
    };
  });

  const holdingRows = holdings.map((holding, index) => {
    const liveQuote = quotes[holding.code];
    const fallbackQuote = previousQuoteMap[holding.code];
    const quote = liveQuote || fallbackQuote || null;
    // PRD 18.2：单只股票行情缺失时不参与本次盈亏计算，仅保留价格展示
    const dailyProfit =
      liveQuote && liveQuote.previousClose
        ? Number(((liveQuote.currentPrice - liveQuote.previousClose) * Number(holding.quantity || 0)).toFixed(2))
        : null;

    return {
      index: index + 1,
      code: holding.code,
      name: holding.name,
      market: holding.market,
      quantity: Number(holding.quantity || 0),
      costPrice: holding.costPrice != null ? Number(holding.costPrice) : null,
      quote,
      dailyProfit,
      stale: !liveQuote && Boolean(fallbackQuote),
      error: liveQuote ? "" : quote ? "行情获取失败(价格沿用上次,不计入盈亏)" : "行情获取失败"
    };
  });

  return { watchlistRows, holdingRows };
}

/** 记录用户接触过的股票，用于离线场景下的名称回退（PRD 16） */
function rememberStocks(stocks) {
  if (!Array.isArray(stocks) || !stocks.length) {
    return;
  }

  const cache = readJson("stocks.json", []);
  const map = new Map();

  [...cache, ...stocks].forEach((item) => {
    const stock = normalizeStock(item);
    if (stock.code && stock.name) {
      map.set(stock.code, { ...stock, updatedAt: new Date().toISOString() });
    }
  });

  const next = [...map.values()].slice(-MAX_STOCK_CACHE);
  writeJson("stocks.json", next);
}

function readDailyStatus() {
  const raw = readJson("daily-status.json", {});
  return raw && typeof raw === "object" ? raw : {};
}

function archiveDailyStatus(status) {
  if (!status || !status.date || (!status.morning && !status.afternoon)) {
    return;
  }

  const history = readJson("daily-history.json", {}) || {};
  const next = {
    ...history,
    [status.date]: {
      morning: status.morning || null,
      afternoon: status.afternoon || null
    }
  };

  const dates = Object.keys(next).sort();
  while (dates.length > MAX_HISTORY_DAYS) {
    delete next[dates.shift()];
  }

  writeJson("daily-history.json", next);
}

/**
 * 保存 11:30 / 15:00 市场快照（PRD 14、BR016、BR017）。
 * 跨天时先归档历史再重置，避免昨天下午的快照被当成今天的数据（PRD 15.2）。
 */
function saveSnapshot(date, payload) {
  const dateKey = formatDateKey(date);
  const timeKey = payload.snapshotTimeKey || (date.getHours() === 11 ? "morning" : "afternoon");
  const snapshotKey = `${dateKey}-${timeKey}`;

  if (runtimeCache.lastSnapshotKey === snapshotKey) {
    return null;
  }

  let dailyStatus = readDailyStatus();
  if (dailyStatus.date && dailyStatus.date !== dateKey) {
    archiveDailyStatus(dailyStatus);
    dailyStatus = { date: dateKey };
  }

  const snapshot = {
    time: timeKey === "morning" ? "11:30" : "15:00",
    savedAt: date.toISOString(),
    profit: payload.totalProfit,
    status: payload.profitStatus,
    marketPhase: payload.marketPhase,
    watchlistRows: payload.watchlistRows || [],
    holdingRows: payload.holdingRows || []
  };

  const nextStatus = {
    date: dateKey,
    morning: timeKey === "morning" ? snapshot : dailyStatus.morning || null,
    afternoon: timeKey === "afternoon" ? snapshot : dailyStatus.afternoon || null
  };

  writeJson("daily-status.json", nextStatus);
  runtimeCache.lastSnapshotKey = snapshotKey;
  return nextStatus;
}

/**
 * 选择用于恢复的快照（PRD 15）：
 * 1. 今天已有快照 → 用今天（优先 15:00，其次 11:30）；
 * 2. 今天尚无快照 → daily-status.json 中保存的最近一个交易日；
 * 3. 兜底 → daily-history.json 中最近一个已完成交易日。
 */
function pickSnapshot() {
  const dailyStatus = readDailyStatus();
  const todayKey = formatDateKey(new Date());
  const candidates = [];

  if (dailyStatus.date) {
    candidates.push(dailyStatus);
  }

  const history = readJson("daily-history.json", {}) || {};
  Object.keys(history)
    .filter((dateKey) => dateKey !== todayKey && dateKey !== dailyStatus.date)
    .sort()
    .reverse()
    .forEach((dateKey) => candidates.push({ date: dateKey, ...(history[dateKey] || {}) }));

  for (const day of candidates) {
    if (day.afternoon) {
      return { date: day.date, snapshotType: "afternoon", ...day.afternoon };
    }
    if (day.morning) {
      return { date: day.date, snapshotType: "morning", ...day.morning };
    }
  }

  return null;
}

function getTodaySnapshotSummary() {
  const dailyStatus = readDailyStatus();
  if (dailyStatus.date !== formatDateKey(new Date())) {
    return { date: "", morning: null, afternoon: null };
  }

  return {
    date: dailyStatus.date,
    morning: dailyStatus.morning || null,
    afternoon: dailyStatus.afternoon || null
  };
}

/**
 * 计算当前是否需要"补拍"快照：程序在 11:30 / 15:00 未运行时，
 * 启动后仍然可以把当时状态补齐（PRD 14）。
 */
function getPendingSnapshotTime(date = new Date()) {
  if (!isTradingDay(date)) {
    return null;
  }

  const totalMinutes = date.getHours() * 60 + date.getMinutes();
  if (totalMinutes < 11 * 60 + 30) {
    return null;
  }

  const dateKey = formatDateKey(date);
  const dailyStatus = readDailyStatus();
  const isToday = dailyStatus.date === dateKey;

  if (totalMinutes >= 15 * 60) {
    return isToday && dailyStatus.afternoon ? null : "afternoon";
  }

  return isToday && dailyStatus.morning ? null : "morning";
}

/**
 * 非交易时间：读取本地最近一次保存状态展示（PRD 15、BR018）。
 * 恢复场景不参与牛/熊动画判断，趋势固定为 flat。
 */
function restoreStateFromSnapshot({ watchlist, holdings, marketPhase }) {
  const snapshot = pickSnapshot();

  const watchlistRows = watchlist.map((stock, index) => {
    const snapshotRow = ((snapshot && snapshot.watchlistRows) || []).find((row) => row.code === stock.code) || null;
    return {
      index: index + 1,
      code: stock.code,
      name: stock.name,
      market: stock.market,
      quote: snapshotRow ? snapshotRow.quote : null,
      stale: true,
      error: snapshotRow ? "非交易时间，展示最近保存状态" : "暂无最近保存状态"
    };
  });

  const holdingRows = holdings.map((holding, index) => {
    const snapshotRow = ((snapshot && snapshot.holdingRows) || []).find((row) => row.code === holding.code) || null;
    return {
      index: index + 1,
      code: holding.code,
      name: holding.name,
      market: holding.market,
      quantity: Number(holding.quantity || 0),
      costPrice: holding.costPrice != null ? Number(holding.costPrice) : null,
      quote: snapshotRow ? snapshotRow.quote : null,
      dailyProfit: snapshotRow ? snapshotRow.dailyProfit : null,
      stale: true,
      error: snapshotRow ? "非交易时间，展示最近保存状态" : "暂无最近保存状态"
    };
  });

  const totalProfit = snapshot ? Number(snapshot.profit || 0) : 0;

  return {
    success: true,
    isLive: false,
    networkError: false,
    marketPhase,
    refreshedAt: new Date().toISOString(),
    totalProfit,
    profitStatus: snapshot ? snapshot.status || getProfitStatus(totalProfit) : getProfitStatus(totalProfit),
    trend: "flat",
    watchlistRows,
    holdingRows,
    snapshotDate: snapshot ? snapshot.date : "",
    snapshotTime: snapshot ? snapshot.time : "",
    snapshotType: snapshot ? snapshot.snapshotType : "",
    todaySnapshot: getTodaySnapshotSummary(),
    dataNotices: [...runtimeCache.dataNotices],
    message: snapshot
      ? `当前为非交易时间，已恢复 ${snapshot.date} ${snapshot.time} 保存的市场状态。`
      : "当前为非交易时间，暂无可恢复的市场快照。"
  };
}

async function refreshMarket() {
  const watchlist = readJson("watchlist.json", []).map(normalizeStock);
  const holdings = readJson("holdings.json", []).map((item) => ({
    ...normalizeStock(item),
    quantity: Number(item.quantity || 0),
    costPrice: item.costPrice != null && item.costPrice !== "" ? Number(item.costPrice) : null,
    addedAt: item.addedAt || new Date().toISOString()
  }));

  const now = new Date();
  const marketPhase = getMarketPhase(now);
  // 11:30 / 15:00 准点保存；若程序当时未运行，则启动后补拍（PRD 14）
  const snapshotTimeKey = isSnapshotCaptureTime(now)
    ? now.getHours() === 11
      ? "morning"
      : "afternoon"
    : getPendingSnapshotTime(now);
  const shouldFetchLive = isLiveMarketPhase(marketPhase) || Boolean(snapshotTimeKey);

  if (!shouldFetchLive) {
    return restoreStateFromSnapshot({ watchlist, holdings, marketPhase });
  }

  try {
    const allStocks = [];
    const codeSet = new Set();
    [...watchlist, ...holdings].forEach((stock) => {
      if (!codeSet.has(stock.code)) {
        codeSet.add(stock.code);
        allStocks.push(stock);
      }
    });

    if (!allStocks.length) {
      const emptyResult = {
        success: true,
        isLive: true,
        networkError: false,
        marketPhase,
        refreshedAt: now.toISOString(),
        totalProfit: 0,
        profitStatus: "持平",
        trend: "flat",
        watchlistRows: [],
        holdingRows: [],
        snapshotDate: "",
        snapshotTime: "",
        snapshotType: "",
        todaySnapshot: getTodaySnapshotSummary(),
        dataNotices: [...runtimeCache.dataNotices],
        message: "尚未添加自选股或持仓股，请先搜索并添加股票。"
      };
      runtimeCache.lastLiveResult = emptyResult;
      return emptyResult;
    }

    const fetchedQuotes = await fetchQuotes(allStocks);
    const previousQuotes = runtimeCache.lastLiveResult
      ? Object.fromEntries(
          [...runtimeCache.lastLiveResult.watchlistRows, ...runtimeCache.lastLiveResult.holdingRows]
            .filter((row) => row.quote)
            .map((row) => [row.code, row.quote])
        )
      : {};

    const { watchlistRows, holdingRows } = buildDisplayRows(watchlist, holdings, fetchedQuotes, previousQuotes);
    const totalProfit = Number(
      holdingRows.reduce((sum, row) => sum + (typeof row.dailyProfit === "number" ? row.dailyProfit : 0), 0).toFixed(2)
    );
    const profitStatus = getProfitStatus(totalProfit);

    // 只有"参与计算的股票集合"与上一轮一致时，盈亏变化才具备可比性，
    // 避免个别股票行情缺失造成虚假的牛/熊切换（PRD 18.2）
    const validHoldingCodes = holdingRows
      .filter((row) => typeof row.dailyProfit === "number")
      .map((row) => row.code)
      .sort()
      .join(",");
    const comparable =
      runtimeCache.lastValidHoldingCodes == null || runtimeCache.lastValidHoldingCodes === validHoldingCodes;
    const previousProfit = runtimeCache.lastLiveResult ? runtimeCache.lastLiveResult.totalProfit : undefined;
    const trend = comparable ? getTrend(totalProfit, previousProfit) : "flat";
    runtimeCache.lastValidHoldingCodes = validHoldingCodes;

    const missingCount = allStocks.length - Object.keys(fetchedQuotes).length;

    const result = {
      success: true,
      isLive: true,
      networkError: false,
      marketPhase,
      refreshedAt: now.toISOString(),
      totalProfit,
      profitStatus,
      trend,
      watchlistRows,
      holdingRows,
      snapshotDate: "",
      snapshotTime: "",
      snapshotType: "",
      todaySnapshot: getTodaySnapshotSummary(),
      dataNotices: [...runtimeCache.dataNotices],
      message: !missingCount
        ? "行情已更新。"
        : `${missingCount} 只股票行情获取失败，已保留上次价格且不参与本次盈亏计算。`
    };

    if (snapshotTimeKey) {
      const saved = saveSnapshot(now, { ...result, snapshotTimeKey });
      if (saved) {
        const snapshot = saved[snapshotTimeKey];
        result.snapshotDate = saved.date;
        result.snapshotTime = snapshot ? snapshot.time : "";
        result.snapshotType = snapshotTimeKey;
        result.todaySnapshot = getTodaySnapshotSummary();
        result.message = `已保存 ${saved.date} ${snapshotTimeKey === "morning" ? "11:30" : "15:00"} 市场状态。`;
      }
    }

    runtimeCache.lastLiveResult = result;
    return result;
  } catch (error) {
    // PRD 18.1 / 18.4：保留最后一次有效行情，不播放新的牛熊动画
    if (runtimeCache.lastLiveResult) {
      return {
        ...runtimeCache.lastLiveResult,
        success: false,
        isLive: true,
        networkError: true,
        marketPhase,
        refreshedAt: now.toISOString(),
        trend: "flat",
        snapshotDate: "",
        snapshotTime: "",
        snapshotType: "",
        todaySnapshot: getTodaySnapshotSummary(),
        dataNotices: [...runtimeCache.dataNotices],
        message: `网络异常，行情更新失败，已保留上一次有效数据（${error.message}）。`
      };
    }

    return {
      success: false,
      isLive: false,
      networkError: true,
      marketPhase,
      refreshedAt: now.toISOString(),
      totalProfit: 0,
      profitStatus: "持平",
      trend: "flat",
      watchlistRows: watchlist.map((stock, index) => ({
        index: index + 1,
        code: stock.code,
        name: stock.name,
        market: stock.market,
        quote: null,
        stale: false,
        error: "行情获取失败"
      })),
      holdingRows: holdings.map((holding, index) => ({
        index: index + 1,
        code: holding.code,
        name: holding.name,
        market: holding.market,
        quantity: Number(holding.quantity || 0),
        costPrice: holding.costPrice != null ? Number(holding.costPrice) : null,
        quote: null,
        dailyProfit: null,
        stale: false,
        error: "行情获取失败"
      })),
      snapshotDate: "",
      snapshotTime: "",
      snapshotType: "",
      todaySnapshot: getTodaySnapshotSummary(),
      dataNotices: [...runtimeCache.dataNotices],
      message: `网络异常，行情更新失败：${error.message}`
    };
  }
}

let panelWindow = null;
let petWindow = null;
let mediaWindow = null;

const PET_WINDOW = { width: 240, height: 300 };

/** 管理面板（V1.0 完整界面）：单实例，重复打开时聚焦已有窗口 */
function createPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show();
    panelWindow.focus();
    return panelWindow;
  }

  const window = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: "#0f172a",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  window.once("ready-to-show", () => {
    window.show();
  });
  window.on("closed", () => {
    if (panelWindow === window) {
      panelWindow = null;
    }
  });
  panelWindow = window;
  return window;
}

/** 素材库管理窗口（V2.1）：浏览/导入素材，按情绪槽位绑定、一键试穿。单实例，重复打开时聚焦已有窗口 */
function createMediaWindow() {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    mediaWindow.show();
    mediaWindow.focus();
    return mediaWindow;
  }

  const window = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: "牛来 · 宠物素材库",
    backgroundColor: "#0f172a",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.loadFile(path.join(__dirname, "..", "dist", "media.html"));
  window.once("ready-to-show", () => {
    window.show();
  });
  window.on("closed", () => {
    // 关闭素材库时若宠物正在"试穿"，结束试穿回到正常绑定显示
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send("pet:command", { type: "mood-media-preview", item: null });
    }
    if (mediaWindow === window) {
      mediaWindow = null;
    }
  });
  mediaWindow = window;
  return window;
}

/** 广播当前情绪素材绑定到宠物与素材库窗口（保持多窗口一致） */
function broadcastBindings(bindings) {
  const next = normalizeBindings(bindings);
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("pet:command", { type: "mood-media-sync", moodMedia: next });
  }
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    mediaWindow.webContents.send("media:bindings-changed", next);
  }
}

/** 广播素材目录变化（导入/删除/重命名）到宠物与素材库窗口 */
function broadcastLibrary() {
  const items = listMoodMedia();
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("pet:command", { type: "media-library-changed", items });
  }
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    mediaWindow.webContents.send("media:library-changed", items);
  }
}

/** 桌面宠物窗口（V2.0）：透明、无边框、置顶、隐藏任务栏，默认停在屏幕右下角 */
function createPetWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const x = workArea.x + workArea.width - PET_WINDOW.width - 24;
  const y = workArea.y + workArea.height - PET_WINDOW.height - 20;

  const window = new BrowserWindow({
    width: PET_WINDOW.width,
    height: PET_WINDOW.height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // 尽量保持在最高层级，避免被常见窗口覆盖
  window.setAlwaysOnTop(true, "screen-saver");
  window.loadFile(path.join(__dirname, "..", "dist", "pet.html"));

  window.on("closed", () => {
    if (petWindow === window) {
      petWindow = null;
    }
    // 宠物是本产品的主窗口：关闭即结束进程（同时收掉管理面板与素材库）
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.close();
    }
    if (mediaWindow && !mediaWindow.isDestroyed()) {
      mediaWindow.close();
    }
    app.quit();
  });
  petWindow = window;
  return window;
}

/**
 * 宠物右键菜单（V2.0）：首部汇总今日盈亏，其余为业务入口。
 * 概要文本由渲染层传入的最新行情拼装。
 */
ipcMain.on("pet:open-menu", (event, state) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow || sourceWindow.isDestroyed()) {
    return;
  }

  const summary = state && state.summary ? state.summary : "加载中…";
  const phase = state && state.phase ? ` · ${state.phase}` : "";
  const counts =
    state && (state.holdingCount || state.watchlistCount)
      ? `（持仓 ${state.holdingCount || 0} · 自选 ${state.watchlistCount || 0}）`
      : "";

  // —— 底部显示内容子菜单（V2.0 可配置显示项） ——
  const sendCommand = (payload) => sourceWindow.webContents.send("pet:command", payload);
  const chipMode = (state && state.chipMode) || "amount";
  const chipPick = (state && state.chipPick) || "";
  const rawCustomText = ((state && state.customText) || "").trim();
  const pickStocks = (state && state.stocks) || [];

  const chipModeItems = [
    { key: "amount", label: "今日盈亏（金额）" },
    { key: "amountPercent", label: "盈亏金额 + 当日涨跌幅" },
    { key: "percent", label: "当日涨跌幅（百分比）" },
    { key: "value", label: "持仓总市值 / 总成本" },
    { key: "counts", label: "持仓数 · 自选数" },
    { key: "tickers", label: "持仓涨跌轮播" }
  ].map((item) => ({
    label: item.label,
    type: "radio",
    checked: chipMode === item.key,
    click: () => sendCommand({ type: "set-chip-mode", value: item.key })
  }));

  const customDisplay = rawCustomText
    ? `自定义文字：${rawCustomText.slice(0, 12)}${rawCustomText.length > 12 ? "…" : ""}`
    : "自定义文字…（未设置）";

  const chipDisplayMenu = {
    label: "底部显示内容",
    submenu: [
      ...chipModeItems,
      { type: "separator" },
      {
        label: "盯盘股行情",
        type: "radio",
        checked: chipMode === "pick",
        click: () => sendCommand({ type: "set-chip-mode", value: "pick" })
      },
      ...(pickStocks.length
        ? [
            {
              label: "选择盯盘股（自选/持仓）",
              submenu: pickStocks.map((stock) => ({
                label: `${stock.name} ${stock.code}`,
                type: "radio",
                checked: chipMode === "pick" && chipPick === stock.code,
                click: () => sendCommand({ type: "set-chip-pick", code: stock.code })
              }))
            }
          ]
        : [{ label: "暂无自选/持仓可盯", enabled: false }]),
      { type: "separator" },
      {
        label: customDisplay,
        type: "radio",
        checked: chipMode === "custom",
        click: () => {
          if (!rawCustomText) {
            sendCommand({ type: "edit-custom-text" });
          } else {
            sendCommand({ type: "set-chip-mode", value: "custom" });
          }
        }
      },
      {
        label: rawCustomText ? "编辑自定义文字…" : "输入自定义文字…",
        click: () => sendCommand({ type: "edit-custom-text" })
      }
    ]
  };

  // —— 宠物外观（情绪素材替换）子菜单 ——
  const boundMedia = (state && state.moodMedia) || {};
  const moodDisplayName = (mood) => {
    const name = boundMedia[mood];
    if (!name) return "默认形象";
    return name.length > 20 ? `${name.slice(0, 20)}…` : name;
  };

  const moodDisplayMenu = {
    label: "宠物外观",
    submenu: [
      {
        label: "打开素材库管理…",
        click: () => createMediaWindow()
      },
      { type: "separator" },
      { label: `待机显示：${moodDisplayName("idle")}`, enabled: false },
      { label: `开心显示：${moodDisplayName("happy")}`, enabled: false },
      { label: `沮丧显示：${moodDisplayName("sad")}`, enabled: false },
      { type: "separator" },
      {
        label: "更换待机（持平）显示…",
        click: async () => {
          const imported = await importMoodMediaFromDialog(sourceWindow, "idle");
          if (imported) {
            sendCommand({ type: "mood-media-changed", mood: "idle", item: imported });
            broadcastLibrary();
          }
        }
      },
      {
        label: "更换开心（盈利）显示…",
        click: async () => {
          const imported = await importMoodMediaFromDialog(sourceWindow, "happy");
          if (imported) {
            sendCommand({ type: "mood-media-changed", mood: "happy", item: imported });
            broadcastLibrary();
          }
        }
      },
      {
        label: "更换沮丧（亏损）显示…",
        click: async () => {
          const imported = await importMoodMediaFromDialog(sourceWindow, "sad");
          if (imported) {
            sendCommand({ type: "mood-media-changed", mood: "sad", item: imported });
            broadcastLibrary();
          }
        }
      },
      { type: "separator" },
      {
        label: "恢复默认显示",
        submenu: [
          { label: "待机（持平）", enabled: !!boundMedia.idle, click: () => sendCommand({ type: "mood-media-clear", mood: "idle" }) },
          { label: "开心（盈利）", enabled: !!boundMedia.happy, click: () => sendCommand({ type: "mood-media-clear", mood: "happy" }) },
          { label: "沮丧（亏损）", enabled: !!boundMedia.sad, click: () => sendCommand({ type: "mood-media-clear", mood: "sad" }) },
          { type: "separator" },
          {
            label: "全部恢复默认",
            enabled: !!(boundMedia.idle || boundMedia.happy || boundMedia.sad),
            click: () => sendCommand({ type: "mood-media-clear", mood: "__all__" })
          }
        ]
      },
      {
        label: "打开素材目录",
        click: () => {
          fs.mkdirSync(getMoodMediaDir(), { recursive: true });
          shell.openPath(getMoodMediaDir());
        }
      }
    ]
  };

  const menu = Menu.buildFromTemplate([
    { label: "牛来 · 今日盈亏", enabled: false },
    { label: `${summary}${phase}${counts}`, enabled: false },
    { type: "separator" },
    { label: "自选 / 持仓管理", click: () => createPanelWindow() },
    { label: "搜索添加股票", click: () => createPanelWindow() },
    { label: "今日快照", click: () => createPanelWindow() },
    { label: "打开数据目录", click: () => shell.openPath(getDataDir()) },
    { type: "separator" },
    chipDisplayMenu,
    moodDisplayMenu,
    { type: "separator" },
    {
      label: "预览表情",
      submenu: [
        { label: "待机（持平）", click: () => sourceWindow.webContents.send("pet:set-mood", "idle") },
        { label: "开心（盈利）", click: () => sourceWindow.webContents.send("pet:set-mood", "happy") },
        { label: "沮丧（亏损）", click: () => sourceWindow.webContents.send("pet:set-mood", "sad") },
        { type: "separator" },
        { label: "恢复自动（按行情）", click: () => sourceWindow.webContents.send("pet:set-mood", "auto") }
      ]
    },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ]);

  menu.popup({ window: sourceWindow });
});

ipcMain.handle("media:list", async () => listMoodMedia());

ipcMain.handle("media:get-bindings", () => readMoodBindings());

ipcMain.handle("media:set-bindings", (_event, bindings) => {
  const next = writeMoodBindings(bindings);
  broadcastBindings(next);
  return next;
});

ipcMain.handle("media:pick-import", async (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  const result = await importMediaFilesFromDialog(sourceWindow);
  if (result.items && result.items.length) broadcastLibrary();
  return result;
});

ipcMain.handle("media:delete-item", (_event, name) => {
  const dir = getMoodMediaDir();
  const safeName = path.basename(String(name || "")).trim();
  if (!safeName || safeName === "." || safeName === "..") {
    return { ok: false, message: "无效的文件名" };
  }
  const filePath = path.join(dir, safeName);
  if (!fs.existsSync(filePath)) {
    return { ok: false, message: "素材文件不存在，可能已被外部删除" };
  }
  try {
    fs.unlinkSync(filePath);
  } catch (_error) {
    return { ok: false, message: "删除失败：文件可能正被占用" };
  }
  const next = { ...readMoodBindings() };
  let cleared = false;
  for (const mood of MOOD_KEYS) {
    if (next[mood] === safeName) {
      delete next[mood];
      cleared = true;
    }
  }
  if (cleared) writeMoodBindings(next);
  broadcastBindings(next);
  broadcastLibrary();
  return { ok: true, bindings: next };
});

ipcMain.handle("media:rename-item", (_event, payload) => {
  const dir = getMoodMediaDir();
  const oldName = path.basename(String((payload && payload.oldName) || "")).trim();
  const rawNewName = path.basename(String((payload && payload.newName) || "")).trim();
  if (!oldName || !rawNewName) return { ok: false, message: "文件名不能为空" };
  if (oldName === rawNewName) return { ok: true };
  if (rawNewName === "." || rawNewName === "..") return { ok: false, message: "无效的文件名" };

  const oldKind = mediaKindOf(oldName);
  const newKind = mediaKindOf(rawNewName);
  if (!newKind) {
    return { ok: false, message: "新文件名需以支持的扩展名结尾：png/jpg/jpeg/webp/gif 或 mp4/webm/mov/m4v" };
  }
  if (oldKind !== newKind) {
    return { ok: false, message: "重命名不能改变素材类型（例如把图片改成视频）" };
  }

  const oldPath = path.join(dir, oldName);
  const newPath = path.join(dir, rawNewName);
  if (!fs.existsSync(oldPath)) return { ok: false, message: "原素材文件不存在" };
  if (fs.existsSync(newPath)) return { ok: false, message: "已存在同名素材，请换一个名称" };

  try {
    fs.renameSync(oldPath, newPath);
  } catch (_error) {
    return { ok: false, message: "重命名失败：文件可能正被占用" };
  }

  const next = { ...readMoodBindings() };
  let changed = false;
  for (const mood of MOOD_KEYS) {
    if (next[mood] === oldName) {
      next[mood] = rawNewName;
      changed = true;
    }
  }
  if (changed) writeMoodBindings(next);
  broadcastBindings(next);
  broadcastLibrary();
  return { ok: true, item: { name: rawNewName, kind: newKind, url: toFileUrl(newPath) }, bindings: next };
});

ipcMain.handle("media:preview-item", (_event, item) => {
  const preview =
    item && item.url
      ? { name: String(item.name || ""), kind: item.kind === "video" ? "video" : "image", url: String(item.url) }
      : null;
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("pet:command", { type: "mood-media-preview", item: preview });
  }
  return { ok: true };
});

ipcMain.handle("app:get-bootstrap", async () => {
  ensureDataFiles();
  const watchlist = readJson("watchlist.json", []).map(normalizeStock);
  const holdings = readJson("holdings.json", []).map((item) => ({
    ...normalizeStock(item),
    quantity: Number(item.quantity || 0),
    costPrice: item.costPrice != null && item.costPrice !== "" ? Number(item.costPrice) : null,
    addedAt: item.addedAt || null
  }));

  rememberStocks([...watchlist, ...holdings]);

  return {
    marketPhase: getMarketPhase(new Date()),
    isTradingDay: isTradingDay(new Date()),
    watchlist,
    holdings,
    todaySnapshot: getTodaySnapshotSummary(),
    dataNotices: [...runtimeCache.dataNotices],
    dataDir: getDataDir()
  };
});

ipcMain.handle("stocks:search", async (_, keyword) => {
  const results = await searchStocks(keyword);
  rememberStocks(results);
  return results;
});

ipcMain.handle("watchlist:add", async (_, stock) => {
  const watchlist = readJson("watchlist.json", []).map(normalizeStock);
  const nextStock = normalizeStock(stock);

  if (!nextStock.code || !nextStock.name) {
    throw new Error("股票信息不完整。");
  }

  // BR005：同一股票不能重复加入自选股
  if (watchlist.some((item) => item.code === nextStock.code)) {
    return { ok: true, duplicate: true, watchlist };
  }

  const nextWatchlist = [...watchlist, nextStock];
  writeJson("watchlist.json", nextWatchlist);
  rememberStocks([nextStock]);
  return { ok: true, duplicate: false, watchlist: nextWatchlist };
});

ipcMain.handle("holding:save", async (_, payload) => {
  const holdings = readJson("holdings.json", []).map((item) => ({
    ...normalizeStock(item),
    quantity: Number(item.quantity || 0),
    costPrice: item.costPrice != null && item.costPrice !== "" ? Number(item.costPrice) : null,
    addedAt: item.addedAt || null
  }));

  const nextHolding = {
    ...normalizeStock(payload),
    quantity: Number(payload.quantity || 0),
    costPrice: payload.costPrice != null && payload.costPrice !== "" ? Number(payload.costPrice) : null,
    addedAt: payload.addedAt || new Date().toISOString()
  };

  if (!nextHolding.code || !nextHolding.name || !Number.isFinite(nextHolding.quantity) || nextHolding.quantity <= 0) {
    throw new Error("持仓信息不完整，持股数必须大于 0。");
  }

  // BR005：同一股票不能重复添加持仓记录
  const existedIndex = holdings.findIndex((item) => item.code === nextHolding.code);
  if (existedIndex >= 0) {
    const updated = [...holdings];
    updated[existedIndex] = {
      ...updated[existedIndex],
      quantity: nextHolding.quantity,
      costPrice: nextHolding.costPrice
    };
    writeJson("holdings.json", updated);
    rememberStocks([nextHolding]);
    return { ok: true, duplicate: true, holdings: updated };
  }

  const nextHoldings = [...holdings, nextHolding];
  writeJson("holdings.json", nextHoldings);
  rememberStocks([nextHolding]);
  return { ok: true, duplicate: false, holdings: nextHoldings };
});

ipcMain.handle("holding:update", async (_, payload) => {
  const holdings = readJson("holdings.json", []).map((item) => ({
    ...normalizeStock(item),
    quantity: Number(item.quantity || 0),
    costPrice: item.costPrice != null && item.costPrice !== "" ? Number(item.costPrice) : null,
    addedAt: item.addedAt || null
  }));

  const existedIndex = holdings.findIndex((item) => item.code === payload.code);
  if (existedIndex < 0) {
    throw new Error("未找到要更新的持仓记录。");
  }

  const nextQuantity = Number(payload.quantity || 0);
  if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
    throw new Error("持股数必须大于 0。");
  }

  const updated = [...holdings];
  updated[existedIndex] = {
    ...updated[existedIndex],
    quantity: nextQuantity,
    costPrice: payload.costPrice != null && payload.costPrice !== "" ? Number(payload.costPrice) : null
  };
  writeJson("holdings.json", updated);
  return { ok: true, holdings: updated };
});

ipcMain.handle("market:refresh", async () => {
  return refreshMarket();
});

ipcMain.handle("snapshot:get", async () => {
  return {
    today: getTodaySnapshotSummary(),
    restored: pickSnapshot()
  };
});

ipcMain.handle("data:open-dir", async () => {
  await shell.openPath(getDataDir());
  return getDataDir();
});

/**
 * 快照守护：确保 11:30 / 15:00 一定落盘，
 * 即使渲染层刷新时机错过或程序当时未启动（PRD 14、BR016、BR017）。
 */
function startSnapshotGuard() {
  setInterval(() => {
    const now = new Date();
    let timeKey = null;

    if (isSnapshotCaptureTime(now)) {
      timeKey = now.getHours() === 11 ? "morning" : "afternoon";
    } else {
      timeKey = getPendingSnapshotTime(now);
    }

    if (!timeKey) {
      return;
    }

    const snapshotKey = `${formatDateKey(now)}-${timeKey}`;
    if (runtimeCache.lastSnapshotKey === snapshotKey) {
      return;
    }

    refreshMarket().catch(() => {
      // 守护任务失败不影响主流程，下个周期继续尝试
    });
  }, 15000);
}

app.whenReady().then(() => {
  ensureDataFiles();
  createPetWindow();
  startSnapshotGuard();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPetWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
