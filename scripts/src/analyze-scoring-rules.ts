/**
 * analyze-scoring-rules.ts
 *
 * Bongkar komponen TREND dan SRLEVEL jadi aturan-aturan individualnya,
 * cek satu-satu mana yang beneran prediktif vs yang "lagging indicator trap".
 *
 * Jalankan:
 *   npx tsx scripts/src/analyze-scoring-rules.ts
 */

import {
  ema, rsi, macd, bollinger, atr, swingLevels, trendStructure,
  volumeProfile, stochastic, detectRsiDivergence,
  bosLevel, vwap, ichimoku, waveTrend, pivotPoints,
} from "../../artifacts/api-server/src/lib/indicators.js";

const PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "DOGEUSDT"];
const DAILY_BATCHES = 4;
const H4_BATCHES = 5;
const MIN_HISTORY = 200;
const TRADE_MAX_BARS = 10;

interface Candles {
  opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; times: number[];
}

interface RuleFlags {
  side: "BUY" | "SELL";
  emaStackFull: boolean;      // EMA20>50>200 (atau kebalikannya) sejajar SEMPURNA
  priceVsEma200Only: boolean; // cuma price vs ema200, EMA lain belum sejajar (early stage)
  ichimokuAligned: boolean;
  trend4hAligned: boolean;
  nearSupOrRes: boolean;      // dekat support(BUY)/resistance(SELL) kuat
  nearBB: boolean;
  bosConfirmed: boolean;
  pnlPct: number;
  win: boolean;
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

function printRuleStat(label: string, fired: RuleFlags[], notFired: RuleFlags[]) {
  const stat = (group: RuleFlags[]) => {
    if (group.length === 0) return "  (tidak ada data)";
    const wins = group.filter(s => s.win).length;
    const wr = (wins / group.length) * 100;
    const avgPnl = group.reduce((s, r) => s + r.pnlPct, 0) / group.length;
    const mark = wr >= 50 && avgPnl > 0 ? "✅" : wr < 40 || avgPnl < -0.5 ? "❌" : "⚠️";
    return `${String(group.length).padEnd(6)} trades | WR ${wr.toFixed(1).padStart(5)}% | AvgPnL ${avgPnl.toFixed(2).padStart(6)}% ${mark}`;
  };
  console.log(`\n── ${label} ──`);
  console.log(`  Aturan AKTIF     : ${stat(fired)}`);
  console.log(`  Aturan TIDAK aktif: ${stat(notFired)}`);
}

async function main() {
  console.log("=".repeat(72));
  console.log("ANALISIS ATURAN INDIVIDUAL — mana yang beneran prediktif?");
  console.log("=".repeat(72));

  const allFlags: RuleFlags[] = [];

  for (const pair of PAIRS) {
    process.stdout.write(`\n[${pair}] Fetching daily... `);
    const daily = await fetchKlinesAll(pair, "1d", DAILY_BATCHES);
    console.log(`${daily.closes.length} candles`);
    process.stdout.write(`[${pair}] Fetching 4H... `);
    const h4 = await fetchKlinesAll(pair, "4h", H4_BATCHES);
    console.log(`${h4.closes.length} candles`);

    for (let i = MIN_HISTORY; i < daily.closes.length - TRADE_MAX_BARS - 1; i++) {
      const dc = daily.closes.slice(0, i + 1);
      const dh = daily.highs.slice(0, i + 1);
      const dl = daily.lows.slice(0, i + 1);
      const dailyOpenTs = daily.times[i];
      let h4EndIdx = h4.times.findIndex(t => t > dailyOpenTs);
      if (h4EndIdx === -1) h4EndIdx = h4.closes.length;
      const h4c = h4.closes.slice(0, h4EndIdx);
      const h4h = h4.highs.slice(0, h4EndIdx);
      const h4l = h4.lows.slice(0, h4EndIdx);
      if (dc.length < 50 || h4c.length < 50) continue;
      const price = dc[dc.length - 1];

      try {
        const ema20Val = ema(dc, Math.min(20, dc.length - 1));
        const ema50Val = ema(dc, Math.min(50, dc.length - 1));
        const ema200Val = ema(dc, Math.min(200, dc.length - 1));
        const ema50_4h = ema(h4c, Math.min(50, h4c.length - 1));
        const ema200_4h = ema(h4c, Math.min(200, h4c.length - 1));
        const trend4hVal = trendStructure(ema50_4h, ema200_4h, h4c[h4c.length - 1]);
        const ichimokuVal = ichimoku(dh, dl, dc);
        const bbVal = bollinger(dc, 20, 2);
        const swing7d = swingLevels(h4h, h4l, 42);
        const swing30d = swingLevels(dh, dl, 30);
        const bos = bosLevel(h4h, h4l, h4c, 20);
        const atr14Val = atr(dh, dl, dc, 14);
        if (!atr14Val || !ema20Val || !ema50Val || !ema200Val) continue;

        // Tentukan bias sederhana: bullish kalau price > ema200, bearish kalau sebaliknya
        const bullishBias = price > ema200Val;
        const side: "BUY" | "SELL" = bullishBias ? "BUY" : "SELL";

        const emaStackFull = bullishBias
          ? (price > ema20Val && ema20Val > ema50Val && ema50Val > ema200Val)
          : (price < ema20Val && ema20Val < ema50Val && ema50Val < ema200Val);
        const priceVsEma200Only = !emaStackFull; // early stage: cuma price vs 200 yg align, belum full stack

        const ichimokuAligned = bullishBias
          ? (ichimokuVal?.priceVsCloud === "ABOVE" && ichimokuVal?.trend === "BULLISH")
          : (ichimokuVal?.priceVsCloud === "BELOW" && ichimokuVal?.trend === "BEARISH");

        const trend4hAligned = bullishBias ? trend4hVal === "BULLISH" : trend4hVal === "BEARISH";

        const nearSupOrRes = bullishBias
          ? Math.abs(price - swing7d.support) < atr14Val * 1.5
          : Math.abs(price - swing7d.resistance) < atr14Val * 1.5;

        const nearBB = bullishBias
          ? (bbVal && Math.abs(price - bbVal.lower) < atr14Val)
          : (bbVal && Math.abs(price - bbVal.upper) < atr14Val);

        const bosConfirmed = bullishBias ? bos.direction === "BULLISH" : bos.direction === "BEARISH";

        const sim = simulateTrade(daily, i, side, atr14Val);
        allFlags.push({
          side, emaStackFull, priceVsEma200Only, ichimokuAligned, trend4hAligned,
          nearSupOrRes, nearBB: !!nearBB, bosConfirmed,
          pnlPct: sim.pnlPct, win: sim.win,
        });
      } catch { continue; }
    }
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Total sinyal dianalisis: ${allFlags.length}`);
  console.log("=".repeat(72));

  for (const [label, subset] of [
    ["SEMUA (BUY + SELL)", allFlags],
    ["BUY saja", allFlags.filter(s => s.side === "BUY")],
    ["SELL saja", allFlags.filter(s => s.side === "SELL")],
  ] as const) {
    console.log(`\n${"=".repeat(72)}`);
    console.log(label);
    console.log("=".repeat(72));

    printRuleStat(
      "EMA Stack SEMPURNA (price>20>50>200 atau kebalikannya)",
      subset.filter(s => s.emaStackFull), subset.filter(s => !s.emaStackFull)
    );
    printRuleStat(
      "Cuma price vs EMA200 (early stage, EMA lain belum sejajar)",
      subset.filter(s => s.priceVsEma200Only), subset.filter(s => !s.priceVsEma200Only)
    );
    printRuleStat(
      "Ichimoku aligned (cloud + trend searah)",
      subset.filter(s => s.ichimokuAligned), subset.filter(s => !s.ichimokuAligned)
    );
    printRuleStat(
      "4H trend structure searah",
      subset.filter(s => s.trend4hAligned), subset.filter(s => !s.trend4hAligned)
    );
    printRuleStat(
      "Dekat support/resistance kuat (S/R 7 hari)",
      subset.filter(s => s.nearSupOrRes), subset.filter(s => !s.nearSupOrRes)
    );
    printRuleStat(
      "Dekat Bollinger Band (upper/lower)",
      subset.filter(s => s.nearBB), subset.filter(s => !s.nearBB)
    );
    printRuleStat(
      "BOS (Break of Structure) terkonfirmasi",
      subset.filter(s => s.bosConfirmed), subset.filter(s => !s.bosConfirmed)
    );
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log("BACA HASILNYA: kalau 'Aturan AKTIF' konsisten LEBIH BAIK dari 'TIDAK aktif',");
  console.log("aturan itu prediktif — pertahankan/naikkan bobot. Kalau SAMA/LEBIH JELEK,");
  console.log("aturan itu noise atau bahkan 'late entry trap' — turunkan bobot atau balik logikanya.");
  console.log("=".repeat(72));
}

main().catch(console.error);
