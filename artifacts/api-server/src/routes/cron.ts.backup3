import { Router } from "express";
import { eq, inArray, and } from "drizzle-orm";
import { SUPPORTED_PAIRS } from "../../../nexusalpha/lib/types";
import { computeRealtimeSignal } from "../lib/signal-engine-realtime";
import { db, ohlcvDaily, signalLog, memeSignalLog } from "@workspace/db";

const router = Router();

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "305425021";
const MEME_TELEGRAM_API = `https://api.telegram.org/bot${process.env.MEME_TELEGRAM_BOT_TOKEN}`;
const MEME_CHAT_ID = process.env.MEME_TELEGRAM_CHAT_ID ?? "305425021";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:10000";


// ─── RETRY HELPER UNTUK TELEGRAM (atasi ConnectTimeoutError) ─────────────────
async function sendWithRetry(
  url: string,
  payload: any,
  label: string,
  maxRetries = 3,
): Promise<any> {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(`Telegram sendMessage failed: ${json?.description ?? res.statusText}`);
      }
      if (attempt > 1) {
        console.log(`[${label}] ✅ Berhasil setelah retry ke-${attempt}`);
      }
      return json;
    } catch (err) {
      lastErr = err;
      console.error(`[${label}] ⚠️ Percobaan ${attempt}/${maxRetries} gagal:`, (err as Error).message);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, attempt * 2000)); // 2s, 4s, ...
      }
    }
  }
  console.error(`[${label}] ❌ Gagal total setelah ${maxRetries}x percobaan.`);
  throw lastErr;
}

async function sendMemeTelegram(text: string): Promise<void> {
  await sendWithRetry(
    `${MEME_TELEGRAM_API}/sendMessage`,
    {
      chat_id: MEME_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    },
    "MEME-TELEGRAM",
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendTelegram(text: string): Promise<void> {
  await sendWithRetry(
    `${TELEGRAM_API}/sendMessage`,
    {
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    },
    "TELEGRAM",
  );
}

function fmtPrice(n: number | null): string {
  if (n === null) return "N/A";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

// ─── FORWARD TESTING: SAVE SIGNAL TO DB ──────────────────────────────────────
async function saveSignalToLog(signal: {
  pair: string;
  side: "BUY" | "SELL" | "NO_TRADE";
  confidence: number;
  price: number;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
}) {
  try {
    // Cegah duplikat: skip kalau pair ini masih punya signal yang belum closed (sama arahnya)
    const existing = await (db as any)
      .select()
      .from(signalLog)
      .where(
        and(
          eq(signalLog.pair, signal.pair),
          eq(signalLog.side, signal.side),
          inArray(signalLog.status, ["OPEN", "TP1_HIT", "TP2_HIT"]),
        ),
      );

    if (existing.length > 0) {
      console.log(`[SIGNAL-LOG] ⏭️ Skip ${signal.pair} ${signal.side} — masih ada signal OPEN yang sama (id #${existing[0].id})`);
      return;
    }

    await (db as any).insert(signalLog).values({
      pair: signal.pair,
      side: signal.side,
      confidence: signal.confidence,
      entryPrice: signal.price,
      sl: signal.sl,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      status: "OPEN",
    });
    console.log(`[SIGNAL-LOG] ✅ Saved ${signal.pair} ${signal.side} @ ${signal.price}`);
  } catch (err) {
    console.error(`[SIGNAL-LOG] Error saving ${signal.pair}:`, err);
  }
}

async function runSignalScan() {
  console.log(`[CRON] Starting REAL-TIME RULE-BASED signal scan for ${SUPPORTED_PAIRS.length} pairs...`);

  for (const pair of SUPPORTED_PAIRS) {
    try {
      await new Promise((r) => setTimeout(r, 2000));
      const signal = await computeRealtimeSignal(pair);

      console.log(`[CRON] ${pair} → confidence: ${signal.confidence}, side: ${signal.side}, bias: ${signal.bias}`);

      if (signal.side !== "NO_TRADE") {
        const sideLabel = signal.side === "BUY" ? "🟢 BUY/LONG" : "🔴 SELL/SHORT";
        const emoji = signal.side === "BUY" ? "📈" : "📉";

        let msg = `${emoji} <b>AUTO SIGNAL — NEXUSALPHA (Rule-Based)</b>\n`;
        msg += `━━━━━━━━━━━━━━━\n`;
        msg += `<b>Pair:</b> ${signal.pair}\n`;
        msg += `<b>Signal:</b> ${sideLabel}\n`;
        const sweetSpotLabel = signal.side === "BUY" ? "BUY zone 50–55" : "SELL zone 0–45";
        msg += `<b>Confidence:</b> ${signal.confidence}/100 🎯 (${sweetSpotLabel})\n`;
        msg += `<b>Price:</b> $${fmtPrice(signal.price)}\n\n`;

        msg += `<b>📍 Entry:</b> ~$${fmtPrice(signal.price)}\n`;
        msg += `<b>🛑 Stop Loss:</b> $${fmtPrice(signal.sl)}\n`;
        msg += `<b>🎯 Take Profit:</b>\n`;
        msg += `  TP1: $${fmtPrice(signal.tp1)} (1:1.5)\n`;
        msg += `  TP2: $${fmtPrice(signal.tp2)} (1:2.5)\n`;
        msg += `  TP3: $${fmtPrice(signal.tp3)} (1:4.0)\n\n`;

        if (signal.confluences.length > 0) {
          msg += `<b>📌 Confluences:</b>\n`;
          signal.confluences.slice(0, 5).forEach((c) => (msg += `  • ${escapeHtml(c)}\n`));
          msg += `\n`;
        }

        msg += `<i>⏰ ${new Date().toLocaleString("id-ID")}</i>\n`;
        msg += `━━━━━━━━━━━━━━━\n`;
        msg += `<i>🤖 Rule-based engine — backtested, deterministic</i>`;

        await sendTelegram(msg);
        console.log(`[CRON] ✅ Signal sent for ${pair}`);

        // Forward testing: simpan signal ke DB untuk dicek hasilnya nanti
        await saveSignalToLog(signal);

        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      console.error(`[CRON] Error processing ${pair}:`, err);
    }
  }

  console.log(`[CRON] Scan complete.`);
}

export function startCron() {
  const INTERVAL_MS = 10 * 60 * 1000;
  console.log(`[CRON] Auto-signal scanner started. Interval: ${INTERVAL_MS / 1000}s`);

  runSignalScan();
  setInterval(runSignalScan, INTERVAL_MS);
}

router.post("/run", async (_req, res) => {
  runSignalScan();
  res.json({ status: "scan started" });
});

// ─── FORWARD TESTING: CHECK OPEN SIGNALS (TP/SL HIT?) ───────────────────────
async function fetchCurrentPrice(pair: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${pair}`);
    const json = (await res.json()) as any;
    if (json.retCode !== 0) return null;
    const ticker = json.result?.list?.[0];
    if (!ticker) return null;
    return parseFloat(ticker.lastPrice);
  } catch {
    return null;
  }
}

async function checkOpenSignals() {
  console.log("[SIGNAL-CHECK] Checking open signals...");
  try {
    const openSignals = await (db as any)
      .select()
      .from(signalLog)
      .where(inArray(signalLog.status, ["OPEN", "TP1_HIT", "TP2_HIT"]));

    if (openSignals.length === 0) {
      console.log("[SIGNAL-CHECK] No open signals.");
      return;
    }

    // Cache harga per pair biar tidak fetch berkali-kali untuk pair yang sama
    const priceCache = new Map<string, number | null>();

    for (const sig of openSignals) {
      if (!priceCache.has(sig.pair)) {
        priceCache.set(sig.pair, await fetchCurrentPrice(sig.pair));
        await new Promise((r) => setTimeout(r, 300));
      }
      const currentPrice = priceCache.get(sig.pair);
      if (currentPrice === null || currentPrice === undefined) continue;

      let newStatus: string | null = null;
      let closed = false;

      if (sig.side === "SELL") {
        // Profit kalau harga TURUN ke TP, rugi kalau harga NAIK ke SL
        if (sig.sl !== null && currentPrice >= sig.sl) {
          newStatus = "SL_HIT"; closed = true;
        } else if (sig.tp3 !== null && currentPrice <= sig.tp3) {
          newStatus = "TP3_HIT"; closed = true;
        } else if (sig.tp2 !== null && currentPrice <= sig.tp2 && sig.status !== "TP2_HIT") {
          newStatus = "TP2_HIT";
        } else if (sig.tp1 !== null && currentPrice <= sig.tp1 && sig.status === "OPEN") {
          newStatus = "TP1_HIT";
        }
      } else if (sig.side === "BUY") {
        // Profit kalau harga NAIK ke TP, rugi kalau harga TURUN ke SL
        if (sig.sl !== null && currentPrice <= sig.sl) {
          newStatus = "SL_HIT"; closed = true;
        } else if (sig.tp3 !== null && currentPrice >= sig.tp3) {
          newStatus = "TP3_HIT"; closed = true;
        } else if (sig.tp2 !== null && currentPrice >= sig.tp2 && sig.status !== "TP2_HIT") {
          newStatus = "TP2_HIT";
        } else if (sig.tp1 !== null && currentPrice >= sig.tp1 && sig.status === "OPEN") {
          newStatus = "TP1_HIT";
        }
      }

      if (newStatus) {
        await (db as any)
          .update(signalLog)
          .set({
            status: newStatus,
            ...(closed ? { closedPrice: currentPrice, closedAt: new Date() } : {}),
          })
          .where(eq(signalLog.id, sig.id));
        console.log(`[SIGNAL-CHECK] ${sig.pair} #${sig.id} → ${newStatus} @ ${currentPrice}`);
      }
    }

    console.log("[SIGNAL-CHECK] Done.");
  } catch (err) {
    console.error("[SIGNAL-CHECK] Error:", err);
  }
}

export function startSignalCheckCron() {
  const INTERVAL_MS = 15 * 60 * 1000; // tiap 15 menit
  console.log(`[SIGNAL-CHECK] Forward-test checker started. Interval: ${INTERVAL_MS / 1000}s`);
  checkOpenSignals();
  setInterval(checkOpenSignals, INTERVAL_MS);
}

// ─── MEME COIN FORWARD TESTING ────────────────────────────────────────────────
async function saveMemeSignalToLog(coin: any, triggerLabel: string) {
  try {
    const existing = await (db as any)
      .select()
      .from(memeSignalLog)
      .where(and(eq(memeSignalLog.coinId, String(coin.id)), eq(memeSignalLog.status, "TRACKING")));

    if (existing.length > 0) {
      console.log(`[MEME-LOG] ⏭️ Skip ${coin.symbol} — masih TRACKING (id #${existing[0].id})`);
      return;
    }

    const price = parseFloat(String(coin.price)) || 0;
    if (price <= 0) {
      console.log(`[MEME-LOG] ⏭️ Skip ${coin.symbol} — harga tidak valid`);
      return;
    }

    await (db as any).insert(memeSignalLog).values({
      coinId: String(coin.id),
      name: coin.name,
      symbol: coin.symbol,
      network: coin.network,
      contractAddress: coin.contractAddress ?? "",
      initialPrice: price,
      initialMcap: coin.marketCap ? parseFloat(String(coin.marketCap)) || null : null,
      initialLiquidity: coin.liquidity ? parseFloat(String(coin.liquidity)) || null : null,
      earlyGemScore: coin.earlyGemScore ?? null,
      buyVerdict: coin.buyVerdict ?? null,
      triggerLabel,
      lastPrice: price,
      athPrice: price,
      athMultiplier: 1,
      status: "TRACKING",
    });
    console.log(`[MEME-LOG] ✅ Saved ${coin.symbol} @ $${price}`);
  } catch (err) {
    console.error(`[MEME-LOG] Error saving ${coin.symbol}:`, err);
  }
}

async function fetchDexScreenerData(contractAddress: string): Promise<{ price: number; liquidity: number; mcap: number } | null> {
  try {
    if (!contractAddress) return null;
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const pairs = json?.pairs;
    if (!pairs || pairs.length === 0) return null;
    // Ambil pair dengan liquidity terbesar (paling representatif)
    const best = pairs.reduce((a: any, b: any) =>
      (parseFloat(b?.liquidity?.usd ?? "0") > parseFloat(a?.liquidity?.usd ?? "0") ? b : a)
    );
    return {
      price: parseFloat(best.priceUsd ?? "0"),
      liquidity: parseFloat(best?.liquidity?.usd ?? "0"),
      mcap: parseFloat(best.fdv ?? best.marketCap ?? "0"),
    };
  } catch {
    return null;
  }
}

async function checkMemeSignals() {
  console.log("[MEME-CHECK] Checking tracked meme signals...");
  try {
    const tracking = await (db as any)
      .select()
      .from(memeSignalLog)
      .where(eq(memeSignalLog.status, "TRACKING"));

    if (tracking.length === 0) {
      console.log("[MEME-CHECK] No coins being tracked.");
      return;
    }

    const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const sig of tracking) {
      await new Promise((r) => setTimeout(r, 300)); // jaga rate limit DexScreener

      const detectedTime = sig.detectedAt ? new Date(sig.detectedAt).getTime() : now;
      if (now - detectedTime > SIXTY_DAYS_MS) {
        await (db as any)
          .update(memeSignalLog)
          .set({ status: "STOPPED", lastCheckedAt: new Date() })
          .where(eq(memeSignalLog.id, sig.id));
        console.log(`[MEME-CHECK] ⏹️ ${sig.symbol} — 60 hari tercapai, stop tracking`);
        continue;
      }

      const data = await fetchDexScreenerData(sig.contractAddress);
      if (!data || data.price <= 0) {
        console.log(`[MEME-CHECK] ⚠️ ${sig.symbol} — data DexScreener tidak tersedia, skip`);
        continue;
      }

      const newAth = Math.max(sig.athPrice ?? sig.initialPrice, data.price);
      const athMultiplier = newAth / sig.initialPrice;
      const isDead = data.liquidity < 1000;

      await (db as any)
        .update(memeSignalLog)
        .set({
          lastPrice: data.price,
          lastMcap: data.mcap || null,
          lastLiquidity: data.liquidity,
          athPrice: newAth,
          athMultiplier,
          lastCheckedAt: new Date(),
          status: isDead ? "DEAD" : "TRACKING",
        })
        .where(eq(memeSignalLog.id, sig.id));

      console.log(`[MEME-CHECK] ${sig.symbol} → price $${data.price}, ATH x${athMultiplier.toFixed(2)}${isDead ? " — DEAD (liquidity habis)" : ""}`);
    }

    console.log("[MEME-CHECK] Done.");
  } catch (err) {
    console.error("[MEME-CHECK] Error:", err);
  }
}

export function startMemeSignalCheckCron() {
  const INTERVAL_6H = 6 * 60 * 60 * 1000;
  console.log(`[MEME-CHECK] Meme forward-test checker started. Interval: ${INTERVAL_6H / 1000}s`);
  checkMemeSignals();
  setInterval(checkMemeSignals, INTERVAL_6H);
}

router.get("/meme-results", async (_req, res) => {
  try {
    const all = await (db as any).select().from(memeSignalLog);
    const withMultiplier = all.filter((c: any) => c.athMultiplier !== null);
    const total = all.length;
    const dead = all.filter((c: any) => c.status === "DEAD").length;
    const above2x = withMultiplier.filter((c: any) => c.athMultiplier >= 2).length;
    const above5x = withMultiplier.filter((c: any) => c.athMultiplier >= 5).length;
    const above10x = withMultiplier.filter((c: any) => c.athMultiplier >= 10).length;
    const topPerformers = [...all]
      .sort((a: any, b: any) => (b.athMultiplier ?? 0) - (a.athMultiplier ?? 0))
      .slice(0, 10)
      .map((c: any) => ({ symbol: c.symbol, name: c.name, athMultiplier: c.athMultiplier, status: c.status }));

    res.json({
      total,
      dead,
      deadPct: total > 0 ? ((dead / total) * 100).toFixed(1) + "%" : "N/A",
      above2xPct: total > 0 ? ((above2x / total) * 100).toFixed(1) + "%" : "N/A",
      above5xPct: total > 0 ? ((above5x / total) * 100).toFixed(1) + "%" : "N/A",
      above10xPct: total > 0 ? ((above10x / total) * 100).toFixed(1) + "%" : "N/A",
      topPerformers,
      allSignals: all,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/results", async (_req, res) => {
  try {
    const all = await (db as any).select().from(signalLog);
    const closed = all.filter((s: any) => s.status === "TP3_HIT" || s.status === "SL_HIT");
    const wins = closed.filter((s: any) => s.status !== "SL_HIT").length;
    const total = closed.length;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "N/A";
    res.json({ total, wins, losses: total - wins, winRate, signals: all });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;

// ─── DAILY OHLCV SAVE ────────────────────────────────────────────────────────
async function saveLatestDailyCandles() {
  console.log("[DAILY-SAVE] Saving latest daily candles...");
  for (const pair of SUPPORTED_PAIRS) {
    try {
      await new Promise(r => setTimeout(r, 500));
      const res  = await fetch(
        `https://api.bybit.com/v5/market/kline?category=spot&symbol=${pair}&interval=D&limit=3`
      );
      const json = (await res.json()) as any;
      if (json.retCode !== 0) continue;

      const raw: any[] = json.result?.list ?? [];
      const k = raw[1];
      if (!k) continue;

      await (db as any).insert(ohlcvDaily).values({
        pair,
        timestampMs: parseInt(k[0], 10),
        open:   k[1],
        high:   k[2],
        low:    k[3],
        close:  k[4],
        volume: k[5],
      }).onConflictDoNothing();

      console.log(`[DAILY-SAVE] ✅ ${pair}`);
    } catch (err) {
      console.error(`[DAILY-SAVE] Error ${pair}:`, err);
    }
  }
  console.log("[DAILY-SAVE] Done.");
}

export function startDailySaveCron() {
  const INTERVAL_24H = 24 * 60 * 60 * 1000;
  saveLatestDailyCandles();
  setInterval(saveLatestDailyCandles, INTERVAL_24H);
  console.log("[DAILY-SAVE] Daily candle saver started (interval 24h)");
}

// ─── MEME COIN CRON ───────────────────────────────────────────────────────────
const memeCooldown = new Map<string, number>();
const MEME_COOLDOWN_MS = 30 * 60 * 1000;
const MEME_INTERVAL_MS = 15 * 60 * 1000;

async function runMemeScan() {
  console.log("[MEME-CRON] Starting meme coin scan...");
  try {
    const res = await fetch(`${BASE_URL}/api/ai/memes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (!res.ok) {
      console.error(`[MEME-CRON] Failed to fetch memes: ${res.status}`);
      return;
    }
    const coins = (await res.json()) as any[];
    console.log(`[MEME-CRON] Fetched ${coins.length} coins`);

    const now = Date.now();
    let sent = 0;

    for (const coin of coins) {
      const isGem = coin.earlyGemLabel === "GEM";
      const isPump = coin.volumeSignal === "PUMP_IMMINENT";
      if (!isGem && !isPump) continue;

      if (coin.buyVerdict === "HINDARI") {
        console.log(`[MEME-CRON] ⛔ Skipped (HINDARI): ${coin.name} — ${coin.buySummary}`);
        continue;
      }

      const lastSent = memeCooldown.get(coin.id) ?? 0;
      if (now - lastSent < MEME_COOLDOWN_MS) continue;

      const label = isGem && isPump
        ? "🚀 GEM + PUMP IMMINENT"
        : isGem
          ? "💎 EARLY GEM"
          : "🚀 PUMP IMMINENT";

      const verdictEmoji = coin.buyVerdict === "LAYAK_BELI" ? "✅" : "⚠️";
      const verdictLabel = coin.buyVerdict === "LAYAK_BELI" ? "LAYAK BELI" : "WASPADA";

      let msg = `${label} — <b>NEXUSALPHA MEME SCANNER</b>\n`;
      msg += `━━━━━━━━━━━━━━━\n`;
      msg += `${verdictEmoji} <b>Verdict: ${verdictLabel}</b> (${coin.buyScore ?? "—"}/100)\n`;
      msg += `<i>${escapeHtml(coin.buySummary ?? "—")}</i>\n\n`;
      msg += `<b>Coin:</b> ${escapeHtml(coin.name)} (${escapeHtml(coin.symbol)})\n`;
      msg += `<b>Network:</b> ${escapeHtml(coin.network)}\n`;
      msg += `<b>Price:</b> $${escapeHtml(String(coin.price))}\n`;
      msg += `<b>Market Cap:</b> $${escapeHtml(coin.marketCap ?? "—")}\n`;
      msg += `<b>Liquidity:</b> $${escapeHtml(coin.liquidity ?? "—")}\n`;
      msg += `<b>Age:</b> ${coin.ageInDays ?? "—"} hari\n\n`;
      if (coin.buyReasons?.length > 0) {
        msg += `<b>✅ Alasan Positif:</b>\n`;
        coin.buyReasons.slice(0, 3).forEach((s: string) => (msg += `  • ${escapeHtml(s)}\n`));
        msg += `\n`;
      }
      if (coin.buyRedFlags?.length > 0) {
        msg += `<b>🚩 Red Flags:</b>\n`;
        coin.buyRedFlags.slice(0, 3).forEach((w: string) => (msg += `  • ${escapeHtml(w)}\n`));
        msg += `\n`;
      }
      msg += `<b>📊 Scores:</b>\n`;
      msg += `  Early Gem: ${coin.earlyGemScore ?? "—"}/100\n`;
      msg += `  Viral: ${coin.viralScore ?? "—"}/100\n`;
      msg += `  Organic: ${coin.organicScore ?? "—"}/100\n\n`;
      msg += `<b>🔗 Chart:</b> ${escapeHtml(coin.dexUrl ?? "—")}\n`;
      if (coin.twitter) msg += `<b>🐦 Twitter:</b> ${escapeHtml(coin.twitter)}\n`;
      if (coin.telegram) msg += `<b>📢 Telegram:</b> ${escapeHtml(coin.telegram)}\n`;
      msg += `<i>⏰ ${new Date().toLocaleString("id-ID")}</i>\n`;
      msg += `━━━━━━━━━━━━━━━\n`;
      msg += `<i>🤖 NexusAlpha Meme Scanner — DYOR, high risk</i>`;

      await sendMemeTelegram(msg);
      memeCooldown.set(coin.id, now);
      sent++;

      // Forward testing: simpan coin ke meme_signal_log untuk dipantau ATH-nya
      await saveMemeSignalToLog(coin, label.includes("GEM") && label.includes("PUMP") ? "BOTH" : isGem ? "GEM" : "PUMP_IMMINENT");
      console.log(`[MEME-CRON] ✅ Alert sent: ${coin.name} (${coin.symbol})`);
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log(`[MEME-CRON] Scan complete. ${sent} alerts sent.`);
  } catch (err) {
    console.error("[MEME-CRON] Error:", err);
  }
}

export function startMemeCron() {
  console.log(`[MEME-CRON] Meme scanner started. Interval: ${MEME_INTERVAL_MS / 1000}s`);
  runMemeScan();
  setInterval(runMemeScan, MEME_INTERVAL_MS);
}
