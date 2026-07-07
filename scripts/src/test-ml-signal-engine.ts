/**
 * test-ml-signal-engine.ts — Tes cepat ml-signal-engine.ts untuk semua
 * pair yang didukung, tanpa menyentuh cron.ts atau Telegram sama sekali.
 */
import { computeMlSignal } from "../../artifacts/api-server/src/lib/ml-signal-engine";

const PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "DOGEUSDT", "XRPUSDT", "DOGEUSDT", "AVAXUSDT", "HYPEUSDT", "SUIUSDT"];

async function main() {
  for (const pair of [...new Set(PAIRS)]) {
    try {
      const result = await computeMlSignal(pair);
      console.log(`${pair.padEnd(10)} price=${result.price.toFixed(4).padEnd(12)} probBuy=${(result.probBuy * 100).toFixed(1)}% probSell=${(result.probSell * 100).toFixed(1)}% -> ${result.side} (conf ${result.confidence.toFixed(1)}%)`);
    } catch (err) {
      console.error(`${pair} ERROR:`, err);
    }
    await new Promise(r => setTimeout(r, 300));
  }
}

main().catch(console.error);
