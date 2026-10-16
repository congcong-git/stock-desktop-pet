// 六因子量化分析引擎（主进程，纯函数，无 DOM 依赖）。
// 因子依据：价值+质量(长期/Fama-French HML·RMW·CMA)、动量(中期, 12M剔除1M)、
// 财报后漂移 PEAD(短中期)、低波动/规模(长期)、宏观与行业景气(配置层)、资金面(中短期)。
// 所有因子均对数据缺失做降级：拿不到就用「数据不足」而非报错。
// 结果仅供研究参考，不构成任何投资建议。

function clamp(x, lo, hi) {
  if (x == null || Number.isNaN(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}
function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}
function mean(arr) {
  const a = arr.filter((v) => v != null && Number.isFinite(v));
  if (!a.length) return null;
  return a.reduce((s, v) => s + v, 0) / a.length;
}
function std(arr) {
  const a = arr.filter((v) => v != null && Number.isFinite(v));
  if (a.length < 2) return null;
  const m = mean(a);
  const v = a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1);
  return Math.sqrt(v);
}
function fmtPct(x, digits = 1) {
  if (x == null || !Number.isFinite(x)) return "--";
  return `${(x * 100).toFixed(digits)}%`;
}
function fmtNum(x, digits = 2) {
  if (x == null || !Number.isFinite(x)) return "--";
  return x.toFixed(digits);
}
function fmtYi(yuan) {
  if (yuan == null || !Number.isFinite(yuan)) return "--";
  return `${(yuan / 1e8).toFixed(2)} 亿`;
}

// 把「分数」映射为 偏多/偏空/中性 三态
function toneOf(score, up = 60, down = 40) {
  if (score == null) return "flat";
  if (score >= up) return "up";
  if (score <= down) return "down";
  return "flat";
}
const SIGNAL_LABEL = { up: "偏多", down: "偏空", flat: "中性" };

// ————————————————————————————————————————————
// 通用：从日线计算收益率与波动率
// ————————————————————————————————————————————
function dailyReturns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev > 0) r.push(closes[i] / prev - 1);
  }
  return r;
}
function maOf(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(closes.length - period);
  return mean(slice);
}
// 在日线里找 >= targetDate 的第一根 K 线下标
function indexFromDate(bars, targetDate) {
  if (!bars || !bars.length || !targetDate) return -1;
  const t = String(targetDate).slice(0, 10);
  for (let i = 0; i < bars.length; i++) {
    if (String(bars[i].date).slice(0, 10) >= t) return i;
  }
  return bars.length - 1;
}
function forwardReturn(bars, startIndex, days) {
  if (startIndex < 0 || startIndex >= bars.length) return null;
  const end = Math.min(bars.length - 1, startIndex + days);
  const p0 = bars[startIndex].close;
  const p1 = bars[end].close;
  if (!p0) return null;
  return p1 / p0 - 1;
}

// ————————————————————————————————————————————
// 因子 1：价值 + 质量（长期）
// ————————————————————————————————————————————
function factorValueQuality(f) {
  const v = f && f.valuation ? f.valuation : {};
  const q = f && f.quality ? f.quality : {};
  const subs = [];
  const metrics = [];

  // 估值分
  const pe = num(v.peTTM);
  const pb = num(v.pb);
  const pcf = num(v.pcf);
  const divY = num(v.dividendYield); // 股息率(TTM) %

  let peScore = null;
  if (pe != null) {
    if (pe <= 0) {
      peScore = null; // 亏损，估值无意义
      metrics.push({ label: "市盈率(TTM)", value: "亏损", note: "PE 为负，估值维度不适用" });
    } else {
      peScore = pe < 15 ? 90 : pe < 25 ? 78 : pe < 40 ? 58 : pe < 60 ? 42 : 26;
      metrics.push({ label: "市盈率(TTM)", value: fmtNum(pe, 1), note: pe < 25 ? "偏低估" : pe < 40 ? "中性" : "偏贵" });
    }
  }
  let pbScore = null;
  if (pb != null) {
    pbScore = pb < 1 ? 90 : pb < 3 ? 76 : pb < 5 ? 56 : pb < 10 ? 40 : 25;
    metrics.push({ label: "市净率", value: fmtNum(pb, 2), note: pb < 3 ? "偏低估" : pb < 5 ? "中性" : "偏贵" });
  }
  let pcfScore = null;
  if (pcf != null) {
    pcfScore = pcf < 8 ? 85 : pcf < 15 ? 70 : pcf < 25 ? 55 : pcf < 40 ? 40 : 25;
    metrics.push({ label: "市现率(P/CF)", value: fmtNum(pcf, 1), note: pcf < 15 ? "现金流估值低" : "中性偏贵" });
  }
  let divScore = null;
  if (divY != null) {
    divScore = divY >= 4 ? 90 : divY >= 2 ? 80 : divY >= 1 ? 66 : 52;
    metrics.push({ label: "股息率(TTM)", value: fmtNum(divY, 2) + "%", note: divY >= 2 ? "持续高分红" : divY > 0 ? "有分红" : "无/低分红" });
  }

  // 质量分
  const roe = num(q.roe); // 最新 ROE %
  const roeSeries = (q.roeSeries || []).map(num).filter((x) => x != null);
  let roeScore = null;
  if (roe != null) {
    roeScore = roe >= 20 ? 90 : roe >= 15 ? 84 : roe >= 10 ? 74 : roe >= 5 ? 60 : roe >= 0 ? 45 : 28;
    metrics.push({ label: "净资产收益率 ROE", value: fmtNum(roe, 1) + "%", note: roe >= 15 ? "高且优质" : roe >= 10 ? "良好" : "偏弱" });
  }
  let stableScore = null;
  if (roeSeries.length >= 3) {
    const m = mean(roeSeries);
    const s = std(roeSeries);
    const cv = m ? s / Math.abs(m) : 1; // 变异系数，越小越稳
    stableScore = clamp(90 - cv * 120, 30, 90);
    metrics.push({ label: "ROE 稳定性", value: cv < 0.3 ? "高" : cv < 0.6 ? "中" : "低", note: "近几期 ROE 波动越小越优" });
  }
  const cfo = num(q.cfoToProfit); // 经营现金流/净利润
  let cfoScore = null;
  if (cfo != null) {
    cfoScore = cfo >= 1 ? 86 : cfo >= 0.7 ? 72 : cfo >= 0.4 ? 56 : 40;
    metrics.push({ label: "经营性现金流/净利润", value: fmtNum(cfo, 2), note: cfo >= 1 ? "盈利含金量大" : cfo < 0.7 ? "利润含金量偏低" : "中性" });
  }

  const valueParts = [peScore, pbScore, pcfScore, divScore].filter((x) => x != null);
  const qualityParts = [roeScore, stableScore, cfoScore].filter((x) => x != null);
  if (!valueParts.length && !qualityParts.length) {
    return {
      key: "value",
      name: "价值 + 质量",
      horizon: "长期（3 年以上）",
      score: null,
      tone: "flat",
      signal: "数据不足",
      summary: "未获取到估值与财务数据，无法评分。",
      metrics
    };
  }
  const vScore = valueParts.length ? mean(valueParts) : 50;
  const qScore = qualityParts.length ? mean(qualityParts) : 50;
  const score = clamp(vScore * 0.5 + qScore * 0.5, 0, 100);

  const reason =
    `${valueParts.length ? "估值" : ""}${valueParts.length && qualityParts.length ? "+" : ""}${qualityParts.length ? "质量" : ""}` +
    `综合：${score >= 60 ? "低估且/或质量优" : score <= 40 ? "估值偏贵或质量弱" : "中性"}`;
  return {
    key: "value",
    name: "价值 + 质量",
    horizon: "长期（3 年以上）",
    score: Math.round(score),
    tone: toneOf(score),
    signal: SIGNAL_LABEL[toneOf(score)],
    summary: reason + "（依据 Fama-French 价值 HML / 盈利 RMW / 投资 CMA 因子）",
    metrics
  };
}

// ————————————————————————————————————————————
// 因子 2：动量（中期，12M 剔除最近 1M）
// ————————————————————————————————————————————
function factorMomentum(bars) {
  const metrics = [];
  if (!bars || bars.length < 60) {
    return { key: "momentum", name: "动量", horizon: "中期（1–12 个月）", score: null, tone: "flat", signal: "数据不足", summary: "日线不足，无法计算动量。", metrics };
  }
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  const idx12 = Math.max(0, n - 252);
  const idx1 = Math.max(0, n - 21); // 剔除最近 1 个月
  const p12 = closes[idx12];
  const p1 = closes[idx1];
  const pNow = closes[n - 1];
  const r12ex1 = p12 > 0 ? p1 / p12 - 1 : null; // 12 个月涨，剔除最近 1 个月
  const r1 = p1 > 0 ? pNow / p1 - 1 : null; // 最近 1 个月（参考，不参与打分）

  let score = null;
  if (r12ex1 != null) {
    score = clamp(50 + r12ex1 * 100, 0, 100);
    metrics.push({ label: "12M 收益(剔除近1M)", value: fmtPct(r12ex1), note: r12ex1 > 0 ? "中期趋势向上" : "中期趋势向下" });
  }
  if (r1 != null) metrics.push({ label: "近 1M 收益(参考)", value: fmtPct(r1), note: "动量因子通常剔除最近 1 个月" });

  // 趋势跟随：均线系统
  const ma60 = maOf(closes, 60);
  const ma200 = maOf(closes, 200);
  if (ma60 != null && ma200 != null) {
    const aligned = pNow > ma60 && ma60 > ma200;
    const inverse = pNow < ma60 && ma60 < ma200;
    metrics.push({ label: "均线(价/MA60/MA200)", value: aligned ? "多头排列" : inverse ? "空头排列" : "纠缠", note: aligned ? "趋势确认" : inverse ? "趋势向下" : "方向不明" });
    if (aligned) score = clamp((score || 50) + 8, 0, 100);
    else if (inverse) score = clamp((score || 50) - 8, 0, 100);
  }

  if (score == null) {
    return { key: "momentum", name: "动量", horizon: "中期（1–12 个月）", score: null, tone: "flat", signal: "数据不足", summary: "收益率计算失败。", metrics };
  }
  const tone = toneOf(score);
  return {
    key: "momentum",
    name: "动量",
    horizon: "中期（1–12 个月）",
    score: Math.round(score),
    tone,
    signal: SIGNAL_LABEL[tone],
    summary: `过去 12 个月（剔除近 1 个月）${r12ex1 != null && r12ex1 > 0 ? "跑赢" : "跑输"}，技术面表现为趋势跟随。`,
    metrics
  };
}

// ————————————————————————————————————————————
// 因子 3：财报后漂移 PEAD（短中期）
// ————————————————————————————————————————————
function factorPEAD(f, bars) {
  const metrics = [];
  const e = f && f.earnings ? f.earnings : [];
  if (!e.length || !bars || bars.length < 60) {
    return { key: "pead", name: "财报后漂移 PEAD", horizon: "短中期", score: null, tone: "flat", signal: "数据不足", summary: "未获取到业绩报告或日线不足。", metrics };
  }
  // 取最近两期，看 YoY 增速（业绩超预期代理）与财报后漂移
  const latest = e[0];
  const yoy = num(latest.yoyGrowth); // 净利润同比增长 %
  const metrics_metrics = [];
  let surpriseScore = null;
  if (yoy != null) {
    surpriseScore = yoy >= 50 ? 90 : yoy >= 30 ? 82 : yoy >= 10 ? 72 : yoy >= 0 ? 60 : 38;
    metrics_metrics.push({ label: "最新业绩增速(YoY)", value: fmtNum(yoy, 1) + "%", note: yoy > 0 ? "正增长" : "负增长" });
  }
  // 漂移：以财报披露/报告期后约 1 个月起算 20/60 日收益
  const anchorIdx = indexFromDate(bars, latest.reportDate);
  const startIdx = Math.min(bars.length - 1, anchorIdx + 21); // 跳过公告前后扰动
  const drift20 = forwardReturn(bars, startIdx, 20);
  const drift60 = forwardReturn(bars, startIdx, 60);
  let driftScore = null;
  if (drift60 != null) {
    driftScore = drift60 >= 0.1 ? 88 : drift60 >= 0 ? 72 : drift60 >= -0.1 ? 55 : 40;
    metrics_metrics.push({ label: "财报后漂移(60日)", value: fmtPct(drift60), note: drift60 > 0 ? "业绩后继续走强" : "业绩后走弱" });
  }
  if (drift20 != null) metrics_metrics.push({ label: "财报后漂移(20日)", value: fmtPct(drift20), note: "短窗口验证" });

  const parts = [surpriseScore, driftScore].filter((x) => x != null);
  if (!parts.length) {
    return { key: "pead", name: "财报后漂移 PEAD", horizon: "短中期", score: null, tone: "flat", signal: "数据不足", summary: "业绩增速与漂移均缺失。", metrics };
  }
  const score = clamp(mean(parts), 0, 100);
  const tone = toneOf(score);
  return {
    key: "pead",
    name: "财报后漂移 PEAD",
    horizon: "短中期",
    score: Math.round(score),
    tone,
    signal: SIGNAL_LABEL[tone],
    summary: `业绩${yoy != null && yoy > 0 ? "超预期/正增长" : "不及预期"}，财报后${drift60 != null && drift60 > 0 ? "延续强势（漂移成立）" : "未现明显漂移"}。`,
    metrics: metrics_metrics
  };
}

// ————————————————————————————————————————————
// 因子 4：低波动 / 规模（长期）
// ————————————————————————————————————————————
function factorLowVolSize(bars, f) {
  const metrics = [];
  let volScore = null;
  if (bars && bars.length >= 60) {
    const rets = dailyReturns(bars.map((b) => b.close));
    const vol = std(rets); // 日波动
    if (vol != null) {
      const ann = vol * Math.sqrt(242);
      volScore = clamp(95 - (ann - 0.15) * 120, 10, 95);
      metrics.push({ label: "年化波动率", value: fmtPct(ann), note: ann < 0.3 ? "低波动（溢价因子利好）" : ann > 0.5 ? "高波动" : "中性" });
    }
  }
  let sizeScore = null;
  const cap = f && f.valuation ? num(f.valuation.totalMarketCap) : null; // 元
  if (cap != null) {
    const yi = cap / 1e8;
    const type = yi < 100 ? "小盘" : yi < 500 ? "中盘" : yi < 2000 ? "大盘" : "超大盘";
    sizeScore = yi < 100 ? 70 : yi < 500 ? 56 : yi < 2000 ? 46 : 40;
    metrics.push({ label: "总市值", value: fmtYi(cap), note: `${type}（小盘历史有效、近年衰减）` });
  }
  const parts = [volScore, sizeScore].filter((x) => x != null);
  if (!parts.length) {
    return { key: "lowvol", name: "低波动 / 规模", horizon: "长期", score: null, tone: "flat", signal: "数据不足", summary: "无波动或市值数据。", metrics };
  }
  const score = clamp(mean(parts), 0, 100);
  const tone = toneOf(score);
  return {
    key: "lowvol",
    name: "低波动 / 规模",
    horizon: "长期",
    score: Math.round(score),
    tone,
    signal: SIGNAL_LABEL[tone],
    summary: `风险调整后，低波动组合长期常优于高波动；${cap != null ? "规模因子近年明显衰减，权重已下调。" : ""}`,
    metrics
  };
}

// ————————————————————————————————————————————
// 因子 5：宏观与行业景气（配置层）
// ————————————————————————————————————————————
function factorMacroIndustry(f, others) {
  const industry = (f && f.industry && f.industry.name) || null;
  const metrics = [];
  if (industry) metrics.push({ label: "所属行业", value: industry, note: "配置层面参考" });
  // 个股层面：用自身动量与质量作为行业景气的弱代理
  const momTone = others && others.momentum ? others.momentum.tone : "flat";
  const valTone = others && others.value ? others.value.tone : "flat";
  const upProxy = (momTone === "up" ? 1 : 0) + (valTone === "up" ? 1 : 0);
  const score = upProxy >= 2 ? 62 : upProxy === 1 ? 54 : 48;
  metrics.push({ label: "行业景气代理", value: upProxy >= 2 ? "偏暖" : upProxy === 1 ? "中性偏暖" : "中性", note: "以个股动量+质量近似，非行业指数" });
  return {
    key: "macro",
    name: "宏观与行业景气",
    horizon: "配置层（1–3 年）",
    score: Math.round(score),
    tone: "flat", // 配置层，对个股择时作用有限，默认中性
    signal: "配置参考",
    summary: "宏观/行业景气对大类资产配置有效，对个股择时作用有限；本项仅以个股动量+质量作弱代理，不参与个股多空投票。",
    metrics
  };
}

// ————————————————————————————————————————————
// 因子 6：资金面（中短期）
// ————————————————————————————————————————————
function factorCapitalFlow(f) {
  const metrics = [];
  const cf = f && f.capitalFlow ? f.capitalFlow : null;
  if (!cf || !cf.days || !cf.days.length) {
    return { key: "flow", name: "资金面", horizon: "中短期", score: null, tone: "flat", signal: "数据不足", summary: "未获取到主力资金流数据。", metrics };
  }
  const days = cf.days.slice(-20);
  const sum20 = days.reduce((s, d) => s + (num(d.mainNetIn) || 0), 0);
  const sum5 = days.slice(-5).reduce((s, d) => s + (num(d.mainNetIn) || 0), 0);
  const sum10 = days.slice(-10).reduce((s, d) => s + (num(d.mainNetIn) || 0), 0);
  const cap = f && f.valuation ? num(f.valuation.totalMarketCap) : null;
  metrics.push({ label: "主力净流入(5日)", value: fmtYi(sum5), note: sum5 > 0 ? "净流入" : "净流出" });
  metrics.push({ label: "主力净流入(20日)", value: fmtYi(sum20), note: sum20 > 0 ? "持续流入" : "持续流出" });

  let score = 50;
  if (cap && cap > 0) {
    const ratio = sum20 / cap; // 20日主力净流入 / 总市值
    score = clamp(50 + ratio * 2200, 0, 100); // 约 2.3% 市值净流入 → +50
  } else {
    score = sum20 > 0 ? clamp(58 + (sum5 > 0 ? 8 : 0), 0, 100) : clamp(42 - (sum5 < 0 ? 8 : 0), 0, 100);
  }
  const tone = toneOf(score);
  return {
    key: "flow",
    name: "资金面",
    horizon: "中短期",
    score: Math.round(score),
    tone,
    signal: SIGNAL_LABEL[tone],
    summary: `近 20 日主力${sum20 > 0 ? "净流入" : "净流出"}，资金${sum20 > 0 ? "看好" : "撤离"}信号。`,
    metrics
  };
}

// ————————————————————————————————————————————
// 综合：因子共振
// ————————————————————————————————————————————
function judgeFactors(list) {
  const bull = list.filter((f) => f.tone === "up").length;
  const bear = list.filter((f) => f.tone === "down").length;
  const scored = list.filter((f) => f.score != null);
  const avg = scored.length ? mean(scored.map((f) => f.score)) : 50;

  let action = "watch";
  let tone = "flat";
  let title = "因子分化 · 观望";
  if (bull >= 4 && bear <= 1) {
    action = "long";
    tone = "up";
    title = "因子共振偏多";
  } else if (bear >= 4 && bull <= 1) {
    action = "short";
    tone = "down";
    title = "因子共振偏空";
  } else if (bull > bear) {
    action = "watch";
    tone = "up";
    title = "偏多（未强共振）";
  } else if (bear > bull) {
    action = "watch";
    tone = "down";
    title = "偏空（未强共振）";
  } else {
    action = "watch";
    tone = "flat";
    title = "因子分化 · 观望";
  }

  const reasons = [];
  reasons.push(`六因子平均得分：${avg != null ? avg.toFixed(0) : "--"}/100`);
  reasons.push(`偏多因子 ${bull} 个，偏空因子 ${bear} 个，中性/数据不足 ${list.length - bull - bear} 个`);
  list.forEach((f) => {
    if (f.tone === "up" || f.tone === "down") {
      reasons.push(`${f.name}：${SIGNAL_LABEL[f.tone]}${f.score != null ? `(${f.score})` : ""}`);
    }
  });
  reasons.push("结论：六因子综合打分，共振偏多可重点关注、共振偏空宜规避，分化时默认观望。");

  return { action, tone, title, avg: avg != null ? Math.round(avg) : null, reasons };
}

/**
 * @param {{ klines?: {day:Array}, fundamentals?: object }} param0
 */
function analyzeFactors({ klines, fundamentals } = {}) {
  const bars = (klines && klines.day) || [];
  const f = fundamentals || {};

  const value = factorValueQuality(f);
  const momentum = factorMomentum(bars);
  const pead = factorPEAD(f, bars);
  const lowvol = factorLowVolSize(bars, f);
  const macro = factorMacroIndustry(f, { momentum, value });
  const flow = factorCapitalFlow(f);

  const list = [value, momentum, pead, lowvol, macro, flow];
  const verdict = judgeFactors(list);

  const disclaimer =
    "六因子（价值+质量 / 动量 / 财报后漂移 PEAD / 低波动规模 / 宏观行业 / 资金面）依据经典异象与 Fama-French 五因子框架做量化刻画，由算法基于公开行情与基本面数据计算，仅供研究参考，不构成任何投资建议。";

  return { list, verdict, disclaimer };
}

module.exports = { analyzeFactors };
