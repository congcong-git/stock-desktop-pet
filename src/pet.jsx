import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./pet.css";

/**
 * 桌面宠物渲染层（V2.0）
 * - 透明小窗内展示角色，整窗可左键拖动（CSS drag region）
 * - 每 10 秒拉取一次行情，按 profitStatus 切换表情：盈利→开心 / 亏损→沮丧 / 持平→待机
 * - 右键弹出主进程原生菜单（今日盈亏概要 + 各功能入口 + 底部显示内容配置）
 */

const MOOD_FOR_STATUS = { 盈利: "happy", 亏损: "sad", 持平: "idle" };
// 底部胶囊指示灯：跟随真实盈亏（而非 mood），避免「预览形象」污染行情指示
const STATUS_DOT = { 盈利: "up", 亏损: "down", 持平: "flat" };
// 展示单只个股时（tickers / pick），指示灯跟随该股涨跌
const DOT_FOR_CHANGE = (pct) => (pct == null || pct === 0 ? "flat" : pct > 0 ? "up" : "down");
const MOOD_CN = {
  idle: "待机",
  happy: "开心",
  sad: "沮丧",
  awake: "开盘前",
  rest: "午间休市",
  doze: "打盹",
  sleep: "睡觉"
};
const MOOD_KEYS = ["idle", "happy", "sad"];
const STATE_KEYS = ["awake", "rest", "doze", "sleep"];


const IMAGE_KEYS = [...MOOD_KEYS, ...STATE_KEYS];
/**
 * 内置形象：情绪（idle / happy / sad）+ 非交易时段状态（awake / rest / doze / sleep）。
 * 当前全部为 WebM 透明动画；美术替换同名文件即可，代码无需改动。
 * 同时支持静态图（png / apng / webp / gif）与 mp4，
 * 换格式时把对应项的 kind 与 src 一起改，规格见 doc/宠物形象素材规范.md
 */
const BUILTIN_MEDIA = {
  idle: { kind: "video", src: "./assets/pet/idle.webm" },
  happy: { kind: "video", src: "./assets/pet/happy.webm" },
  sad: { kind: "video", src: "./assets/pet/sad.webm" },
  awake: { kind: "video", src: "./assets/pet/awake.webm" },
  rest: { kind: "video", src: "./assets/pet/rest.webm" },
  doze: { kind: "video", src: "./assets/pet/doze.webm" },
  sleep: { kind: "video", src: "./assets/pet/sleep.webm" }
};

/**
 * 点击动作形象：pat（被摸头，含手）/ wag（站起来摇尾巴）。
 * 素材放到 src/assets/pet/ 后自动启用，播完回落到点击前的形象；
 * 素材缺失时自动降级为 CSS 变换动画（对静态图仍可见）。
 */
const BUILTIN_ACTION_MEDIA = {
  pat: { kind: "video", src: "./assets/pet/pat.webm" },
  wag: { kind: "video", src: "./assets/pet/wag.webm" }
};
const TAP_ACTION_MS = 2000; // 动作形象播放时长
const TAP_FALLBACK_MS = 900; // 无动作素材时 CSS 变换动画时长

const STORAGE_KEYS = {
  mode: "pet.chipMode",
  pick: "pet.chipPick",
  custom: "pet.customText",
  moodMedia: "pet.moodMedia",
  summaryDate: "pet.summaryDate" // M9：收盘小结当天只播报一次
};

// M9 · 陪伴感与提醒 —— 非交易时段状态
const PHASE_STATE = {
  开盘前: "awake",
  午间休市: "rest",
  收盘后: "doze",
  非交易日: "sleep"
};
const LIVE_PHASES = ["集合竞价", "上午交易", "下午交易"];
const PET_STATE_LABEL = { awake: "待机", rest: "休息", doze: "打盹", sleep: "睡觉" };

/** 非交易时段的随机台词 */
const IDLE_LINES = {
  awake: ["开盘前，先伸个懒腰～", "准备开工啦，今天也要加油！", "还没开盘，先活动活动筋骨"],
  rest: ["午休时间，嘘——", "中午歇一歇，下午再战", "Zzz… 午间休市中"],
  doze: ["收盘啦，我打个盹儿～", "今天辛苦了，先眯一会儿", "Zzz… 收盘后小憩中"],
  sleep: ["今天是休市日，我在睡觉", "Zzz… 周末就该好好休息", "休市中，别吵醒我哦"]
};

/** 无行情 / 交易时段的点击台词 */
const TAP_LINES = ["咩？", "被摸头啦～", "嘿嘿，再来一下", "今天也要开心呀", "我在呢，别担心", "摸摸头，好运来"];

/** 行情刷新间隔默认值（秒），与 main.js DEFAULT_REFRESH_SECONDS 一致 */
const DEFAULT_REFRESH_SECONDS = 10;

/** M9 配置默认值（与 main.js DEFAULT_COMPANION 一致，主进程下发生效前先用它） */
const DEFAULT_COMPANION = {
  tapFeedback: true,
  idleState: true,
  alertsEnabled: true,
  stockPercent: 3,
  profitAmount: 1000,
  cooldownMinutes: 10,
  dailySummary: true
};

/** 各显示模式的中文名（右键菜单勾选提示用） */
const CHIP_MODE_NAMES = {
  amount: "今日盈亏（金额）",
  amountPercent: "盈亏金额 + 当日涨跌幅",
  percent: "当日涨跌幅（百分比）",
  value: "持仓总市值 / 总成本",
  counts: "持仓数 · 自选数",
  tickers: "持仓涨跌轮播",
  pick: "盯盘股行情",
  custom: "自定义文字"
};

function safeLoad(key) {
  try {
    return window.localStorage.getItem(key) || "";
  } catch (_e) {
    return "";
  }
}

function safeSave(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_e) {
    /* 忽略存储失败 */
  }
}

function num(value) {
  return Number(value || 0);
}

function formatSignedCurrency(value) {
  const amount = num(value);
  if (!Number.isFinite(amount)) return "--";
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}${Math.abs(amount).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedPercent(pct) {
  if (pct == null || !Number.isFinite(pct)) return "--";
  const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

function formatPrice(value) {
  if (value == null || !Number.isFinite(num(value))) return "--";
  return num(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 金额缩写：≥1亿显示 x.x亿，≥1万显示 x.x万，否则取整 */
function formatCompact(value) {
  const amount = num(value);
  if (!Number.isFinite(amount)) return "--";
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(2)}万`;
  return `${sign}${abs.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

/** 单行行情百分比：优先用最新/昨收自算，避免源字段缺失时为 0 */
function rowChangePercent(row) {
  const quote = row && row.quote;
  if (!quote) return null;
  const previous = num(quote.previousClose);
  const current = num(quote.currentPrice);
  if (!previous || !current) return null;
  return ((current - previous) / previous) * 100;
}

function rowPrice(row) {
  const quote = row && row.quote;
  if (!quote) return null;
  return num(quote.currentPrice) || null;
}

function pickRandom(list) {
  if (!Array.isArray(list) || !list.length) return "";
  return list[Math.floor(Math.random() * list.length)];
}

/** 本地时区的当天日期键，用于"每天只播报一次" */
function todayKey(date = new Date()) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 按当日涨跌幅挑出最强 / 最弱的一只（都无行情时返回 null） */
function pickExtremes(rows) {
  const list = (rows || [])
    .map((row) => ({ row, pct: rowChangePercent(row) }))
    .filter((item) => item.pct != null && Number.isFinite(item.pct));
  if (!list.length) return null;
  list.sort((a, b) => b.pct - a.pct);
  return { best: list[0], worst: list[list.length - 1] };
}

/** 占位角色：等素材 PNG 就绪后替换为图片（见 PetBody 的 imageReady 逻辑） */
function PlaceholderCow({ mood }) {
  return (
    <svg className="cow-placeholder" viewBox="0 0 240 260" aria-hidden="true">
      {/* 身体 */}
      <ellipse cx="120" cy="216" rx="62" ry="34" fill="#f2c14e" />
      <ellipse cx="120" cy="222" rx="52" ry="18" fill="#e9a93b" opacity="0.55" />
      {/* 双蹄 */}
      <rect x="78" y="236" width="16" height="16" rx="6" fill="#b97a2b" />
      <rect x="146" y="236" width="16" height="16" rx="6" fill="#b97a2b" />
      {/* 头 */}
      <ellipse cx="120" cy="96" rx="68" ry="62" fill="#f6c453" />
      <ellipse cx="120" cy="120" rx="44" ry="36" fill="#fdeecf" />
      {/* 犄角 */}
      <path d="M66 62 Q38 44 42 16 Q46 44 76 52 Z" fill="#8a5a2b" />
      <path d="M174 62 Q202 44 198 16 Q194 44 164 52 Z" fill="#8a5a2b" />
      {/* 耳朵 */}
      <ellipse cx="58" cy="106" rx="18" ry="14" fill="#f6c453" transform="rotate(-24 58 106)" />
      <ellipse cx="182" cy="106" rx="18" ry="14" fill="#f6c453" transform="rotate(24 182 106)" />
      <ellipse cx="58" cy="108" rx="10" ry="7" fill="#e8a0a0" transform="rotate(-24 58 108)" />
      <ellipse cx="182" cy="108" rx="10" ry="7" fill="#e8a0a0" transform="rotate(24 182 108)" />
      {/* 头顶小花斑 */}
      <circle cx="98" cy="52" r="9" fill="#e9a93b" opacity="0.7" />
      <circle cx="150" cy="58" r="6" fill="#e9a93b" opacity="0.6" />

      {/* 眼睛：三态并存，由 CSS 依据 mood 显示 */}
      <g className="eye-pair eye-pair--idle">
        <circle cx="94" cy="94" r="7" fill="#332211" />
        <circle cx="146" cy="94" r="7" fill="#332211" />
        <circle cx="96" cy="92" r="2.2" fill="#ffffff" />
        <circle cx="148" cy="92" r="2.2" fill="#ffffff" />
      </g>
      <g className="eye-pair eye-pair--happy">
        <path d="M84 96 Q94 82 104 96 Q94 92 84 96 Z" fill="#332211" />
        <path d="M136 96 Q146 82 156 96 Q146 92 136 96 Z" fill="#332211" />
      </g>
      <g className="eye-pair eye-pair--sad">
        <path d="M86 100 Q94 92 102 100" stroke="#332211" strokeWidth="3.4" fill="none" strokeLinecap="round" />
        <path d="M138 100 Q146 92 154 100" stroke="#332211" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      </g>

      {/* 鼻子与嘴：三态并存 */}
      <ellipse cx="108" cy="128" rx="10" ry="8" fill="#e5897a" />
      <ellipse cx="132" cy="128" rx="10" ry="8" fill="#e5897a" />
      <g className="mouth mouth--idle">
        <path d="M106 144 Q120 152 134 144" stroke="#8a4a3a" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      </g>
      <g className="mouth mouth--happy">
        <path d="M98 142 Q120 166 142 142 Q120 150 98 142 Z" fill="#8a4a3a" />
        <path d="M112 152 Q120 158 128 152" stroke="#fdeecf" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      </g>
      <g className="mouth mouth--sad">
        <path d="M104 152 Q120 144 136 152" stroke="#8a4a3a" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      </g>

      {/* 腮红：难过时水滴 */}
      <g className="cheek cheek--happy">
        <circle cx="78" cy="112" r="7" fill="#f59a8a" opacity="0.6" />
        <circle cx="162" cy="112" r="7" fill="#f59a8a" opacity="0.6" />
      </g>
      <g className="cheek cheek--sad">
        <circle cx="78" cy="118" r="6" fill="#9db8d9" opacity="0.8" />
        <circle cx="162" cy="118" r="6" fill="#9db8d9" opacity="0.8" />
      </g>
    </svg>
  );
}

function PetApp() {
  const [market, setMarket] = useState(null);
  const [autoMood, setAutoMood] = useState("idle");
  const [moodOverride, setMoodOverride] = useState(null);
  const [speech, setSpeech] = useState("");

  // —— 宠物外观（情绪素材替换） ——
  const [moodMedia, setMoodMedia] = useState(() => {
    try {
      const raw = JSON.parse(safeLoad(STORAGE_KEYS.moodMedia) || "null");
      return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch (_error) {
      return {};
    }
  });
  // 素材目录索引：文件名 -> { name, kind: "image"|"video", url }
  const [mediaCatalog, setMediaCatalog] = useState(null);
  const [mediaErrorStage, setMediaErrorStage] = useState(0);
  // 素材库"试穿"预览：不写入绑定，仅临时覆盖当前表情素材；null 表示未试穿
  const [previewMedia, setPreviewMedia] = useState(null);
  // 绑定主进程同步控制：初始化完成标志 + 主进程回包时跳过重复上报（防环）
  const bindingsInitRef = useRef(false);
  const skipBindingsSyncRef = useRef(false);

  const updateMoodMedia = useCallback((updater) => {
    setMoodMedia((current) => {
      const next = updater(current) || {};
      safeSave(STORAGE_KEYS.moodMedia, JSON.stringify(next));
      return next;
    });
  }, []);

  // 启动时读取素材目录，用于解析绑定素材的本地 file:// 地址
  useEffect(() => {
    let cancelled = false;
    window.stockWatcher.getMedia().then((items) => {
      if (cancelled) return;
      const map = {};
      (items || []).forEach((item) => {
        map[item.name] = item;
      });
      setMediaCatalog(map);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 绑定单一数据源在主进程：启动时以主进程为准；主进程为空时把本地旧缓存上传迁移
  useEffect(() => {
    let cancelled = false;
    window.stockWatcher
      .getMoodBindings()
      .then((remoteRaw) => {
        if (cancelled) return;
        const remoteMap = remoteRaw && typeof remoteRaw === "object" && !Array.isArray(remoteRaw) ? remoteRaw : {};
        setMoodMedia((current) => {
          if (Object.keys(remoteMap).length > 0) {
            const value = { ...remoteMap };
            safeSave(STORAGE_KEYS.moodMedia, JSON.stringify(value));
            return value;
          }
          const currentMap = current && typeof current === "object" ? current : {};
          if (Object.keys(currentMap).length > 0) {
            // 老版本本地缓存迁移到主进程，供素材库窗口读取
            window.stockWatcher.setMoodBindings(currentMap).catch(() => {});
          }
          return current;
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) bindingsInitRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 本地绑定变化上报主进程，经 set-bindings 广播保持宠物 / 素材库 / 右键菜单一致
  useEffect(() => {
    if (!bindingsInitRef.current) return;
    if (skipBindingsSyncRef.current) {
      skipBindingsSyncRef.current = false;
      return;
    }
    window.stockWatcher.setMoodBindings(moodMedia).catch(() => {});
  }, [moodMedia]);

  const speechTimerRef = useRef(null);
  const showSpeech = useCallback((text) => {
    setSpeech(text);
    if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
    speechTimerRef.current = window.setTimeout(() => setSpeech(""), 3600);
  }, []);

  // —— M9 · 陪伴感与提醒 ——
  const [companion, setCompanion] = useState(DEFAULT_COMPANION);
  const companionRef = useRef(DEFAULT_COMPANION);
  const [refreshSeconds, setRefreshSeconds] = useState(DEFAULT_REFRESH_SECONDS); // 行情刷新间隔（面板可配）
  const [tapAnim, setTapAnim] = useState(""); // pat | wag：点击反馈动画
  const [petState, setPetState] = useState(null); // awake | rest | doze | sleep
  const [stateOverride, setStateOverride] = useState(null); // 菜单"预览形象"：手动指定状态形象
  const [tapWake, setTapWake] = useState(false); // 非交易时段被点击后临时"醒来"，显示盈亏情绪形象
  // 点击动作素材是否可用：预加载成功才启用，缺失 / 加载失败则降级为 CSS 变换
  const [actionReady, setActionReady] = useState({ pat: false, wag: false });
  const actionReadyRef = useRef(actionReady);
  useEffect(() => {
    actionReadyRef.current = actionReady;
  }, [actionReady]);
  const alertMemoryRef = useRef({ stock: new Map(), profit: null }); // 异动去重
  const noticeUnsupportedRef = useRef(false); // 系统通知不可用只提示一次
  const tapTimerRef = useRef(null);
  const tapWakeTimerRef = useRef(null);

  // 陪伴与提醒配置以主进程为数据源，配置变更即时广播到宠物窗口
  useEffect(() => {
    const applyConfig = (config) => {
      const next = { ...DEFAULT_COMPANION, ...((config && config.companion) || {}) };
      companionRef.current = next;
      setCompanion(next);
      // 刷新间隔（秒）：越界或非法值回落到默认 10 秒
      const seconds = Number(config && config.refreshSeconds);
      setRefreshSeconds(Number.isFinite(seconds) && seconds >= 3 ? seconds : DEFAULT_REFRESH_SECONDS);
    };
    window.stockWatcher
      .getAppConfig()
      .then(applyConfig)
      .catch(() => {});
    return window.stockWatcher.onAppConfigChanged(applyConfig);
  }, []);

  // —— 底部胶囊显示内容（可配置，持久化） ——
  const [chipMode, setChipMode] = useState(() => safeLoad(STORAGE_KEYS.mode) || "amount");
  const [chipPick, setChipPick] = useState(() => safeLoad(STORAGE_KEYS.pick) || "");
  const [customText, setCustomText] = useState(() => safeLoad(STORAGE_KEYS.custom) || "");
  const [customDraft, setCustomDraft] = useState("");
  const [editingCustom, setEditingCustom] = useState(false);
  const [tickerIndex, setTickerIndex] = useState(0);
  const customTextRef = useRef(customText);
  const timerRef = useRef(null);

  const applyMode = useCallback((mode, pickCode) => {
    if (pickCode) {
      setChipPick(pickCode);
      safeSave(STORAGE_KEYS.pick, pickCode);
    }
    if (mode) {
      setChipMode(mode);
      safeSave(STORAGE_KEYS.mode, mode);
    }
  }, []);

  // 统计汇总：持仓 / 自选列表、总成本、当日盈亏、涨跌幅
  const stats = useMemo(() => {
    const holdings = (market && market.holdingRows) || [];
    const watchlist = (market && market.watchlistRows) || [];
    let totalCost = 0;
    holdings.forEach((row) => {
      if (row.costPrice != null) totalCost += num(row.quantity) * num(row.costPrice);
    });
    const totalProfit = num(market && market.totalProfit);
    const profitPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : null;
    const totalValue = holdings.reduce((sum, row) => sum + num(row.quantity) * (num(rowPrice(row)) || 0), 0);
    return { holdings, watchlist, totalCost, totalProfit, profitPercent, totalValue };
  }, [market]);

  // 持仓 + 自选合并（去重），供"盯盘股"选择
  const allStocks = useMemo(() => {
    const seen = new Set();
    const merged = [];
    for (const row of [...stats.holdings, ...stats.watchlist]) {
      if (!row || !row.code || seen.has(row.code)) continue;
      seen.add(row.code);
      merged.push(row);
    }
    return merged;
  }, [stats.holdings, stats.watchlist]);

  const pickStock = useMemo(
    () => (chipPick ? allStocks.find((stock) => stock.code === chipPick) || null : null),
    [allStocks, chipPick]
  );

  /** 系统通知：不可用时降级为气泡，且只提示一次 */
  const sendAlert = useCallback(
    (title, body) => {
      window.stockWatcher
        .notifyAlert({ title, body })
        .then((result) => {
          if (result && result.ok) return;
          if (noticeUnsupportedRef.current) return;
          noticeUnsupportedRef.current = true;
          showSpeech("系统通知不可用，已改为气泡提醒");
        })
        .catch(() => {});
    },
    [showSpeech]
  );

  /** M9：每轮行情后跑陪伴逻辑（异动提醒 + 收盘小结） */
  const runCompanionChecks = useCallback(
    (result) => {
      if (!result || result.networkError) return;
      const cfg = companionRef.current;
      const cooldownMs = Math.max(1, num(cfg.cooldownMinutes) || 10) * 60 * 1000;
      const now = Date.now();
      const memory = alertMemoryRef.current;

      // —— 异动提醒：仅交易时段；同一只股票同一方向在间隔内不重复 ——
      if (cfg.alertsEnabled && LIVE_PHASES.includes(result.marketPhase)) {
        const threshold = num(cfg.stockPercent) || 3;
        const rows = [...(result.holdingRows || []), ...(result.watchlistRows || [])];
        const hit = rows
          .map((row) => ({ row, pct: rowChangePercent(row) }))
          .filter((item) => item.pct != null && Math.abs(item.pct) >= threshold)
          .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];
        if (hit) {
          const direction = hit.pct > 0 ? "up" : "down";
          const key = `${hit.row.code}:${direction}`;
          const last = memory.stock.get(key) || 0;
          if (now - last >= cooldownMs) {
            memory.stock.set(key, now);
            const text = `${hit.row.name} ${direction === "up" ? "涨" : "跌"}幅 ${formatSignedPercent(hit.pct)}，现价 ${formatPrice(rowPrice(hit.row))}`;
            showSpeech(`异动 · ${text}`);
            sendAlert("异动提醒", text);
          }
        }

        // —— 当日总盈亏突破金额阈值 ——
        const amountThreshold = num(cfg.profitAmount) || 1000;
        const totalProfit = num(result.totalProfit);
        if (Math.abs(totalProfit) >= amountThreshold) {
          const direction = totalProfit > 0 ? "up" : "down";
          const last = memory.profit;
          if (!last || last.direction !== direction || now - last.at >= cooldownMs) {
            memory.profit = { direction, at: now };
            const text = `今日${direction === "up" ? "盈利" : "亏损"} ${formatSignedCurrency(totalProfit)}（阈值 ±${amountThreshold}）`;
            showSpeech(`盈亏 · ${text}`);
            sendAlert("盈亏提醒", text);
          }
        }
      }

      // —— 收盘小结：15:00 快照后当天只播报一次 ——
      if (cfg.dailySummary && result.snapshotTime === "15:00") {
        const key = todayKey();
        if (safeLoad(STORAGE_KEYS.summaryDate) !== key) {
          safeSave(STORAGE_KEYS.summaryDate, key);
          const rows = [...(result.holdingRows || []), ...(result.watchlistRows || [])];
          const extremes = pickExtremes(rows);
          let text = `今日${result.profitStatus || "持平"} ${formatSignedCurrency(result.totalProfit)}`;
          if (extremes) {
            text += `｜最强 ${extremes.best.row.name} ${formatSignedPercent(extremes.best.pct)}`;
            if (extremes.worst.row.code !== extremes.best.row.code) {
              text += ` / 最弱 ${extremes.worst.row.name} ${formatSignedPercent(extremes.worst.pct)}`;
            }
          }
          showSpeech(`收盘小结 · ${text}`);
          sendAlert("今日收盘小结", text);
        }
      }
    },
    [sendAlert, showSpeech]
  );

  /** M9：点击宠物形象反馈 —— 动作形象 + 气泡，非交易时段说状态台词 */
  const handleTap = useCallback(() => {
    if (!companionRef.current.tapFeedback) return;
    const action = Math.random() < 0.5 ? "pat" : "wag";
    const speak = (text) => showSpeech(text);
    // 动作素材可用则播 2 秒动作形象，播完回到点击前的形象；否则降级为 CSS 变换
    const actionAvailable = Boolean(actionReadyRef.current[action]);
    setTapAnim(action);
    if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
    tapTimerRef.current = window.setTimeout(() => setTapAnim(""), actionAvailable ? TAP_ACTION_MS : TAP_FALLBACK_MS);

    // 仅降级路径保留"被摸醒"：临时改用盈亏情绪形象回应，3.5 秒后回到状态形象
    if (petState && !actionAvailable) {
      setTapWake(true);
      if (tapWakeTimerRef.current) window.clearTimeout(tapWakeTimerRef.current);
      tapWakeTimerRef.current = window.setTimeout(() => setTapWake(false), 3500);
    }

    const rows = stats.holdings.length ? stats.holdings : stats.watchlist;
    if (market && rows.length) {
      const head = `今日${market.profitStatus || "持平"} ${formatSignedCurrency(market.totalProfit)}`;
      const extremes = pickExtremes(rows);
      speak(
        extremes
          ? `${head}｜最强 ${extremes.best.row.name} ${formatSignedPercent(extremes.best.pct)} / 最弱 ${extremes.worst.row.name} ${formatSignedPercent(extremes.worst.pct)}`
          : head
      );
      return;
    }
    // 无行情：交易时段说随机台词；非交易时段说状态台词（被打扰的语气）
    speak(petState ? pickRandom(IDLE_LINES[petState] || TAP_LINES) : pickRandom(TAP_LINES));
  }, [market, stats, petState, showSpeech]);

  // 动作素材预加载成功标记：仅用于"是否走唤醒降级"的决策，播放本身不依赖它
  const markActionReady = useCallback((actionKey) => {
    setActionReady((prev) => (prev[actionKey] ? prev : { ...prev, [actionKey]: true }));
  }, []);

  const handleTapRef = useRef(null);
  useEffect(() => {
    handleTapRef.current = handleTap;
  }, [handleTap]);


  // —— 窗口位置微调：Ctrl / Alt + 方向键（按住 Shift 每次 10px）——
  // 拖动本身走系统 drag region（形象以外的留白、底部把手条），
  // 这里只补充"精确摆位"：系统拖动没法做像素级调整
  useEffect(() => {
    const onKeyDown = (event) => {
      // 输入框里要把方向键留给光标移动（自定义文字编辑）
      const tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!event.ctrlKey && !event.altKey) return;
      const step = event.shiftKey ? 10 : 1;
      const deltas = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
      };
      const delta = deltas[event.key];
      if (!delta) return;
      event.preventDefault();
      window.stockWatcher?.nudgePetWindow?.(delta[0], delta[1]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const firstLoadRef = useRef(true);

  const applyResult = useCallback(
    (result) => {
      if (!result) return;
      setMarket(result);
      // 非交易时段状态：设置里可关闭，关闭后保持常驻表情
      setPetState(companionRef.current.idleState ? PHASE_STATE[result.marketPhase] || null : null);
      // 网络异常/无有效行情时不切换表情（沿用 V1.0 失败保留旧数据规则）
      if (result.success === false && result.networkError && !result.profitStatus) return;
      setAutoMood(MOOD_FOR_STATUS[result.profitStatus] || "idle");
      // 首次拿到的是冷启动恢复的历史数据，不触发提醒，避免一开机就轰炸
      if (firstLoadRef.current) {
        firstLoadRef.current = false;
        return;
      }
      runCompanionChecks(result);
    },
    [runCompanionChecks]
  );

  // 菜单"预览形象"支持：手动指定情绪形象，auto 恢复为随行情自动
  useEffect(() => {
    const unsubscribe = window.stockWatcher.onSetPetMood((nextMood) => {
      if (nextMood === "auto") {
        setMoodOverride(null);
      } else if (nextMood === "idle" || nextMood === "happy" || nextMood === "sad") {
        setMoodOverride(nextMood);
      }
    });
    return unsubscribe;
  }, []);

  // 菜单"预览形象"支持：手动指定状态形象，auto 恢复为按时段自动
  useEffect(() => {
    const unsubscribe = window.stockWatcher.onSetPetState((nextState) => {
      if (nextState === "auto") {
        setStateOverride(null);
      } else if (STATE_KEYS.includes(nextState)) {
        setStateOverride(nextState);
      }
    });
    return unsubscribe;
  }, []);

  // 菜单"底部显示内容"+"宠物外观（情绪素材）"命令
  useEffect(() => {
    const unsubscribe = window.stockWatcher.onPetCommand((cmd) => {
      if (!cmd) return;
      if (cmd.type === "set-chip-mode") {
        applyMode(cmd.value, "");
      } else if (cmd.type === "set-chip-pick") {
        applyMode("pick", cmd.code);
      } else if (cmd.type === "edit-custom-text") {
        setCustomDraft(customTextRef.current || "");
        setEditingCustom(true);
      } else if (cmd.type === "mood-media-changed") {
        const item = cmd.item;
        if (item && item.name && cmd.mood) {
          updateMoodMedia((current) => ({ ...current, [cmd.mood]: item.name }));
          // 目录索引仅启动时拉取一次；把新素材即时并入，保证更换后立即生效
          setMediaCatalog((current) => ({ ...(current || {}), [item.name]: item }));
          showSpeech(`已更换${MOOD_CN[cmd.mood] || "情绪"}显示素材：${item.name}`);
        }
      } else if (cmd.type === "mood-media-clear") {
        if (cmd.mood === "__all__") {
          updateMoodMedia(() => ({}));
          showSpeech("已全部恢复默认形象");
        } else if (cmd.mood) {
          updateMoodMedia((current) => {
            const next = { ...current };
            delete next[cmd.mood];
            return next;
          });
          showSpeech(`${MOOD_CN[cmd.mood] || "情绪"}已恢复默认形象`);
        }
      } else if (cmd.type === "mood-media-sync") {
        // 素材库/删除/重命名等主进程操作后收敛绑定（值一致时不触发重渲染，防止双向同步环）
        const remoteMap =
          cmd.moodMedia && typeof cmd.moodMedia === "object" && !Array.isArray(cmd.moodMedia) ? cmd.moodMedia : {};
        setMoodMedia((current) => {
          const currentMap = current || {};
          const same = IMAGE_KEYS.every((mood) => (remoteMap[mood] || undefined) === (currentMap[mood] || undefined));
          if (same) return current;
          const value = { ...remoteMap };
          safeSave(STORAGE_KEYS.moodMedia, JSON.stringify(value));
          skipBindingsSyncRef.current = true;
          return value;
        });
      } else if (cmd.type === "mood-media-preview") {
        const item = cmd.item;
        setPreviewMedia(
          item && item.url
            ? { name: String(item.name || ""), kind: item.kind === "video" ? "video" : "image", url: String(item.url) }
            : null
        );
      } else if (cmd.type === "media-library-changed") {
        // 素材目录（导入/删除/重命名）变化时重建索引
        const nextMap = {};
        (Array.isArray(cmd.items) ? cmd.items : []).forEach((item) => {
          if (item && item.name) nextMap[item.name] = { name: item.name, kind: item.kind === "video" ? "video" : "image", url: item.url };
        });
        setMediaCatalog(nextMap);
      }
    });
    return unsubscribe;
  }, [applyMode, updateMoodMedia, showSpeech]);

  // 持仓涨跌轮播：每 3.2s 切到下一只
  useEffect(() => {
    if (chipMode !== "tickers") return undefined;
    const timer = window.setInterval(() => setTickerIndex((index) => index + 1), 3200);
    return () => window.clearInterval(timer);
  }, [chipMode]);

  const refresh = useCallback(async () => {
    try {
      const result = await window.stockWatcher.refreshMarket();
      applyResult(result);
    } catch (error) {
      // 静默：下一轮自动重试
    }
  }, [applyResult]);

  useEffect(() => {
    refresh();

    // 刷新间隔可在管理面板自定义（3～120 秒）：配置变更时重建定时器，即时生效
    const intervalMs = Math.max(3, Number(refreshSeconds) || DEFAULT_REFRESH_SECONDS) * 1000;
    const startTimer = () => {
      timerRef.current = window.setInterval(() => {
        refresh();
      }, intervalMs);
    };
    // 首帧先给界面一点时间渲染，再进入周期刷新
    const delayedTimer = window.setTimeout(startTimer, Math.min(5000, intervalMs));
    return () => {
      window.clearTimeout(delayedTimer);
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [refresh, refreshSeconds]);

  const openMenu = useCallback(() => {
    const summary = market ? formatSignedCurrency(market.totalProfit) : "加载中…";
    window.stockWatcher.openPetMenu({
      summary,
      status: market ? market.profitStatus : "持平",
      phase: market ? market.marketPhase : "",
      holdingCount: stats.holdings.length,
      watchlistCount: stats.watchlist.length,
      chipMode,
      chipPick,
      customText,
      moodMedia: IMAGE_KEYS.reduce((acc, key) => {
        acc[key] = moodMedia[key] || null;
        return acc;
      }, {}),
      stocks: allStocks.map((stock) => ({ code: stock.code, name: stock.name }))
    });
  }, [market, stats, chipMode, chipPick, customText, moodMedia, allStocks]);

  const commitCustom = useCallback(() => {
    const text = (customDraft || "").trim();
    customTextRef.current = text;
    setCustomText(text);
    safeSave(STORAGE_KEYS.custom, text);
    setEditingCustom(false);
    applyMode("custom", "");
  }, [customDraft, applyMode]);

  // —— 组装底部胶囊文字 ——
  const chip = useMemo(() => {
    if (!market) return { text: "加载中…", statusText: "持平", dotKey: "flat", modeName: "" };
    const statusText = market.profitStatus || "持平";
    const { holdings, watchlist, totalCost, totalProfit, profitPercent, totalValue } = stats;
    let text = "";
    let modeName = CHIP_MODE_NAMES[chipMode] || "";
    // 默认跟随整体盈亏，展示单只个股的模式会覆盖它
    let dotKey = STATUS_DOT[statusText] || "flat";

    switch (chipMode) {
      case "amount":
        text = `今日 ${statusText} ${formatSignedCurrency(totalProfit)}`;
        break;
      case "percent": {
        const pct = formatSignedPercent(profitPercent);
        text = `今日 ${statusText} ${pct}`;
        break;
      }
      case "amountPercent":
        text = `今日 ${statusText} ${formatSignedCurrency(totalProfit)}（${formatSignedPercent(profitPercent)}）`;
        break;
      case "value":
        text = `市值 ¥${formatCompact(totalValue)} / 成本 ¥${formatCompact(totalCost) || "--"}`;
        if (!totalCost && !totalValue) text = "暂无持仓市值";
        break;
      case "counts":
        text = `持仓 ${holdings.length} · 自选 ${watchlist.length}`;
        break;
      case "tickers": {
        if (!holdings.length) {
          text = "暂无持仓";
          dotKey = "flat";
        } else {
          const row = holdings[tickerIndex % holdings.length];
          const pct = rowChangePercent(row);
          const price = rowPrice(row);
          if (price == null) {
            text = `${row.name} 暂无行情`;
            dotKey = "flat";
          } else {
            text = pct == null ? `${row.name} ¥${formatPrice(price)}` : `${row.name} ¥${formatPrice(price)} ${formatSignedPercent(pct)}`;
            dotKey = DOT_FOR_CHANGE(pct);
          }
        }
        break;
      }
      case "pick": {
        if (!chipPick) {
          text = "点右键 · 选盯盘股";
          dotKey = "flat";
        } else if (!pickStock) {
          text = `盯盘股 ${chipPick} 不在自选/持仓`;
          dotKey = "flat";
        } else {
          const pct = rowChangePercent(pickStock);
          const price = rowPrice(pickStock);
          if (price == null) {
            text = `${pickStock.name} 暂无行情`;
            dotKey = "flat";
          } else {
            text = pct == null ? `${pickStock.name} ¥${formatPrice(price)}` : `${pickStock.name} ¥${formatPrice(price)} ${formatSignedPercent(pct)}`;
            dotKey = DOT_FOR_CHANGE(pct);
          }
        }
        break;
      }
      case "custom": {
        const textValue = (customText || "").trim();
        text = textValue || "未设置 · 点右键编辑";
        break;
      }
      default:
        text = `今日 ${statusText} ${formatSignedCurrency(totalProfit)}`;
    }

    return { text, statusText, dotKey, modeName };
  }, [market, stats, chipMode, chipPick, pickStock, customText, tickerIndex]);

  const mood = moodOverride || autoMood;
  // 菜单预览的状态形象优先于时段自动状态
  const activeState = stateOverride || petState;

  // 形象选择（M9）：非交易时段显示状态形象；用户点击后临时"唤醒"，
  // 用盈亏情绪形象回应（睡觉时被摸头会露出笑脸/哭脸），3.5 秒后回到状态形象。
  // 菜单"预览形象"优先级最高：指定情绪看情绪、指定状态看状态，两者互斥。
  const visualKey = tapWake || moodOverride ? mood : stateOverride || (activeState ? activeState : mood);

  // 素材候选源：试穿预览 → 用户绑定的素材（图片/视频）→ 内置形象，逐级回退。
  // 用户绑定覆盖 7 个槽位（情绪 3 + 状态 4）。
  const boundItem = mediaCatalog ? mediaCatalog[(moodMedia || {})[visualKey]] : undefined;
  // 状态形象未自定义时，回退到用户绑定的待机形象：
  // 否则自定义了形象的用户，一到睡觉时段就会变回内置的官方形象（穿帮）
  const stateFallbackItem =
    !boundItem && STATE_KEYS.includes(visualKey) && mediaCatalog ? mediaCatalog[(moodMedia || {}).idle] : undefined;
  const mediaCandidates = useMemo(() => {
    const list = [];
    // 试穿预览优先级最高；其次是点击动作形象。
    // 不依赖预加载探测：素材缺失时由 onError 自动回退到后面的候选，保证点击一定有反馈
    if (previewMedia) list.push({ kind: previewMedia.kind, src: previewMedia.url });
    else if (tapAnim) list.push(BUILTIN_ACTION_MEDIA[tapAnim]);
    if (!previewMedia) {
      if (boundItem) list.push({ kind: boundItem.kind, src: boundItem.url });
      else if (stateFallbackItem) list.push({ kind: stateFallbackItem.kind, src: stateFallbackItem.url });
    }
    list.push(BUILTIN_MEDIA[visualKey] || BUILTIN_MEDIA[mood]);
    return list;
  }, [previewMedia, tapAnim, actionReady, boundItem, stateFallbackItem, visualKey, mood]);

  // 情绪或素材变化时回到第一候选重新加载
  useEffect(() => {
    setMediaErrorStage(0);
  }, [mediaCandidates]);

  const showMediaPlaceholder = mediaErrorStage >= mediaCandidates.length;
  const currentMedia = mediaCandidates[Math.min(mediaErrorStage, mediaCandidates.length - 1)];
  // 当前是否真的在播放点击动作素材（素材缺失时会自动回退，此时为 false）
  const isPlayingAction = Boolean(
    tapAnim && BUILTIN_ACTION_MEDIA[tapAnim] && currentMedia && currentMedia.src === BUILTIN_ACTION_MEDIA[tapAnim].src
  );

  const handleChipClick = useCallback(() => {
    refresh();
    const message =
      market && market.message ? market.message : mood === "happy" ? "涨了，真开心！" : mood === "sad" ? "跌了…明天会更好" : "待命中…";
    showSpeech(message);
  }, [refresh, market, mood, showSpeech]);

  const moodClass = `pet-cow pet-cow--${mood}`;

  // M9：非交易时段状态 + 点击反馈动画，均以根节点类名驱动 CSS
  const rootClassNames = ["pet-root"];
  if (activeState) rootClassNames.push(`pet-root--${activeState}`);
  // 只有"当前确实在播动作素材"时才不叠加 CSS 变换；
  // 动作素材缺失（已自动回退到普通形象）时仍叠加，保证点击看得出反应
  if (tapAnim && !isPlayingAction) {
    rootClassNames.push(`pet-root--${tapAnim}`);
  }
  // 素材自带动画时关闭叠加的 CSS 循环动画（避免"动两遍"），交互反馈动画仍保留
  if (currentMedia?.kind === "video") rootClassNames.push("pet-root--video");
  const showZzz = activeState === "doze" || activeState === "sleep" || activeState === "rest";

  return (
    <div
      className={rootClassNames.join(" ")}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu();
      }}
    >
      {speech ? <div className="pet-speech">{speech}</div> : null}
      {activeState && !tapWake && !moodOverride && !tapAnim ? (
        <div className="pet-state-tag">
          {showZzz ? "Zzz " : ""}
          {PET_STATE_LABEL[activeState] || ""}中
        </div>
      ) : null}

      {/* 整窗可拖，只有形象上部的一小块热区留给单击互动 */}
      <div className={`pet-stage ${moodClass}`}>
        {showMediaPlaceholder ? (
          <PlaceholderCow mood={mood} />
        ) : currentMedia.kind === "video" ? (
          <video
            key={`video-${mood}-${mediaErrorStage}-${currentMedia.src}`}
            className="pet-media"
            src={currentMedia.src}
            preload="auto"
            autoPlay
            // 动作素材播一次即停（不循环），播完立刻回到点击前的形象
            loop={!isPlayingAction}
            muted
            playsInline
            disablePictureInPicture
            onEnded={() => {
              if (isPlayingAction) setTapAnim("");
            }}
            onError={() => setMediaErrorStage((stage) => stage + 1)}
          />
        ) : (
          <img
            key={`image-${mood}-${mediaErrorStage}-${currentMedia.src}`}
            className="pet-media"
            src={currentMedia.src}
            alt=""
            draggable={false}
            onError={() => setMediaErrorStage((stage) => stage + 1)}
          />
        )}
        {/* 互动热区（牛头位置）：
            实测 drag region 下单击 / 双击 / 窗口消息全部收不到，
            因此只把这一小块设为 no-drag，其余 89% 的面积都能拖动窗口 */}
        <div
          className="pet-tap-zone"
          title="点我互动（其它地方可以拖动我）"
          onClick={() => {
            if (handleTapRef.current) handleTapRef.current();
          }}
        />
      </div>

      {/* 预加载点击动作素材：常驻隐藏，避免点击瞬间才加载出现黑帧；加载成功才启用动作形象 */}
      {Object.keys(BUILTIN_ACTION_MEDIA).map((actionKey) => (
        <video
          key={`action-preload-${actionKey}`}
          className="pet-action-preload"
          src={BUILTIN_ACTION_MEDIA[actionKey].src}
          preload="auto"
          muted
          playsInline
          onLoadedMetadata={() => markActionReady(actionKey)}
          onCanPlay={() => markActionReady(actionKey)}
          onLoadedData={() => markActionReady(actionKey)}
          onError={() => setActionReady((prev) => (prev[actionKey] ? { ...prev, [actionKey]: false } : prev))}
        />
      ))}

      <div className="pet-foot">
        <span className="pet-grip" title="按住这里（或形象以外的空白处）可以拖动我">
          ⠿
        </span>
        <button
          type="button"
          className="pet-chip"
          onClick={handleChipClick}
          title={chip.modeName ? `底部显示：${chip.modeName}（点击刷新行情）` : "点击刷新行情"}
        >
          <span className={`chip-dot chip-dot--${chip.dotKey}`} />
          <span className="chip-text" title={chip.text}>
            {chip.text}
          </span>
        </button>
      </div>

      {editingCustom && (
        <div className="pet-editor">
          <input
            autoFocus
            className="pet-editor-input"
            type="text"
            value={customDraft}
            maxLength={40}
            placeholder="输入自定义显示文字（≤40字）"
            onChange={(event) => setCustomDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitCustom();
              if (event.key === "Escape") setEditingCustom(false);
            }}
          />
          <button type="button" className="pet-editor-btn pet-editor-btn--primary" onClick={commitCustom}>
            保存
          </button>
          <button type="button" className="pet-editor-btn" onClick={() => setEditingCustom(false)}>
            取消
          </button>
        </div>
      )}
    </div>
  );
}

function main() {
  const container = document.getElementById("root");
  const root = createRoot(container);
  root.render(<PetApp />);
}

main();
