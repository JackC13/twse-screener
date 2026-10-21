import { test } from "node:test";
import assert from "node:assert/strict";
import { num, rocToIso, parseMiIndex, parseT86, parseValuation, parseRevenue, parseStockDayAll, isCommonStock } from "../src/twse.js";
import { sma, rsi, computeMetrics } from "../src/indicators.js";
import { shortRules, midRules, screen } from "../src/screen.js";
import { newState, step, summarize, buyCost, sellProceeds } from "../src/paper.js";
import { markdown, lineText } from "../src/report.js";
import { prevWeekday } from "../src/main.js";

const cfg = JSON.parse((await import("node:fs")).readFileSync(new URL("../config.json", import.meta.url), "utf8"));

// ── 解析 ──
test("num：千分位、空值、破折號", () => {
  assert.equal(num("1,234.5"), 1234.5);
  assert.equal(num("--"), null);
  assert.equal(num(""), null);
  assert.equal(num("-"), null);
  assert.equal(num("-3.2"), -3.2);
  assert.equal(num("<p style=color:red>+</p>"), null);
});
test("民國日期", () => {
  assert.equal(rocToIso("1151020"), "2026-10-20");
  assert.equal(rocToIso("115/10/20"), "2026-10-20");
  assert.equal(rocToIso("x"), null);
});
test("一般股判斷", () => {
  assert.ok(isCommonStock("2330"));
  assert.ok(!isCommonStock("0050"));
  assert.ok(!isCommonStock("00878"));
  assert.ok(!isCommonStock("2330A"));
});

const miIndex = {
  stat: "OK", date: "20261020",
  tables: [
    { title: "價格指數", fields: ["指數", "收盤指數"], data: [["發行量加權股價指數", "23,000.00"]] },
    {
      title: "每日收盤行情(全部(不含權證、牛熊證))",
      fields: ["證券代號", "證券名稱", "成交股數", "成交筆數", "成交金額", "開盤價", "最高價", "最低價", "收盤價", "漲跌(+/-)", "漲跌價差"],
      data: [
        ["2330", "台積電", "30,000,000", "50,000", "30,000,000,000", "1,000.00", "1,010.00", "995.00", "1,005.00", "<p style= color:red>+</p>", "5.00"],
        ["1101", "台泥", "5,000,000", "3,000", "150,000,000", "--", "--", "--", "--", "", "0.00"],
      ],
    },
  ],
};
test("MI_INDEX：找到正確表格並解析", () => {
  const p = parseMiIndex(miIndex);
  assert.deepEqual(p["2330"], { name: "台積電", open: 1000, high: 1010, low: 995, close: 1005, volume: 30000000, value: 30000000000 });
  assert.equal(p["1101"].close, null);
});
test("MI_INDEX：舊版 fields9/data9 與非交易日", () => {
  const old = { stat: "OK", fields9: miIndex.tables[1].fields, data9: miIndex.tables[1].data };
  assert.equal(parseMiIndex(old)["2330"].close, 1005);
  assert.equal(parseMiIndex({ stat: "很抱歉，沒有符合條件的資料!" }), null);
});
test("T86 三大法人", () => {
  const j = { stat: "OK", fields: ["證券代號", "證券名稱", "外陸資買賣超股數(不含外資自營商)", "三大法人買賣超股數"], data: [["2330 ", "台積電", "1,000", "2,500"], ["2317", "鴻海", "-10", "-3,000"]] };
  assert.deepEqual(parseT86(j), { 2330: 2500, 2317: -3000 });
});
test("本益比、月營收、STOCK_DAY_ALL", () => {
  assert.deepEqual(parseValuation([{ Code: "2330", PEratio: "20.5", DividendYield: "1.5", PBratio: "6.1" }, { Code: "1101", PEratio: "", DividendYield: "5", PBratio: "1" }]),
    { 2330: { pe: 20.5, yield: 1.5, pb: 6.1 }, 1101: { pe: null, yield: 5, pb: 1 } });
  const rev = parseRevenue([{ 出表日期: "1151011", 資料年月: "11509", 公司代號: "2330", 公司名稱: "台積電", "營業收入-去年同月增減(%)": "30.5", "累計營業收入-前期比較增減(%)": "35.1" }]);
  assert.deepEqual(rev["2330"], { month: "11509", revYoY: 30.5, revCumYoY: 35.1 });
  const s = parseStockDayAll([{ Date: "1151020", Code: "2330", Name: "台積電", TradeVolume: "100", TradeValue: "1000", OpeningPrice: "10", HighestPrice: "11", LowestPrice: "9", ClosingPrice: "10.5", Change: "0.5", Transaction: "5" }]);
  assert.equal(s.date, "2026-10-20");
  assert.equal(s.prices["2330"].close, 10.5);
});

// ── 指標 ──
test("均線與 RSI", () => {
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.equal(sma([1], 2), null);
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => 10 + i)), 100);
  assert.equal(rsi(Array.from({ length: 20 }, () => 10)), 50);
  const r = rsi([44, 44.3, 44.1, 43.6, 44.3, 44.8, 45.1, 45.4, 45.8, 46.1, 45.9, 46.2, 45.6, 46.3, 46.3, 46]);
  assert.ok(r > 55 && r < 75, `rsi=${r}`);
});

/** 產生 n 天的假資料：price(i) 決定收盤，vol(i) 決定量，inst(i) 決定法人 */
function fakeDays(n, { price = (i) => 100 + i, vol = () => 1_000_000, inst = () => 100 } = {}) {
  const days = [];
  for (let i = 0; i < n; i++) {
    const c = price(i);
    days.push({ date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
      p: { 2330: [c - 1, c + 1, c - 2, c, vol(i), vol(i) * c], 1101: [50, 50, 50, 50, 1000, 50000] }, inst: { 2330: inst(i), 1101: -1 } });
  }
  return days;
}

test("computeMetrics：均線、量比、法人連買", () => {
  const days = fakeDays(70, { vol: (i) => (i === 69 ? 3_000_000 : 1_000_000) });
  const m = computeMetrics(days)["2330"];
  assert.equal(m.close, 169);
  assert.equal(m.ma5, 167);
  assert.equal(m.ma20, 159.5);
  assert.equal(m.ma60, 139.5);
  assert.equal(m.volRatio, 3);
  assert.equal(m.instDays, 70);
  assert.equal(m.instNet3, 300);
  assert.ok(m.rsi14 > 99);
  assert.equal(computeMetrics(days)["1101"].instDays, 0);
});
test("computeMetrics：今天沒成交的股票不列入", () => {
  const days = fakeDays(30);
  days.at(-1).p["2330"][3] = null;
  assert.equal(computeMetrics(days)["2330"], undefined);
});

// ── 篩選 ──
const goodShort = { close: 100, avgValue20: 1e8, ma5: 98, ma20: 95, ma60: 90, volRatio: 2, rsi14: 60, instDays: 3 };
test("短期條件", () => {
  const r = cfg.short.rules;
  assert.ok(shortRules(r, goodShort));
  assert.ok(!shortRules(r, { ...goodShort, rsi14: 75 }), "過熱");
  assert.ok(!shortRules(r, { ...goodShort, volRatio: 1.2 }), "沒放量");
  assert.ok(!shortRules(r, { ...goodShort, instDays: 2 }), "法人連買不夠");
  assert.ok(!shortRules(r, { ...goodShort, instDays: null }), "缺法人資料");
  assert.ok(shortRules({ ...r, instBuyDays: null }, { ...goodShort, instDays: null }), "關閉條件後通過");
});
test("中期條件", () => {
  const r = cfg.mid.rules;
  const v = { pe: 12, yield: 5, pb: 1.5 };
  const rev = { revYoY: 15, revCumYoY: 8 };
  assert.ok(midRules(r, goodShort, v, rev));
  assert.ok(!midRules(r, goodShort, { ...v, pe: -3 }, rev), "虧損");
  assert.ok(!midRules(r, goodShort, { ...v, pe: null }, rev), "沒有本益比");
  assert.ok(!midRules(r, goodShort, v, { ...rev, revYoY: 5 }), "營收成長不夠");
  assert.ok(!midRules(r, { ...goodShort, ma60: 110 }, v, rev), "跌破季線");
});
test("screen：排序與筆數", () => {
  const metrics = { 1111: { ...goodShort, volRatio: 2 }, 2222: { ...goodShort, volRatio: 5 }, 3333: { ...goodShort, rsi14: 90 } };
  const out = screen({ ...cfg, short: { ...cfg.short, top: 1 } }, metrics, { 2222: "乙" });
  assert.equal(out.counts.short, 2);
  assert.deepEqual(out.short.map((x) => x.code), ["2222"]);
  assert.equal(out.short[0].name, "乙");
  assert.equal(out.counts.mid, 0, "沒有估值資料就不會進中期");
});

// ── 模擬交易 ──
test("交易成本", () => {
  assert.equal(buyCost(100, 1000, cfg.paper), 100000 + 142);
  assert.equal(sellProceeds(100, 1000, cfg.paper), 100000 - 142 - 300);
  assert.equal(buyCost(10, 1, cfg.paper), 10 + 20, "最低手續費 20");
});

const P = (o, c) => [o, o, c, c, 1000, 1000 * c];
test("模擬：訊號隔天開盤買進、停利出場", () => {
  const s = newState();
  const dates = ["2026-10-01"];
  step(s, cfg, "2026-10-01", { 2330: P(100, 100), "0050": P(50, 50) }, dates, { short: [{ code: "2330", name: "台積電" }], mid: [] });
  assert.equal(s.books.short.pending.length, 1);
  assert.equal(s.books.short.positions.length, 0);

  dates.push("2026-10-02");
  const r2 = step(s, cfg, "2026-10-02", { 2330: P(100, 103), "0050": P(50, 51) }, dates, { short: [], mid: [] });
  assert.equal(s.books.short.positions.length, 1);
  assert.equal(s.books.short.positions[0].buyPrice, 100);
  assert.equal(s.books.short.positions[0].shares, 1000);
  assert.equal(r2.events[0].type, "buy");

  dates.push("2026-10-05");
  const r3 = step(s, cfg, "2026-10-05", { 2330: P(104, 109), "0050": P(51, 52) }, dates, { short: [], mid: [] });
  assert.equal(s.books.short.positions.length, 0);
  const t = s.books.short.closed[0];
  assert.equal(t.reason, "停利");
  assert.equal(t.sellPrice, 109);
  assert.equal(t.heldDays, 1);
  assert.equal(t.pnl, sellProceeds(109, 1000, cfg.paper) - buyCost(100, 1000, cfg.paper));
  assert.equal(r3.events[0].type, "sell");

  const perf = summarize(s, cfg, { 2330: P(104, 109), "0050": P(51, 52) });
  assert.equal(perf.short.trades, 1);
  assert.equal(perf.short.winRate, 100);
  assert.equal(perf.benchmark.returnPct, 4);
  assert.equal(perf.startDate, "2026-10-01");
});
test("模擬：停損、到期、停牌取消、同一天不重跑", () => {
  const s = newState();
  const cfg2 = { ...cfg, paper: { ...cfg.paper, short: { ...cfg.paper.short, maxHoldDays: 2 } } };
  const dates = ["d1"];
  step(s, cfg2, "d1", { 1111: P(10, 10), 2222: P(10, 10), 3333: P(10, 10) }, dates,
    { short: [{ code: "1111", name: "A" }, { code: "2222", name: "B" }, { code: "3333", name: "C" }], mid: [] });
  dates.push("d2");
  const r = step(s, cfg2, "d2", { 1111: P(10, 9.4), 2222: P(10, 10), 3333: [null, null, null, null, 0, 0] }, dates, { short: [], mid: [] });
  assert.deepEqual(r.events.map((e) => `${e.type}:${e.code}`).sort(), ["buy:1111", "buy:2222", "cancel:3333", "sell:1111"]);
  assert.equal(s.books.short.closed[0].reason, "停損");
  dates.push("d3");
  step(s, cfg2, "d3", { 2222: P(10, 10.1) }, dates, { short: [], mid: [] });
  assert.equal(s.books.short.positions.length, 1, "持有 1 天，還沒到期");
  dates.push("d4");
  step(s, cfg2, "d4", { 2222: P(10, 10.1) }, dates, { short: [], mid: [] });
  assert.equal(s.books.short.closed.at(-1).reason, "到期");
  assert.deepEqual(step(s, cfg2, "d4", {}, dates, { short: [], mid: [] }).events, [], "已處理過的日期不重跑");
});
test("模擬：已持有的不重複買、持股上限", () => {
  const s = newState();
  const cfg2 = { ...cfg, paper: { ...cfg.paper, short: { ...cfg.paper.short, maxPositions: 1, buyTopN: 2 } } };
  const dates = ["d1"];
  step(s, cfg2, "d1", { 1111: P(10, 10), 2222: P(10, 10) }, dates, { short: [{ code: "1111", name: "A" }, { code: "2222", name: "B" }], mid: [] });
  dates.push("d2");
  const r = step(s, cfg2, "d2", { 1111: P(10, 10), 2222: P(10, 10) }, dates, { short: [{ code: "1111", name: "A" }], mid: [] });
  assert.deepEqual(r.events.map((e) => `${e.type}:${e.code}`), ["buy:1111", "cancel:2222"]);
  assert.equal(s.books.short.pending.length, 0, "已持有的不再排入");
});

// ── 報表 ──
test("報表與 LINE 文字", () => {
  const result = screen(cfg, { 2330: goodShort }, { 2330: "台積電" });
  const s = newState();
  step(s, cfg, "2026-10-20", { 2330: P(100, 100), "0050": P(50, 50) }, ["2026-10-20"], result);
  const perf = summarize(s, cfg, { 2330: P(100, 100), "0050": P(50, 50) });
  const md = markdown({ date: "2026-10-20", result, cfg, perf, events: [], notes: ["測試"] });
  assert.match(md, /\| 2330 \| 台積電 \|/);
  assert.match(md, /明天開盤買進：2330 台積電/);
  assert.match(md, /不構成投資建議/);
  const t = lineText({ date: "2026-10-20", result, perf, cfg, reportUrl: "https://x" });
  assert.match(t, /📈 台股篩選 10\/20/);
  assert.match(t, /短期（1）：2330 台積電/);
  assert.match(t, /0050 0\.00%/);
});
test("前一個平日", () => {
  assert.equal(prevWeekday("2026-10-19"), "2026-10-16");
  assert.equal(prevWeekday("2026-10-21"), "2026-10-20");
});

test("排序：由小到大、缺值排最後", async () => {
  const { sorter } = await import("../src/screen.js");
  const rows = [{ pe: 10 }, { pe: null }, { pe: 5 }, { pe: 20 }];
  assert.deepEqual([...rows].sort(sorter("-pe")).map((x) => x.pe), [5, 10, 20, null]);
  assert.deepEqual([...rows].sort(sorter("pe")).map((x) => x.pe), [20, 10, 5, null]);
});

// ── 審查後補的測試 ──
test("法人連買：遇到缺資料的日子就中斷", () => {
  const days = fakeDays(30);
  days[27].inst = null;
  const m = computeMetrics(days)["2330"];
  assert.equal(m.instDays, 2);
  assert.equal(m.instNet3, null, "最近 3 天有缺漏");
});
test("模擬：訊號過期（中間缺交易日）就取消", () => {
  const s = newState();
  step(s, cfg, "d1", { 1111: P(10, 10) }, ["d1"], { short: [{ code: "1111", name: "A" }], mid: [] });
  const r = step(s, cfg, "d3", { 1111: P(10, 10) }, ["d1", "d2", "d3"], { short: [], mid: [] });
  assert.deepEqual(r.events.map((e) => `${e.type}:${e.reason}`), ["cancel:訊號已過期（中間缺了交易日）"]);
});
test("模擬：開盤漲停買不到", () => {
  const s = newState();
  step(s, cfg, "d1", { 1111: P(10, 10) }, ["d1"], { short: [{ code: "1111", name: "A" }], mid: [] });
  const r = step(s, cfg, "d2", { 1111: P(11, 11) }, ["d1", "d2"], { short: [], mid: [] }, { 1111: P(10, 10) });
  assert.equal(r.events[0].reason, "開盤漲停，買不到");
  assert.equal(s.books.short.positions.length, 0);
});
