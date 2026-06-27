import { Router } from "express";
import { SUPPORTED_PAIRS } from "../../../nexusalpha/lib/types";
import { computeRealtimeSignal } from "../lib/signal-engine-realtime";

const router = Router();

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "305425021";
const CONFIDENCE_THRESHOLD = 58;
const MEME_TELEGRAM_API = `https://api.telegram.org/bot${process.env.MEME_TELEGRAM_BOT_TOKEN}`;
const MEME_CHAT_ID = process.env.MEME_TELEGRAM_CHAT_ID ?? "305425021";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:10000";

async function sendMemeTelegram(text: string): Promise<void> {
  const res = await fetch(`${MEME_TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: MEME_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    console.error(`[MEME-TELEGRAM] Send failed:`, JSON.stringify(json));
    throw new Error(`Telegram sendMessage failed: ${json?.description ?? res.statusText}`);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendTelegram(text: string): Promise<void> {
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.ok) {
    console.error(`[TELEGRAM] Send failed (status ${res.status}):`, JSON.stringify(json));
    throw new Error(`Telegram sendMessage failed: ${json?.description ?? res.statusText}`);
  }
}

function fmtPrice(n: number | null): string {
  if (n === null) return "N/A";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
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
        msg += `<b>Confidence:</b> ${signal.confidence}/100 🎯 (sweet spot 45-55)\n`;
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

export default router;

// ─── MEME COIN CRON ───────────────────────────────────────────────────────────
const memeCooldown = new Map<string, number>(); // coinId → last alert timestamp
const MEME_COOLDOWN_MS = 30 * 60 * 1000; // 30 menit per coin
const MEME_INTERVAL_MS = 15 * 60 * 1000; // scan tiap 15 menit

async function runMemeScan() {
  console.log("[MEME-CRON] Starting meme coin scan...");
  try {
    const res = await fetch(`${BASE_URL}/api/ai/memes`);
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

      const lastSent = memeCooldown.get(coin.id) ?? 0;
      if (now - lastSent < MEME_COOLDOWN_MS) continue;

      const label = isGem && isPump
        ? "🚀 GEM + PUMP IMMINENT"
        : isGem
          ? "💎 EARLY GEM"
          : "🚀 PUMP IMMINENT";

      let msg = `${label} — <b>NEXUSALPHA MEME SCANNER</b>\n`;
      msg += `━━━━━━━━━━━━━━━\n`;
      msg += `<b>Coin:</b> ${escapeHtml(coin.name)} (${escapeHtml(coin.symbol)})\n`;
      msg += `<b>Network:</b> ${escapeHtml(coin.network)}\n`;
      msg += `<b>Price:</b> $${escapeHtml(String(coin.price))}\n`;
      msg += `<b>Market Cap:</b> $${escapeHtml(coin.marketCap ?? "—")}\n`;
      msg += `<b>Liquidity:</b> $${escapeHtml(coin.liquidity ?? "—")}\n`;
      msg += `<b>Age:</b> ${coin.ageInDays ?? "—"} hari\n\n`;
      msg += `<b>📊 Scores:</b>\n`;
      msg += `  Quality: ${coin.qualityScore ?? "—"}/100\n`;
      msg += `  Viral: ${coin.viralScore ?? "—"}/100 (${escapeHtml(coin.viralLabel ?? "—")})\n`;
      msg += `  Organic: ${coin.organicScore ?? "—"}/100 (${escapeHtml(coin.organicLabel ?? "—")})\n`;
      msg += `  Early Gem: ${coin.earlyGemScore ?? "—"}/100\n`;
      msg += `  Narrative: ${escapeHtml(coin.narrativeType ?? "NONE")} (${coin.narrativeScore ?? 0}/100)\n\n`;
      if (coin.earlyGemSignals?.length > 0) {
        msg += `<b>✅ Sinyal Positif:</b>\n`;
        coin.earlyGemSignals.slice(0, 4).forEach((s: string) => (msg += `  • ${escapeHtml(s)}\n`));
        msg += `\n`;
      }
      if (coin.warnings?.length > 0) {
        msg += `<b>⚠️ Warning:</b>\n`;
        coin.warnings.slice(0, 3).forEach((w: string) => (msg += `  • ${escapeHtml(w)}\n`));
        msg += `\n`;
      }
      msg += `<b>🔗 Chart:</b> ${escapeHtml(coin.dexUrl ?? "—")}\n`;
      msg += `<i>⏰ ${new Date().toLocaleString("id-ID")}</i>\n`;
      msg += `━━━━━━━━━━━━━━━\n`;
      msg += `<i>🤖 NexusAlpha Meme Scanner — DYOR, high risk</i>`;

      await sendMemeTelegram(msg);
      memeCooldown.set(coin.id, now);
      sent++;
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
