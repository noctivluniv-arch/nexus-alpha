/**
 * Component-level edge test untuk kondisi scalp (1H).
 * Untuk setiap dari 16 kondisi boolean (8 dipakai untuk LONG, 8 untuk SHORT
 * di scoreScalp), hitung: ketika kondisi TRUE, apa forward return rata-rata
 * & win rate dibanding overall baseline?
 *
 * Tambahan: hitung juga "VWAP intraday" (rolling 24x 1H = 1 hari) sebagai
 * kandidat pengganti cumulative-VWAP yang bermasalah.
 *
 * Usage: npx tsx scripts/backtest-scalp-components.ts
 */

import {
  ema, rsi, macd, bollinger, atr, swingLevels, trendStructure,
  stochastic, waveTrend,
} from "../src/lib/indicators";

interface Candles {
  opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; closeTime: number[];
}

async function fetchKlines(symbol: string, interval: string, totalWanted: number): Promise<Candles> {
  const c: Candles = { opens: [], highs: [], lows: [], closes: [], volumes: [], closeTime: [] };
  let endTime: number | undefined = undefined;
  while (c.closes.length < totalWanted) {
    const remaining = totalWanted - c.closes.length;
    const batchLimit = Math.min(1000, remaining);
    let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${batchLimit}`;
    if (endTime !== undefined) url += `&endTime=${endTime}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance API error ${res.status}`);
    const raw: any[] = await res.json();
    if (raw.length === 0) break;
    const batch: Candles = { opens: [], highs: [], lows: [], closes: [], volumes: [], closeTime: [] };
    for (const k of raw) {
      batch.opens.push(parseFloat(k[1]));
      batch.highs.push(parseFloat(k[2]));
      batch.lows.push(parseFloat(k[3]));
      batch.closes.push(parseFloat(k[4]));
      batch.volumes.push(parseFloat(k[5]));
      batch.closeTime.push(k[6]);
    }
    c.opens = [...batch.opens, ...c.opens];
    c.highs = [...batch.highs, ...c.highs];
    c.lows = [...batch.lows, ...c.lows];
    c.closes = [...batch.closes, ...c.closes];
    c.volumes = [...batch.volumes, ...c.volumes];
    c.closeTime = [...batch.closeTime, ...c.closeTime];
    if (raw.length < batchLimit) break;
    endTime = raw[0][0] - 1;
    await new Promise((r) => setTimeout(r, 200));
  }
  return c;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(3)}%`;
}

interface Row {
  pair: string;
  conditions: Record<string, boolean>;
  fwdReturns: Record<number, number>; // raw forward return (not direction-adjusted)
}

async function processPair(symbol: string, horizonsH: number[]): Promise<Row[]> {
  const h1 = await fetchKlines(symbol, "1h", 4000);
  const h4 = await fetchKlines(symbol, "4h", 1000);
  const daily = await fetchKlines(symbol, "1d", 400);

  const maxHorizon = Math.max(...horizonsH);
  const rows: Row[] = [];
  const minH1Idx = 250;

  for (let i = minH1Idx; i < h1.closes.length - maxHorizon; i++) {
    const h1CloseTime = h1.closeTime[i];

    let h4End = h4.closeTime.findIndex((t) => t > h1CloseTime);
    if (h4End === -1) h4End = h4.closeTime.length;
    if (h4End < 60) continue;

    let dEnd = daily.closeTime.findIndex((t) => t > h1CloseTime);
    if (dEnd === -1) dEnd = daily.closeTime.length;
    if (dEnd < 60) continue;

    const h1c = h1.closes.slice(0, i + 1);
    const h1h = h1.highs.slice(0, i + 1);
    const h1l = h1.lows.slice(0, i + 1);

    const h4c = h4.closes.slice(0, h4End);
    const h4h = h4.highs.slice(0, h4End);
    const h4l = h4.lows.slice(0, h4End);

    const dH = daily.highs.slice(0, dEnd);
    const dL = daily.lows.slice(0, dEnd);

    const price = h1c[h1c.length - 1];

    const rsi1hVal = rsi(h1c, 14);
    const rsi4hVal = rsi(h4c, 14);
    const macd4hVal = macd(h4c);
    const stoch1hVal = stochastic(h1h, h1l, h1c);
    const waveTrendVal = waveTrend(h4h, h4l, h4c);

    const atr14Val = atr(dH, dL, daily.closes.slice(0, dEnd), 14);
    const atr1h = (atr14Val ?? price * 0.015) * 0.4;

    const swing7d = swingLevels(h4h, h4l, 42);

    // Rolling "intraday" VWAP: last 24x 1H bars (~1 day)
    const win = 24;
    const start = Math.max(0, i + 1 - win);
    let cumTPV = 0, cumVol = 0;
    for (let j = start; j <= i; j++) {
      const tp = (h1.highs[j] + h1.lows[j] + h1.closes[j]) / 3;
      cumTPV += tp * h1.volumes[j];
      cumVol += h1.volumes[j];
    }
    const vwapIntraday = cumVol > 0 ? cumTPV / cumVol : price;

    const rsi1hOversold = rsi1hVal !== null && rsi1hVal < 35;
    const rsi1hOverbought = rsi1hVal !== null && rsi1hVal > 65;
    const rsi4hBull = rsi4hVal !== null && rsi4hVal > 45 && rsi4hVal < 70;
    const rsi4hBear = rsi4hVal !== null && rsi4hVal < 55 && rsi4hVal > 30;
    const macd4hBull = macd4hVal !== null && macd4hVal.histogram > 0;
    const macd4hBear = macd4hVal !== null && macd4hVal.histogram < 0;
    const stoch1hBull = stoch1hVal !== null && stoch1hVal.k < 25 && stoch1hVal.k > stoch1hVal.d;
    const stoch1hBear = stoch1hVal !== null && stoch1hVal.k > 75 && stoch1hVal.k < stoch1hVal.d;
    const wtBull = waveTrendVal?.cross === "BULLISH";
    const wtBear = waveTrendVal?.cross === "BEARISH";
    const nearSupport = Math.abs(price - swing7d.support) < atr1h * 2;
    const nearResistance = Math.abs(price - swing7d.resistance) < atr1h * 2;
    const vwapIntradayBull = price > vwapIntraday;
    const vwapIntradayBear = price < vwapIntraday;

    const conditions: Record<string, boolean> = {
      rsi1hOversold, rsi1hOverbought,
      rsi4hBull, rsi4hBear,
      macd4hBull, macd4hBear,
      stoch1hBull, stoch1hBear,
      wtBull, wtBear,
      nearSupport, nearResistance,
      vwapIntradayBull, vwapIntradayBear,
    };

    const fwdReturns: Record<number, number> = {};
    for (const h of horizonsH) {
      const fwdPrice = h1.closes[i + h];
      fwdReturns[h] = (fwdPrice - price) / price;
    }

    rows.push({ pair: symbol, conditions, fwdReturns });
  }

  return rows;
}

async function main() {
  const pairs = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"];
  const horizonsH = [1, 4, 8];

  let allRows: Row[] = [];
  for (const pair of pairs) {
    console.log(`Processing ${pair}...`);
    const rows = await processPair(pair, horizonsH);
    console.log(`  -> ${rows.length} rows`);
    allRows = allRows.concat(rows);
  }

  console.log(`\n\n========== COMPONENT EDGE TEST — n=${allRows.length} ==========\n`);

  const longConditions = ["rsi1hOversold", "rsi4hBull", "macd4hBull", "stoch1hBull", "wtBull", "nearSupport", "vwapIntradayBull"];
  const shortConditions = ["rsi1hOverbought", "rsi4hBear", "macd4hBear", "stoch1hBear", "wtBear", "nearResistance", "vwapIntradayBear"];

  for (const h of horizonsH) {
    console.log(`--- Horizon ${h}h ---`);

    // Baseline: overall avg return regardless of condition
    const baselineAvg = allRows.reduce((a, r) => a + r.fwdReturns[h], 0) / allRows.length;
    const baselineWin = allRows.filter((r) => r.fwdReturns[h] > 0).length / allRows.length;
    console.log(`Baseline (semua data): avg_return=${fmtPct(baselineAvg)}, win_rate(up)=${fmtPct(baselineWin)}\n`);

    console.log("LONG conditions (expect positive return when true):");
    console.log("condition          | n     | %_of_data | avg_return | win_rate | edge_vs_baseline");
    for (const cond of longConditions) {
      const subset = allRows.filter((r) => r.conditions[cond]);
      if (subset.length === 0) { console.log(`${cond.padEnd(19)} | n=0`); continue; }
      const avg = subset.reduce((a, r) => a + r.fwdReturns[h], 0) / subset.length;
      const win = subset.filter((r) => r.fwdReturns[h] > 0).length / subset.length;
      const edge = avg - baselineAvg;
      console.log(`${cond.padEnd(19)} | ${String(subset.length).padEnd(5)} | ${fmtPct(subset.length/allRows.length).padEnd(9)} | ${fmtPct(avg).padEnd(10)} | ${fmtPct(win).padEnd(8)} | ${edge >= 0 ? "+" : ""}${fmtPct(edge)}`);
    }

    console.log("\nSHORT conditions (expect NEGATIVE return when true):");
    console.log("condition          | n     | %_of_data | avg_return | win_rate(down) | edge_vs_baseline");
    for (const cond of shortConditions) {
      const subset = allRows.filter((r) => r.conditions[cond]);
      if (subset.length === 0) { console.log(`${cond.padEnd(19)} | n=0`); continue; }
      const avg = subset.reduce((a, r) => a + r.fwdReturns[h], 0) / subset.length;
      const winDown = subset.filter((r) => r.fwdReturns[h] < 0).length / subset.length;
      const edge = baselineAvg - avg; // positive edge = condition correctly predicts down move
      console.log(`${cond.padEnd(19)} | ${String(subset.length).padEnd(5)} | ${fmtPct(subset.length/allRows.length).padEnd(9)} | ${fmtPct(avg).padEnd(10)} | ${fmtPct(winDown).padEnd(14)} | ${edge >= 0 ? "+" : ""}${fmtPct(edge)}`);
    }
    console.log();
  }

  console.log(`Cara baca:`);
  console.log(`- "edge_vs_baseline" positif & besar -> kondisi ini punya predictive value.`);
  console.log(`- Kondisi dengan edge mendekati 0 atau negatif -> TIDAK berguna, exclude dari scalp logic.`);
  console.log(`- "% of data" tinggi (>40%) berarti kondisi ini hampir selalu true -> tidak selektif,`);
  console.log(`  kontribusi ke "n dari 8" jadi noise (selalu nambah hitungan tanpa info baru).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
