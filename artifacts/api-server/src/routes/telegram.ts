import { Router } from "express";

const router = Router();

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// Send message to Telegram
async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json() as any;
    return data.ok === true;
  } catch {
    return false;
  }
}

// Format signal as Telegram message
function formatSignal(signal: any): string {
  const side = signal.side === "BUY" ? "🟢 BUY/LONG" : signal.side === "SELL" ? "🔴 SELL/SHORT" : "⚪ NO TRADE";
  const emoji = signal.side === "BUY" ? "📈" : signal.side === "SELL" ? "📉" : "⏸";

  let msg = `${emoji} <b>NEXUSALPHA SIGNAL</b>\n`;
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `<b>Pair:</b> ${signal.pair}\n`;
  msg += `<b>Signal:</b> ${side}\n`;
  msg += `<b>Confidence:</b> ${signal.confidence}/100\n`;
  msg += `<b>Market:</b> ${signal.marketStructure}\n\n`;

  if (signal.side !== "NO_TRADE") {
    msg += `<b>📍 Entry:</b> ${signal.entryRange}\n`;
    msg += `<b>🛑 Stop Loss:</b> ${signal.stopLoss} (${signal.stopLossRiskPct})\n`;
    msg += `<b>🎯 Take Profit:</b>\n`;
    (signal.takeProfit ?? []).forEach((tp: string, i: number) => {
      const rr = signal.takeProfitRR?.[i] ?? "";
      msg += `  TP${i + 1}: ${tp} ${rr}\n`;
    });
    msg += `\n<b>Leverage:</b> ${signal.leverage}\n`;
    msg += `<b>R:R:</b> ${signal.riskReward}\n\n`;
  }

  if (signal.spotEntry) {
    msg += `<b>💰 Spot DCA Zone:</b> ${signal.spotEntry}\n\n`;
  }

  if (signal.confluences?.length > 0) {
    msg += `<b>✅ Confluences:</b>\n`;
    signal.confluences.slice(0, 3).forEach((c: string) => {
      msg += `• ${c}\n`;
    });
    msg += `\n`;
  }

  msg += `<b>⚠️ Invalidation:</b> ${signal.invalidation}\n\n`;
  msg += `<i>⏰ Valid until: ${new Date(signal.validUntil ?? Date.now()).toLocaleString("id-ID")}</i>\n`;
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `<i>by NexusAlpha — nexus-alpha-zeta.vercel.app</i>`;

  return msg;
}

// POST /telegram/send — send signal to telegram
router.post("/send", async (req, res) => {
  const { chatId, signal } = req.body as { chatId: string; signal: any };

  if (!chatId || !signal) {
    return res.status(400).json({ error: "chatId and signal required" });
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return res.status(500).json({ error: "Telegram bot not configured" });
  }

  const text = formatSignal(signal);
  const ok = await sendTelegram(chatId, text);

  if (ok) {
    return res.json({ success: true });
  } else {
    return res.status(500).json({ error: "Failed to send Telegram message" });
  }
});

// GET /telegram/me — verify bot is working
router.get("/me", async (_req, res) => {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return res.status(500).json({ error: "Bot token not set" });
  }
  try {
    const r = await fetch(`${TELEGRAM_API}/getMe`);
    const data = await r.json();
    return res.json(data);
  } catch {
    return res.status(500).json({ error: "Cannot reach Telegram API" });
  }
});

export default router;
