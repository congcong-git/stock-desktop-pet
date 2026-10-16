// 通用 K 线工具集：包含关系处理、分型、笔、摆动高低点、MACD / EMA。
// 纯函数，无 DOM 依赖，主进程与（按需）渲染层均可引用。

/**
 * 缠论「包含关系」处理：相邻 K 线存在包含时按当前趋势方向合并。
 * bars: [{ date, open, high, low, close, volume }]
 * 返回合并后的 K 线数组（保留 date / 合并后的 high/low / 末根 close / 累加 volume）。
 */
function mergeInclusion(bars) {
  if (!Array.isArray(bars) || bars.length < 2) {
    return bars ? bars.map((b, i) => ({ ...b, origIndex: i })) : [];
  }
  const out = [];
  let up = null; // 当前合并方向：true 向上、false 向下
  bars.forEach((bar, i) => {
    if (out.length === 0) {
      out.push({ ...bar, origIndex: i });
      return;
    }
    const last = out[out.length - 1];
    const contains =
      (last.high >= bar.high && last.low <= bar.low) ||
      (last.high <= bar.high && last.low >= bar.low);

    if (!contains) {
      up = bar.high > last.high;
      out.push({ ...bar, origIndex: i });
      return;
    }

    // 包含：按既有方向合并（向上取高高，向下取低低）
    const newHigh = up ? Math.max(last.high, bar.high) : Math.min(last.high, bar.high);
    const newLow = up ? Math.max(last.low, bar.low) : Math.min(last.low, bar.low);
    out[out.length - 1] = {
      ...last,
      high: newHigh,
      low: newLow,
      close: bar.close,
      volume: last.volume + bar.volume,
      date: bar.date,
      origIndex: last.origIndex
    };
  });
  return out;
}

/** 在合并后的 K 线上找顶/底分型（严格相邻高点/低点）。 */
function findFractals(bars) {
  const tops = [];
  const bottoms = [];
  for (let i = 1; i < bars.length - 1; i++) {
    const c = bars[i];
    const p = bars[i - 1];
    const n = bars[i + 1];
    if (c.high > p.high && c.high > n.high) {
      tops.push({ index: i, origIndex: c.origIndex, price: c.high, bar: c });
    }
    if (c.low < p.low && c.low < n.low) {
      bottoms.push({ index: i, origIndex: c.origIndex, price: c.low, bar: c });
    }
  }
  return { tops, bottoms };
}

/**
 * 由分型构造「笔」：交替连接顶/底分型，相邻分型间隔至少 MIN_GAP 根（合并后）。
 */
function buildStrokes(bars, minGap = 4) {
  const { tops, bottoms } = findFractals(bars);
  const pivots = [
    ...tops.map((t) => ({ ...t, kind: "top" })),
    ...bottoms.map((b) => ({ ...b, kind: "bottom" }))
  ].sort((a, b) => a.index - b.index);

  const strokes = [];
  let prev = null;
  for (const p of pivots) {
    if (!prev) {
      prev = p;
      continue;
    }
    if (p.kind === prev.kind) {
      // 同型：保留更极端的那一个
      if (
        (p.kind === "top" && p.price > prev.price) ||
        (p.kind === "bottom" && p.price < prev.price)
      ) {
        prev = p;
      }
      continue;
    }
    if (p.index - prev.index < minGap) {
      continue; // 间隔不足，暂存上一极点
    }
    strokes.push({
      startIdx: prev.origIndex,
      endIdx: p.origIndex,
      startPrice: prev.price,
      endPrice: p.price,
      dir: prev.kind === "bottom" ? "up" : "down",
      startKind: prev.kind,
      endKind: p.kind
    });
    prev = p;
  }
  return strokes;
}

/** 在「笔」序列上找第一个由连续 3 笔重叠构成的「中枢」。 */
function findZhongshu(strokes) {
  for (let i = 0; i + 2 < strokes.length; i++) {
    const a = strokes[i];
    const b = strokes[i + 1];
    const c = strokes[i + 2];
    const high = Math.min(
      Math.max(a.startPrice, a.endPrice),
      Math.max(b.startPrice, b.endPrice),
      Math.max(c.startPrice, c.endPrice)
    );
    const low = Math.max(
      Math.min(a.startPrice, a.endPrice),
      Math.min(b.startPrice, b.endPrice),
      Math.min(c.startPrice, c.endPrice)
    );
    if (high > low) {
      return {
        startIdx: a.startIdx,
        endIdx: c.endIdx,
        high,
        low
      };
    }
  }
  return null;
}

/** EMA 序列（返回与输入等长数组）。 */
function ema(values, period) {
  const result = new Array(values.length).fill(null);
  if (!values.length) return result;
  const k = 2 / (period + 1);
  let prev = values[0];
  result[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

/** MACD（12/26/9），返回 [{ dif, dea, macd }]。 */
function computeMACD(bars, fast = 12, slow = 26, signal = 9) {
  const closes = bars.map((b) => Number(b.close) || 0);
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const dif = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const dea = ema(
    dif.map((v) => (v == null ? 0 : v)),
    signal
  );
  return dif.map((d, i) => {
    const macd = (d - (dea[i] || 0)) * 2;
    return { dif: d, dea: dea[i] || 0, macd };
  });
}

/** 线性回归斜率（判断一段的趋势强度与方向），基于收盘价。 */
function slope(values) {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) * (i - xMean);
  }
  return den === 0 ? 0 : num / den;
}

/** 摆动高低点（道氏用）：局部极值，minSep 控制最小间隔（根）。 */
function swingPoints(bars, minSep = 5) {
  const highs = [];
  const lows = [];
  for (let i = minSep; i < bars.length - minSep; i++) {
    let isHigh = true;
    let isLow = true;
    const c = bars[i];
    for (let j = i - minSep; j <= i + minSep; j++) {
      if (j === i) continue;
      if (bars[j].high >= c.high) isHigh = false;
      if (bars[j].low <= c.low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: c.high });
    if (isLow) lows.push({ index: i, price: c.low });
  }
  return { highs, lows };
}

module.exports = {
  mergeInclusion,
  findFractals,
  buildStrokes,
  findZhongshu,
  ema,
  computeMACD,
  slope,
  swingPoints
};
