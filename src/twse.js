// 證交所資料：抓取與解析
//
// 每日收盤行情  rwd  /afterTrading/MI_INDEX?date=YYYYMMDD&type=ALLBUT0999   （可指定日期，回補歷史也用它）
// 每日收盤行情  openapi /exchangeReport/STOCK_DAY_ALL                         （只有最新一天，MI_INDEX 失敗時的備援）
// 三大法人      rwd  /fund/T86?date=YYYYMMDD&selectType=ALLBUT0999
// 本益比等      openapi /exchangeReport/BWIBBU_ALL                            （最新一天）
// 月營收        openapi /opendata/t187ap05_L                                  （最新月份）

const RWD = "https://www.twse.com.tw/rwd/zh";
const OPENAPI = "https://openapi.twse.com.tw/v1";

/** 一般上市股票：4 位數、不是 0 開頭（排除 ETF、權證等） */
export const isCommonStock = (code) => /^[1-9]\d{3}$/.test(code);

/** "1,234.5" → 1234.5；"--"、""、"-"、"N/A" → null */
export function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/<[^>]*>/g, "").replace(/,/g, "").trim();
  if (!s || /^[-–—]+$/.test(s) || /^n\/?a$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "2026-10-20" → "20261020" */
export const ymd = (date) => date.replaceAll("-", "");

/** 民國日期 "1151020" 或 "115/10/20" → "2026-10-20" */
export function rocToIso(s) {
  const m = String(s ?? "").trim().match(/^(\d{2,3})\/?(\d{2})\/?(\d{2})$/);
  if (!m) return null;
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
}

/** 從 rwd 回應找出欄位含指定名稱的表格：支援新版 tables[] 與舊版 fieldsN/dataN */
export function findTable(json, mustHave) {
  const tables = [];
  if (Array.isArray(json?.tables)) tables.push(...json.tables);
  if (Array.isArray(json?.fields) && Array.isArray(json?.data)) tables.push({ fields: json.fields, data: json.data });
  for (const k of Object.keys(json ?? {})) {
    const m = k.match(/^fields(\d+)$/);
    if (m && Array.isArray(json[`data${m[1]}`])) tables.push({ fields: json[k], data: json[`data${m[1]}`] });
  }
  return tables.find((t) => Array.isArray(t?.fields) && mustHave.every((f) => t.fields.some((x) => String(x).includes(f)))) ?? null;
}

const col = (fields, name) => fields.findIndex((f) => String(f).includes(name));

/** MI_INDEX → { code: { name, open, high, low, close, volume, value } }；非交易日回傳 null */
export function parseMiIndex(json) {
  const t = findTable(json, ["證券代號", "收盤價"]);
  if (!t || !t.data?.length) return null;
  const f = t.fields;
  const i = {
    code: col(f, "證券代號"), name: col(f, "證券名稱"), volume: col(f, "成交股數"), value: col(f, "成交金額"),
    open: col(f, "開盤價"), high: col(f, "最高價"), low: col(f, "最低價"), close: col(f, "收盤價"),
  };
  const out = {};
  for (const r of t.data) {
    const code = String(r[i.code]).trim();
    out[code] = {
      name: String(r[i.name]).trim(),
      open: num(r[i.open]), high: num(r[i.high]), low: num(r[i.low]), close: num(r[i.close]),
      volume: num(r[i.volume]), value: num(r[i.value]),
    };
  }
  return out;
}

/** openapi STOCK_DAY_ALL → { date, prices }（date 由民國日期換算） */
export function parseStockDayAll(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const prices = {};
  let date = null;
  for (const r of rows) {
    date ??= rocToIso(r.Date);
    prices[String(r.Code).trim()] = {
      name: String(r.Name).trim(),
      open: num(r.OpeningPrice), high: num(r.HighestPrice), low: num(r.LowestPrice), close: num(r.ClosingPrice),
      volume: num(r.TradeVolume), value: num(r.TradeValue),
    };
  }
  return { date, prices };
}

/** T86 → { code: 三大法人買賣超股數 } */
export function parseT86(json) {
  const t = findTable(json, ["證券代號", "三大法人買賣超"]);
  if (!t || !t.data?.length) return null;
  const ic = col(t.fields, "證券代號");
  const inet = col(t.fields, "三大法人買賣超");
  const out = {};
  for (const r of t.data) out[String(r[ic]).trim()] = num(r[inet]);
  return out;
}

/** BWIBBU_ALL → { code: { pe, yield, pb } } */
export function parseValuation(rows) {
  if (!Array.isArray(rows)) return {};
  const out = {};
  for (const r of rows) {
    out[String(r.Code).trim()] = { pe: num(r.PEratio), yield: num(r.DividendYield), pb: num(r.PBratio) };
  }
  return out;
}

/** t187ap05_L（月營收，中文欄位）→ { code: { month, revYoY, revCumYoY } } */
export function parseRevenue(rows) {
  if (!Array.isArray(rows) || !rows.length) return {};
  const keys = Object.keys(rows[0]);
  const k = (name) => keys.find((x) => x.includes(name));
  const kCode = k("公司代號"), kMonth = k("資料年月"), kYoY = k("去年同月增減"), kCum = k("前期比較增減");
  const out = {};
  for (const r of rows) {
    const code = String(r[kCode] ?? "").trim();
    if (!code) continue;
    out[code] = { month: kMonth ? String(r[kMonth]).trim() : null, revYoY: num(r[kYoY]), revCumYoY: num(r[kCum]) };
  }
  return out;
}

// ───────────── 抓取 ─────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, { tries = 3, delayMs = 4000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (twse-screener; personal use)", Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`不是 JSON（前 80 字：${text.slice(0, 80).replace(/\s+/g, " ")}）`);
      }
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(delayMs * (i + 1));
    }
  }
  throw new Error(`${url.replace(/^https:\/\/[^/]+/, "")}：${last.message}`);
}

export const fetchMiIndex = async (date) =>
  parseMiIndex(await getJson(`${RWD}/afterTrading/MI_INDEX?date=${ymd(date)}&type=ALLBUT0999&response=json`));
export const fetchT86 = async (date) =>
  parseT86(await getJson(`${RWD}/fund/T86?date=${ymd(date)}&selectType=ALLBUT0999&response=json`));
export const fetchStockDayAll = async () => parseStockDayAll(await getJson(`${OPENAPI}/exchangeReport/STOCK_DAY_ALL`));
export const fetchValuation = async () => parseValuation(await getJson(`${OPENAPI}/exchangeReport/BWIBBU_ALL`));
export const fetchRevenue = async () => parseRevenue(await getJson(`${OPENAPI}/opendata/t187ap05_L`));
export { sleep };

// ───────────── 盤中即時報價（早上用開盤價模擬成交） ─────────────
// mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw|tse_2317.tw&json=1&delay=0
// 回傳 msgArray：c 代號、n 名稱、o 開盤、y 昨收、z 最新成交、b 委買價（_ 分隔）、d 日期 YYYYMMDD；沒有值的欄位是 "-"

/** → { code: { name, open, prevClose, last, bid, date } } */
export function parseRealtime(json) {
  const out = {};
  for (const r of json?.msgArray ?? []) {
    const code = String(r.c ?? "").trim();
    if (!code) continue;
    const d = String(r.d ?? "");
    out[code] = {
      name: String(r.n ?? "").trim(),
      open: num(r.o), prevClose: num(r.y), last: num(r.z), bid: num(String(r.b ?? "").split("_")[0]),
      date: /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null,
    };
  }
  return out;
}

export async function fetchRealtime(codes) {
  if (!codes.length) return {};
  const out = {};
  for (let i = 0; i < codes.length; i += 20) {
    const ex = codes.slice(i, i + 20).map((c) => `tse_${c}.tw`).join("|");
    Object.assign(out, parseRealtime(await getJson(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(ex)}&json=1&delay=0&_=${Date.now()}`)));
    if (i + 20 < codes.length) await sleep(2000);
  }
  return out;
}
