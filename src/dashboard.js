// 產生網頁 dashboard 讀取的 docs/data.json

const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

/** 民國年月 "11509" → "2026/09" */
export const rocMonth = (s) => (/^\d{5}$/.test(s ?? "") ? `${Number(s.slice(0, 3)) + 1911}/${s.slice(3)}` : s ?? null);

const shortRow = (r) => ({
  code: r.code, name: r.name, close: r2(r.close), volRatio: r2(r.volRatio), rsi14: r2(r.rsi14),
  instDays: r.instDays, ret20: r2(r.ret20), avgValue20: r.avgValue20 === null ? null : Math.round(r.avgValue20),
  ma20: r2(r.ma20),
});
const midRow = (r) => ({
  code: r.code, name: r.name, close: r2(r.close), pe: r2(r.pe), yield: r2(r.yield), pb: r2(r.pb),
  revYoY: r2(r.revYoY), revCumYoY: r2(r.revCumYoY), revMonth: rocMonth(r.revMonth), ma60: r2(r.ma60),
});
const trade = (t) => ({
  code: t.code, name: t.name, buyDate: t.buyDate, buyPrice: r2(t.buyPrice), shares: t.shares,
  sellDate: t.sellDate ?? null, sellPrice: r2(t.sellPrice ?? null), close: r2(t.close ?? null),
  pnl: Math.round(t.pnl ?? 0), pnlPct: r2(t.pnlPct ?? null), reason: t.reason ?? null, heldDays: t.heldDays ?? null,
});

export function buildDashboard({ date, result, cfg, perf, equity, events, notes, historyDays, generatedAt = new Date().toISOString() }) {
  const book = (b) =>
    perf && {
      capital: perf[b].capital, total: Math.round(perf[b].total), realized: Math.round(perf[b].realized),
      unrealized: Math.round(perf[b].unrealized), returnPct: perf[b].returnPct, trades: perf[b].trades,
      winRate: perf[b].winRate, avgPnlPct: perf[b].avgPnlPct,
      open: perf[b].open.map(trade), pending: perf[b].pending.map((p) => ({ code: p.code, name: p.name })),
      recent: perf[b].recent.map(trade),
    };
  return {
    date, generatedAt, historyDays, notes,
    short: { count: result.counts.short, rows: result.short.map(shortRow), rules: cfg.short.rules, rankBy: cfg.short.rankBy },
    mid: { count: result.counts.mid, rows: result.mid.map(midRow), rules: cfg.mid.rules, rankBy: cfg.mid.rankBy },
    paper: perf
      ? { startDate: perf.startDate, benchmark: perf.benchmark, short: book("short"), mid: book("mid"), params: cfg.paper, equity }
      : null,
    events: (events ?? []).map((e) => ({ ...e, price: r2(e.price ?? null), pnl: e.pnl === undefined ? undefined : Math.round(e.pnl) })),
  };
}
