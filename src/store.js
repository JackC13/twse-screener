// 資料存成 repo 裡的 JSON 檔，由 GitHub Actions 每天 commit
//   data/history/YYYY-MM-DD.json   { date, p: { code: [開, 高, 低, 收, 成交股數, 成交金額] }, inst: { code: 法人買賣超股數 } | null }
//   data/names.json                { code: 名稱 }
//   data/paper.json                模擬交易狀態
//   docs/data.json                 網頁 dashboard 的資料
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = process.env.SCREENER_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const HIST = () => join(ROOT, "data", "history");

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
function writeJson(path, value, pretty = false) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, pretty ? 2 : 0) + "\n");
}

export const loadConfig = () => readJson(join(ROOT, "config.json"), null);

/** 已存的交易日，由舊到新 */
export function listDates() {
  if (!existsSync(HIST())) return [];
  return readdirSync(HIST()).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
}

export const loadDay = (date) => readJson(join(HIST(), `${date}.json`), null);
export const saveDay = (day) => writeJson(join(HIST(), `${day.date}.json`), day);

/** 把 { code: {open,...} } 壓成存檔格式；只留一般股與指定代號（例如大盤比較用的 0050） */
export function packPrices(prices, keep) {
  const p = {};
  for (const [code, x] of Object.entries(prices)) {
    if (!keep(code)) continue;
    p[code] = [x.open, x.high, x.low, x.close, x.volume, x.value];
  }
  return p;
}

export const loadNames = () => readJson(join(ROOT, "data", "names.json"), {});
export const saveNames = (names) => writeJson(join(ROOT, "data", "names.json"), names, true);

export const loadPaper = () => readJson(join(ROOT, "data", "paper.json"), null);
export const savePaper = (state) => writeJson(join(ROOT, "data", "paper.json"), state, true);

/** 網頁 dashboard 讀的資料（GitHub Pages 從 docs/ 發布） */
export const saveDashboard = (data) => writeJson(join(ROOT, "docs", "data.json"), data);
export const loadDashboard = () => readJson(join(ROOT, "docs", "data.json"), null);

/** 只保留最近 keep 個交易日 */
export function prune(keep) {
  const dates = listDates();
  for (const d of dates.slice(0, Math.max(0, dates.length - keep))) unlinkSync(join(HIST(), `${d}.json`));
}
