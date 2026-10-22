# 台股篩選與模擬交易

每個交易日由 GitHub Actions 自動執行兩次（台北時間）：

- **09:10 開盤後**：用即時報價的開盤價，把前一天的模擬買單成交，dashboard 馬上看得到持股
- **17:30 收盤後**：以下完整流程

1. 抓證交所的收盤行情、三大法人買賣超、本益比／殖利率／淨值比、上市公司月營收
2. 依 `config.json` 的條件，分別篩出**短期**與**中期**清單（只看上市一般股，不含 ETF）
3. 用篩選結果做**模擬買賣**，扣除手續費與證交稅，並和 0050 比較
4. 更新網頁 dashboard（GitHub Pages，手機可看）

> 本工具只整理公開資料與模擬結果，不構成投資建議。進出場由你自己判斷。

## 第一次設定

1. **Settings → Pages**：Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/docs`，按 Save。
   幾分鐘後網址會是 `https://<你的帳號>.github.io/twse-screener/`，用手機加到主畫面就像一個 app。
2. **Actions → 每日台股篩選 → Run workflow**：
   - 先選 `diagnose`，確認每個資料來源都是 ✅
   - 再選 `run`。第一次會回補約 70 個交易日的歷史，大約要 6–8 分鐘

之後每個平日會自動執行；假日或颱風假證交所沒有資料，會自動略過。

## 調整條件

直接在 GitHub 網頁上編輯 [`config.json`](config.json) 並 commit，隔天執行就會套用。
任何條件改成 `null` 就代表不使用這個條件。

### 短期 `short.rules`

| 欄位 | 預設 | 意思 |
| --- | --- | --- |
| `minPrice` | 10 | 收盤價至少幾元 |
| `minAvgValue` | 50000000 | 近 20 日平均成交金額至少幾元（流動性） |
| `closeAboveMA` | 20 | 收盤價站上幾日均線 |
| `ma5AboveMa20` | true | 5 日均線在 20 日均線之上 |
| `minVolRatio` | 1.5 | 今日成交量 ÷ 前 20 日均量，至少幾倍 |
| `rsiMin` / `rsiMax` | 50 / 70 | RSI(14) 的範圍：有動能但不過熱 |
| `instBuyDays` | 3 | 三大法人合計連續買超至少幾天 |

`short.rankBy`：排序欄位，可用 `volRatio`、`rsi14`、`ret20`、`instNet3`、`avgValue20`（由大到小；前面加 `-` 改成由小到大，例如 `-rsi14`）。`short.top`：列出幾檔。

### 中期 `mid.rules`

| 欄位 | 預設 | 意思 |
| --- | --- | --- |
| `minPrice` | 10 | 收盤價至少幾元 |
| `minAvgValue` | 30000000 | 近 20 日平均成交金額至少幾元 |
| `closeAboveMA` | 60 | 收盤價站上幾日均線（季線） |
| `peMin` / `peMax` | 0 / 15 | 本益比範圍（大於 0 排除虧損公司） |
| `yieldMin` | 4 | 殖利率至少幾 % |
| `pbMax` | 2 | 股價淨值比最多幾倍 |
| `revYoYMin` | 10 | 最新月營收年增率至少幾 % |
| `revCumYoYMin` | 0 | 今年累計營收年增率至少幾 % |

`mid.rankBy`：可用 `revCumYoY`、`revYoY`、`yield`（由大到小），或 `-pe`、`-pb`（由小到大）。

### 模擬交易 `paper`

| 欄位 | 短期預設 | 中期預設 | 意思 |
| --- | --- | --- | --- |
| `perTrade` | 100000 | 100000 | 每筆投入金額（可買零股） |
| `buyTopN` | 3 | 2 | 每天買進清單前幾檔（已持有的跳過） |
| `maxPositions` | 10 | 10 | 最多同時持有幾檔 |
| `takeProfit` | 8 | null | 報酬達幾 % 停利（null = 不停利） |
| `stopLoss` | -5 | -15 | 報酬低於幾 % 停損 |
| `maxHoldDays` | 10 | 60 | 最多持有幾個交易日 |

規則：
- 篩選出來的**隔天開盤價**買進（避免用到當天還不知道的資訊）。早上先用即時報價成交，收盤後再改成證交所公布的正式開盤價；早上還沒成交的股票，收盤後用正式資料補成交
- 每天用**收盤價**檢查停利、停損、到期，觸發就以收盤價賣出
- 開盤就漲停（比前一天收盤高 9.5% 以上）視為買不到；股數依金額計算，可能是零股
- 有一天沒跑到（排程延誤、證交所連線失敗），下次執行會補抓那天的資料並補算出場；當時排隊的買單視為過期取消
- 手續費 0.1425%（最低 20 元）、賣出證交稅 0.3%
- 報酬率 = 總損益 ÷ 本金（`perTrade × maxPositions`）
- 只往後模擬，不回測過去；想重新開始，刪掉 `data/paper.json` 即可

**改了模擬參數後，舊的持股會沿用新規則。** 想乾淨比較，就刪掉 `data/paper.json` 重來。

## 資料與檔案

| 路徑 | 內容 |
| --- | --- |
| `data/history/` | 每日收盤行情與法人買賣超，保留最近 120 個交易日 |
| `data/paper.json` | 模擬交易的持股、待買與已出場紀錄 |
| `docs/index.html` | 網頁 dashboard |
| `docs/data.json` | dashboard 讀的資料，每天更新 |

## 本機執行

```bash
node src/main.js diagnose   # 測試資料來源
node src/main.js run        # 完整執行
npm test                    # 單元測試
```

資料來源：[臺灣證券交易所](https://www.twse.com.tw/)、[證交所 OpenAPI](https://openapi.twse.com.tw/)。
