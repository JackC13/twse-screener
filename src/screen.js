// 依 config.json 的條件篩選。條件設成 null 代表不使用；啟用的條件遇到資料缺漏就視為不符合。

const on = (v) => v !== null && v !== undefined && v !== false;
const has = (v) => v !== null && v !== undefined && Number.isFinite(v);

/** 短期：趨勢＋量能＋動能＋法人 */
export function shortRules(r, m) {
  const checks = [];
  if (on(r.minPrice)) checks.push(has(m.close) && m.close >= r.minPrice);
  if (on(r.minAvgValue)) checks.push(has(m.avgValue20) && m.avgValue20 >= r.minAvgValue);
  if (on(r.closeAboveMA)) {
    const ma = m[`ma${r.closeAboveMA}`];
    checks.push(has(ma) && m.close > ma);
  }
  if (on(r.ma5AboveMa20)) checks.push(has(m.ma5) && has(m.ma20) && m.ma5 > m.ma20);
  if (on(r.minVolRatio)) checks.push(has(m.volRatio) && m.volRatio >= r.minVolRatio);
  if (on(r.rsiMin)) checks.push(has(m.rsi14) && m.rsi14 >= r.rsiMin);
  if (on(r.rsiMax)) checks.push(has(m.rsi14) && m.rsi14 <= r.rsiMax);
  if (on(r.instBuyDays)) checks.push(has(m.instDays) && m.instDays >= r.instBuyDays);
  return checks.every(Boolean);
}

/** 中期：估值＋營收成長＋長期趨勢 */
export function midRules(r, m, v = {}, rev = {}) {
  const checks = [];
  if (on(r.minPrice)) checks.push(has(m.close) && m.close >= r.minPrice);
  if (on(r.minAvgValue)) checks.push(has(m.avgValue20) && m.avgValue20 >= r.minAvgValue);
  if (on(r.closeAboveMA)) {
    const ma = m[`ma${r.closeAboveMA}`];
    checks.push(has(ma) && m.close > ma);
  }
  if (on(r.peMin)) checks.push(has(v.pe) && v.pe > r.peMin);
  if (on(r.peMax)) checks.push(has(v.pe) && v.pe <= r.peMax);
  if (on(r.yieldMin)) checks.push(has(v.yield) && v.yield >= r.yieldMin);
  if (on(r.pbMax)) checks.push(has(v.pb) && v.pb <= r.pbMax);
  if (on(r.revYoYMin)) checks.push(has(rev.revYoY) && rev.revYoY >= r.revYoYMin);
  if (on(r.revCumYoYMin)) checks.push(has(rev.revCumYoY) && rev.revCumYoY >= r.revCumYoYMin);
  return checks.every(Boolean);
}

/** "volRatio" = 由大到小；"-pe" = 由小到大。缺值一律排最後 */
export function sorter(rankBy) {
  const asc = rankBy.startsWith("-");
  const key = asc ? rankBy.slice(1) : rankBy;
  const val = (x) => (Number.isFinite(x[key]) ? x[key] : null);
  return (a, b) => {
    const va = val(a), vb = val(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return asc ? va - vb : vb - va;
  };
}

/** 回傳 { short: [...], mid: [...] }，每筆含代號、名稱與相關指標 */
export function screen(cfg, metrics, names, valuation = {}, revenue = {}) {
  const short = [], mid = [];
  for (const [code, m] of Object.entries(metrics)) {
    const v = valuation[code] ?? {};
    const rev = revenue[code] ?? {};
    const row = { code, name: names[code] ?? code, ...m, pe: v.pe ?? null, yield: v.yield ?? null, pb: v.pb ?? null,
      revYoY: rev.revYoY ?? null, revCumYoY: rev.revCumYoY ?? null, revMonth: rev.month ?? null };
    if (shortRules(cfg.short.rules, m)) short.push(row);
    if (midRules(cfg.mid.rules, m, v, rev)) mid.push(row);
  }
  short.sort(sorter(cfg.short.rankBy ?? "volRatio"));
  mid.sort(sorter(cfg.mid.rankBy ?? "revCumYoY"));
  return { short: short.slice(0, cfg.short.top ?? 10), mid: mid.slice(0, cfg.mid.top ?? 10), counts: { short: short.length, mid: mid.length } };
}
