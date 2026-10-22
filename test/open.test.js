// 早上開盤成交 → 收盤後對帳
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "screener-open-"));
process.env.SCREENER_ROOT = root;
const cfg = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
cfg.data.requestDelayMs = 0;
cfg.paper.mid.buyTopN = 1;
writeFileSync(join(root, "config.json"), JSON.stringify(cfg));

const dayIndex = (ymd) => Math.round((Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6)) - Date.UTC(2026, 6, 1)) / 864e5);
const miIndex = (ymd) => {
  const i = dayIndex(ymd), c = 100 + i * 0.5;
  const row = (code, name, o, cl) => [code, name, "1,000,000", "1", String(1e6 * cl), String(o), String(cl + 1), String(o - 1), String(cl), "", ""];
  return { stat: "OK", tables: [{ fields: ["證券代號", "證券名稱", "成交股數", "成交筆數", "成交金額", "開盤價", "最高價", "最低價", "收盤價", "漲跌(+/-)", "漲跌價差"],
    data: [row("2330", "台積電", ymd === "20261022" ? 150.5 : c - 0.2, c), row("0050", "元大台灣50", 150, 150)] }] };
};
let realtime = {};
globalThis.fetch = async (url) => {
  const u = new URL(url);
  let body;
  if (u.pathname.endsWith("/MI_INDEX")) body = miIndex(u.searchParams.get("date"));
  else if (u.pathname.endsWith("/T86")) body = { stat: "OK", fields: ["證券代號", "三大法人買賣超股數"], data: [["2330", "1"]] };
  else if (u.pathname.endsWith("/BWIBBU_ALL")) body = [{ Code: "2330", PEratio: "12", DividendYield: "5", PBratio: "1.8" }];
  else if (u.pathname.endsWith("/t187ap05_L")) body = [{ 資料年月: "11509", 公司代號: "2330", "營業收入-去年同月增減(%)": "20", "累計營業收入-前期比較增減(%)": "15" }];
  else if (u.pathname.endsWith("/getStockInfo.jsp")) body = { msgArray: Object.values(realtime), rtcode: "0000" };
  else throw new Error(`unexpected ${url}`);
  return new Response(JSON.stringify(body));
};
const { run, openRun } = await import("../src/main.js");
const paper = () => JSON.parse(readFileSync(join(root, "data", "paper.json"), "utf8"));
const dash = () => JSON.parse(readFileSync(join(root, "docs", "data.json"), "utf8"));

test("前一天收盤後產生買單", async () => {
  await run({ date: "2026-10-21" });
  assert.deepEqual(paper().books.mid.pending.map((x) => x.code), ["2330"]);
});

test("休市或不是今天的報價：不動作", async () => {
  realtime = { 2330: { c: "2330", n: "台積電", o: "150.00", y: "149.50", z: "151.00", d: "20261021" } };
  assert.equal((await openRun({ date: "2026-10-22" })).skipped, true);
  assert.equal(paper().books.mid.pending.length, 1);
});

test("還沒開盤成交的股票先留著", async () => {
  realtime = { 2330: { c: "2330", n: "台積電", o: "-", y: "149.50", z: "-", d: "20261022" } };
  const r = await openRun({ date: "2026-10-22" });
  assert.deepEqual(r.events, []);
  assert.equal(paper().books.mid.pending.length, 1);
});

test("開盤後用即時開盤價成交，dashboard 立刻看到持股", async () => {
  realtime = { 2330: { c: "2330", n: "台積電", o: "150.00", y: "149.50", z: "151.00", d: "20261022" } };
  const r = await openRun({ date: "2026-10-22" });
  assert.equal(r.events[0].type, "buy");
  const p = paper();
  assert.equal(p.books.mid.positions[0].buyPrice, 150);
  assert.equal(p.books.mid.positions[0].source, "realtime");
  assert.equal(p.books.mid.pending.length, 0);
  assert.equal(p.lastDate, "2026-10-21", "收盤後的流程還要跑");
  const d = dash();
  assert.equal(d.paper.mid.open[0].code, "2330");
  assert.equal(d.paper.mid.open[0].close, 151);
});

test("沒有最新成交價時用最佳委買價估算", async () => {
  const { parseRealtime } = await import("../src/twse.js");
  const q = parseRealtime({ msgArray: [{ c: "2330", o: "150", z: "-", b: "150.5000_150.0000_", d: "20261022" }] });
  assert.equal(q["2330"].last, null);
  assert.equal(q["2330"].bid, 150.5);
  assert.ok(d.notes.some((n) => n.startsWith("早上")));
});

test("同一天早上再跑一次不會重複買", async () => {
  const r = await openRun({ date: "2026-10-22" });
  assert.equal(r.skipped, true);
  assert.equal(paper().books.mid.positions.length, 1);
});

test("收盤後：改用正式開盤價、不重複成交、交易紀錄保留早上的買進", async () => {
  const out = await run({ date: "2026-10-22" });
  const pos = paper().books.mid.positions.filter((x) => x.code === "2330");
  assert.equal(pos.length, 1);
  assert.equal(pos[0].buyPrice, 150.5, "正式開盤價");
  assert.equal(pos[0].source, "official");
  assert.equal(out.events.filter((e) => e.type === "buy" && e.code === "2330").length, 1);
  assert.ok(!dash().notes.some((n) => n.startsWith("早上")), "收盤後的 dashboard 重新產生");
});
