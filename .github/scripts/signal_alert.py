import requests, os, time

API_BASE = "https://nexus-alpha-j3yb.onrender.com"
PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"]
TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]
APP_SECRET = "nexusalpha-secret-2026"

def send_telegram(msg):
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    try:
        r = requests.post(url, json={
            "chat_id": CHAT_ID,
            "text": msg,
            "parse_mode": "HTML",
            "disable_web_page_preview": True
        }, timeout=15)
        result = r.json()
        print(f"Telegram: {result.get('ok')}")
    except Exception as e:
        print(f"Telegram failed: {e}")

def format_signal(s):
    side = s.get("side", "NO_TRADE")
    pair = s.get("pair", "N/A")
    confidence = s.get("confidence", 0)
    entry = s.get("entryRange", "N/A")
    sl = s.get("stopLoss", "N/A")
    sl_pct = s.get("stopLossRiskPct", "")
    tp_list = s.get("takeProfit", [])
    tp_rr = s.get("takeProfitRR", [])
    leverage = s.get("leverage", "N/A")
    structure = s.get("marketStructure", "N/A")
    spot_entry = s.get("spotEntry", "N/A")
    invalidation = s.get("invalidation", "N/A")
    confluences = s.get("confluences", [])

    side_label = "🟢 BUY/LONG" if side == "BUY" else "🔴 SELL/SHORT"
    emoji = "📈" if side == "BUY" else "📉"

    msg = emoji + " <b>NEXUSALPHA SIGNAL ALERT</b>\n"
    msg += "━━━━━━━━━━━━━━━\n"
    msg += "<b>Pair:</b> " + pair + "\n"
    msg += "<b>Signal:</b> " + side_label + "\n"
    msg += "<b>Confidence:</b> " + str(confidence) + "/100\n"
    msg += "<b>Market:</b> " + structure + "\n\n"
    msg += "<b>📍 Entry:</b> " + entry + "\n"
    msg += "<b>🛑 Stop Loss:</b> " + sl + " (" + sl_pct + ")\n"
    msg += "<b>🎯 Take Profit:</b>\n"
    for i, tp in enumerate(tp_list):
        rr = tp_rr[i] if i < len(tp_rr) else ""
        msg += "  TP" + str(i+1) + ": " + tp + " " + rr + "\n"
    msg += "\n<b>⚡ Leverage:</b> " + leverage + "\n"
    msg += "<b>💰 Spot DCA Zone:</b> " + spot_entry + "\n\n"
    if confluences:
        msg += "<b>✅ Confluences:</b>\n"
        for c in confluences[:3]:
            msg += "• " + c + "\n"
        msg += "\n"
    msg += "<b>⚠️ Invalidation:</b> " + invalidation + "\n\n"
    msg += "━━━━━━━━━━━━━━━\n"
    msg += "<i>🤖 Auto-alert by NexusAlpha</i>"
    return msg

def format_meme(coin):
    name = coin.get("name", "?")
    symbol = coin.get("symbol", "?")
    price = coin.get("price", "?")
    change24h = str(coin.get("change24h", "0"))
    vol_signal = coin.get("volumeSignalLabel", "")
    gem_label = coin.get("earlyGemLabel", "")
    gem_score = coin.get("earlyGemScore", 0)
    age = coin.get("ageInDays", 0)
    network = coin.get("network", "?")
    liq = coin.get("liquidity", "?")
    risk = coin.get("riskLevel", "?")
    viral_score = coin.get("viralScore", 0)
    dex_url = coin.get("dexUrl", "")

    msg = "🚨 <b>MEME COIN ALERT</b>\n"
    msg += "━━━━━━━━━━━━━━━\n"
    msg += "<b>" + name + " ($" + symbol + ")</b>\n"
    msg += "<b>Network:</b> " + network + "\n"
    msg += "<b>Price:</b> " + str(price) + "\n"
    msg += "<b>Change 24H:</b> " + change24h + "%\n"
    if vol_signal:
        msg += "<b>Volume Signal:</b> " + vol_signal + "\n"
    if gem_label and gem_label != "BIASA":
        gem_icon = "⭐ GEM" if gem_label == "GEM" else "🔍 POTENSIAL"
        msg += "<b>Early Gem:</b> " + gem_icon + " (" + str(gem_score) + "/100)\n"
    msg += "<b>Age:</b> " + str(round(float(age), 1)) + " days\n"
    msg += "<b>Liquidity:</b> " + str(liq) + "\n"
    msg += "<b>Risk:</b> " + str(risk) + "\n"
    msg += "<b>Viral Score:</b> " + str(viral_score) + "/100\n"
    if dex_url:
        msg += "<b>DEX:</b> " + dex_url + "\n"
    msg += "\n━━━━━━━━━━━━━━━\n"
    msg += "<i>⚠️ DYOR! Meme coins are extremely risky.</i>\n"
    msg += "<i>🤖 Auto-alert by NexusAlpha</i>"
    return msg

# ─── CHECK TRADING SIGNALS ────────────────────────────────────────────────────
for pair in PAIRS:
    print(f"Checking {pair}...")
    try:
        r = requests.post(
            f"{API_BASE}/api/ai/signal",
            headers={"Content-Type": "application/json", "x-app-secret": APP_SECRET},
            json={"pair": pair, "lang": "en"},
            timeout=90
        )
        print(f"Status: {r.status_code}")
        if r.status_code != 200:
            print(f"Error: {r.text[:200]}")
            time.sleep(5)
            continue
        signal = r.json()
        side = signal.get("side", "NO_TRADE")
        no_trade = signal.get("noTrade", True)
        confidence = signal.get("confidence", 0)
        print(f"{pair}: side={side} confidence={confidence} noTrade={no_trade}")
        if not no_trade and side != "NO_TRADE" and confidence >= 58:
            print(f"Valid signal! Sending to Telegram...")
            send_telegram(format_signal(signal))
        else:
            print(f"No valid signal for {pair}")
    except Exception as e:
        print(f"Error checking {pair}: {e}")
    time.sleep(5)

print("Done checking trading signals!")

# ─── CHECK MEME COINS ─────────────────────────────────────────────────────────
print("\nChecking meme coins for pump signals...")
try:
    r = requests.get(
        f"{API_BASE}/memes",
        headers={"x-app-secret": APP_SECRET},
        timeout=60
    )
    if r.status_code == 200:
        coins = r.json()
        if isinstance(coins, list):
            pump_coins = [c for c in coins if (
                c.get("volumeSignal") in ["PUMP_IMMINENT", "ACCUMULATION"] or
                (c.get("ageInDays", 999) <= 1 and c.get("earlyGemLabel") in ["GEM", "POTENSIAL"])
            )]
            print(f"Found {len(pump_coins)} pump/gem candidates")
            for coin in pump_coins[:3]:
                send_telegram(format_meme(coin))
                time.sleep(2)
        else:
            print("Memes response is not a list")
    else:
        print(f"Memes API error: {r.status_code}")
except Exception as e:
    print(f"Error checking memes: {e}")

print("All done!")
