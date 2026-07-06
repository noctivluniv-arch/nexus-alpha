import app from "./app";
import { logger } from "./lib/logger";
import { scheduleSignalPrewarm } from "./routes/ai";
import { schedulePrewarmMemes } from "./routes/memes";
import { startCron, startMemeCron, startDailySaveCron, startSignalCheckCron, startMemeSignalCheckCron, startDexRadarCron, startWhaleCron, startWhaleCheckCron, startMlSignalCron, startMlSignalCheckCron } from "./routes/cron";

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
  startCron();
  startMemeCron();
  startDailySaveCron();
  startSignalCheckCron();
  startMemeSignalCheckCron();
  startDexRadarCron();
  startWhaleCron();
  startWhaleCheckCron();
  startMlSignalCron();
  startMlSignalCheckCron();
});
