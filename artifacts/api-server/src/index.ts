import app from "./app";
import { logger } from "./lib/logger";
import { scheduleSignalPrewarm } from "./routes/ai";
import { schedulePrewarmMemes } from "./routes/memes";
import { startCron, startMemeCron, startDailySaveCron, startSignalCheckCron, startMemeSignalCheckCron, startMemeTpslCheckCron, startDexRadarCron, startWhaleCron, startWhaleCheckCron, startWalletScoreCron, startConfluenceCheckCron, startConfluenceTpslCheckCron, startMlSignalCron, startMlSignalCheckCron, startBreakoutSignalCron, startBreakoutSignalCheckCron } from "./routes/cron";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

if (process.env["NODE_ENV"] === "production" && !process.env["AI_APP_SECRET"]) {
  logger.error(
    "AI_APP_SECRET is not set in production. AI endpoints (/api/ai/signal, /api/ai/whales) are publicly accessible without an app-level secret. Set AI_APP_SECRET to enforce caller identity on Gemini-backed routes.",
  );
  process.exit(1);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  if (!process.env["GEMINI_API_KEY"]) {
    scheduleSignalPrewarm();
  }
  schedulePrewarmMemes();
  // startCron(); -- DIMATIKAN 23 Sep 2026: rule-based SELL-only, win rate
  // 0% (0/20 closed). Diganti Shadow Breakout sebagai sinyal utama.
  // startSignalCheckCron() di bawah TETAP jalan agar sinyal OPEN lama
  // tetap bisa closed dengan benar.
  startMemeCron();
  startDailySaveCron();
  startSignalCheckCron();
  startMemeSignalCheckCron();
  startMemeTpslCheckCron();
  startDexRadarCron();
  startWhaleCron();
  startWhaleCheckCron();
  startWalletScoreCron();
  startConfluenceCheckCron();
  startConfluenceTpslCheckCron();
  // startMlSignalCron(); -- DIMATIKAN 23 Sep 2026: SELL 0% win rate, BUY
  // menjanjikan tapi terkonsentrasi di 2 rally + ada bug sinyal duplikat
  // yang belum diperbaiki. startMlSignalCheckCron() di bawah TETAP jalan
  // agar sinyal OPEN lama tetap bisa closed dengan benar.
  startMlSignalCheckCron();
  startBreakoutSignalCron();
  startBreakoutSignalCheckCron();
});
