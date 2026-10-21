// 產生 Markdown 報表與 LINE 推播文字

const f = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toFixed(d));
const pct = (x) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(2)}%`);
const money = (x) => (x === null || x === undefined ? "—" : `${x > 0 ? "+" : ""}${Math.round(x).toLocaleString("en-US")}`);
const yi = (x) => (x === null || x === undefined ? "—" : (x / 1e8).toFixed(1));
const BOOK_NAME = { short: "短期", mid: "中期" };
/** 民國年月 "11509" → "2026/09" */
const rocMonth = (s) => (/^\d{5}$/.test(s ?? "") ? `${Number(s.slice(0, 3)) + 1911}/${s.slice(3)}` : s ?? "—");

function rulesText(rules) {
  return Object.entries(rules).filter(([, v]) => v !== null && v !== false).map(([k, v]) => `\`${k}=${v}\``).join("、");
}

export function markdown({ date, result, cfg, perf, events, notes = [] }) {
  const L = [];
  L.push(`# 台股篩選 ${date}`, "");
  L.push("> 這份報表只整理公開資料與模擬結果，不構成投資建議。", "");
  if (notes.length) L.push(...notes.map((n) => `- ⚠️ ${n}`), "");

  L.push(`## 短期（符合 ${result.counts.short} 檔，列前 ${result.short.length} 檔）`, "");
  L.push(`條件：${rulesText(cfg.short.rules)}｜排序：\`${cfg.short.rankBy}\``, "");
  if (result.short.length) {
    L.push("| 代號 | 名稱 | 收盤 | 量比 | RSI14 | 法人連買 | 20日漲跌 | 20日均成交(億) |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of result.short) {
      L.push(`| ${r.code} | ${r.name} | ${f(r.close)} | ${f(r.volRatio)} | ${f(r.rsi14, 1)} | ${r.instDays ?? "—"} 天 | ${pct(r.ret20)} | ${yi(r.avgValue20)} |`);
    }
  } else L.push("今天沒有符合的標的。");
  L.push("");

  L.push(`## 中期（符合 ${result.counts.mid} 檔，列前 ${result.mid.length} 檔）`, "");
  L.push(`條件：${rulesText(cfg.mid.rules)}｜排序：\`${cfg.mid.rankBy}\``, "");
  if (result.mid.length) {
    L.push("| 代號 | 名稱 | 收盤 | 本益比 | 殖利率% | 淨值比 | 月營收年增 | 累計營收年增 | 營收月份 |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of result.mid) {
      L.push(`| ${r.code} | ${r.name} | ${f(r.close)} | ${f(r.pe)} | ${f(r.yield)} | ${f(r.pb)} | ${pct(r.revYoY)} | ${pct(r.revCumYoY)} | ${rocMonth(r.revMonth)} |`);
    }
  } else L.push("今天沒有符合的標的。");
  L.push("");

  if (perf) {
    L.push(`## 模擬交易（自 ${perf.startDate} 起）`, "");
    L.push("| | 總損益 | 報酬率 | 已實現 | 未實現 | 交易筆數 | 勝率 | 平均每筆 |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const b of ["short", "mid"]) {
      const p = perf[b];
      L.push(`| ${BOOK_NAME[b]}（本金 ${p.capital.toLocaleString("en-US")}） | ${money(p.total)} | ${pct(p.returnPct)} | ${money(p.realized)} | ${money(p.unrealized)} | ${p.trades} | ${p.winRate === null ? "—" : `${p.winRate}%`} | ${pct(p.avgPnlPct)} |`);
    }
    if (perf.benchmark) L.push(`| 對照：${perf.benchmark.code} 買進持有 | | ${pct(perf.benchmark.returnPct)} | | | | | |`);
    L.push("");
    L.push("報酬率 = 總損益 ÷ 本金（每筆金額 × 持股上限）。已扣手續費與證交稅。", "");

    for (const b of ["short", "mid"]) {
      const p = perf[b];
      L.push(`### ${BOOK_NAME[b]}持股（${p.open.length}）`, "");
      if (p.open.length) {
        L.push("| 代號 | 名稱 | 買進日 | 買價 | 收盤 | 股數 | 損益 | 報酬 |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
        for (const x of p.open) L.push(`| ${x.code} | ${x.name} | ${x.buyDate} | ${f(x.buyPrice)} | ${f(x.close)} | ${x.shares} | ${money(x.pnl)} | ${pct(x.pnlPct)} |`);
      } else L.push("目前沒有持股。");
      if (p.pending.length) L.push("", `明天開盤買進：${p.pending.map((x) => `${x.code} ${x.name}`).join("、")}`);
      if (p.recent.length) {
        L.push("", `最近出場：`, "", "| 代號 | 名稱 | 買進 | 賣出 | 天數 | 原因 | 損益 | 報酬 |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
        for (const t of p.recent) L.push(`| ${t.code} | ${t.name} | ${t.buyDate} ${f(t.buyPrice)} | ${t.sellDate} ${f(t.sellPrice)} | ${t.heldDays} | ${t.reason} | ${money(t.pnl)} | ${pct(t.pnlPct)} |`);
      }
      L.push("");
    }
  }

  if (events?.length) {
    L.push("## 模擬交易紀錄", "");
    for (const e of events) {
      const what = e.type === "buy" ? `買進 ${e.shares} 股 @ ${f(e.price)}` : e.type === "sell" ? `賣出 @ ${f(e.price)}（${e.reason}，${money(e.pnl)}）` : `取消（${e.reason}）`;
      L.push(`- ${e.date ? `${e.date} ` : ""}${BOOK_NAME[e.book]}｜${e.code} ${e.name}：${what}`);
    }
    L.push("");
  }
  return L.join("\n");
}

export function lineText({ date, result, perf, cfg, reportUrl, notes = [] }) {
  const n = cfg.notify?.listSize ?? 5;
  const list = (rows) => (rows.length ? rows.slice(0, n).map((r) => `${r.code} ${r.name}`).join("、") : "（無）");
  const L = [`📈 台股篩選 ${date.slice(5).replace("-", "/")}`];
  if (notes.length) L.push(...notes.map((x) => `⚠️ ${x}`));
  L.push(`短期（${result.counts.short}）：${list(result.short)}`);
  L.push(`中期（${result.counts.mid}）：${list(result.mid)}`);
  if (perf) {
    const p = (b) => `${pct(perf[b].returnPct)}${perf[b].trades ? `，勝率 ${perf[b].winRate}%` : ""}`;
    L.push("", `模擬（自 ${perf.startDate.slice(5).replace("-", "/")}）`, `短期 ${p("short")}｜中期 ${p("mid")}${perf.benchmark ? `｜${perf.benchmark.code} ${pct(perf.benchmark.returnPct)}` : ""}`);
  }
  if (reportUrl) L.push("", `完整報表：${reportUrl}`);
  L.push("（僅供參考，非投資建議）");
  return L.join("\n");
}
