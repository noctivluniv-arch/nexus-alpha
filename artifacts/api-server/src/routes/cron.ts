import { Router } from "express";
import { SUPPORTED_PAIRS } from "../../../nexusalpha/lib/types";

const router = Router();

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "305425021";
const SWEET_SPOT_MIN = 45;
const SWEET_SPOT_MAX = 65;
const BASE_URL = process.env.BASE_URL ?? "http://localhost:10000";

async function sendTelegram(text: string): Promise<void> {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

async function runSignalScan() {
  console.log(`[CRON] Starting signal scan for ${SUPPORTED_PAIRS.length} pairs...`);

  for (const pair of SUPPORTED_PAIRS) {
    try {
      // Get price
      const priceRes = await fetch(
        `${BASE_URL}/api/binance/tickers?symbols=${pair}`
      );
      const prices = await priceRes.json() as any[];
      const priceData = prices?.[0];

      // Generate signal
      const signalRes = await fetch(`${BASE_URL}/api/ai/signal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-app-secret": process.env.EXPO_PUBLIC_AI_APP_SECRET ?? "nexusalpha-secret-2026",
        },
        body: JSON.stringify({ pair, priceData, lang: "id" }),
      });

      const signal = await signalRes.json() as any;

      console.log(`[CRON] ${pair} → confidence: ${signal.confidence}, side: ${signal.side}`);

      // Only send if confidence >= threshold and not NO_TRADE
      if (
        signal.confidence >= SWEET_SPOT_MIN &&
        signal.confidence <= SWEET_SPOT_MAX &&
        signal.side !== "NO_TRADE" &&
        !signal.noTrade
      ) {
        const side = signal.side === "BUY" ? "🟢 BUY/LONG" : "🔴 SELL/SHORT";
        const emoji = signal.side === "BUY" ? "📈" : "📉";

        let msg = `${emoji} <b>AUTO SIGNAL — NEXUSALPHA</b>\n`;
        msg += `━━━━━━━━━━━━━━━\n`;
        msg += `<b>Pair:</b> ${signal.pair}\n`;
        msg += `<b>Signal:</b> ${side}\n`;
        msg += `<b>Confidence:</b> ${signal.confidence}/100 ✅\n`;
        msg += `<b>Market:</b> ${signal.marketStructure}\n\n`;
        msg += `<b>📍 Entry:</b> ${signal.entryRange}\n`;
        msg += `<b>🛑 Stop Loss:</b> ${signal.stopLoss}\n`;
        msg += `<b>🎯 Take Profit:</b>\n`;
        (signal.takeProfit ?? []).forEach((tp: string, i: number) => {
          const rr = signal.takeProfitRR?.[i] ?? "";
          msg += `  TP${i + 1}: ${tp} ${rr}\n`;
        });
        msg += `\n<b>Leverage:</b> ${signal.leverage}\n`;
        msg += `<b>R:R:</b> ${signal.riskReward}\n\n`;
        msg += `<b>⚠️ Invalidation:</b> ${signal.invalidation}\n\n`;
        msg += `<i>⏰ ${new Date().toLocaleString("id-ID")}</i>\n`;
        msg += `━━━━━━━━━━━━━━━\n`;
        msg += `<i>🤖 Auto-signal by NexusAlpha</i>`;

        await sendTelegram(msg);
        console.log(`[CRON] ✅ Signal sent for ${pair}`);

        // Delay 1s antar pair biar tidak spam
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      console.error(`[CRON] Error processing ${pair}:`, err);
    }
  }

  console.log(`[CRON] Scan complete.`);
}

// Start cron loop — every 5 minutes
export function startCron() {
  const INTERVAL_MS = 5 * 60 * 1000;
  console.log(`[CRON] Auto-signal scanner started. Interval: ${INTERVAL_MS / 1000}s`);
  
  // Run immediately on start
  runSignalScan();
  
  // Then repeat every 5 minutes
  setInterval(runSignalScan, INTERVAL_MS);
}

// Manual trigger endpoint (for testing)
router.post("/run", async (_req, res) => {
  runSignalScan(); // non-blocking
  res.json({ status: "scan started" });
});

export default router;
