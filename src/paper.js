// 模擬交易（只往後模擬，不回測過去）
//
// 每個交易日 D 依序：
//   1. 前一天的訊號，在 D 開盤價買進（停牌、沒有開盤價就取消；超過持股上限也取消）
//   2. 用 D 收盤價檢查持股：達停利 / 停損 / 持有天數上限就以收盤價賣出
//   3. D 的篩選結果前 N 檔（尚未持有）排入隔天買進
// 手續費 0.1425%（最低 20 元）、賣出證交稅 0.3%，都用無條件捨去計算

const BOOKS = ["short", "mid"];

export function newState() {
  return { startDate: null, lastDate: null, benchmark: null, books: Object.fromEntries(BOOKS.map((b) => [b, { positions: [], pending: [], closed: [] }])) };
}

const fee = (amount, pc) => Math.max(pc.minFee, Math.floor(amount * pc.feeRate));
const tax = (amount, pc) => Math.floor(amount * pc.taxRate);

export function buyCost(price, shares, pc) {
  const amount = price * shares;
  return amount + fee(amount, pc);
}
export function sellProceeds(price, shares, pc) {
  const amount = price * shares;
  return amount - fee(amount, pc) - tax(amount, pc);
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * 以開盤價成交排隊中的買單（早上即時報價與收盤後的正式資料都用這個）。
 * yesterday: date 的前一個交易日，訊號日不是它就視為過期
 * open(code) / prevClose(code): 取得開盤價與前一日收盤價
 * source: "realtime"（早上即時報價）或 "official"（收盤後正式資料）
 */
export function fillPending(state, cfg, date, yesterday, open, prevClose, source = "official") {
  const pc = cfg.paper;
  const events = [];
  for (const book of BOOKS) {
    const bc = pc[book];
    const s = state.books[book];
    const pending = s.pending;
    s.pending = [];
    for (const o of pending) {
      const price = open(o.code);
      const cancel = (reason) => events.push({ book, type: "cancel", code: o.code, name: o.name, reason });
      if (o.signalDate !== yesterday) { cancel("訊號已過期（中間缺了交易日）"); continue; }
      if (!price) { cancel("沒有開盤價"); continue; }
      const pcl = prevClose(o.code);
      if (pcl && price >= pcl * 1.095) { cancel("開盤漲停，買不到"); continue; }
      if (s.positions.length >= bc.maxPositions) { cancel("持股已滿"); continue; }
      const shares = Math.floor(bc.perTrade / price);
      if (shares < 1) continue;
      const cost = buyCost(price, shares, pc);
      s.positions.push({ code: o.code, name: o.name, signalDate: o.signalDate, buyDate: date, buyPrice: price, shares, cost, source });
      events.push({ book, type: "buy", code: o.code, name: o.name, price, shares });
    }
  }
  return events;
}

/**
 * 推進一個交易日。
 * state: newState() 或上次的狀態
 * date:  "YYYY-MM-DD"
 * prices: { code: [o,h,l,c,v,val] }（當天）
 * dates: 所有已知交易日（含 date），由舊到新，用來算持有天數
 * picks: { short: [{code,name}], mid: [...] }（當天篩選結果，已排序）
 * prev: 前一個交易日的 prices，用來判斷開盤漲停（可省略）
 */
export function step(state, cfg, date, prices, dates, picks, prev = null) {
  const pc = cfg.paper;
  if (state.lastDate && date <= state.lastDate) return { state, events: [] };
  const events = [];
  if (!state.startDate) {
    state.startDate = date;
    const b = prices[pc.benchmark];
    state.benchmark = { code: pc.benchmark, startClose: b?.[3] ?? null };
  }
  if (state.benchmark && state.benchmark.startClose === null) state.benchmark.startClose = prices[pc.benchmark]?.[3] ?? null;

  // 1. 開盤買進：早上已用即時報價成交的，改用正式開盤價重算；其餘排隊單照常成交
  const yesterday = dates[dates.indexOf(date) - 1];
  for (const book of BOOKS) {
    for (const p of state.books[book].positions) {
      if (p.buyDate !== date || p.source !== "realtime") continue;
      const official = prices[p.code]?.[0];
      if (official && official !== p.buyPrice) {
        p.buyPrice = official;
        p.shares = Math.floor(pc[book].perTrade / official);
        p.cost = buyCost(official, p.shares, pc);
      }
      p.source = "official";
    }
  }
  events.push(...fillPending(state, cfg, date, yesterday, (c) => prices[c]?.[0], (c) => prev?.[c]?.[3]));

  for (const book of BOOKS) {
    const bc = pc[book];
    const s = state.books[book];

    // 2. 收盤檢查出場
    const keep = [];
    for (const p of s.positions) {
      const close = prices[p.code]?.[3];
      if (!close) { keep.push(p); continue; }
      const ret = (close / p.buyPrice - 1) * 100;
      const held = dates.filter((d) => d > p.buyDate && d <= date).length;
      let reason = null;
      if (bc.takeProfit !== null && bc.takeProfit !== undefined && ret >= bc.takeProfit) reason = "停利";
      else if (bc.stopLoss !== null && bc.stopLoss !== undefined && ret <= bc.stopLoss) reason = "停損";
      else if (bc.maxHoldDays && held >= bc.maxHoldDays) reason = "到期";
      if (!reason) { keep.push(p); continue; }
      const proceeds = sellProceeds(close, p.shares, pc);
      const pnl = proceeds - p.cost;
      s.closed.push({ ...p, sellDate: date, sellPrice: close, proceeds, pnl, pnlPct: round2((pnl / p.cost) * 100), reason, heldDays: held });
      events.push({ book, type: "sell", code: p.code, name: p.name, price: close, pnl, reason });
    }
    s.positions = keep;

    // 3. 排入隔天買進
    const held = new Set(s.positions.map((p) => p.code));
    for (const x of (picks[book] ?? []).filter((x) => !held.has(x.code)).slice(0, bc.buyTopN)) {
      s.pending.push({ code: x.code, name: x.name, signalDate: date });
    }
  }
  state.lastDate = date;
  state.lastEvents = events;
  return { state, events };
}

/** 績效摘要；prices 為最新一天，用收盤價估算未實現損益（扣除賣出成本） */
export function summarize(state, cfg, prices) {
  const pc = cfg.paper;
  const out = {};
  for (const book of BOOKS) {
    const bc = pc[book];
    const s = state.books[book];
    const realized = s.closed.reduce((a, t) => a + t.pnl, 0);
    let unrealized = 0;
    const open = s.positions.map((p) => {
      const close = prices[p.code]?.[3] ?? p.buyPrice;
      const pnl = sellProceeds(close, p.shares, pc) - p.cost;
      unrealized += pnl;
      return { ...p, close, pnl, pnlPct: round2((pnl / p.cost) * 100) };
    });
    const wins = s.closed.filter((t) => t.pnl > 0).length;
    const capital = bc.perTrade * bc.maxPositions;
    out[book] = {
      capital,
      realized, unrealized, total: realized + unrealized,
      returnPct: round2(((realized + unrealized) / capital) * 100),
      trades: s.closed.length,
      winRate: s.closed.length ? round2((wins / s.closed.length) * 100) : null,
      avgPnlPct: s.closed.length ? round2(s.closed.reduce((a, t) => a + t.pnlPct, 0) / s.closed.length) : null,
      open,
      pending: s.pending,
      recent: s.closed.slice(-10).reverse(),
    };
  }
  const b = state.benchmark;
  const bClose = b ? prices[b.code]?.[3] : null;
  out.benchmark = b && b.startClose && bClose ? { code: b.code, returnPct: round2((bClose / b.startClose - 1) * 100) } : null;
  out.startDate = state.startDate;
  return out;
}
