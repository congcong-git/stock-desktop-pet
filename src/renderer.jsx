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
  return phase === "上午交易" || phase === "下午交易";
}

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
  const timerRef = useRef(null);
  const marketStateRef = useRef(marketState);

  marketStateRef.current = marketState;

  const watchlistCount = watchlist.length;
  const holdingCount = holdings.length;

  const themeClass = useMemo(() => getProfitTheme(marketState.profitStatus), [marketState.profitStatus]);
  const watchCodes = useMemo(() => new Set(watchlist.map((item) => item.code)), [watchlist]);
  const holdingCodes = useMemo(() => new Set(holdings.map((item) => item.code)), [holdings]);
  const networkError = Boolean(marketState.networkError);

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

  // PRD 12.1：刷新时间对齐到整 10 秒，而非"启动后每 10 秒"
  function scheduleAlignedRefresh() {
    window.clearTimeout(timerRef.current);
    const delay = 10000 - (Date.now() % 10000 || 10000);
    timerRef.current = window.setTimeout(async () => {
      await refreshMarket(false);
      if (!isLiveMarketPhase(marketStateRef.current.marketPhase)) {
        await loadSnapshots();
      }
      scheduleAlignedRefresh();
    }, delay);
  }

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

  return (
    <div className={classNames("app-shell", themeClass)}>
      <div className="app-header">
        <div>
          <div className="eyebrow">股票桌宠小组件</div>
          <h1>实时盯盘与今日盈亏总览</h1>
          <p>搜索股票、维护自选与持仓，并在桌面端持续查看 A 股状态。</p>
        </div>
        <div className="status-panel">
          <div className="chip-row">
            <span className="status-chip">{marketState.marketPhase}</span>
            {networkError ? <span className="status-chip warn">网络异常</span> : null}
            {!isTradingDay ? <span className="status-chip muted">非交易日</span> : null}
          </div>
          <div className="status-meta">
            最近刷新：{marketState.refreshedAt ? new Date(marketState.refreshedAt).toLocaleString("zh-CN") : "--"}
          </div>
          <div className="status-meta">
            持仓 {holdingCount} 只 / 自选 {watchlistCount} 只
            {marketLoading ? " · 刷新中" : ""}
          </div>
        </div>
      </div>

      <div className="grid-layout">
        <section className="card search-card">
          <div className="section-title">
            <div>
              <h2>股票搜索</h2>
              <span>支持名称和代码模糊搜索，输入后自动检索。</span>
            </div>
            <div className="inline-count">{searchLoading ? "搜索中..." : `结果 ${searchResults.length} 条`}</div>
          </div>

          <div className="search-bar">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入股票名称或代码，例如：中科、603019"
            />
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>序号</th>
                  <th>股票名称</th>
                  <th>股票代码</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="empty-cell">
                      {query.trim() ? "暂无匹配结果" : "请输入股票名称或代码"}
                    </td>
                  </tr>
                ) : (
                  searchResults.map((item, index) => {
                    const inWatchlist = watchCodes.has(item.code);
                    const inHoldings = holdingCodes.has(item.code);

                    return (
                      <tr key={item.code}>
                        <td>{index + 1}</td>
                        <td>
                          {item.name}
                          {inWatchlist || inHoldings ? (
                            <span className="tag-row">
                              {inWatchlist ? <em className="tag tag-watch">自选</em> : null}
                              {inHoldings ? <em className="tag tag-hold">持仓</em> : null}
                            </span>
                          ) : null}
                        </td>
                        <td>{item.code}</td>
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
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card summary-card">
          <div className="section-title">
            <div>
              <h2>今日盈亏</h2>
              <span>根据持仓股“当前价 - 昨收价”计算当日盈亏。</span>
            </div>
            <div className={classNames("profit-status", themeClass)}>{marketState.profitStatus}</div>
          </div>

          <div className="summary-main">
            <div className={classNames("profit-value", getValueTone(marketState.totalProfit))}>{formatCurrency(marketState.totalProfit)}</div>
            <div className="summary-metrics">
              <div className="metric-card">
                <span>自选股</span>
                <strong>{watchlistCount}</strong>
              </div>
              <div className="metric-card">
                <span>持仓股</span>
                <strong>{holdingCount}</strong>
              </div>
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
        </section>
      </div>

      <div className="grid-layout secondary">
        <section className="card">
          <div className="section-title">
            <div>
              <h2>自选股</h2>
              <span>展示当前涨幅与较开盘价涨跌幅。</span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>序号</th>
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
                    <td colSpan="8" className="empty-cell">
                      暂无自选股
                    </td>
                  </tr>
                ) : (
                  marketState.watchlistRows.map((row) => (
                    <tr key={row.code}>
                      <td>{row.index}</td>
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
        </section>

        <section className="card">
          <div className="section-title">
            <div>
              <h2>持仓股</h2>
              <span>支持编辑持股数和成本价，并计算单只股票今日盈亏。</span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>序号</th>
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
                    <td colSpan="9" className="empty-cell">
                      暂无持仓股
                    </td>
                  </tr>
                ) : (
                  marketState.holdingRows.map((row) => (
                    <tr key={row.code}>
                      <td>{row.index}</td>
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
                        <button className="ghost-btn" onClick={() => openEditHoldingModal(row)}>
                          编辑持仓
                        </button>
                        <button className="danger-btn" onClick={() => handleRemoveHolding(row)}>
                          删除
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card footer-card">
        <div className="section-title">
          <div>
            <h2>市场状态快照</h2>
            <span>每个交易日上午 11:30 与下午 15:00 自动保存，非交易时间自动恢复最近一次状态。</span>
          </div>
          <div className={classNames("source-chip", marketState.isLive ? "live" : "restored")}>
            {marketState.isLive ? "实时行情" : "快照恢复"}
          </div>
        </div>

        <div className="snapshot-grid">
          <div className="snapshot-cell">
            <div className="footer-label">上午 11:30</div>
            <div className={classNames("footer-value", getValueTone(snapshotInfo.today.morning?.profit ?? null))}>
              {formatSnapshot(snapshotInfo.today.morning)}
            </div>
            <div className="footer-sub">{formatSavedAt(snapshotInfo.today.morning?.savedAt)}</div>
          </div>
          <div className="snapshot-cell">
            <div className="footer-label">下午 15:00</div>
            <div className={classNames("footer-value", getValueTone(snapshotInfo.today.afternoon?.profit ?? null))}>
              {formatSnapshot(snapshotInfo.today.afternoon)}
            </div>
            <div className="footer-sub">{formatSavedAt(snapshotInfo.today.afternoon?.savedAt)}</div>
          </div>
          <div className="snapshot-cell">
            <div className="footer-label">当前展示来源</div>
            <div className="footer-value">
              {marketState.isLive
                ? "实时行情"
                : marketState.snapshotDate
                  ? `${marketState.snapshotDate} ${marketState.snapshotTime}`
                  : snapshotInfo.restored
                    ? `${snapshotInfo.restored.date} ${snapshotInfo.restored.time}`
                    : "暂无快照"}
            </div>
            <div className="footer-sub">最近行情：{(() => {
              const firstQuote =
                marketState.watchlistRows.find((row) => row.quote)?.quote ||
                marketState.holdingRows.find((row) => row.quote)?.quote;
              return firstQuote ? formatQuoteTime(firstQuote.latestTime) : "--";
            })()}</div>
          </div>
          <div className="snapshot-cell">
            <div className="footer-label">刷新节奏</div>
            <div className="footer-value">启动立即刷新</div>
            <div className="footer-sub">之后对齐到每 10 秒</div>
          </div>
        </div>

        <div className="footer-bottom">
          <span className="footer-sub">
            本地数据目录：{dataDir || "--"}（watchlist / holdings / daily-status 均为 JSON 持久化）
          </span>
          <button className="ghost-btn" onClick={() => window.stockWatcher.openDataDir()}>
            打开数据目录
          </button>
        </div>
      </section>

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
