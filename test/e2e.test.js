// 端對端：假的證交所 API ＋ 暫存資料夾，跑完整個 run()
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "screener-"));
process.env.SCREENER_ROOT = root;
const cfg = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
cfg.data.requestDelayMs = 0;
writeFileSync(join(root, "config.json"), JSON.stringify(cfg));

// 2330 一路上漲、最後一天爆量；1101 橫盤；0050 對照
const dayIndex = (ymd) => {
  const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}T00:00:00Z`);
  return Math.round((d - Date.UTC(2026, 6, 1)) / 864e5);
};
const holidays = new Set(["20261009"]);
function miIndex(ymd) {
  if (holidays.has(ymd)) return { stat: "很抱歉，沒有符合條件的資料!" };
  const i = dayIndex(ymd);
  const c = 100 + i * 0.5;
  const vol = ymd === "20261020" ? 5_000_000 : 1_000_000;
  const row = (code, name, o, cl, v) => [code, name, v.toLocaleString("en-US"), "1", (v * cl).toLocaleString("en-US"), String(o), String(cl + 1), String(o - 1), String(cl), "", ""];
  return {
    stat: "OK",
    tables: [{ fields: ["證券代號", "證券名稱", "成交股數", "成交筆數", "成交金額", "開盤價", "最高價", "最低價", "收盤價", "漲跌(+/-)", "漲跌價差"],
      data: [row("2330", "台積電", c - 0.2, c, vol), row("1101", "台泥", 40, 40, 2_000_000), row("0050", "元大台灣50", 150 + i * 0.1, 150 + i * 0.1, 1e6), row("00878", "國泰永續高股息", 20, 20, 1e6)] }],
  };
}
const t86 = (ymd) => ({ stat: "OK", fields: ["證券代號", "證券名稱", "三大法人買賣超股數"], data: [["2330", "台積電", "1,000"], ["1101", "台泥", "-500"]] });

const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push(url);
  const u = new URL(url);
  let body;
  if (u.pathname.endsWith("/MI_INDEX")) body = miIndex(u.searchParams.get("date"));
  else if (u.pathname.endsWith("/T86")) body = t86(u.searchParams.get("date"));
  else if (u.pathname.endsWith("/BWIBBU_ALL")) body = [{ Code: "2330", PEratio: "12", DividendYield: "5", PBratio: "1.8" }, { Code: "1101", PEratio: "30", DividendYield: "2", PBratio: "1" }];
  else if (u.pathname.endsWith("/t187ap05_L")) body = [{ 資料年月: "11509", 公司代號: "2330", "營業收入-去年同月增減(%)": "20", "累計營業收入-前期比較增減(%)": "15" }];
  else if (u.hostname === "api.line.me") { calls.push(["LINE", JSON.parse(opts.body)]); body = {}; }
  else throw new Error(`unexpected ${url}`);
  return new Response(JSON.stringify(body), { status: 200 });
};

const { run } = await import("../src/main.js");

test("第一次執行：回補歷史、篩選、開始模擬、推播", async () => {
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "t";
  process.env.LINE_TO = "U1";
  process.env.GITHUB_REPOSITORY = "me/twse-screener";
  const out = await run({ date: "2026-10-20" });

  const hist = readdirSync(join(root, "data", "history"));
  assert.equal(hist.length, cfg.data.backfillDays);
  assert.ok(!hist.includes("2026-10-09.json"), "假日不存");
  const day = JSON.parse(readFileSync(join(root, "data", "history", "2026-10-20.json"), "utf8"));
  assert.deepEqual(Object.keys(day.p).sort(), ["0050", "1101", "2330"], "排除 00878 等 ETF，保留對照用的 0050");
  assert.equal(day.inst["2330"], 1000);

  assert.deepEqual(out.result.short.map((x) => x.code), [], "上漲太穩 RSI=100 過熱，短期不入選");
  assert.deepEqual(out.result.mid.map((x) => x.code), ["2330"]);
  assert.ok(existsSync(join(root, "reports", "latest.md")));
  const paper = JSON.parse(readFileSync(join(root, "data", "paper.json"), "utf8"));
  assert.equal(paper.startDate, "2026-10-20");
  assert.deepEqual(paper.books.mid.pending.map((x) => x.code), ["2330"]);

  const line = calls.find((c) => Array.isArray(c) && c[0] === "LINE");
  assert.ok(line, "有推播");
  assert.match(line[1].messages[0].text, /中期（1）：2330 台積電/);
  assert.match(line[1].messages[0].text, /github\.com\/me\/twse-screener\/blob\/main\/reports\/2026-10-20\.md/);
});

test("隔天：不再回補，模擬買進", async () => {
  calls.length = 0;
  const out = await run({ date: "2026-10-21", notify: false });
  assert.equal(calls.filter((c) => typeof c === "string" && c.includes("MI_INDEX")).length, 1, "只抓今天");
  assert.equal(out.perf.mid.open.length, 1);
  assert.equal(out.perf.mid.open[0].code, "2330");
});

test("非交易日：直接結束、不寫檔", async () => {
  holidays.add("20261022");
  globalThis.fetch = ((orig) => async (url, o) => (url.includes("STOCK_DAY_ALL") ? new Response("[]") : orig(url, o)))(globalThis.fetch);
  const out = await run({ date: "2026-10-22", notify: false });
  assert.equal(out.skipped, true);
  assert.ok(!existsSync(join(root, "data", "history", "2026-10-22.json")));
});

test("同一天重跑：不重複推播，報表保留原本的交易紀錄", async () => {
  holidays.delete("20261022");
  calls.length = 0;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "t";
  const first = await run({ date: "2026-10-23" });
  const pushes1 = calls.filter((c) => Array.isArray(c)).length;
  const again = await run({ date: "2026-10-23" });
  assert.equal(calls.filter((c) => Array.isArray(c)).length, pushes1, "沒有第二次推播");
  assert.deepEqual(again.events, first.events);
});

test("漏跑的交易日會補上，模擬交易也會補跑", async () => {
  const out = await run({ date: "2026-10-27", notify: false }); // 10/26 沒跑
  const hist = readdirSync(join(root, "data", "history"));
  assert.ok(hist.includes("2026-10-26.json"), "補上 10/26");
  const paper = JSON.parse(readFileSync(join(root, "data", "paper.json"), "utf8"));
  assert.equal(paper.lastDate, "2026-10-27");
});

test("不能執行比最新資料更早的日期", async () => {
  await assert.rejects(run({ date: "2026-10-21", notify: false }), /只能執行最新的交易日/);
});

test("LINE 推播失敗不會讓整個執行失敗", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, o) => (String(url).includes("api.line.me") ? new Response("bad", { status: 401 }) : orig(url, o));
  const out = await run({ date: "2026-10-28" });
  globalThis.fetch = orig;
  assert.ok(out.notes.some((n) => n.includes("LINE 推播失敗")));
  assert.ok(existsSync(join(root, "reports", "2026-10-28.md")));
});
