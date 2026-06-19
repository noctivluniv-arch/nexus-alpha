import { Router } from "express";
import { SUPPORTED_PAIRS } from "../../../nexusalpha/lib/types";
import { computeRealtimeSignal } from "../lib/signal-engine-realtime";

const router = Router();

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "305425021";

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

function fmtPrice(n: number | null): string {
  if (n === null) return "N/A";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

async function runSignalScan() {
  console.log(`[CRON] Starting REAL-TIME RULE-BASED signal scan for ${SUPPORTED_PAIRS.length} pairs...`);

  for (const pair of SUPPORTED_PAIRS) {
    try {
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
          signal.confluences.slice(0, 5).forEach((c) => (msg += `  • ${c}\n`));
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
  const INTERVAL_MS = 5 * 60 * 1000;
  console.log(`[CRON] Auto-signal scanner started. Interval: ${INTERVAL_MS / 1000}s`);

  runSignalScan();
  setInterval(runSignalScan, INTERVAL_MS);
}

router.post("/run", async (_req, res) => {
  runSignalScan();
  res.json({ status: "scan started" });
});

export default router;
