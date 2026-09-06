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
const MOOD_CN = { idle: "待机", happy: "开心", sad: "沮丧" };
const MOOD_KEYS = ["idle", "happy", "sad"];
const MOOD_IMG = {
  idle: "./assets/pet/idle.png",
  happy: "./assets/pet/happy.png",
  sad: "./assets/pet/sad.png"
};

const STORAGE_KEYS = {
  mode: "pet.chipMode",
  pick: "pet.chipPick",
  custom: "pet.customText",
  moodMedia: "pet.moodMedia"
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

  const applyResult = useCallback((result) => {
    if (!result) return;
    setMarket(result);
    // 网络异常/无有效行情时不切换表情（沿用 V1.0 失败保留旧数据规则）
    if (result.success === false && result.networkError && !result.profitStatus) return;
    setAutoMood(MOOD_FOR_STATUS[result.profitStatus] || "idle");
  }, []);

  // 菜单"预览表情"支持：手动指定表情，auto 恢复为随行情自动
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
          const same = MOOD_KEYS.every((mood) => (remoteMap[mood] || undefined) === (currentMap[mood] || undefined));
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

    let pendingDelay = 5000;
    const startTimer = () => {
      timerRef.current = window.setInterval(() => {
        refresh();
      }, 10000);
    };
    const delayedTimer = window.setTimeout(startTimer, pendingDelay);
    return () => {
      window.clearTimeout(delayedTimer);
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [refresh]);

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
      moodMedia: {
        idle: moodMedia.idle || null,
        happy: moodMedia.happy || null,
        sad: moodMedia.sad || null
      },
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
    if (!market) return { text: "加载中…", statusText: "持平", modeName: "" };
    const statusText = market.profitStatus || "持平";
    const { holdings, watchlist, totalCost, totalProfit, profitPercent, totalValue } = stats;
    let text = "";
    let modeName = CHIP_MODE_NAMES[chipMode] || "";

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
        } else {
          const row = holdings[tickerIndex % holdings.length];
          const pct = rowChangePercent(row);
          const price = rowPrice(row);
          if (price == null) {
            text = `${row.name} 暂无行情`;
          } else {
            text = pct == null ? `${row.name} ¥${formatPrice(price)}` : `${row.name} ¥${formatPrice(price)} ${formatSignedPercent(pct)}`;
          }
        }
        break;
      }
      case "pick": {
        if (!chipPick) {
          text = "点右键 · 选盯盘股";
        } else if (!pickStock) {
          text = `盯盘股 ${chipPick} 不在自选/持仓`;
        } else {
          const pct = rowChangePercent(pickStock);
          const price = rowPrice(pickStock);
          if (price == null) {
            text = `${pickStock.name} 暂无行情`;
          } else {
            text = pct == null ? `${pickStock.name} ¥${formatPrice(price)}` : `${pickStock.name} ¥${formatPrice(price)} ${formatSignedPercent(pct)}`;
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

    return { text, statusText, modeName };
  }, [market, stats, chipMode, chipPick, pickStock, customText, tickerIndex]);

  const mood = moodOverride || autoMood;

  // 素材候选源：试穿预览 → 当前情绪绑定素材（图片/视频）→ 内置形象图，逐级回退
  const boundItem = mediaCatalog ? mediaCatalog[(moodMedia || {})[mood]] : undefined;
  const mediaCandidates = useMemo(() => {
    const list = [];
    if (previewMedia) list.push({ kind: previewMedia.kind, src: previewMedia.url });
    else if (boundItem) list.push({ kind: boundItem.kind, src: boundItem.url });
    list.push({ kind: "image", src: MOOD_IMG[mood] });
    return list;
  }, [previewMedia, boundItem, mood]);

  // 情绪或素材变化时回到第一候选重新加载
  useEffect(() => {
    setMediaErrorStage(0);
  }, [mediaCandidates]);

  const showMediaPlaceholder = mediaErrorStage >= mediaCandidates.length;
  const currentMedia = mediaCandidates[Math.min(mediaErrorStage, mediaCandidates.length - 1)];

  const handleChipClick = useCallback(() => {
    refresh();
    const message =
      market && market.message ? market.message : mood === "happy" ? "涨了，真开心！" : mood === "sad" ? "跌了…明天会更好" : "待命中…";
    showSpeech(message);
  }, [refresh, market, mood, showSpeech]);

  const moodClass = `pet-cow pet-cow--${mood}`;

  return (
    <div
      className="pet-root"
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu();
      }}
    >
      {speech && <div className="pet-speech">{speech}</div>}

      <div className={`pet-stage ${moodClass}`}>
        {showMediaPlaceholder ? (
          <PlaceholderCow mood={mood} />
        ) : currentMedia.kind === "video" ? (
          <video
            key={`video-${mood}-${mediaErrorStage}-${currentMedia.src}`}
            className="pet-media"
            src={currentMedia.src}
            autoPlay
            loop
            muted
            playsInline
            disablePictureInPicture
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
      </div>

      <div className="pet-foot">
        <button
          type="button"
          className="pet-chip"
          onClick={handleChipClick}
          title={chip.modeName ? `底部显示：${chip.modeName}（点击刷新行情）` : "点击刷新行情"}
        >
          <span className={`chip-dot chip-dot--${mood}`} />
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
