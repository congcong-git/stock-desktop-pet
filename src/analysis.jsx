import React, { useEffect, useRef, useState } from "react";
import "./analysis.css";

const PERIOD_LABELS = { day: "日线", "60m": "60分", "30m": "30分", "5m": "5分" };
const PERIODS = ["day", "60m", "30m", "5m"];
const ACTION_COLOR = { buy: "#38bdf8", sell: "#fb923c", hold: "#94a3b8" };
const DIRECTION_LABEL = { up: "上升", down: "下降", sideways: "震荡", unknown: "不明" };
const STRENGTH_LABEL = { high: "强", medium: "中", low: "弱" };
const PHASE_TONE = {
  accumulation: "up",
  markup: "up",
  distribution: "down",
  markdown: "down",
  trading_range: "flat",
  unknown: "flat"
};
const ACTION_LABEL = { long: "共振偏多", short: "共振偏空", watch: "不共振·观望" };

function MethodCard({ title, sub, badge, badgeTone, children }) {
  return (
    <div className="method-card">
      <div className="method-head">
        <div className="method-title">
          <h3>{title}</h3>
          {sub ? <div className="method-sub">{sub}</div> : null}
        </div>
        {badge ? <span className={`method-badge ${badgeTone || ""}`}>{badge}</span> : null}
      </div>
      <div className="method-body">{children}</div>
    </div>
  );
}

function FactorCard({ f }) {
  const toneCls = f.tone === "up" ? "up" : f.tone === "down" ? "down" : "flat";
  const score = f.score == null ? null : f.score;
  return (
    <div className={`factor-card ${toneCls}`}>
      <div className="factor-card-head">
        <div className="factor-name">
          {f.name}
          <span className="factor-horizon">{f.horizon}</span>
        </div>
        <span className={`factor-badge ${toneCls}`}>{f.signal}</span>
      </div>
      <div className="factor-score">
        {score == null ? (
          <span className="factor-score-na">N/A</span>
        ) : (
          <>
            <div className="factor-score-bar">
              <i className={toneCls} style={{ width: `${score}%` }} />
            </div>
            <span className="factor-score-num">{score}</span>
          </>
        )}
      </div>
      <p className="factor-summary">{f.summary}</p>
      {f.metrics && f.metrics.length ? (
        <ul className="factor-metrics">
          {f.metrics.map((m, i) => (
            <li key={i}>
              <span className="fm-label">{m.label}</span>
              <span className="fm-value">{m.value}</span>
              {m.note ? <span className="fm-note">{m.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FactorAnalysis({ factors }) {
  if (!factors) return null;
  const v = factors.verdict || {};
  const vCls = v.tone === "up" ? "up" : v.tone === "down" ? "down" : "flat";
  return (
    <div className="factor-section">
      <div className="factor-section-head">
        <h2>因子分析 · 六因子</h2>
        {v.title ? (
          <span className={`trend-pill ${vCls}`}>
            {v.title}
            {v.avg != null ? ` · ${v.avg}/100` : ""}
          </span>
        ) : null}
      </div>
      {v.title ? (
        <div className={`resonance-card ${vCls}`}>
          <div className="resonance-title">{v.title}</div>
          {v.reasons && v.reasons.length ? (
            <ul className="resonance-reasons">
              {v.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="factor-grid">
        {(factors.list || []).map((f, i) => (
          <FactorCard key={i} f={f} />
        ))}
      </div>
      {factors.disclaimer ? <div className="disclaimer factor-disclaimer">{factors.disclaimer}</div> : null}
    </div>
  );
}

function drawChart(canvas, wrap, bars, chan, keyLevels, opts) {
  if (!canvas || !wrap) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = wrap.clientWidth || 820;
  const cssH = (opts && opts.height) || 380;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  if (!bars || !bars.length) {
    ctx.fillStyle = "#64748b";
    ctx.font = "14px sans-serif";
    ctx.fillText("暂无 K 线数据", 20, 30);
    return;
  }

  const padL = 8;
  const padR = 84;
  const padT = 10;
  const padB = 10;
  const plotW = cssW - padL - padR;
  const volH = cssH * 0.22;
  const priceH = cssH - volH - padT - padB - 6;
  const priceTop = padT;
  const priceBottom = padT + priceH;
  const volTop = priceBottom + 6;
  const volBottom = cssH - padB;

  const n = bars.length;
  const maxBars = (opts && opts.maxBars) || n;
  const start = Math.max(0, n - maxBars);
  let minP = Infinity;
  let maxP = -Infinity;
  let maxV = 0;
  for (let i = start; i < n; i++) {
    const b = bars[i];
    if (b.low < minP) minP = b.low;
    if (b.high > maxP) maxP = b.high;
    if (b.volume > maxV) maxV = b.volume;
  }
  if (keyLevels) {
    keyLevels.support.forEach((v) => {
      if (v < minP) minP = v;
      if (v > maxP) maxP = v;
    });
    keyLevels.resistance.forEach((v) => {
      if (v < minP) minP = v;
      if (v > maxP) maxP = v;
    });
  }
  if (chan && chan.zhongshu && chan.zhongshu.endIdx >= start) {
    minP = Math.min(minP, chan.zhongshu.low);
    maxP = Math.max(maxP, chan.zhongshu.high);
  }
  const pad = (maxP - minP) * 0.08 || 1;
  minP -= pad;
  maxP += pad;

  const visN = Math.max(1, n - start);
  const step = plotW / visN;
  const xOf = (i) => padL + step * (Math.max(start, Math.min(n - 1, i)) - start + 0.5);
  const yOf = (p) => priceBottom - ((p - minP) / (maxP - minP)) * priceH;
  const yVol = (v) => volBottom - (v / (maxV || 1)) * volH;

  ctx.strokeStyle = "rgba(148,163,184,0.10)";
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = priceTop + (priceH * g) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
  }

  const cw = Math.max(1, step * 0.62);
  for (let i = start; i < n; i++) {
    const b = bars[i];
    const x = xOf(i);
    const up = b.close >= b.open;
    const color = up ? "#ef4444" : "#22c55e";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, yOf(b.high));
    ctx.lineTo(x, yOf(b.low));
    ctx.stroke();
    const yo = yOf(b.open);
    const yc = yOf(b.close);
    const top = Math.min(yo, yc);
    const h = Math.max(1, Math.abs(yo - yc));
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - cw / 2, top, cw, h);
    ctx.globalAlpha = 0.45;
    ctx.fillRect(x - cw / 2, yVol(b.volume), cw, volBottom - yVol(b.volume));
    ctx.globalAlpha = 1;
  }

  if (chan && chan.zhongshu) {
    const z = chan.zhongshu;
    const x1 = xOf(Math.max(0, Math.min(z.startIdx, n - 1)));
    const x2 = xOf(Math.min(n - 1, Math.max(0, z.endIdx)));
    const y1 = yOf(z.high);
    const y2 = yOf(z.low);
    ctx.fillStyle = "rgba(56,189,248,0.12)";
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = "rgba(56,189,248,0.55)";
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }

  if (chan && chan.strokes) {
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.5;
    chan.strokes.forEach((s) => {
      const xs = xOf(Math.max(0, Math.min(n - 1, s.startIdx)));
      const xe = xOf(Math.min(n - 1, Math.max(0, s.endIdx)));
      const ys = yOf(s.startPrice);
      const ye = yOf(s.endPrice);
      ctx.beginPath();
      ctx.moveTo(xs, ys);
      ctx.lineTo(xe, ye);
      ctx.stroke();
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.arc(xs, ys, 2.5, 0, Math.PI * 2);
      ctx.arc(xe, ye, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  const drawLevel = (val, color, label) => {
    if (!isFinite(val)) return;
    const y = yOf(val);
    ctx.strokeStyle = color;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = "11px sans-serif";
    ctx.fillText(`${label} ${val.toFixed(2)}`, padL + plotW + 4, y + 3);
  };
  (keyLevels ? keyLevels.support : []).forEach((v) => drawLevel(v, "#22c55e", "支撑"));
  (keyLevels ? keyLevels.resistance : []).forEach((v) => drawLevel(v, "#ef4444", "压力"));

  if (chan && chan.signals) {
    chan.signals.forEach((sig) => {
      const y = yOf(sig.price);
      const color = ACTION_COLOR[sig.action] || "#94a3b8";
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(padL + plotW, y - 5);
      ctx.lineTo(padL + plotW - 9, y);
      ctx.lineTo(padL + plotW, y + 5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = "10px sans-serif";
      ctx.fillText(sig.type, padL + plotW - 76, y - 6);
    });
  }
}

const FACTOR_SHORT = {
  value: "价值",
  momentum: "动量",
  pead: "PEAD",
  lowvol: "低波",
  macro: "行业",
  flow: "资金"
};

function FactorRank({ watchlist, holdings, onPick }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const stocks = [];
    const seen = new Set();
    [...(watchlist || []), ...(holdings || [])].forEach((s) => {
      if (s && s.code && !seen.has(s.code)) {
        seen.add(s.code);
        stocks.push({ code: s.code, market: s.market, name: s.name });
      }
    });
    if (!stocks.length) {
      setData([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    window.stockWatcher
      .rankAnalysis(stocks)
      .then((res) => {
        if (!cancelled) setData(Array.isArray(res) ? res : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err && err.message ? err.message : "排行计算失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [watchlist, holdings]);

  if (!data && loading) {
    return <div className="analysis-state">正在计算全市场因子打分…</div>;
  }
  if (error) {
    return <div className="analysis-state error">因子排行失败：{error}</div>;
  }
  if (data && !data.length) {
    return <div className="analysis-state">先在「自选股 / 持仓股」添加股票，才能生成因子排行。</div>;
  }

  return (
    <div className="factor-rank">
      <div className="disclaimer">
        ⚠ 因子排行基于公开行情与基本面数据，对自选 / 持仓股批量计算六因子综合分并降序排列，<b>仅供研究参考，不构成投资建议</b>；综合分每 10 分钟缓存一次。
      </div>
      <div className="rank-table-wrap">
        <table className="rank-table">
          <thead>
            <tr>
              <th className="col-rank">#</th>
              <th className="col-name">股票</th>
              <th className="col-score">综合分</th>
              <th className="col-verdict">结论</th>
              <th className="col-factors">六因子</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => {
              const vCls = row.tone === "up" ? "up" : row.tone === "down" ? "down" : "flat";
              return (
                <tr key={row.code} onClick={() => onPick && onPick({ code: row.code, name: row.name, market: row.market })}>
                  <td className="col-rank">{idx + 1}</td>
                  <td className="col-name">
                    <div className="rank-name">{row.name}</div>
                    <div className="rank-code">{row.market} {row.code}</div>
                  </td>
                  <td className="col-score">
                    {row.score == null ? (
                      <span className="rank-score-na">--</span>
                    ) : (
                      <div className="rank-score">
                        <div className="rank-score-bar">
                          <i className={vCls} style={{ width: `${row.score}%` }} />
                        </div>
                        <span className="rank-score-num">{row.score}</span>
                      </div>
                    )}
                  </td>
                  <td className="col-verdict">
                    <span className={`trend-pill ${vCls}`}>{row.title || "数据不足"}</span>
                  </td>
                  <td className="col-factors">
                    <div className="rank-factors">
                      {row.factorScores.length ? (
                        row.factorScores.map((f) => (
                          <span
                            key={f.key}
                            className={`rank-chip ${(f.tone === "up" ? "up" : f.tone === "down" ? "down" : "flat")}`}
                            title={f.name}
                          >
                            {FACTOR_SHORT[f.key] || f.key}
                            {f.score != null ? ` ${f.score}` : ""}
                          </span>
                        ))
                      ) : (
                        <span className="rank-chip flat">无数据</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AnalysisView({ stock, watchlist, holdings, onPickStock }) {
  const [mode, setMode] = useState("stock");
  const [period, setPeriod] = useState("day");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [chartH, setChartH] = useState(420);
  const [chartBars, setChartBars] = useState(0);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!stock || !stock.code) {
      setData(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    setData(null);
    window.stockWatcher
      .getAnalysis(stock, { force: true })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err && err.message ? err.message : "分析失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stock, nonce]);

  useEffect(() => {
    if (!data) return;
    drawChart(
      canvasRef.current,
      wrapRef.current,
      data.klines[period] || [],
      data.analysis.methods.chan[period],
      data.analysis.keyLevels,
      { height: chartH, maxBars: chartBars }
    );
  }, [data, period, chartH, chartBars]);

  const renderModeBar = (
    <div className="analysis-mode-bar">
      <div className="segmented small">
        <button type="button" className={mode === "stock" ? "active" : ""} onClick={() => setMode("stock")}>
          个股分析
        </button>
        <button type="button" className={mode === "rank" ? "active" : ""} onClick={() => setMode("rank")}>
          因子排行
        </button>
      </div>
    </div>
  );

  if (mode === "rank") {
    return (
      <div className="analysis-wrap">
        {renderModeBar}
        <FactorRank
          watchlist={watchlist}
          holdings={holdings}
          onPick={(s) => {
            if (onPickStock) onPickStock(s);
            setMode("stock");
          }}
        />
      </div>
    );
  }

  if (!stock) {
    return (
      <div className="analysis-wrap">
        {renderModeBar}
        <div className="analysis-empty">在「搜索 / 自选股 / 持仓股」中点击股票的「分析」按钮，即可查看买卖点分析。</div>
      </div>
    );
  }

  const a = data && data.analysis;
  const dow = a && a.methods.dow;
  const wk = a && a.methods.wyckoff;
  const byPeriod = a && a.byPeriod;
  const cur = byPeriod && byPeriod[period];
  const resonance = cur && cur.resonance;
  const chanPoints = (cur && cur.chanPoints) || [];

  const pillTone = resonance ? resonance.tone : "flat";
  const pillLabel = resonance ? ACTION_LABEL[resonance.action] : "";
  const factors = a && a.factors;
  const factorVerdict = factors && factors.verdict;
  const factorPillTone =
    factorVerdict && factorVerdict.tone === "up"
      ? "up"
      : factorVerdict && factorVerdict.tone === "down"
      ? "down"
      : "flat";

  return (
    <div className="analysis-wrap">
      {renderModeBar}
      <div className="disclaimer">
        ⚠ 三种方法分工使用：<b>道氏判方向</b>、<b>威科夫判阶段与量能</b>、<b>缠论仅标注买卖点类别</b>；三者不共振时默认观望。本页由算法基于历史 K
        线生成，仅供研究参考，<b>不构成任何投资建议</b>。
      </div>

      <div className="analysis-head">
        <div className="analysis-title">
          <span className="stock-name-lg">{stock.name || stock.code}</span>
          <span className="stock-code-lg">
            {stock.market} {stock.code}
          </span>
          {resonance ? <span className={`trend-pill ${pillTone}`}>{pillLabel}</span> : null}
          {factorVerdict && factorVerdict.title ? (
            <span className={`trend-pill ${factorPillTone}`}>
              因子 {factorVerdict.title}
              {factorVerdict.avg != null ? ` · ${factorVerdict.avg}` : ""}
            </span>
          ) : null}
        </div>
        <div className="analysis-actions">
          <div className="segmented small">
            {PERIODS.map((p) => (
              <button
                type="button"
                key={p}
                className={period === p ? "active" : ""}
                onClick={() => setPeriod(p)}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <button type="button" className="ghost-btn" onClick={() => setNonce((v) => v + 1)}>
            重新分析
          </button>
        </div>
      </div>

      {loading ? (
        <div className="analysis-state">正在拉取多周期 K 线并运行分析引擎…</div>
      ) : error ? (
        <div className="analysis-state error">分析失败：{error}</div>
      ) : !data ? (
        <div className="analysis-state">无数据</div>
      ) : (
        <>
          <div className="kline-box" ref={wrapRef}>
            <div className="kline-controls">
              <div className="kc-group">
                <span className="kc-label">高度</span>
                <button type="button" className={chartH <= 320 ? "active" : ""} onClick={() => setChartH(320)}>矮</button>
                <button type="button" className={chartH === 420 ? "active" : ""} onClick={() => setChartH(420)}>中</button>
                <button type="button" className={chartH >= 560 ? "active" : ""} onClick={() => setChartH(560)}>高</button>
              </div>
              <div className="kc-group">
                <span className="kc-label">显示</span>
                <button type="button" className={chartBars === 0 ? "active" : ""} onClick={() => setChartBars(0)}>全部</button>
                <button type="button" className={chartBars === 60 ? "active" : ""} onClick={() => setChartBars(60)}>60</button>
                <button type="button" className={chartBars === 120 ? "active" : ""} onClick={() => setChartBars(120)}>120</button>
                <button type="button" className={chartBars === 250 ? "active" : ""} onClick={() => setChartBars(250)}>250</button>
              </div>
            </div>
            <canvas ref={canvasRef} className="kline-canvas" />
            <div className="kline-legend">
              <span><i className="lg-stroke" />缠论笔</span>
              <span><i className="lg-zs" />中枢</span>
              <span><i className="lg-up" />涨</span>
              <span><i className="lg-down" />跌</span>
            </div>
          </div>

          {resonance ? (
            <div className={`resonance-card ${resonance.tone}`}>
              <div className="resonance-title">{resonance.title}</div>
              <ul className="resonance-reasons">
                {resonance.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="method-grid">
            <MethodCard
              title="道氏理论"
              sub="回答：方向"
              badge={dow ? DIRECTION_LABEL[dow.direction] : ""}
              badgeTone={dow ? (dow.direction === "up" ? "up" : dow.direction === "down" ? "down" : "flat") : "flat"}
            >
              <div className="kv"><span>力度</span><b>{dow ? STRENGTH_LABEL[dow.strength] : "--"}</b></div>
              <div className="kv">
                <span>量能</span>
                <b className={dow ? (dow.volumeConfirmed ? "ok" : "warn") : ""}>
                  {dow ? (dow.volumeConfirmed ? "配合" : "未配合") : "--"}
                </b>
              </div>
              <p className="method-basis">{dow ? dow.basis : ""}</p>
            </MethodCard>

            <MethodCard
              title="威科夫"
              sub="回答：阶段 · 量能"
              badge={wk ? wk.phaseLabel : ""}
              badgeTone={wk ? PHASE_TONE[wk.phase] : "flat"}
            >
              <div className="kv">
                <span>量能配合</span>
                <b className={wk ? (wk.volumeConfirmed === false ? "warn" : wk.volumeConfirmed ? "ok" : "muted") : ""}>
                  {wk
                    ? wk.volumeConfirmed === false
                      ? "未配合"
                      : wk.volumeConfirmed
                        ? "配合"
                        : "无明确要求"
                    : "--"}
                </b>
              </div>
              {wk && wk.events.length ? (
                <ul className="event-list">
                  {wk.events.map((e, i) => (
                    <li key={i}>
                      <span className="event-type">{e.type}</span>
                      <span className="event-price">@{e.price}</span>
                      <span className="event-note">{e.note}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="method-basis">{wk ? wk.basis : ""}</p>
              {wk && wk.target ? (
                <div className="kv"><span>量度目标</span><b>{wk.target}</b></div>
              ) : null}
            </MethodCard>

            <MethodCard
              title="缠论"
              sub="仅标注：买卖点类别"
              badge={chanPoints.length ? `${chanPoints.length} 类` : "无"}
              badgeTone={
                chanPoints.some((p) => p.kind === "buy")
                  ? "up"
                  : chanPoints.some((p) => p.kind === "sell")
                    ? "down"
                    : "flat"
              }
            >
              {chanPoints.length ? (
                <ul className="point-list">
                  {chanPoints.map((p, i) => (
                    <li key={i} className={`point-${p.kind}`}>
                      <span className="point-cat">{p.category}</span>
                      <span className="point-price">@{p.price}</span>
                      <span className="point-period">{PERIOD_LABELS[p.period]}</span>
                      <span className="point-note">{p.note}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="signal-empty">暂无买卖点类别标注</div>
              )}
            </MethodCard>
          </div>

          <FactorAnalysis factors={a && a.factors} />
        </>
      )}
    </div>
  );
}
