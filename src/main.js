// 進入點：node src/main.js run | diagnose
//   run       抓今天的資料 → 回補歷史 → 篩選 → 模擬交易 → 輸出 docs/data.json 給網頁 dashboard
//   diagnose  只測試各資料來源能不能抓到，不寫入任何檔案
// 環境變數：TODAY=YYYY-MM-DD（指定日期，測試用）

import * as twse from "./twse.js";
import * as store from "./store.js";
import { computeMetrics } from "./indicators.js";
import { screen } from "./screen.js";
import { newState, step, summarize } from "./paper.js";
import { buildDashboard } from "./dashboard.js";

export const taipeiToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

export function prevWeekday(date) {
  const d = new Date(`${date}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1); while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** 抓某一天的收盤行情；非交易日回傳 null。today=true 時 MI_INDEX 失敗會改用 openapi */
async function getPrices(date, today) {
  try {
    const p = await twse.fetchMiIndex(date);
    if (p) return p;
  } catch (e) {
    if (!today) throw e;
    log(`MI_INDEX 失敗（${e.message}），改用 STOCK_DAY_ALL`);
  }
  if (!today) return null;
  const alt = await twse.fetchStockDayAll().catch(() => null);
  return alt && alt.date === date ? alt.prices : null;
}

function keepCode(cfg) {
  return (code) => twse.isCommonStock(code) || code === cfg.paper.benchmark;
}

function filterInst(inst, keep) {
  if (!inst) return null;
  return Object.fromEntries(Object.entries(inst).filter(([c]) => keep(c)));
}

async function backfill(cfg, notes) {
  const want = cfg.data.backfillDays;
  const delay = cfg.data.requestDelayMs;
  let dates = store.listDates();
  if (dates.length >= want) return;
  log(`回補歷史：目前 ${dates.length} 天，目標 ${want} 天`);
  let cursor = dates[0];
  let attempts = 0;
  while (dates.length < want && attempts < want * 2) {
    cursor = prevWeekday(cursor);
    attempts++;
    await twse.sleep(delay);
    let prices;
    try {
      prices = await twse.fetchMiIndex(cursor);
    } catch (e) {
      notes.push(`回補 ${cursor} 失敗：${e.message}`);
      break;
    }
    if (!prices) continue; // 假日
    store.saveDay({ date: cursor, p: store.packPrices(prices, keepCode(cfg)), inst: null });
    dates = store.listDates();
    if (dates.length % 10 === 0) log(`  已有 ${dates.length} 天`);
  }
}

/** 補上「上次執行 ~ 今天」之間漏掉的交易日（排程沒跑、執行失敗時） */
async function fillGaps(cfg, date, notes) {
  const keep = keepCode(cfg);
  const before = store.listDates().filter((d) => d < date);
  if (!before.length) return;
  const missing = [];
  for (let d = prevWeekday(date); d > before.at(-1) && missing.length < 30; d = prevWeekday(d)) missing.unshift(d);
  for (const d of missing) {
    await twse.sleep(cfg.data.requestDelayMs);
    try {
      const prices = await twse.fetchMiIndex(d);
      if (!prices) continue;
      store.saveDay({ date: d, p: store.packPrices(prices, keep), inst: null });
      log(`補上漏掉的交易日 ${d}`);
    } catch (e) {
      notes.push(`補 ${d} 的資料失敗：${e.message}`);
    }
  }
}

/** 最近 5 個交易日缺法人資料的補上（短期條件要看連續買超） */
async function backfillInst(cfg, notes) {
  const keep = keepCode(cfg);
  for (const date of store.listDates().slice(-5)) {
    const day = store.loadDay(date);
    if (day.inst) continue;
    await twse.sleep(cfg.data.requestDelayMs);
    try {
      day.inst = filterInst(await twse.fetchT86(date), keep);
      if (day.inst) store.saveDay(day);
    } catch (e) {
      notes.push(`三大法人 ${date} 讀取失敗：${e.message}`);
    }
  }
}

export async function run({ date = process.env.TODAY || taipeiToday() } = {}) {
  const cfg = store.loadConfig();
  const notes = [];
  const keep = keepCode(cfg);

  log(`日期 ${date}`);
  const latestStored = store.listDates().at(-1);
  if (latestStored && date < latestStored) {
    throw new Error(`只能執行最新的交易日：已經有 ${latestStored} 的資料，不能再跑 ${date}`);
  }
  const prices = await getPrices(date, true);
  if (!prices) {
    log("今天不是交易日，或證交所資料尚未更新，結束。");
    return { skipped: true };
  }
  let inst = null;
  try {
    inst = filterInst(await twse.fetchT86(date), keep);
  } catch (e) {
    notes.push(`今天的三大法人資料讀取失敗：${e.message}`);
  }
  store.saveDay({ date, p: store.packPrices(prices, keep), inst });
  const names = { ...store.loadNames() };
  for (const [code, x] of Object.entries(prices)) if (keep(code)) names[code] = x.name;
  store.saveNames(names);

  await fillGaps(cfg, date, notes);
  await backfill(cfg, notes);
  await backfillInst(cfg, notes);
  store.prune(cfg.data.historyDays);

  const dates = store.listDates();
  const days = dates.map(store.loadDay);
  log(`歷史資料 ${dates.length} 天（${dates[0]} ~ ${dates.at(-1)}）`);
  if (dates.length < 60) notes.push(`歷史資料只有 ${dates.length} 天，60 日均線等指標尚未齊全`);

  const [valuation, revenue] = await Promise.all([
    twse.fetchValuation().catch((e) => (notes.push(`本益比資料讀取失敗：${e.message}`), {})),
    twse.fetchRevenue().catch((e) => (notes.push(`月營收資料讀取失敗：${e.message}`), {})),
  ]);

  const metrics = computeMetrics(days, twse.isCommonStock);
  const result = screen(cfg, metrics, names, valuation, revenue);
  log(`短期符合 ${result.counts.short} 檔、中期符合 ${result.counts.mid} 檔`);

  let perf = null, events = [];
  const byDate = Object.fromEntries(days.map((d) => [d.date, d.p]));
  const today = byDate[date];
  const state = store.loadPaper() ?? newState();
  if (dates.length >= 60) {
    if (state.lastDate === date) {
      events = state.lastEvents ?? [];
    } else {
      // 漏掉的交易日：只處理成交與出場（沒有當天的估值資料，不產生新訊號）
      for (const d of dates.filter((x) => state.startDate && x > state.lastDate && x < date)) {
        const r = step(state, cfg, d, byDate[d], dates, { short: [], mid: [] }, byDate[dates[dates.indexOf(d) - 1]]);
        events.push(...r.events.map((e) => ({ ...e, date: d })));
      }
      const r = step(state, cfg, date, today, dates, result, byDate[dates[dates.indexOf(date) - 1]]);
      events.push(...r.events);
      state.lastEvents = events;
    }
    perf = summarize(state, cfg, today);
  } else {
    notes.push("模擬交易會在歷史資料滿 60 天後開始");
  }

  if (perf) {
    state.equity = (state.equity ?? []).filter((e) => e.date !== date);
    state.equity.push({ date, short: perf.short.returnPct, mid: perf.mid.returnPct, bench: perf.benchmark?.returnPct ?? null });
    store.savePaper(state);
  }
  store.saveDashboard(buildDashboard({ date, result, cfg, perf, equity: state.equity ?? [], events, notes, historyDays: dates.length }));
  return { result, perf, notes, events };
}

export async function diagnose() {
  const date = process.env.TODAY || taipeiToday();
  const tryIt = async (label, fn, show) => {
    try {
      const v = await fn();
      console.log(`✅ ${label}：${show(v)}`);
    } catch (e) {
      console.log(`❌ ${label}：${e.message}`);
    }
    await twse.sleep(3000);
  };
  let d = date;
  for (let i = 0; i < 5; i++) {
    const p = await twse.fetchMiIndex(d).catch(() => null);
    if (p) break;
    d = prevWeekday(d);
    await twse.sleep(3000);
  }
  console.log(`測試日期 ${d}`);
  const count = (o) => (o ? `${Object.keys(o).length} 筆，例：${JSON.stringify(Object.entries(o).find(([c]) => c === "2330") ?? Object.entries(o)[0])}` : "沒有資料");
  await tryIt("MI_INDEX 每日收盤行情", () => twse.fetchMiIndex(d), count);
  await tryIt("T86 三大法人", () => twse.fetchT86(d), count);
  await tryIt("STOCK_DAY_ALL", () => twse.fetchStockDayAll(), (v) => `日期 ${v?.date}，${count(v?.prices)}`);
  await tryIt("BWIBBU_ALL 本益比", () => twse.fetchValuation(), count);
  await tryIt("t187ap05_L 月營收", () => twse.fetchRevenue(), count);
}

const mode = process.argv[2];
if (mode === "run") run().catch((e) => { console.error(e); process.exit(1); });
else if (mode === "diagnose") diagnose();
