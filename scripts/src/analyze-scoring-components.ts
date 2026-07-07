/**
 * analyze-scoring-components.ts
 *
 * Analisis: apakah tiap komponen scoring (trend, confluence, srLevel, volume)
 * BENAR-BENAR membedakan trade yang menang vs kalah, atau cuma "noise"?
 *
 * Catatan penting: sentiment/funding/macro TIDAK dianalisis di sini karena
 * datanya (fgi, fundingRate, lsRatio, btcDom) selalu null di backtest historis
 * -- jadi skornya konstan, tidak bisa dianalisis korelasinya dari data ini.
 *
 * Untuk tiap komponen, data dibagi 3 kelompok (rendah/sedang/tinggi) berdasarkan
 * skornya, lalu dibandingkan win rate & avg PnL per kelompok.
 * Kalau komponen itu prediktif, kelompok "tinggi" harusnya menang lebih sering
 * dan profit lebih besar daripada kelompok "rendah".
 *
 * Jalankan:
 *   npx tsx scripts/src/analyze-scoring-components.ts
 */

import {
  ema, rsi, macd, bollinger, atr, swingLevels, trendStructure,
  volumeProfile, stochastic, detectRsiDivergence,
  bosLevel, vwap, ichimoku, waveTrend, pivotPoints,
} from "../../artifacts/api-server/src/lib/indicators.js";
import { scoreSwing, type RuleBasedSignalInput } from "../../artifacts/api-server/src/lib/rule-based-engine.js";

const PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "DOGEUSDT"];
const DAILY_BATCHES = 4;
const H4_BATCHES = 5;
const MIN_HISTORY = 200;
const TRADE_MAX_BARS = 10;

interface Candles {
  opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; times: number[];
}
interface Signal {
  side: "BUY" | "SELL";
  trend: number; confluence: number; srLevel: number; volume: number;
  pnlPct: number; win: boolean;
}

async function fetchKlinesAll(symbol: string, interval: string, maxBatches: number): Promise<Candles> {
  const bybitInterval = interval === "1d" ? "D" : interval === "4h" ? "240" : interval;
  const LIMIT = 1000;
  const batches: any[][] = [];
  let endTime: number | undefined = undefined;
  for (let b = 0; b < maxBatches; b++) {
    const params: Record<string, string> = { category: "spot", symbol, interval: bybitInterval, limit: String(LIMIT) };
    if (endTime !== undefined) params.end = String(endTime);
    const url = `https://api.bybit.com/v5/market/kline?${new URLSearchParams(params)}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const json = (await res.json()) as any;
    if (json.retCode !== 0) break;
    const raw: any[] = [...(json.result?.list ?? [])];
    if (raw.length === 0) break;
    raw.reverse();
    batches.unshift(raw);
    const oldestTs = parseInt(raw[0][0], 10);
    endTime = oldestTs - 1;
    if (raw.length < LIMIT) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  const c: Candles = { opens: [], highs: [], lows: [], closes: [], volumes: [], times: [] };
  for (const batch of batches) {
    for (const k of batch) {
      c.opens.push(parseFloat(k[1])); c.highs.push(parseFloat(k[2])); c.lows.push(parseFloat(k[3]));
      c.closes.push(parseFloat(k[4])); c.volumes.push(parseFloat(k[5])); c.times.push(parseInt(k[0], 10));
    }
  }
  return c;
}

function buildInput(symbol: string, daily: Candles, h4: Candles, i: number): RuleBasedSignalInput | null {
  const dc = daily.closes.slice(0, i + 1);
  const dh = daily.highs.slice(0, i + 1);
  const dl = daily.lows.slice(0, i + 1);
  const dv = daily.volumes.slice(0, i + 1);
  const dailyOpenTs = daily.times[i];
  let h4EndIdx = h4.times.findIndex(t => t > dailyOpenTs);
  if (h4EndIdx === -1) h4EndIdx = h4.closes.length;
  const h4c = h4.closes.slice(0, h4EndIdx);
  const h4h = h4.highs.slice(0, h4EndIdx);
  const h4l = h4.lows.slice(0, h4EndIdx);
  if (dc.length < 50 || h4c.length < 50) return null;
  const price = dc[dc.length - 1];
  const todayVol = dv[dv.length - 1];
  const volH1 = todayVol / 24;
  const volH6 = todayVol / 4;
  try {
    const ema20Val = ema(dc, Math.min(20, dc.length - 1));
    const ema50Val = ema(dc, Math.min(50, dc.length - 1));
    const ema200Val = ema(dc, Math.min(200, dc.length - 1));
    const rsi1dVal = rsi(dc, 14);
    const rsi4hVal = rsi(h4c, 14);
    const rsiDiv = detectRsiDivergence(dc, 20);
    const macd4hVal = macd(h4c);
    const bbVal = bollinger(dc, 20, 2);
    const stoch4hVal = stochastic(h4h, h4l, h4c);
    const ema50_4h = ema(h4c, Math.min(50, h4c.length - 1));
    const ema200_4h = ema(h4c, Math.min(200, h4c.length - 1));
    const trend4hVal = trendStructure(ema50_4h, ema200_4h, h4c[h4c.length - 1]);
    const trend1dVal = trendStructure(ema50Val, ema200Val, price);
    const bos = bosLevel(h4h, h4l, h4c, 20);
    const swing7d = swingLevels(h4h, h4l, 42);
    const swing30d = swingLevels(dh, dl, 30);
    const swing90d = swingLevels(dh, dl, 90);
    const vwapVal = vwap(dh, dl, dc, dv);
    const ichimokuVal = ichimoku(dh, dl, dc);
    const waveTrendVal = waveTrend(h4h, h4l, h4c);
    const prevH = dh[dh.length - 2] ?? dh[dh.length - 1];
    const prevL = dl[dl.length - 2] ?? dl[dl.length - 1];
    const prevC = dc[dc.length - 2] ?? dc[dc.length - 1];
    const pivotsVal = pivotPoints(prevH, prevL, prevC);
    const atr14Val = atr(dh, dl, dc, 14);
    const vp = volumeProfile(dv.slice(-30));
    const high24h = dh[dh.length - 1];
    const low24h = dl[dl.length - 1];
    const change24h = (((price - prevC) / prevC) * 100).toFixed(2);
    return {
      pair: symbol, price,
      ema20: ema20Val, ema50: ema50Val, ema200: ema200Val,
      rsi1h: null, rsi4h: rsi4hVal, rsi1d: rsi1dVal, rsi1w: null,
      rsiDivergence: rsiDiv,
      macd4h: macd4hVal, macd1d: macd(dc),
      bb: bbVal, stoch4h: stoch4hVal, stoch1h: null,
      volAvg30: vp.avg, volRecent: vp.recent, volH1, volH6,
      trend4h: trend4hVal, trend1d: trend1dVal,
      bos,
      sup1: swing7d.support, sup2: swing30d.support, sup3: swing90d.support,
      res1: swing7d.resistance, res2: swing30d.resistance, res3: swing90d.resistance,
      ichimoku: ichimokuVal, waveTrend: waveTrendVal, vwap: vwapVal, pivots: pivotsVal,
      fundingRate: null, lsRatio: null, oiUsd: null,
      fgi: null, btcDom: null,
      atr14: atr14Val, change24h, high24h, low24h,
    };
  } catch { return null; }
}

function simulateTrade(daily: Candles, entryIdx: number, side: "BUY" | "SELL", atr14: number): { pnlPct: number; win: boolean } {
  const entry = daily.closes[entryIdx];
  const riskAmt = atr14 * 1.5;
  const sl = side === "BUY" ? entry - riskAmt : entry + riskAmt;
  const tp = side === "BUY" ? entry + riskAmt * 1.5 : entry - riskAmt * 1.5;
  for (let b = 1; b <= TRADE_MAX_BARS; b++) {
    const idx = entryIdx + b;
    if (idx >= daily.closes.length) break;
    const high = daily.highs[idx];
    const low = daily.lows[idx];
    if (side === "BUY") {
      if (low <= sl) return { pnlPct: ((sl - entry) / entry) * 100, win: false };
      if (high >= tp) return { pnlPct: ((tp - entry) / entry) * 100, win: true };
    } else {
      if (high >= sl) return { pnlPct: ((entry - sl) / entry) * 100, win: false };
      if (low <= tp) return { pnlPct: ((entry - tp) / entry) * 100, win: true };
    }
  }
  const exitIdx = Math.min(entryIdx + TRADE_MAX_BARS, daily.closes.length - 1);
  const exitPrice = daily.closes[exitIdx];
  const pnlPct = side === "BUY" ? ((exitPrice - entry) / entry) * 100 : ((entry - exitPrice) / entry) * 100;
  return { pnlPct, win: pnlPct > 0 };
}

function analyzeComponent(signals: Signal[], key: "trend" | "confluence" | "srLevel" | "volume", maxScore: number) {
  console.log(`\n── Komponen: ${key.toUpperCase()} (maks ${maxScore} poin) ──`);
  const low = signals.filter(s => s[key] < maxScore * 0.4);
  const mid = signals.filter(s => s[key] >= maxScore * 0.4 && s[key] < maxScore * 0.7);
  const high = signals.filter(s => s[key] >= maxScore * 0.7);
  for (const [label, group] of [["Rendah (<40%)", low], ["Sedang (40-70%)", mid], ["Tinggi (>=70%)", high]] as const) {
    if (group.length === 0) { console.log(`  ${label}: (tidak ada data)`); continue; }
    const wins = group.filter(s => s.win).length;
    const wr = (wins / group.length) * 100;
    const avgPnl = group.reduce((s, r) => s + r.pnlPct, 0) / group.length;
    const mark = wr >= 50 && avgPnl > 0 ? "✅" : wr < 40 || avgPnl < -0.5 ? "❌" : "⚠️";
    console.log(`  ${label.padEnd(18)}: ${String(group.length).padEnd(6)} trades | WR ${wr.toFixed(1).padStart(5)}% | AvgPnL ${avgPnl.toFixed(2).padStart(6)}% ${mark}`);
  }
}

async function main() {
  console.log("=".repeat(72));
  console.log("ANALISIS KOMPONEN SCORING — trend, confluence, srLevel, volume");
  console.log("(sentiment/funding/macro di-skip, datanya konstan di backtest historis)");
  console.log("=".repeat(72));

  const allSignals: Signal[] = [];

  for (const pair of PAIRS) {
    process.stdout.write(`\n[${pair}] Fetching daily... `);
    const daily = await fetchKlinesAll(pair, "1d", DAILY_BATCHES);
    console.log(`${daily.closes.length} candles`);
    process.stdout.write(`[${pair}] Fetching 4H... `);
    const h4 = await fetchKlinesAll(pair, "4h", H4_BATCHES);
    console.log(`${h4.closes.length} candles`);

    for (let i = MIN_HISTORY; i < daily.closes.length - TRADE_MAX_BARS - 1; i++) {
      const inp = buildInput(pair, daily, h4, i);
      if (!inp || !inp.atr14) continue;
      const { score, bias } = scoreSwing(inp);
      if (bias === "NEUTRAL") continue;
      const side: "BUY" | "SELL" = bias === "BULLISH" ? "BUY" : "SELL";
      const sim = simulateTrade(daily, i, side, inp.atr14);
      allSignals.push({
        side, trend: score.trend, confluence: score.confluence,
        srLevel: score.srLevel, volume: score.volume,
        pnlPct: sim.pnlPct, win: sim.win,
      });
    }
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Total sinyal dianalisis: ${allSignals.length}`);
  console.log("=".repeat(72));

  for (const [label, subset] of [
    ["SEMUA (BUY + SELL)", allSignals],
    ["BUY saja", allSignals.filter(s => s.side === "BUY")],
    ["SELL saja", allSignals.filter(s => s.side === "SELL")],
  ] as const) {
    console.log(`\n${"=".repeat(72)}`);
    console.log(label);
    console.log("=".repeat(72));
    analyzeComponent(subset as Signal[], "trend", 20);
    analyzeComponent(subset as Signal[], "confluence", 20);
    analyzeComponent(subset as Signal[], "srLevel", 20);
    analyzeComponent(subset as Signal[], "volume", 15);
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log("BACA HASILNYA: kalau kelompok 'Tinggi' konsisten lebih baik dari 'Rendah'");
  console.log("(WR lebih tinggi DAN AvgPnL lebih positif), komponen itu prediktif — pertahankan.");
  console.log("Kalau 'Tinggi' malah SAMA atau LEBIH JELEK dari 'Rendah', komponen itu noise —");
  console.log("kandidat untuk dikurangi bobotnya atau dihapus.");
  console.log("=".repeat(72));
}

main().catch(console.error);
