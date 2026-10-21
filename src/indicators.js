// 技術與籌碼指標：用歷史日資料算出「最新一天」每檔股票的數值

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const last = (a, n) => a.slice(Math.max(0, a.length - n));

export function sma(values, n) {
  return values.length >= n ? mean(last(values, n)) : null;
}

/** Wilder RSI；資料不足 n+1 筆回傳 null */
export function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

/**
 * days: [{ date, p: { code: [o,h,l,c,v,val] }, inst }]，由舊到新
 * 回傳 { code: metrics }，只含最新一天有成交的股票
 */
export function computeMetrics(days, filter = () => true) {
  if (!days.length) return {};
  const latest = days.at(-1);
  const out = {};
  for (const code of Object.keys(latest.p)) {
    if (!filter(code)) continue;
    const today = latest.p[code];
    if (!today || today[3] === null) continue;

    const closes = [], vols = [], vals = [];
    for (const d of days) {
      const r = d.p[code];
      if (!r || r[3] === null) continue;
      closes.push(r[3]);
      vols.push(r[4] ?? 0);
      vals.push(r[5] ?? 0);
    }

    const close = closes.at(-1);
    const prevVols = vols.slice(0, -1);
    const avgVol20Prev = prevVols.length >= 20 ? mean(last(prevVols, 20)) : null;

    // 由新到舊數連續買超天數；遇到沒有法人資料的日子就停（不跨過缺漏）
    let instDays = null;
    if (latest.inst) {
      instDays = 0;
      for (let i = days.length - 1; i >= 0; i--) {
        const inst = days[i].inst;
        if (!inst || !((inst[code] ?? 0) > 0)) break;
        instDays++;
      }
    }
    const last3 = days.slice(-3);
    const instNet3 = last3.length === 3 && last3.every((d) => d.inst) ? last3.reduce((s, d) => s + (d.inst[code] ?? 0), 0) : null;

    out[code] = {
      close,
      open: today[0],
      volume: today[4],
      ma5: sma(closes, 5),
      ma20: sma(closes, 20),
      ma60: sma(closes, 60),
      avgValue20: vals.length >= 20 ? mean(last(vals, 20)) : null,
      volRatio: avgVol20Prev ? today[4] / avgVol20Prev : null,
      rsi14: rsi(last(closes, 60)),
      ret20: closes.length > 20 ? (close / closes.at(-21) - 1) * 100 : null,
      instDays,
      instNet3,
    };
  }
  return out;
}
