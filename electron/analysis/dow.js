// 道氏理论分析：只回答一个问题——「方向」。
// 通过摆动高低点判断主趋势方向、力度与级别，并由量能确认可靠性。
// 道氏不负责给出买卖点（那是缠论的标注职责），也不负责判断主力阶段（那是威科夫的职责）。
const { swingPoints } = require("./kline");

/**
 * @param {Array<{date,open,high,low,close,volume}>} bars 建议传入日线
 * @returns {{
 *   direction: "up"|"down"|"sideways"|"unknown",
 *   strength: "high"|"medium"|"low",
 *   volumeConfirmed: boolean,
 *   basis: string,
 *   keyLevels: {support:number[], resistance:number[]}
 * }}
 */
function analyzeDow(bars) {
  const empty = {
    direction: "unknown",
    strength: "low",
    volumeConfirmed: false,
    basis: "样本不足，无法判断方向。",
    keyLevels: { support: [], resistance: [] }
  };
  if (!bars || bars.length < 20) return empty;

  const { highs, lows } = swingPoints(bars, 5);
  if (highs.length < 2 || lows.length < 2) return empty;

  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];

  const higherHighs = lastHigh.price > prevHigh.price;
  const higherLows = lastLow.price > prevLow.price;
  const lowerHighs = lastHigh.price < prevHigh.price;
  const lowerLows = lastLow.price < prevLow.price;

  let direction;
  let strength;
  if (higherHighs && higherLows) {
    direction = "up";
    strength = "high";
  } else if (lowerHighs && lowerLows) {
    direction = "down";
    strength = "high";
  } else if (higherHighs && lowerLows) {
    direction = "up";
    strength = "medium";
  } else if (lowerHighs && higherLows) {
    direction = "down";
    strength = "medium";
  } else {
    direction = "sideways";
    strength = "low";
  }

  // 量能确认：上升段放量更可靠，下降段缩量下跌更可靠
  const recent = bars.slice(-Math.min(20, bars.length));
  const upVol = recent
    .filter((b) => (Number(b.close) || 0) >= (Number(b.open) || 0))
    .reduce((s, b) => s + (b.volume || 0), 0);
  const downVol = recent
    .filter((b) => (Number(b.close) || 0) < (Number(b.open) || 0))
    .reduce((s, b) => s + (b.volume || 0), 0);
  const volumeConfirmed =
    direction === "up" ? upVol >= downVol : direction === "down" ? downVol >= upVol : true;

  const support = [Number(lastLow.price.toFixed(2))];
  const resistance = [Number(lastHigh.price.toFixed(2))];

  const basis = `最近摆动高点 ${prevHigh.price.toFixed(2)}→${lastHigh.price.toFixed(
    2
  )}（${higherHighs ? "抬高" : lowerHighs ? "降低" : "持平"}），摆动低点 ${prevLow.price.toFixed(
    2
  )}→${lastLow.price.toFixed(2)}（${higherLows ? "抬高" : lowerLows ? "降低" : "持平"}），方向判定为${
    direction === "up" ? "上升" : direction === "down" ? "下降" : "震荡"
  }（力度${strength === "high" ? "强" : strength === "medium" ? "中" : "弱"}）${
    volumeConfirmed ? "，量能方向与趋势一致" : "，量能未明显配合，可靠性下降"
  }。`;

  return { direction, strength, volumeConfirmed, basis, keyLevels: { support, resistance } };
}

module.exports = { analyzeDow };
