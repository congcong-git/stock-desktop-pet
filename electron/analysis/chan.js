// 缠论分析：只做一件事——把当前结构「标注」为哪一类买卖点。
// 包含关系 → 分型 → 笔 → 中枢 → 背驰 → 一/二/三类买卖点（务实近似实现）。
// 缠论不判断「该不该操作」（那是综合共振的职责），只客观标注点的类别与位置。
const { mergeInclusion, buildStrokes, findZhongshu, computeMACD } = require("./kline");

/** 一段笔的「力度」：价格幅度 × 量能对数加权，用于背驰比较。 */
function strokeStrength(bars, stroke) {
  const lo = Math.min(stroke.startIdx, stroke.endIdx);
  const hi = Math.max(stroke.startIdx, stroke.endIdx);
  let vol = 0;
  for (let i = lo; i <= hi && i < bars.length; i++) {
    vol += (bars[i] && bars[i].volume) || 0;
  }
  const range = Math.abs(stroke.endPrice - stroke.startPrice);
  return range * (1 + Math.log10(1 + vol / 1e6));
}

/**
 * @param {Array<{date,open,high,low,close,volume}>} bars
 * @returns {{strokes, zhongshu, signals, trend, summary}}
 *   signals 为「买卖点类别标注」：{ action:"buy"|"sell", type, price, reason }
 *   action 仅表示该点是买点类还是卖点类，不构成操作建议。
 */
function analyzeChan(bars) {
  const empty = {
    strokes: [],
    zhongshu: null,
    signals: [],
    trend: "sideways",
    summary: "样本不足，无法划分笔与中枢。"
  };
  if (!bars || bars.length < 20) return empty;

  const merged = mergeInclusion(bars);
  const strokes = buildStrokes(merged);
  if (strokes.length < 3) {
    return { ...empty, summary: `仅划分出 ${strokes.length} 笔，不足以构成完整结构。` };
  }

  const zhongshu = findZhongshu(strokes);
  const last = strokes[strokes.length - 1];
  const prev = strokes[strokes.length - 2];
  const last3 = strokes.slice(-3);
  const upCount = last3.filter((s) => s.dir === "up").length;
  const downCount = last3.filter((s) => s.dir === "down").length;
  const trend = upCount > downCount ? "up" : downCount > upCount ? "down" : "sideways";

  const signals = [];

  // 1) 背驰：最后两段同向笔，价格创新高/低但力度衰减
  if (last && prev && last.dir === prev.dir) {
    const sLast = strokeStrength(bars, last);
    const sPrev = strokeStrength(bars, prev);
    const priceExtreme = last.dir === "up" ? last.endPrice > prev.endPrice : last.endPrice < prev.endPrice;
    if (priceExtreme && sLast < sPrev) {
      if (last.dir === "up") {
        signals.push({
          method: "chan",
          action: "sell",
          type: "顶背驰（卖点类别）",
          price: Number(last.endPrice.toFixed(2)),
          reason: `最后一段向上笔价格创新高（${last.endPrice.toFixed(2)}），但力度 ${sLast.toFixed(
            0
          )} 弱于前一段 ${sPrev.toFixed(0)}，结构上出现顶背驰，属卖点类别标注。`
        });
      } else {
        signals.push({
          method: "chan",
          action: "buy",
          type: "底背驰（买点类别）",
          price: Number(last.endPrice.toFixed(2)),
          reason: `最后一段向下笔价格创新低（${last.endPrice.toFixed(2)}），但力度 ${sLast.toFixed(
            0
          )} 弱于前一段 ${sPrev.toFixed(0)}，结构上出现底背驰，属买点类别标注。`
        });
      }
    }
  }

  // 2) 一类买卖点：末端笔触及/跌破中枢边界
  if (last.dir === "down") {
    const low = last.endPrice;
    if (zhongshu && low <= zhongshu.low * 1.02) {
      signals.push({
        method: "chan",
        action: "buy",
        type: "一类买点",
        price: Number(low.toFixed(2)),
        reason: `向下笔探至中枢下沿 ${zhongshu.low.toFixed(2)} 附近（${low.toFixed(
          2
        )}），结构上构成一类买点，属买点类别标注。`
      });
    }
  } else if (last.dir === "up") {
    const high = last.endPrice;
    if (zhongshu && high >= zhongshu.high * 0.98) {
      signals.push({
        method: "chan",
        action: "sell",
        type: "一类卖点",
        price: Number(high.toFixed(2)),
        reason: `向上笔触及中枢上沿 ${zhongshu.high.toFixed(2)} 附近（${high.toFixed(
          2
        )}），结构上构成一类卖点，属卖点类别标注。`
      });
    }
  }

  // 3) 三类买卖点：回抽不进中枢
  if (strokes.length >= 4 && zhongshu) {
    const penult = strokes[strokes.length - 2];
    if (last.dir === "up" && penult.dir === "down" && penult.endPrice > zhongshu.high) {
      signals.push({
        method: "chan",
        action: "buy",
        type: "三类买点",
        price: Number(penult.endPrice.toFixed(2)),
        reason: `回抽低点 ${penult.endPrice.toFixed(2)} 高于中枢上沿 ${zhongshu.high.toFixed(
          2
        )}，中枢完成后的三类买点，属买点类别标注。`
      });
    }
    if (last.dir === "down" && penult.dir === "up" && penult.endPrice < zhongshu.low) {
      signals.push({
        method: "chan",
        action: "sell",
        type: "三类卖点",
        price: Number(penult.endPrice.toFixed(2)),
        reason: `反抽高点 ${penult.endPrice.toFixed(2)} 低于中枢下沿 ${zhongshu.low.toFixed(
          2
        )}，中枢完成后的三类卖点，属卖点类别标注。`
      });
    }
  }

  const zsText = zhongshu
    ? `中枢区间 ${zhongshu.low.toFixed(2)}–${zhongshu.high.toFixed(2)}`
    : "暂未识别到中枢";
  const summary = `共划分 ${strokes.length} 笔，当前结构${
    trend === "up" ? "向上" : trend === "down" ? "向下" : "横向"
  }；${zsText}。` + (signals.length ? `标注出 ${signals.length} 个买卖点类别。` : "暂无明确买卖点类别。");

  return { strokes, zhongshu, signals, trend, summary };
}

module.exports = { analyzeChan };
