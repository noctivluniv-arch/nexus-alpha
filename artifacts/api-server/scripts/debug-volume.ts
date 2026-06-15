import { getOHLC } from "../src/routes/binance";
import { volumeProfile } from "../src/lib/indicators";

async function main() {
  for (const symbol of ["BTCUSDT", "ZECUSDT"]) {
    const ohlc = await getOHLC(symbol, 90);
    if (!ohlc) {
      console.log(symbol, "-> ohlc is null");
      continue;
    }
    const dVols = ohlc.daily.volumes;
    const hVols = ohlc.hourly.volumes;
    const vp = volumeProfile(dVols.slice(-31, -1));

    console.log(`\n=== ${symbol} ===`);
    console.log("daily.volumes.length:", dVols.length);
    console.log("daily.volumes last 5:", dVols.slice(-5));
    console.log("hourly.volumes.length:", hVols.length);
    console.log("hourly.volumes last 6:", hVols.slice(-6));
    console.log("volumeProfile (last 30d):", vp);

    const volH1 = hVols.slice(-1)[0] ?? 0;
    const volH6 = hVols.slice(-6).reduce((a, b) => a + b, 0) ?? 0;
    const volRatio = vp.avg > 0 ? vp.recent / vp.avg : 0;
    const volAcc = volH6 > 0 ? volH1 / (volH6 / 6) : 0;
    console.log("volRatio:", volRatio, "| volAcc:", volAcc);
    const lastTs = ohlc.daily.timestamps[ohlc.daily.timestamps.length - 1];
    console.log("Last daily candle timestamp:", new Date(lastTs).toISOString());
    console.log("Current time:", new Date().toISOString());
  }
}

main().catch(console.error);

