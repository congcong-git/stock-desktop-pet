// 聚合三种方法为「分工 + 共振」的统一分析结构。
// 分工：道氏判方向、威科夫判阶段与量能配合、缠论只标注买卖点「类别」。
// 三者不共振时，默认动作是观望。
// 每个周期单独计算共振：方向/阶段用日线（大周期定调），买卖点类别用该周期缠论。
const { analyzeDow } = require("./dow");
const { analyzeChan } = require("./chan");
const { analyzeWyckoff } = require("./wyckoff");
const { analyzeFactors } = require("./factors");

const PERIODS = ["day", "60m", "30m", "5m"];

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

/**
 * 共振判定：方向（道氏）× 阶段与量能（威科夫）× 缠论买卖点类别。
 * 仅当三者同向、且量能配合、且缠论出现对应类别买卖点时，才给出偏多/偏空；
 * 否则默认观望，并说明哪个维度未配合。
 * @param {string} direction 道氏方向
 * @param {string} strength 道氏力度（用于结论展示）
 * @param {object} wyckoff 威科夫分析结果
 * @param {Array} chanPoints 当前周期的缠论买卖点类别标注
 */
function judgeResonance(direction, strength, wyckoff, chanPoints) {
  const dowBull = direction === "up";
  const dowBear = direction === "down";
  const wkTone = PHASE_TONE[wyckoff.phase] || "flat";
  const wkBull = wkTone === "up";
  const wkBear = wkTone === "down";
  const volOk = wyckoff.volumeConfirmed !== false; // null 视为不否决
  const hasBuyPoint = chanPoints.some((p) => p.kind === "buy");
  const hasSellPoint = chanPoints.some((p) => p.kind === "sell");

  const wkVolText =
    wyckoff.volumeConfirmed === true
      ? "（量能配合）"
      : wyckoff.volumeConfirmed === false
        ? "（量能未配合）"
        : "（量能无明确要求）";

  // 方向共识：道氏与威科夫是否同指
  let consensus;
  if (dowBull && wkBull) consensus = "bull";
  else if (dowBear && wkBear) consensus = "bear";
  else if ((dowBull && wkBear) || (dowBear && wkBull)) consensus = "diverge";
  else consensus = "neutral";

  const strengthText = STRENGTH_LABEL[strength] || "";

  if (consensus === "bull" && volOk && hasBuyPoint) {
    return {
      action: "long",
      tone: "up",
      title: "三者共振偏多",
      reasons: [
        `道氏方向：上升（力度${strengthText}）`,
        `威科夫阶段：${wyckoff.phaseLabel}${wkVolText}`,
        `缠论标注出买点类别（一类/二类/三类买点）`,
        `结论：方向、阶段、买卖点类别三者同向，可关注对应买点的介入机会（务必结合自身风控）。`
      ]
    };
  }
  if (consensus === "bear" && volOk && hasSellPoint) {
    return {
      action: "short",
      tone: "down",
      title: "三者共振偏空",
      reasons: [
        `道氏方向：下降（力度${strengthText}）`,
        `威科夫阶段：${wyckoff.phaseLabel}${wkVolText}`,
        `缠论标注出卖点类别（一类/二类/三类卖点）`,
        `结论：方向、阶段、买卖点类别三者同向，应规避或关注减仓（务必结合自身风控）。`
      ]
    };
  }

  // 不共振 → 观望
  const blocks = [];
  if (consensus === "diverge") blocks.push("道氏方向与威科夫阶段相反");
  if (consensus === "neutral") blocks.push("方向不明确（道氏震荡或威科夫处于区间/数据不足）");
  if (!volOk) blocks.push("威科夫量能未配合当前阶段");
  if (consensus === "bull" && !hasBuyPoint) blocks.push("缠论未标注出买点类别");
  if (consensus === "bear" && !hasSellPoint) blocks.push("缠论未标注出卖点类别");

  const chanText = chanPoints.length ? chanPoints.map((p) => p.category).join("、") : "暂无";
  return {
    action: "watch",
    tone: "flat",
    title: "不共振 · 默认观望",
    reasons: [
      `道氏方向：${DIRECTION_LABEL[direction]}`,
      `威科夫阶段：${wyckoff.phaseLabel}${wkVolText}`,
      `缠论买卖点类别：${chanText}`,
      blocks.length ? `未共振原因：${blocks.join("；")}。` : "",
      `结论：三者未同向共振，默认动作是观望，不强行操作。`
    ].filter(Boolean)
  };
}

function toPoints(signals, period) {
  return (signals || []).map((s) => ({
    kind: s.action === "buy" ? "buy" : s.action === "sell" ? "sell" : "neutral",
    category: s.type,
    price: s.price,
    period,
    note: s.reason
  }));
}

/**
 * @param {Object} klinesByPeriod { day:[], "60m":[], "30m":[], "5m":[] }
 * @param {{code:string,name:string,market:string}} stock
 * @param {Object} [fundamentals] 因子分析所需基本面/资金面数据（见 factors.js）
 */
function analyze(klinesByPeriod, stock, fundamentals) {
  const day = klinesByPeriod.day || [];
  const dow = analyzeDow(day);
  const wyckoff = analyzeWyckoff(day);

  const chanByPeriod = {};
  PERIODS.forEach((p) => {
    chanByPeriod[p] = analyzeChan(klinesByPeriod[p] || []);
  });
  const chanDay = chanByPeriod.day;

  // 每个周期单独计算「买卖点类别 + 共振」：
  // 方向（道氏）/ 阶段与量能（威科夫）用日线定调，买卖点类别用该周期缠论。
  const byPeriod = {};
  PERIODS.forEach((p) => {
    const points = toPoints(chanByPeriod[p].signals, p);
    byPeriod[p] = {
      chanPoints: points,
      resonance: judgeResonance(dow.direction, dow.strength, wyckoff, points)
    };
  });

  // 关键位合并（供图表标注）：道氏 + 威科夫 + 缠论中枢
  const support = new Set();
  const resistance = new Set();
  [dow, wyckoff].forEach((m) => {
    (m.keyLevels ? m.keyLevels.support || [] : []).forEach((v) => support.add(v));
    (m.keyLevels ? m.keyLevels.resistance || [] : []).forEach((v) => resistance.add(v));
  });
  if (chanDay.zhongshu) {
    support.add(Number(chanDay.zhongshu.low.toFixed(2)));
    resistance.add(Number(chanDay.zhongshu.high.toFixed(2)));
  }

  const disclaimer =
    "三种方法各有分工：道氏判方向、威科夫判阶段与量能、缠论仅标注买卖点类别；三者不共振即观望。以上为算法基于历史 K 线的客观刻画，仅供研究参考，不构成任何投资建议。";

  return {
    keyLevels: { support: [...support], resistance: [...resistance] },
    methods: {
      dow: {
        direction: dow.direction,
        strength: dow.strength,
        volumeConfirmed: dow.volumeConfirmed,
        basis: dow.basis,
        keyLevels: dow.keyLevels
      },
      wyckoff: {
        phase: wyckoff.phase,
        phaseLabel: wyckoff.phaseLabel,
        volumeConfirmed: wyckoff.volumeConfirmed,
        events: wyckoff.events,
        target: wyckoff.target,
        basis: wyckoff.basis,
        keyLevels: wyckoff.keyLevels
      },
      chan: chanByPeriod
    },
    byPeriod,
    resonance: byPeriod.day.resonance,
    factors: analyzeFactors({ klines: klinesByPeriod, fundamentals }),
    disclaimer
  };
}

module.exports = { analyze, PERIODS };
