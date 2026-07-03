import { Router } from "express";
import { eq, inArray, and } from "drizzle-orm";
import { SUPPORTED_PAIRS } from "../../../nexusalpha/lib/types";
import { computeRealtimeSignal } from "../lib/signal-engine-realtime";
import { db, ohlcvDaily, signalLog, memeSignalLog, whaleAlerts } from "@workspace/db";

const router = Router();

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "305425021";
const MEME_TELEGRAM_API = `https://api.telegram.org/bot${process.env.MEME_TELEGRAM_BOT_TOKEN}`;
const MEME_CHAT_ID = process.env.MEME_TELEGRAM_CHAT_ID ?? "305425021";
const WHALE_TELEGRAM_API = `https://api.telegram.org/bot${process.env.WHALE_TELEGRAM_BOT_TOKEN}`;
const WHALE_CHAT_ID = process.env.WHALE_TELEGRAM_CHAT_ID ?? "305425021";
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

async function sendWhaleTelegram(text: string): Promise<void> {
  await sendWithRetry(
    `${WHALE_TELEGRAM_API}/sendMessage`,
    {
      chat_id: WHALE_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    },
    "WHALE-TELEGRAM",
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
        // Cooldown: skip kirim Telegram kalau pair+side ini masih ada signal OPEN
        const stillOpen = await (db as any)
          .select()
          .from(signalLog)
          .where(
            and(
              eq(signalLog.pair, signal.pair),
              eq(signalLog.side, signal.side),
              inArray(signalLog.status, ["OPEN", "TP1_HIT", "TP2_HIT"]),
            ),
          );
        if (stillOpen.length > 0) {
          console.log(`[CRON] ⏭️ Skip kirim Telegram ${signal.pair} ${signal.side} — masih ada signal OPEN (id #${stillOpen[0].id})`);
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }

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
      dexUrl: coin.dexUrl ?? null,
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

      // Sanity check: kalau harga baru > 500x dari initial, kemungkinan bug data DexScreener
      // (misal harga dalam denominasi ETH bukan USD, atau pair yang salah)
      // Skip update harga untuk kasus ini supaya data tidak corrupt
      const priceRatio = data.price / sig.initialPrice;
      if (priceRatio > 500) {
        console.log(`[MEME-CHECK] ⚠️ ${sig.symbol} — harga anomali (x${priceRatio.toFixed(0)}), kemungkinan bug DexScreener data, skip`);
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

router.get("/dashboard", (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>NexusAlpha — Forward Test Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, sans-serif; background:#0d1117; color:#e6edf3; margin:0; padding:20px; }
  h1 { font-size:22px; margin-bottom:4px; }
  .sub { color:#8b949e; font-size:13px; margin-bottom:24px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:24px; }
  .card { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:16px; }
  .card .label { font-size:12px; color:#8b949e; margin-bottom:6px; }
  .card .value { font-size:24px; font-weight:700; }
  .card .sublabel { font-size:11px; color:#8b949e; margin-top:4px; }
  .green { color:#3fb950; } .red { color:#f85149; } .yellow { color:#d29922; } .blue { color:#58a6ff; }
  section { margin-bottom:32px; }
  h2 { font-size:16px; border-bottom:1px solid #30363d; padding-bottom:8px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:8px; border-bottom:1px solid #21262d; }
  th { color:#8b949e; font-weight:500; }
  .badge { padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; }
  .badge-open { background:#1f6feb33; color:#58a6ff; }
  .badge-win { background:#3fb95033; color:#3fb950; }
  .badge-loss { background:#f8514933; color:#f85149; }
  .badge-dead { background:#f8514933; color:#f85149; }
  .badge-tracking { background:#d2992233; color:#d29922; }
  .badge-stopped { background:#30363d; color:#8b949e; }
  .pnl-pos { color:#3fb950; font-weight:600; }
  .pnl-neg { color:#f85149; font-weight:600; }
  .pnl-neutral { color:#8b949e; }
  .loading { color:#8b949e; text-align:center; padding:40px; }
  .note { background:#1f2937; border-left:3px solid #d29922; padding:12px 16px; border-radius:4px; font-size:13px; color:#c9d1d9; margin-bottom:24px; }
  .paper-note { background:#161b22; border:1px solid #1f6feb; border-radius:6px; padding:8px 12px; font-size:12px; color:#58a6ff; margin-bottom:16px; display:inline-block; }
</style>
</head>
<body>
  <h1>📊 NexusAlpha — Forward Test Dashboard</h1>
  <div class="sub">Data real dari production, auto-refresh tiap 60 detik. Terakhir diupdate: <span id="ts">-</span></div>
  <div class="note">⚠️ Sample kecil belum bisa disimpulkan. Tunggu minimal 50 trade closed (signal) atau 30-50 coin tracked (meme) sebelum percaya angka ini untuk keputusan nyata.</div>
  <div class="paper-note">🎮 Simulasi Paper Trading — Modal virtual $100 per trade & $100 per coin. Uang tidak nyata, harga nyata.</div>

  <section>
    <h2>🎯 Signal Trading (BUY/SELL)</h2>
    <div class="grid" id="signal-stats"><div class="loading">Memuat...</div></div>
    <table id="signal-table">
      <thead><tr><th>Pair</th><th>Side</th><th>Conf.</th><th>Entry ($)</th><th>Status</th><th>Close ($)</th><th>PnL (dari $100)</th><th>Sent</th></tr></thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>💎 Meme Coin (Early Gem Tracker)</h2>
    <div class="grid" id="meme-stats"><div class="loading">Memuat...</div></div>
    <table id="meme-table">
      <thead><tr><th>Coin</th><th>Network</th><th>Entry ($)</th><th>Harga Skrg ($)</th><th>ATH x</th><th>PnL Skrg</th><th>PnL ATH</th><th>Status</th><th>Detected</th><th>Chart</th></tr></thead>
      <tbody></tbody>
    </table>
  </section>

<script>
const MODAL = 100; // modal virtual per trade/coin

function pnlHtml(pnl) {
  if (pnl === null || isNaN(pnl)) return '<span class="pnl-neutral">—</span>';
  const sign = pnl >= 0 ? '+' : '';
  const cls = pnl > 0 ? 'pnl-pos' : pnl < 0 ? 'pnl-neg' : 'pnl-neutral';
  return '<span class="' + cls + '">' + sign + '$' + pnl.toFixed(2) + '</span>';
}

async function load() {
  document.getElementById('ts').textContent = new Date().toLocaleString('id-ID');

  // ── SIGNAL TRADING ────────────────────────────────────────────────
  try {
    const sigRes = await fetch('/api/cron/results').then(r => r.json());
    
    // Fetch harga terkini untuk semua pair yang masih OPEN (satu per satu, lebih reliable)
    const openPairs = [...new Set(sigRes.signals.map(s => s.pair))];
    let currentPrices = {};
    if (openPairs.length > 0) {
      try {
        const pricePromises = openPairs.map(pair =>
          fetch('/api/binance/ticker?symbol=' + pair)
            .then(r => r.json())
            .then(t => { if (t && t.lastPrice) currentPrices[t.symbol] = parseFloat(t.lastPrice); })
            .catch(() => {})
        );
        await Promise.all(pricePromises);
      } catch(e) { /* harga tidak tersedia, abaikan */ }
    }
    
    let totalPnl = 0;
    let closedCount = 0;
    let winCount = 0;
    let lossCount = 0;
    
    const rows = sigRes.signals.slice().reverse().map(s => {
      let pnl = null;
      let badge = 'badge-open';
      const isClosed = s.status === 'SL_HIT' || s.status === 'TP3_HIT';

      if (isClosed && s.closedPrice && s.entryPrice) {
        // PnL realized — sudah final, tidak berubah lagi
        const pct = s.side === 'SELL'
          ? (s.entryPrice - s.closedPrice) / s.entryPrice
          : (s.closedPrice - s.entryPrice) / s.entryPrice;
        pnl = pct * MODAL;
        totalPnl += pnl;
        closedCount++;
        if (pnl > 0) { winCount++; badge = 'badge-win'; }
        else { lossCount++; badge = 'badge-loss'; }
      }

      // PnL unrealized (hanya untuk posisi yang belum final)
      let unrealizedHint = '';
      if (!isClosed && s.entryPrice) {
        const curPrice = currentPrices[s.pair];
        if (curPrice) {
          const pct = s.side === 'SELL'
            ? (s.entryPrice - curPrice) / s.entryPrice
            : (curPrice - s.entryPrice) / s.entryPrice;
          const unrealizedPnl = pct * MODAL;
          const sign = unrealizedPnl >= 0 ? '+' : '';
          const cls = unrealizedPnl > 0 ? 'pnl-pos' : unrealizedPnl < 0 ? 'pnl-neg' : 'pnl-neutral';
          const pct100 = (pct * 100).toFixed(2);
          let tpSlRef = '';
          if (s.tp1 && s.sl) {
            const potTP1 = s.side === 'SELL'
              ? ((s.entryPrice - s.tp1) / s.entryPrice * MODAL).toFixed(2)
              : ((s.tp1 - s.entryPrice) / s.entryPrice * MODAL).toFixed(2);
            const potSL = s.side === 'SELL'
              ? ((s.sl - s.entryPrice) / s.entryPrice * MODAL).toFixed(2)
              : ((s.entryPrice - s.sl) / s.entryPrice * MODAL).toFixed(2);
            tpSlRef = '<br><span style="font-size:10px;color:#8b949e">TP1: +$' + potTP1 + ' | SL: -$' + potSL + '</span>';
          }
          unrealizedHint = '<span class="' + cls + '">' + sign + '$' + unrealizedPnl.toFixed(2) + ' (' + sign + pct100 + '%)</span><br><span style="font-size:11px;color:#8b949e">@ $' + curPrice + '</span>' + tpSlRef;
        } else if (s.tp1 && s.sl) {
          const potTP1 = s.side === 'SELL'
            ? ((s.entryPrice - s.tp1) / s.entryPrice * MODAL).toFixed(2)
            : ((s.tp1 - s.entryPrice) / s.entryPrice * MODAL).toFixed(2);
          const potSL = s.side === 'SELL'
            ? ((s.sl - s.entryPrice) / s.entryPrice * MODAL).toFixed(2)
            : ((s.entryPrice - s.sl) / s.entryPrice * MODAL).toFixed(2);
          unrealizedHint = '<span class="pnl-neutral" style="font-size:11px">TP1: +$' + potTP1 + ' / SL: -$' + potSL + '</span>';
        }
      }

      return '<tr>' +
        '<td>' + s.pair + '</td>' +
        '<td>' + s.side + '</td>' +
        '<td>' + s.confidence + '</td>' +
        '<td>' + s.entryPrice + '</td>' +
        '<td><span class="badge ' + badge + '">' + s.status + '</span></td>' +
        '<td>' + (s.closedPrice ? '$' + s.closedPrice : '-') + '</td>' +
        '<td>' + (pnl !== null ? pnlHtml(pnl) : unrealizedHint) + '</td>' +
        '<td>' + new Date(s.sentAt).toLocaleString('id-ID') + '</td>' +
        '</tr>';
    });
    
    const winRate = closedCount > 0 ? (winCount / closedCount * 100).toFixed(1) + '%' : 'N/A';
    const sigStats = document.getElementById('signal-stats');
    sigStats.innerHTML =
      '<div class="card"><div class="label">Total Closed</div><div class="value">' + closedCount + '</div><div class="sublabel">dari ' + sigRes.signals.length + ' signal</div></div>' +
      '<div class="card"><div class="label">Wins</div><div class="value green">' + winCount + '</div></div>' +
      '<div class="card"><div class="label">Losses</div><div class="value red">' + lossCount + '</div></div>' +
      '<div class="card"><div class="label">Win Rate</div><div class="value yellow">' + winRate + '</div></div>' +
      '<div class="card"><div class="label">Total PnL</div><div class="value ' + (totalPnl >= 0 ? 'green' : 'red') + '">' + (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(2) + '</div><div class="sublabel">dari modal $' + (sigRes.signals.length * MODAL) + ' virtual</div></div>';
    
    document.querySelector('#signal-table tbody').innerHTML = rows.join('');
  } catch(e) {
    document.getElementById('signal-stats').innerHTML = '<div class="loading">Gagal memuat data signal.</div>';
  }

  // ── MEME COIN ────────────────────────────────────────────────────
  try {
    const memeRes = await fetch('/api/cron/meme-results').then(r => r.json());
    
    let totalMemePnlNow = 0;
    let totalMemePnlAth = 0;
    
    const rows = memeRes.allSignals.slice().reverse().map(c => {
      const badge = c.status === 'DEAD' ? 'badge-dead' : c.status === 'TRACKING' ? 'badge-tracking' : 'badge-stopped';
      
      // PnL sekarang
      let pnlNow = null;
      if (c.status === 'DEAD') {
        pnlNow = -MODAL; // total loss
      } else if (c.lastPrice && c.initialPrice && c.initialPrice > 0) {
        pnlNow = (c.lastPrice / c.initialPrice - 1) * MODAL;
      }
      
      // PnL ATH (best case yang pernah dicapai)
      let pnlAth = null;
      if (c.athMultiplier && c.initialPrice > 0) {
        pnlAth = (c.athMultiplier - 1) * MODAL;
      }
      
      if (pnlNow !== null) totalMemePnlNow += pnlNow;
      if (pnlAth !== null) totalMemePnlAth += pnlAth;
      
      const lastPriceDisplay = c.lastPrice ? '$' + c.lastPrice.toFixed(8) : '-';
      const athDisplay = c.athMultiplier ? 'x' + c.athMultiplier.toFixed(2) : '-';
      
      return '<tr>' +
        '<td>' + c.name + ' (' + c.symbol + ')</td>' +
        '<td>' + c.network + '</td>' +
        '<td>$' + (c.initialPrice ? c.initialPrice.toFixed(8) : '-') + '</td>' +
        '<td>' + lastPriceDisplay + '</td>' +
        '<td>' + athDisplay + '</td>' +
        '<td>' + pnlHtml(pnlNow) + '</td>' +
        '<td>' + pnlHtml(pnlAth) + '</td>' +
        '<td><span class="badge ' + badge + '">' + c.status + '</span></td>' +
        '<td>' + new Date(c.detectedAt).toLocaleString('id-ID') + '</td>' +
        '<td>' + (c.dexUrl ? '<a href="' + c.dexUrl + '" target="_blank" style="color:#58a6ff;font-size:12px">📊 Chart</a>' : '-') + '</td>' +
        '</tr>';
    });
    
    const total = memeRes.total;
    const memeStats = document.getElementById('meme-stats');
    memeStats.innerHTML =
      '<div class="card"><div class="label">Total Tracked</div><div class="value">' + total + '</div><div class="sublabel">Modal virtual $' + (total * MODAL) + '</div></div>' +
      '<div class="card"><div class="label">≥ 2x</div><div class="value green">' + memeRes.above2xPct + '</div></div>' +
      '<div class="card"><div class="label">≥ 5x</div><div class="value green">' + memeRes.above5xPct + '</div></div>' +
      '<div class="card"><div class="label">≥ 10x</div><div class="value green">' + memeRes.above10xPct + '</div></div>' +
      '<div class="card"><div class="label">Dead / Rug</div><div class="value red">' + memeRes.deadPct + '</div></div>' +
      '<div class="card"><div class="label">PnL Sekarang</div><div class="value ' + (totalMemePnlNow >= 0 ? 'green' : 'red') + '">' + (totalMemePnlNow >= 0 ? '+' : '') + '$' + totalMemePnlNow.toFixed(2) + '</div><div class="sublabel">vs modal $' + (total * MODAL) + '</div></div>' +
      '<div class="card"><div class="label">PnL ATH Terbaik</div><div class="value blue">+$' + totalMemePnlAth.toFixed(2) + '</div><div class="sublabel">kalau jual di harga tertinggi</div></div>';
    
    document.querySelector('#meme-table tbody').innerHTML = rows.join('');
  } catch(e) {
    document.getElementById('meme-stats').innerHTML = '<div class="loading">Gagal memuat data meme coin.</div>';
  }
}
load();
setInterval(load, 60000);
</script>
</body>
</html>`);
});

// ─── DEXSCREENER EARLY RADAR ─────────────────────────────────────────────────
const dexRadarCooldown = new Map<string, number>();
const DEX_RADAR_COOLDOWN_MS = 60 * 60 * 1000; // 1 jam per token

interface DexToken {
  tokenAddress: string;
  chainId: string;
  url: string;
  description?: string;
  links?: { type?: string; label?: string; url: string }[];
  amount?: number;
  totalAmount?: number;
  cto?: boolean;
}

async function fetchDexScreenerBoosted(): Promise<DexToken[]> {
  try {
    const res = await fetch("https://api.dexscreener.com/token-boosts/latest/v1", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json() as DexToken[];
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function fetchDexScreenerProfiles(): Promise<DexToken[]> {
  try {
    const res = await fetch("https://api.dexscreener.com/token-profiles/latest/v1", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json() as DexToken[];
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function runDexRadarScan() {
  console.log("[DEX-RADAR] Starting DexScreener early radar scan...");
  try {
    const [boosted, profiles] = await Promise.all([
      fetchDexScreenerBoosted(),
      fetchDexScreenerProfiles(),
    ]);

    console.log(`[DEX-RADAR] Boosted: ${boosted.length}, Profiles: ${profiles.length}`);

    const profileMap = new Map<string, DexToken>();
    for (const p of profiles) {
      profileMap.set(p.tokenAddress.toLowerCase(), p);
    }

    const now = Date.now();
    let sent = 0;

    for (const token of boosted) {
      const addr = token.tokenAddress.toLowerCase();
      const profile = profileMap.get(addr);
      if (!profile) continue;

      const lastSent = dexRadarCooldown.get(addr) ?? 0;
      if (now - lastSent < DEX_RADAR_COOLDOWN_MS) continue;

      const supportedChains = ["solana", "ethereum", "bsc", "base", "arbitrum", "polygon"];
      if (!supportedChains.includes(token.chainId)) continue;

      const allLinks = [...(token.links ?? []), ...(profile.links ?? [])];
      const twitter = allLinks.find(l => l.type === "twitter" || l.url?.includes("twitter.com") || l.url?.includes("x.com"))?.url ?? null;
      const website = allLinks.find(l => l.label === "Website" || (!l.type && l.url?.includes("http")))?.url ?? null;

      if (!twitter && !website) continue;

      const chainLabel = token.chainId.charAt(0).toUpperCase() + token.chainId.slice(1);
      const boostAmount = token.totalAmount ?? token.amount ?? 0;
      const isCto = profile.cto === true;

      let msg = `🔍 <b>EARLY RADAR — DEXSCREENER CROSSMATCH</b>
`;
      msg += `━━━━━━━━━━━━━━━
`;
      msg += `⚡ Token baru terdeteksi aktif marketing:
`;
      msg += `  • Masuk DexScreener Boosted ($${boostAmount} boost)
`;
      msg += `  • Punya Token Profile lengkap
`;
      if (isCto) msg += `  • CTO (Community Takeover)
`;
      msg += `
`;
      msg += `<b>Network:</b> ${escapeHtml(chainLabel)}
`;
      msg += `<b>Address:</b> <code>${escapeHtml(token.tokenAddress)}</code>
`;
      if (profile.description) msg += `<b>Deskripsi:</b> ${escapeHtml(profile.description.slice(0, 100))}
`;
      msg += `
`;
      if (twitter) msg += `<b>🐦 Twitter:</b> ${escapeHtml(twitter)}
`;
      if (website) msg += `<b>🌐 Website:</b> ${escapeHtml(website)}
`;
      msg += `<b>🔗 Chart:</b> ${escapeHtml(token.url)}
`;
      msg += `
`;
      msg += `<i>⏰ ${new Date().toLocaleString("id-ID")}</i>
`;
      msg += `━━━━━━━━━━━━━━━
`;
      msg += `<i>⚠️ SANGAT SPEKULATIF — DYOR, belum ada validasi harga/liquidity. High risk.</i>`;

      try {
        await sendMemeTelegram(msg);
        dexRadarCooldown.set(addr, now);
        sent++;
        console.log(`[DEX-RADAR] ✅ Alert: ${token.tokenAddress.slice(0, 8)}... (${token.chainId})`);
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.error(`[DEX-RADAR] Failed to send alert:`, err);
      }
    }

    console.log(`[DEX-RADAR] Scan complete. ${sent} crossmatch alerts sent.`);
  } catch (err) {
    console.error("[DEX-RADAR] Error:", err);
  }
}

export function startDexRadarCron() {
  const INTERVAL_MS = 15 * 60 * 1000;
  console.log(`[DEX-RADAR] DexScreener early radar started. Interval: ${INTERVAL_MS / 1000}s`);
  runDexRadarScan();
  setInterval(runDexRadarScan, INTERVAL_MS);
}

// ─── WHALE / SMART MONEY TRACKER (GMGN) ──────────────────────────────────────
// Data source: gmgn-cli `track smartmoney` — daftar wallet "smart money" versi
// GMGN sendiri (bukan wallet pilihan manual kita), diklasifikasikan dari
// track record trading mereka di platform GMGN.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

const whaleAlertCooldown = new Map<string, number>(); // key: chain:wallet:token
const WHALE_COOLDOWN_MS = 30 * 60 * 1000; // 30 menit per wallet+token, cegah spam

interface GmgnSmartMoneyTrade {
  wallet_address?: string;
  maker?: string;
  token_address?: string;
  token_symbol?: string;
  symbol?: string;
  side?: string;         // buy | sell
  event_type?: string;
  amount_usd?: number;
  usd_value?: number;
  price_usd?: number;
  price?: number;
  tx_hash?: string;
  timestamp?: number;
}

async function fetchGmgnSmartMoney(chain: string): Promise<GmgnSmartMoneyTrade[]> {
  try {
    const { stdout } = await execFileAsync(
      "npx",
      ["--yes", "gmgn-cli", "track", "smartmoney", "--chain", chain, "--side", "buy", "--limit", "30", "--raw"],
      {
        env: { ...process.env, GMGN_API_KEY: process.env.GMGN_API_KEY },
        timeout: 20000,
      },
    );
    const json = JSON.parse(stdout);
    const list = json?.list ?? json?.data?.list ?? json;
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error(`[WHALE] gmgn-cli error (${chain}):`, (err as Error).message);
    return [];
  }
}

async function runWhaleScan() {
  console.log("[WHALE] Starting smart money scan...");
  if (!process.env.GMGN_API_KEY) {
    console.error("[WHALE] GMGN_API_KEY belum di-set, skip scan.");
    return;
  }

  const chains = ["sol", "eth"];
  let sent = 0;

  for (const chain of chains) {
    const trades = await fetchGmgnSmartMoney(chain);
    console.log(`[WHALE] ${chain}: ${trades.length} trade ditemukan dari smart money`);

    const now = Date.now();

    for (const trade of trades) {
      const wallet = trade.wallet_address ?? trade.maker;
      const token = trade.token_address;
      if (!wallet || !token) continue;

      const key = `${chain}:${wallet}:${token}`;
      const lastSent = whaleAlertCooldown.get(key) ?? 0;
      if (now - lastSent < WHALE_COOLDOWN_MS) continue;

      const amountUsd = trade.amount_usd ?? trade.usd_value ?? 0;
      const priceUsd = trade.price_usd ?? trade.price ?? 0;
      const symbol = trade.token_symbol ?? trade.symbol ?? "?";

      const chainLabel = chain === "sol" ? "Solana" : chain === "eth" ? "Ethereum" : chain.toUpperCase();

      let msg = `🐋 <b>WHALE ALERT — SMART MONEY BUY</b>\n`;
      msg += `━━━━━━━━━━━━━━━\n`;
      msg += `<b>Chain:</b> ${escapeHtml(chainLabel)}\n`;
      msg += `<b>Token:</b> ${escapeHtml(symbol)}\n`;
      msg += `<b>Token Address:</b> <code>${escapeHtml(token)}</code>\n`;
      if (amountUsd) msg += `<b>Nilai Transaksi:</b> $${amountUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}\n`;
      if (priceUsd) msg += `<b>Harga saat beli:</b> $${priceUsd}\n`;
      msg += `<b>Wallet:</b> <code>${escapeHtml(wallet)}</code>\n`;
      msg += `\n<i>⏰ ${new Date().toLocaleString("id-ID")}</i>\n`;
      msg += `━━━━━━━━━━━━━━━\n`;
      msg += `<i>⚠️ Ini data mengikuti klasifikasi "smart money" versi GMGN. Belum ada forward-test — DYOR sebelum ikut beli.</i>`;

      try {
        await sendWhaleTelegram(msg);
        whaleAlertCooldown.set(key, now);
        sent++;

        await (db as any).insert(whaleAlerts).values({
          chain,
          walletAddress: wallet,
          side: "buy",
          tokenAddress: token,
          tokenSymbol: symbol,
          amountUsd,
          priceAtAlert: priceUsd,
          txHash: trade.tx_hash ?? null,
        });

        console.log(`[WHALE] ✅ Alert terkirim: ${symbol} (${chain}) oleh ${wallet.slice(0, 8)}...`);
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        console.error("[WHALE] Gagal kirim/simpan alert:", err);
      }
    }
  }

  console.log(`[WHALE] Scan selesai. ${sent} alert terkirim.`);
}

export function startWhaleCron() {
  const INTERVAL_MS = 15 * 60 * 1000;
  console.log(`[WHALE] Whale/smart money tracker started. Interval: ${INTERVAL_MS / 1000}s`);
  runWhaleScan();
  setInterval(runWhaleScan, INTERVAL_MS);
}

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
