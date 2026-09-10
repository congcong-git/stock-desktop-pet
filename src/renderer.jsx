import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "--";
  }
  const amount = Number(value);
  const prefix = amount > 0 ? "+" : "";
  return `${prefix}${amount.toFixed(2)}%`;
}

function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "--";
  }
  const amount = Number(value);
  const prefix = amount > 0 ? "+" : "";
  return `${prefix}${amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} 元`;
}

function formatPrice(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "--";
  }
  return Number(value).toFixed(2);
}

function formatQuoteTime(value) {
  if (!value || String(value).length < 14) {
    return "--";
  }
  return `${String(value).slice(0, 4)}-${String(value).slice(4, 6)}-${String(value).slice(6, 8)} ${String(value).slice(
    8,
    10
  )}:${String(value).slice(10, 12)}:${String(value).slice(12, 14)}`;
}

function getValueTone(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "";
  }
  if (Number(value) > 0) {
    return "rise";
  }
  if (Number(value) < 0) {
    return "fall";
  }
  return "flat";
}

function getProfitTheme(status) {
  if (status === "盈利") {
    return "theme-profit";
  }
  if (status === "亏损") {
    return "theme-loss";
  }
  return "theme-flat";
}

function getTrendText(trend) {
  if (trend === "bull") {
    return "牛市上攻";
  }
  if (trend === "bear") {
    return "熊市回撤";
  }
  return "波动持平";
}

function isLiveMarketPhase(phase) {
  return phase === "集合竞价" || phase === "上午交易" || phase === "下午交易";
}

const REFRESH_PRESETS = [5, 10, 15, 30];
const REFRESH_LIMITS = [3, 120];
const MARKET_LABELS = { sh: "沪", sz: "深", bj: "北" };
const LIST_HINTS = {
  search: "输入名称或代码，可直接加入自选 / 持仓",
  watch: "涨幅与较开盘价涨跌幅",
  hold: "持股数、成本价与单只今日盈亏"
};

function formatSnapshot(snapshot) {
  if (!snapshot) {
    return "--";
  }
  const profit = typeof snapshot.profit === "number" ? formatCurrency(snapshot.profit) : "--";
  return `${profit} · ${snapshot.status || "--"}`;
}

function formatSavedAt(value) {
  if (!value) {
    return "--";
  }
  return new Date(value).toLocaleString("zh-CN");
}

function emptyHoldingDraft() {
  return {
    code: "",
    name: "",
    quantity: "",
    costPrice: ""
  };
}

function BullIcon() {
  return (
    <svg viewBox="0 0 120 120" className="animal-svg" aria-label="牛">
      <defs>
        <linearGradient id="bullBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fca5a5" />
          <stop offset="100%" stopColor="#dc2626" />
        </linearGradient>
      </defs>
      <path
        d="M22 44 C10 34 8 20 16 12 C24 6 34 12 36 22"
        fill="none"
        stroke="#fecaca"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        d="M98 44 C110 34 112 20 104 12 C96 6 86 12 84 22"
        fill="none"
        stroke="#fecaca"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path d="M60 26 C79 26 93 41 93 59 C93 79 78 97 60 97 C42 97 27 79 27 59 C27 41 41 26 60 26 Z" fill="url(#bullBody)" />
      <ellipse cx="60" cy="80" rx="22" ry="15" fill="#fee2e2" opacity="0.92" />
      <ellipse cx="51" cy="80" rx="4" ry="5.5" fill="#b91c1c" />
      <ellipse cx="69" cy="80" rx="4" ry="5.5" fill="#b91c1c" />
      <circle cx="45" cy="55" r="5" fill="#450a0a" />
      <circle cx="75" cy="55" r="5" fill="#450a0a" />
      <path d="M33 44 C39 38 48 36 55 38" fill="none" stroke="#fecaca" strokeWidth="4" strokeLinecap="round" opacity="0.7" />
      <path d="M87 44 C81 38 72 36 65 38" fill="none" stroke="#fecaca" strokeWidth="4" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function BearIcon() {
  return (
    <svg viewBox="0 0 120 120" className="animal-svg" aria-label="熊">
      <defs>
        <linearGradient id="bearBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#86efac" />
          <stop offset="100%" stopColor="#15803d" />
        </linearGradient>
      </defs>
      <circle cx="29" cy="33" r="16" fill="#166534" />
      <circle cx="91" cy="33" r="16" fill="#166534" />
      <circle cx="29" cy="33" r="8" fill="#bbf7d0" />
      <circle cx="91" cy="33" r="8" fill="#bbf7d0" />
      <ellipse cx="60" cy="67" rx="36" ry="33" fill="url(#bearBody)" />
      <ellipse cx="60" cy="83" rx="20" ry="14" fill="#dcfce7" />
      <ellipse cx="60" cy="76" rx="6" ry="4.5" fill="#14532d" />
      <path
        d="M60 80 L60 86 M60 86 C55 91 50 89 49 85 M60 86 C65 91 70 89 71 85"
        fill="none"
        stroke="#14532d"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="46" cy="57" r="4.5" fill="#052e16" />
      <circle cx="74" cy="57" r="4.5" fill="#052e16" />
      <path d="M40 45 C46 41 53 41 58 43" fill="none" stroke="#bbf7d0" strokeWidth="3.5" strokeLinecap="round" opacity="0.65" />
      <path d="M80 45 C74 41 67 41 62 43" fill="none" stroke="#bbf7d0" strokeWidth="3.5" strokeLinecap="round" opacity="0.65" />
    </svg>
  );
}

function IdleIcon() {
  return (
    <svg viewBox="0 0 120 120" className="animal-svg" aria-label="持平">
      <circle cx="60" cy="60" r="34" fill="none" stroke="#64748b" strokeWidth="7" />
      <path d="M38 60 H82" stroke="#94a3b8" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}

const TREND_DURATION = 2400;

/**
 * 牛/熊动画展示区（PRD 11、BR014、BR015）。
 * 仅在"本次总盈亏高于/低于上次"时播放一次动画；持平或网络异常时不播放。
 */
function TrendStage({ trend, playToken, disabled }) {
  const [playing, setPlaying] = useState(false);
  const [lastTrend, setLastTrend] = useState("flat");

  useEffect(() => {
    if (disabled || !trend || trend === "flat") {
      setPlaying(false);
      return undefined;
    }

    setLastTrend(trend);
    // 重新挂载动画：先复位再播放，保证连续同向变化也能看到动画
    setPlaying(false);
    const startTimer = window.setTimeout(() => setPlaying(true), 20);
    const stopTimer = window.setTimeout(() => setPlaying(false), TREND_DURATION);

    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(stopTimer);
    };
  }, [playToken, trend, disabled]);

  const stageTrend = playing ? trend : lastTrend;
  const label =
    trend === "bull" ? "牛动画 · 总盈亏上升" : trend === "bear" ? "熊动画 · 总盈亏下降" : "持平 · 不播放新动画";

  return (
    <div className={classNames("trend-stage", `is-${stageTrend}`, playing && "is-playing")}>
      <div className="stage-glow" />
      <div className="stage-ring" />
      <div className="stage-rays">
        <span style={{ "--i": 0 }} />
        <span style={{ "--i": 1 }} />
        <span style={{ "--i": 2 }} />
        <span style={{ "--i": 3 }} />
        <span style={{ "--i": 4 }} />
      </div>
      <div className="stage-animal">
        {trend === "bull" ? <BullIcon /> : trend === "bear" ? <BearIcon /> : <IdleIcon />}
      </div>
      <div className="stage-caption">
        <div className={classNames("stage-badge", `is-${trend}`)}>{getTrendText(trend)}</div>
        <p>{label}</p>
      </div>
      <div className="stage-particles">
        <span style={{ "--i": 0 }} />
        <span style={{ "--i": 1 }} />
        <span style={{ "--i": 2 }} />
      </div>
    </div>
  );
}

function App() {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [marketState, setMarketState] = useState({
    totalProfit: 0,
    profitStatus: "持平",
    trend: "flat",
    marketPhase: "开盘前",
    watchlistRows: [],
    holdingRows: [],
    message: "正在初始化...",
    refreshedAt: ""
  });
  const [statusMessage, setStatusMessage] = useState("正在初始化...");
  const [searchLoading, setSearchLoading] = useState(false);
  const [marketLoading, setMarketLoading] = useState(false);
  const [holdingDraft, setHoldingDraft] = useState(emptyHoldingDraft());
  const [holdingModalOpen, setHoldingModalOpen] = useState(false);
  const [editingHoldingCode, setEditingHoldingCode] = useState("");
  const [dataDir, setDataDir] = useState("");
  const [snapshotInfo, setSnapshotInfo] = useState({
    today: { date: "", morning: null, afternoon: null },
    restored: null
  });
  const [isTradingDay, setIsTradingDay] = useState(true);
  const [dataNotices, setDataNotices] = useState([]);
  const [appConfig, setAppConfig] = useState(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideAutoLaunch, setGuideAutoLaunch] = useState(false);
  const [activeTable, setActiveTable] = useState("watch"); // 搜索 / 自选股 / 持仓股 分栏
  const [snapshotFlash, setSnapshotFlash] = useState(false); // 快照区高亮提示
  const [intervalDraft, setIntervalDraft] = useState("10"); // 刷新间隔输入框草稿
  const searchInputRef = useRef(null);
  const timerRef = useRef(null);
  const marketStateRef = useRef(marketState);
  const refreshSecondsRef = useRef(10);
  const bootstrappedRef = useRef(false);

  marketStateRef.current = marketState;
  refreshSecondsRef.current = Number(appConfig?.refreshSeconds) || 10;

  const watchlistCount = watchlist.length;
  const holdingCount = holdings.length;

  const themeClass = useMemo(() => getProfitTheme(marketState.profitStatus), [marketState.profitStatus]);
  const watchCodes = useMemo(() => new Set(watchlist.map((item) => item.code)), [watchlist]);
  const holdingCodes = useMemo(() => new Set(holdings.map((item) => item.code)), [holdings]);
  const networkError = Boolean(marketState.networkError);
  const firstQuoteTime = useMemo(() => {
    const firstQuote =
      marketState.watchlistRows.find((row) => row.quote)?.quote ||
      marketState.holdingRows.find((row) => row.quote)?.quote;
    return firstQuote ? formatQuoteTime(firstQuote.latestTime) : "--";
  }, [marketState.watchlistRows, marketState.holdingRows]);

  async function loadBootstrap() {
    const bootstrap = await window.stockWatcher.getBootstrap();
    setWatchlist(bootstrap.watchlist || []);
    setHoldings(bootstrap.holdings || []);
    setDataDir(bootstrap.dataDir || "");
    setIsTradingDay(bootstrap.isTradingDay !== false);
    setDataNotices(bootstrap.dataNotices || []);
    setSnapshotInfo((current) => ({
      ...current,
      today: bootstrap.todaySnapshot || { date: "", morning: null, afternoon: null }
    }));

    const config = bootstrap.appConfig || null;
    setAppConfig(config);
    if (config) {
      setIntervalDraft(String(config.refreshSeconds || 10));
    }
    if (config && !config.guideSeen) {
      setGuideOpen(true);
      setGuideAutoLaunch(config.autoLaunchEnabled === true);
    }
  }

  async function loadSnapshots() {
    try {
      const snapshots = await window.stockWatcher.getSnapshots();
      setSnapshotInfo({
        today: snapshots.today || { date: "", morning: null, afternoon: null },
        restored: snapshots.restored || null
      });
    } catch (error) {
      // 快照读取失败不阻断主流程
    }
  }

  async function refreshMarket(showBusy = true) {
    if (showBusy) {
      setMarketLoading(true);
    }

    try {
      const result = await window.stockWatcher.refreshMarket();
      setMarketState(result);
      setStatusMessage(result.message || "已刷新");
      setDataNotices(result.dataNotices || []);
      if (result.todaySnapshot) {
        setSnapshotInfo((current) => ({ ...current, today: result.todaySnapshot }));
      }
      if (result.snapshotDate) {
        await loadSnapshots();
      }
    } catch (error) {
      setStatusMessage(`刷新失败：${error.message}`);
    } finally {
      if (showBusy) {
        setMarketLoading(false);
      }
    }
  }

  // PRD 12.1：刷新时间对齐到整间隔（默认 10 秒，面板可自定义），而非"启动后每 N 秒"
  function scheduleAlignedRefresh() {
    window.clearTimeout(timerRef.current);
    const interval = Math.max(REFRESH_LIMITS[0], refreshSecondsRef.current) * 1000;
    const delay = interval - (Date.now() % interval);
    timerRef.current = window.setTimeout(async () => {
      await refreshMarket(false);
      if (!isLiveMarketPhase(marketStateRef.current.marketPhase)) {
        await loadSnapshots();
      }
      scheduleAlignedRefresh();
    }, delay);
  }

  // 配置变更（本面板 / 宠物右键菜单）即时同步，并按新间隔重建定时器
  useEffect(() => {
    return window.stockWatcher.onAppConfigChanged((config) => {
      setAppConfig(config);
      setIntervalDraft(String((config && config.refreshSeconds) || 10));
    });
  }, []);

  // 宠物右键菜单直达：搜索添加股票 / 自选持仓管理 / 今日快照
  useEffect(() => {
    if (typeof window.stockWatcher.onPanelMode !== "function") {
      return undefined;
    }

    return window.stockWatcher.onPanelMode((mode) => {
      if (mode === "search") {
        setActiveTable("search");
        window.setTimeout(() => searchInputRef.current?.focus(), 80);
        return;
      }
      if (mode === "manage") {
        setActiveTable("watch");
        return;
      }
      if (mode === "snapshot") {
        setSnapshotFlash(true);
        window.setTimeout(() => setSnapshotFlash(false), 1700);
      }
    });
  }, []);

  useEffect(() => {
    if (!bootstrappedRef.current) {
      return;
    }
    scheduleAlignedRefresh();
  }, [appConfig?.refreshSeconds]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await loadBootstrap();
        if (!active) {
          return;
        }
        await refreshMarket(true);
        if (!active) {
          return;
        }
        bootstrappedRef.current = true;
        scheduleAlignedRefresh();
      } catch (error) {
        setStatusMessage(`初始化失败：${error.message}`);
      }
    })();

    return () => {
      active = false;
      window.clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchLoading(false);
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await window.stockWatcher.searchStocks(trimmed);
        setSearchResults(results);
      } catch (error) {
        setStatusMessage(`搜索失败：${error.message}`);
      } finally {
        setSearchLoading(false);
      }
    }, 400);

    return () => window.clearTimeout(timer);
  }, [query]);

  async function handleAddWatchlist(stock) {
    try {
      const result = await window.stockWatcher.addWatchlist(stock);
      setWatchlist(result.watchlist || []);
      setStatusMessage(result.duplicate ? `${stock.name} 已在自选股中。` : `${stock.name} 已加入自选股。`);
      await refreshMarket(false);
    } catch (error) {
      setStatusMessage(`加入自选失败：${error.message}`);
    }
  }

  // BR005：已存在的持仓直接进入编辑流程，避免重复记录
  function openAddHoldingModal(stock) {
    const existing = holdings.find((item) => item.code === stock.code);

    setEditingHoldingCode(existing ? existing.code : "");
    setHoldingDraft({
      code: stock.code,
      name: existing ? existing.name : stock.name,
      quantity: existing ? String(existing.quantity || "") : "",
      costPrice: existing && existing.costPrice != null ? String(existing.costPrice) : ""
    });
    setHoldingModalOpen(true);
  }

  function openEditHoldingModal(holdingRow) {
    setEditingHoldingCode(holdingRow.code);
    setHoldingDraft({
      code: holdingRow.code,
      name: holdingRow.name,
      quantity: String(holdingRow.quantity || ""),
      costPrice: holdingRow.costPrice != null ? String(holdingRow.costPrice) : ""
    });
    setHoldingModalOpen(true);
  }

  function closeHoldingModal() {
    setHoldingModalOpen(false);
    setEditingHoldingCode("");
    setHoldingDraft(emptyHoldingDraft());
  }

  async function handleSaveHolding() {
    try {
      if (editingHoldingCode) {
        const result = await window.stockWatcher.updateHolding({
          code: holdingDraft.code,
          quantity: Number(holdingDraft.quantity),
          costPrice: holdingDraft.costPrice === "" ? null : Number(holdingDraft.costPrice)
        });
        setHoldings(result.holdings || []);
        setStatusMessage(`${holdingDraft.name} 持仓已更新。`);
      } else {
        const result = await window.stockWatcher.saveHolding({
          code: holdingDraft.code,
          name: holdingDraft.name,
          quantity: Number(holdingDraft.quantity),
          costPrice: holdingDraft.costPrice === "" ? null : Number(holdingDraft.costPrice)
        });
        setHoldings(result.holdings || []);
        setStatusMessage(result.duplicate ? `${holdingDraft.name} 已存在，已直接更新持仓。` : `${holdingDraft.name} 已加入持仓。`);
      }

      closeHoldingModal();
      await refreshMarket(false);
    } catch (error) {
      setStatusMessage(`保存持仓失败：${error.message}`);
    }
  }

  async function handleRemoveWatchlist(row) {
    const confirmed = window.confirm(`确定从自选股中移除「${row.name}（${row.code}）」吗？`);
    if (!confirmed) {
      return;
    }
    try {
      const result = await window.stockWatcher.removeWatchlist(row.code);
      setWatchlist(result.watchlist || []);
      setStatusMessage(`已从自选股移除：${row.name}`);
      await refreshMarket(false);
    } catch (error) {
      setStatusMessage(`移除自选股失败：${error.message}`);
    }
  }

  async function closeGuide() {
    setGuideOpen(false);
    try {
      if (guideAutoLaunch && appConfig && appConfig.autoLaunchEnabled !== guideAutoLaunch) {
        await window.stockWatcher.setAutoLaunch(true);
      }
      await window.stockWatcher.setGuideSeen();
      setAppConfig(await window.stockWatcher.getAppConfig());
    } catch (error) {
      setStatusMessage(`引导设置保存失败：${error.message}`);
    }
  }

  async function handleRemoveHolding(row) {
    const confirmed = window.confirm(`确定删除持仓「${row.name}（${row.code}）」吗？该操作不可撤销。`);
    if (!confirmed) {
      return;
    }
    try {
      const result = await window.stockWatcher.removeHolding(row.code);
      setHoldings(result.holdings || []);
      setStatusMessage(`已删除持仓：${row.name}`);
      await refreshMarket(false);
    } catch (error) {
      setStatusMessage(`删除持仓失败：${error.message}`);
    }
  }

  // 刷新间隔：越界自动收敛到 3～120 秒，保存后主进程会广播给所有窗口
  async function applyRefreshSeconds(seconds) {
    const [min, max] = REFRESH_LIMITS;
    const value = Math.min(max, Math.max(min, Math.round(Number(seconds) || refreshSecondsRef.current)));
    setIntervalDraft(String(value));
    try {
      const config = await window.stockWatcher.setRefreshSeconds(value);
      setAppConfig(config);
      setStatusMessage(`刷新间隔已设为每 ${value} 秒`);
    } catch (error) {
      setStatusMessage(`刷新间隔设置失败：${error.message}`);
    }
  }

  return (
    <div className={classNames("app-shell", themeClass)}>
      <div className="app-header">
        <div className="header-main">
          <div className="eyebrow">股票桌宠小组件</div>
          <h1>实时盯盘与今日盈亏总览</h1>
        </div>
        <div className="status-panel">
          <div className="chip-row">
            <span className="status-chip">{marketState.marketPhase}</span>
            <span className={classNames("status-chip", marketState.isLive ? "live" : "muted")}>
              {marketState.isLive ? "实时行情" : "快照恢复"}
            </span>
            {networkError ? <span className="status-chip warn">网络异常</span> : null}
            {!isTradingDay ? <span className="status-chip muted">非交易日</span> : null}
          </div>
          <div className="status-meta">
            刷新于 {marketState.refreshedAt ? new Date(marketState.refreshedAt).toLocaleTimeString("zh-CN") : "--"}
            <em className="dot" />
            持仓 {holdingCount} / 自选 {watchlistCount}
            {marketLoading ? " · 刷新中" : ""}
          </div>
        </div>

        <div className="interval-control">
          <span className="interval-label">刷新间隔</span>
          <div className="segmented small">
            {REFRESH_PRESETS.map((seconds) => (
              <button
                type="button"
                key={seconds}
                className={classNames(Number(appConfig?.refreshSeconds) === seconds && "active")}
                onClick={() => applyRefreshSeconds(seconds)}
              >
                {seconds}s
              </button>
            ))}
          </div>
          <div className="interval-input">
            <input
              type="number"
              min={REFRESH_LIMITS[0]}
              max={REFRESH_LIMITS[1]}
              value={intervalDraft}
              onChange={(event) => setIntervalDraft(event.target.value)}
              onBlur={() => applyRefreshSeconds(intervalDraft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
            <span>秒</span>
          </div>
          <span className="section-hint">交易日 9:15 起自动刷新</span>
        </div>
      </div>

      <div className="main-row">
        <section className="card list-card">
          <div className="section-title">
            <div className="segmented">
              <button
                type="button"
                className={classNames(activeTable === "search" && "active")}
                onClick={() => setActiveTable("search")}
              >
                搜索
              </button>
              <button
                type="button"
                className={classNames(activeTable === "watch" && "active")}
                onClick={() => setActiveTable("watch")}
              >
                自选股 <em>{watchlistCount}</em>
              </button>
              <button
                type="button"
                className={classNames(activeTable === "hold" && "active")}
                onClick={() => setActiveTable("hold")}
              >
                持仓股 <em>{holdingCount}</em>
              </button>
            </div>
            <span className="section-hint">{LIST_HINTS[activeTable]}</span>
          </div>

          {activeTable === "search" ? (
            <>
              <div className="search-bar">
                <span className="search-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.6-3.6" strokeLinecap="round" />
                  </svg>
                </span>
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="输入股票名称或代码，例如：中科、603019"
                />
                {query ? (
                  <button
                    type="button"
                    className="search-clear"
                    title="清空搜索"
                    onClick={() => {
                      setQuery("");
                      searchInputRef.current?.focus();
                    }}
                  >
                    ✕
                  </button>
                ) : null}
              </div>

              <div className={classNames("table-wrap", searchResults.length === 0 && "is-empty")}>
                {searchResults.length === 0 ? (
                  <div className="search-empty">
                    <div className="search-empty-title">
                      {searchLoading ? "搜索中..." : query.trim() ? "暂无匹配结果" : "输入名称或代码开始搜索"}
                    </div>
                    <div className="search-empty-hint">
                      {query.trim() ? "换个关键词试试，支持名称 / 代码 / 拼音首字母" : "试试：600519 / 茅台 / 中科曙光"}
                    </div>
                  </div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>股票名称</th>
                        <th>市场</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchResults.map((item) => {
                        const inWatchlist = watchCodes.has(item.code);
                        const inHoldings = holdingCodes.has(item.code);

                        return (
                          <tr key={item.code}>
                            <td>
                              <div className="stock-name">
                                {item.name}
                                {inWatchlist || inHoldings ? (
                                  <span className="tag-row">
                                    {inWatchlist ? <em className="tag tag-watch">自选</em> : null}
                                    {inHoldings ? <em className="tag tag-hold">持仓</em> : null}
                                  </span>
                                ) : null}
                              </div>
                              <div className="stock-code">{item.code}</div>
                            </td>
                            <td>
                              <em className="market-tag">{MARKET_LABELS[item.market] || "—"}</em>
                            </td>
                            <td>
                              <div className="action-group">
                                <button
                                  className="ghost-btn"
                                  disabled={inWatchlist}
                                  onClick={() => handleAddWatchlist(item)}
                                >
                                  {inWatchlist ? "已加入自选" : "加入自选"}
                                </button>
                                <button className="primary-btn" onClick={() => openAddHoldingModal(item)}>
                                  {inHoldings ? "修改持仓" : "加入持仓"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : null}

          {activeTable === "watch" ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>股票名称</th>
                    <th>股票代码</th>
                    <th>当前价</th>
                    <th>当前涨幅</th>
                    <th>较开盘价涨跌幅</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {marketState.watchlistRows.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="empty-cell">
                        暂无自选股
                      </td>
                    </tr>
                  ) : (
                    marketState.watchlistRows.map((row) => (
                      <tr key={row.code}>
                        <td>{row.name}</td>
                        <td>{row.code}</td>
                        <td>{row.quote ? formatPrice(row.quote.currentPrice) : "--"}</td>
                        <td className={getValueTone(row.quote ? row.quote.changePercent : null)}>
                          {row.quote ? formatPercent(row.quote.changePercent) : "--"}
                        </td>
                        <td className={getValueTone(row.quote ? row.quote.openChangePercent : null)}>
                          {row.quote ? formatPercent(row.quote.openChangePercent) : "--"}
                        </td>
                        <td className={classNames("status-text", row.error && "stale-text")}>{row.error || "正常"}</td>
                        <td>
                          <button className="danger-btn" onClick={() => handleRemoveWatchlist(row)}>
                            删除
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          {activeTable === "hold" ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>股票名称</th>
                    <th>股票代码</th>
                    <th>当前价</th>
                    <th>当前涨幅</th>
                    <th>开盘涨跌</th>
                    <th>持股数</th>
                    <th>今日盈亏</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {marketState.holdingRows.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="empty-cell">
                        暂无持仓股
                      </td>
                    </tr>
                  ) : (
                    marketState.holdingRows.map((row) => (
                      <tr key={row.code}>
                        <td>{row.name}</td>
                        <td>{row.code}</td>
                        <td>{row.quote ? formatPrice(row.quote.currentPrice) : "--"}</td>
                        <td className={getValueTone(row.quote ? row.quote.changePercent : null)}>
                          {row.quote ? formatPercent(row.quote.changePercent) : "--"}
                        </td>
                        <td className={getValueTone(row.quote ? row.quote.openChangePercent : null)}>
                          {row.quote ? formatPercent(row.quote.openChangePercent) : "--"}
                        </td>
                        <td>{row.quantity}</td>
                        <td className={getValueTone(row.dailyProfit)}>{formatCurrency(row.dailyProfit)}</td>
                        <td>
                          <div className="action-group">
                            <button className="ghost-btn" onClick={() => openEditHoldingModal(row)}>
                              编辑
                            </button>
                            <button className="danger-btn" onClick={() => handleRemoveHolding(row)}>
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <aside className="card summary-card">
          <div className="section-title">
            <h2>今日盈亏</h2>
            <div className={classNames("profit-status", themeClass)}>{marketState.profitStatus}</div>
          </div>

          <div className="summary-main">
            <div className={classNames("profit-value", getValueTone(marketState.totalProfit))}>{formatCurrency(marketState.totalProfit)}</div>
            <div className="profit-sub">
              今日持仓浮动
              <em className="dot" />
              自选 {watchlistCount} · 持仓 {holdingCount}
            </div>
          </div>

          <TrendStage
            trend={marketState.trend}
            playToken={marketState.refreshedAt}
            disabled={networkError || !isLiveMarketPhase(marketState.marketPhase)}
          />

          <div className={classNames("message-bar", marketLoading && "loading", networkError && "error")}>
            {statusMessage}
          </div>

          {dataNotices.length > 0 ? (
            <div className="notice-bar">
              {dataNotices.map((notice) => (
                <div key={notice}>{notice}</div>
              ))}
            </div>
          ) : null}

          <div className={classNames("snapshot-mini", snapshotFlash && "snapshot-flash")}>
            <div className="snapshot-line">
              <span>上午 11:30</span>
              <b className={getValueTone(snapshotInfo.today.morning?.profit ?? null)}>
                {formatSnapshot(snapshotInfo.today.morning)}
              </b>
            </div>
            <div className="snapshot-line">
              <span>下午 15:00</span>
              <b className={getValueTone(snapshotInfo.today.afternoon?.profit ?? null)}>
                {formatSnapshot(snapshotInfo.today.afternoon)}
              </b>
            </div>
            <div className="snapshot-line">
              <span>展示来源</span>
              <b>
                {marketState.isLive
                  ? "实时行情"
                  : marketState.snapshotDate
                    ? `${marketState.snapshotDate} ${marketState.snapshotTime}`
                    : snapshotInfo.restored
                      ? `${snapshotInfo.restored.date} ${snapshotInfo.restored.time}`
                      : "暂无快照"}
              </b>
            </div>
            <div className="snapshot-line">
              <span>快照写入</span>
              <em>{formatSavedAt(snapshotInfo.today.afternoon?.savedAt || snapshotInfo.today.morning?.savedAt)}</em>
            </div>
            <div className="snapshot-line">
              <span>最近行情</span>
              <em>{firstQuoteTime}</em>
            </div>
            <div className="snapshot-actions">
              <span className={classNames("source-chip", marketState.isLive ? "live" : "restored")}>
                {marketState.isLive ? "实时行情" : "快照恢复"}
              </span>
              <button
                className="ghost-btn"
                title={dataDir ? `本地数据目录：${dataDir}` : "打开本地数据目录"}
                onClick={() => window.stockWatcher.openDataDir()}
              >
                打开数据目录
              </button>
            </div>
          </div>
        </aside>
      </div>

      {holdingModalOpen ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>{editingHoldingCode ? "编辑持仓" : "添加持仓"}</h3>
            <div className="form-row">
              <label>股票名称</label>
              <input value={holdingDraft.name} disabled />
            </div>
            <div className="form-row">
              <label>股票代码</label>
              <input value={holdingDraft.code} disabled />
            </div>
            <div className="form-row">
              <label>持股数量</label>
              <input
                type="number"
                min="1"
                value={holdingDraft.quantity}
                onChange={(event) => setHoldingDraft((current) => ({ ...current, quantity: event.target.value }))}
                placeholder="请输入持股数量"
              />
            </div>
            <div className="form-row">
              <label>持仓成本价</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={holdingDraft.costPrice}
                onChange={(event) => setHoldingDraft((current) => ({ ...current, costPrice: event.target.value }))}
                placeholder="可选，后续扩展使用"
              />
            </div>
            <div className="modal-actions">
              <button className="ghost-btn" onClick={closeHoldingModal}>
                取消
              </button>
              <button className="primary-btn" onClick={handleSaveHolding}>
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {guideOpen ? (
        <div className="modal-backdrop">
          <div className="modal guide-modal">
            <h3>欢迎使用「牛来」</h3>
            <div className="guide-list">
              <p>
                <b>1. 右键宠物</b>：切换底部胶囊显示内容、更换形象、打开管理面板。
              </p>
              <p>
                <b>2. 宠物素材库</b>：右键 → 宠物外观 → 打开素材库管理，可导入 / 试穿 / 去背景。
              </p>
              <p>
                <b>3. 找不到窗口时</b>：点 Windows 右下角托盘的牛头图标即可唤回。
              </p>
            </div>
            {appConfig && appConfig.autoLaunchSupported ? (
              <div className="guide-checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={guideAutoLaunch}
                    onChange={(event) => setGuideAutoLaunch(event.target.checked)}
                  />
                  开机自动启动（可在右键菜单「设置」中随时调整）
                </label>
              </div>
            ) : null}
            <div className="modal-actions">
              <button className="primary-btn" onClick={closeGuide}>
                知道了
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
