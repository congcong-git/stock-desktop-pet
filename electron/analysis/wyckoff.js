// 威科夫分析：只回答两个问题——「当前处于什么阶段」与「量能是否配合该阶段」。
// 识别吸筹 / 派发 / 拉升 / 下跌 / 区间震荡，并标注 Spring / UT 等中性事件（不作为买卖建议），
// 量度目标仅作因果测算参考。威科夫不负责给买卖点（那是缠论的标注职责）。
//
// 采用务实的启发式判定，非严格 Composite Man 叙事。

/**
 * @param {Array<{date,open,high,low,close,volume}>} bars 建议传入日线
 */
function analyzeWyckoff(bars) {
  const empty = {
    phase: "unknown",
    phaseLabel: "数据不足",
    volumeConfirmed: null,
    events: [],
    target: null,
    basis: "样本不足，无法识别威科夫阶段。",
    keyLevels: { support: [], resistance: [] }
  };
  if (!bars || bars.length < 40) return empty;

  const window = bars.slice(-Math.min(120, bars.length));
  const lowVals = window.map((b) => b.low);
  const highVals = window.map((b) => b.high);
  const support = Math.min(...lowVals);
  const resistance = Math.max(...highVals);
  const rangeH = resistance - support;
  const last = window[window.length - 1];
  const prev = window[window.length - 2];
  const lastClose = Number(last.close) || 0;

  // Spring：区间内某根创新低（接近/跌破下沿）后快速收回，且相对前一根放量
  let springIdx = -1;
  let springVolOk = false;
  for (let i = 2; i < window.length - 3; i++) {
    const b = window[i];
    const beforeLow = window.slice(0, i).reduce((m, x) => Math.min(m, x.low), Infinity);
    if (b.low < support * 1.002 && b.low < beforeLow && window[i + 1].close > b.close && b.volume > window[i - 1].volume * 1.2) {
      springIdx = i;
      springVolOk = b.volume > window[i - 1].volume * 1.2;
      break;
    }
  }

  // UT：区间内某根创新高（接近/突破上沿）后快速回落，且相对前一根放量
  let utIdx = -1;
  let utVolOk = false;
  for (let i = 2; i < window.length - 3; i++) {
    const b = window[i];
    const beforeHigh = window.slice(0, i).reduce((m, x) => Math.max(m, x.high), -Infinity);
    if (b.high > resistance * 0.998 && b.high > beforeHigh && window[i + 1].close < b.close && b.volume > window[i - 1].volume * 1.2) {
      utIdx = i;
      utVolOk = b.volume > window[i - 1].volume * 1.2;
      break;
    }
  }

  let phase;
  let phaseLabel;
  let volumeConfirmed = null;
  const events = [];
  let target = null;
  let basis;

  if (springIdx >= 0 && lastClose > support + rangeH * 0.5) {
    phase = "accumulation";
    phaseLabel = "吸筹（Accumulation）";
    volumeConfirmed = springVolOk;
    events.push({
      type: "Spring",
      price: Number(support.toFixed(2)),
      note: "假跌破后快速收回并放量，主力清洗浮筹的典型动作，出现在吸筹尾声。"
    });
    target = support + rangeH * 2;
    basis = "区间内出现 Spring（假跌破后快速收回并放量），价格回到区间上半部，处于吸筹尾声、即将进入拉升的概率较高。";
  } else if (utIdx >= 0 && lastClose < resistance - rangeH * 0.5) {
    phase = "distribution";
    phaseLabel = "派发（Distribution）";
    volumeConfirmed = utVolOk;
    events.push({
      type: "UT",
      price: Number(resistance.toFixed(2)),
      note: "假突破后快速回落并放量，主力派发、引导追高的典型动作，出现在派发尾声。"
    });
    target = resistance - rangeH * 2;
    basis = "区间内出现 UT（假突破后快速回落并放量），价格回到区间下半部，处于派发尾声、即将进入下跌的概率较高。";
  } else if (lastClose > resistance) {
    phase = "markup";
    phaseLabel = "拉升（Markup）";
    volumeConfirmed = last.volume >= (prev ? prev.volume : last.volume);
    basis = `价格已突破区间上沿（${resistance.toFixed(2)}），进入拉升段，顺势但追高后风险收益比下降。`;
  } else if (lastClose < support) {
    phase = "markdown";
    phaseLabel = "下跌（Markdown）";
    volumeConfirmed = last.volume >= (prev ? prev.volume : last.volume);
    basis = `价格已跌破区间下沿（${support.toFixed(2)}），进入下跌段，回避为主。`;
  } else {
    phase = "trading_range";
    phaseLabel = "区间震荡（Trading Range）";
    volumeConfirmed = null;
    basis = `价格运行于 ${support.toFixed(2)}–${resistance.toFixed(2)} 区间内，尚未出现明确的 Spring / UT，阶段方向待定。`;
  }

  return {
    phase,
    phaseLabel,
    volumeConfirmed,
    events,
    target: target ? Number(target.toFixed(2)) : null,
    basis,
    keyLevels: {
      support: [Number(support.toFixed(2))],
      resistance: [Number(resistance.toFixed(2))]
    }
  };
}

module.exports = { analyzeWyckoff };
