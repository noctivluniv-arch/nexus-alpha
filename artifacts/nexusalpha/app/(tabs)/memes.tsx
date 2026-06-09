import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import Svg, {
  Path,
  Line as SvgLine,
  Circle,
  Rect,
  Text as SvgText,
} from "react-native-svg";

import { Header } from "@/components/Header";
import { useColors } from "@/hooks/useColors";
import { api, formatNumber } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cacheGet, cacheSet, memGet, memSet } from "@/lib/persistentCache";
import { ChartPayload, ChartTimeframe, MemeCoin } from "@/lib/types";

const MEMES_CACHE_KEY = "memes.list";
const MEMES_CACHE_MAX_AGE = 30 * 60 * 1000; // 30 min — backend TTL is 15m so stale shows briefly while refresh runs.

function shortAddress(addr: string): string {
  if (!addr) return "—";
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatAge(days: number, t: (k: string) => string): string {
  if (!days || days < 1) return t("memes.age.justNow");
  if (days < 30) return `${Math.round(days)} ${t("memes.age.days")}`;
  if (days < 365) return `${Math.round(days / 30)} ${t("memes.age.months")}`;
  const years = (days / 365).toFixed(1);
  return `${years} ${t("memes.age.years")}`;
}

export default function MemesScreen() {
  const colors = useColors();
  const t = useT();
  // Try in-memory snapshot first (instant on tab navigation within session).
  const memSnap = memGet<MemeCoin[]>(MEMES_CACHE_KEY, MEMES_CACHE_MAX_AGE);
  const [coins, setCoins] = useState<MemeCoin[]>(memSnap ?? []);
  // If we already have a session snapshot, skip the loader spinner.
  const [loading, setLoading] = useState(!memSnap);
  const [refreshing, setRefreshing] = useState(false);
  const [bgRefreshing, setBgRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeNetwork, setActiveNetwork] = useState<string>("ALL");

  const load = useCallback(
    async (mode: "initial" | "refresh" | "background" = "initial") => {
      if (mode === "background") setBgRefreshing(true);
      try {
        setError(null);
        const data = await api.getMemeCoins();
        setCoins(data);
        memSet(MEMES_CACHE_KEY, data);
        // Persist to disk for app-restart instant boot.
        cacheSet(MEMES_CACHE_KEY, data);
      } catch (e: any) {
        // On background refresh failure, keep showing the cached data
        // and stay silent — surfacing an error here would be jarring.
        if (mode !== "background") {
          if (e?.message === "QUOTA_EXCEEDED") {
            setError(t("common.quotaError"));
          } else {
            setError(t("memes.error"));
          }
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
        setBgRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    let cancelled = false;
    // If we already have an in-memory snapshot, refresh in the background.
    if (memSnap) {
      load("background");
      return () => {
        cancelled = true;
      };
    }
    // Otherwise try persistent disk cache for instant first paint.
    cacheGet<MemeCoin[]>(MEMES_CACHE_KEY, MEMES_CACHE_MAX_AGE).then((hit) => {
      if (cancelled) return;
      if (hit && hit.value.length > 0) {
        setCoins(hit.value);
        memSet(MEMES_CACHE_KEY, hit.value);
        setLoading(false);
        // Background refresh to get latest while user reads cached list.
        load("background");
      } else {
        load("initial");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    load("refresh");
  };

  const sentimentColor = (s: MemeCoin["sentiment"]) => {
    if (s === "HYPER") return colors.fuchsia;
    if (s === "BULLISH") return colors.success;
    return colors.mutedForeground;
  };

  const riskColor = (r: MemeCoin["riskLevel"]) => {
    if (r === "EXTREME") return colors.danger;
    if (r === "HIGH") return "#F97316";
    if (r === "MEDIUM") return colors.primary;
    return colors.success;
  };

  const actionColor = (a: "BUY" | "SELL" | "HOLD" | "NO_TRADE") => {
    if (a === "BUY") return colors.success;
    if (a === "SELL") return colors.danger;
    if (a === "NO_TRADE") return colors.mutedForeground;
    return colors.primary;
  };

  const networkChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of coins) {
      counts.set(c.network, (counts.get(c.network) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    return [
      { id: "ALL" as const, label: t("memes.filterAll"), count: coins.length },
      ...sorted.map(([net, count]) => ({ id: net, label: net, count })),
    ];
  }, [coins, t]);

  const filteredCoins = useMemo(() => {
    if (activeNetwork === "ALL") return coins;
    return coins.filter((c) => c.network === activeNetwork);
  }, [coins, activeNetwork]);

  const copyAddress = async (addr: string, id: string) => {
    await Clipboard.setStringAsync(addr);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header
        onRefresh={onRefresh}
        refreshing={refreshing}
        subtitle={t("header.memes")}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.fuchsia}
          />
        }
      >
        <View
          style={[
            styles.banner,
            {
              backgroundColor: "rgba(232,121,249,0.08)",
              borderColor: "rgba(232,121,249,0.3)",
            },
          ]}
        >
          
          <Text style={[styles.bannerText, { color: colors.fuchsia }]}>
            {t("memes.dyor")}
          </Text>
        </View>

        {error ? (
          <View
            style={[
              styles.errorBox,
              { backgroundColor: "#2A1A1F", borderColor: colors.danger },
            ]}
          >
            
            <Text style={[styles.errorText, { color: colors.danger }]}>
              {error}
            </Text>
          </View>
        ) : null}

        {loading && coins.length === 0 ? (
          <View style={{ paddingVertical: 60, alignItems: "center" }}>
            <ActivityIndicator color={colors.fuchsia} />
            <Text
              style={{
                color: colors.mutedForeground,
                marginTop: 12,
                fontSize: 11,
                fontFamily: "Helvetica Neue",
              }}
            >
              {t("memes.searching")}
            </Text>
          </View>
        ) : null}

        {coins.length > 0 ? (
          <View style={styles.filterStrip}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingRight: 8 }}
            >
              {networkChips.map((chip) => {
                const active = chip.id === activeNetwork;
                return (
                  <Pressable
                    key={chip.id}
                    onPress={() => setActiveNetwork(chip.id)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active
                          ? colors.fuchsia + "22"
                          : colors.card,
                        borderColor: active
                          ? colors.fuchsia
                          : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipLabel,
                        {
                          color: active ? colors.fuchsia : colors.foreground,
                        },
                      ]}
                    >
                      {chip.label}
                    </Text>
                    <View
                      style={[
                        styles.chipCount,
                        {
                          backgroundColor: active
                            ? colors.fuchsia + "33"
                            : colors.background,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipCountText,
                          {
                            color: active
                              ? colors.fuchsia
                              : colors.mutedForeground,
                          },
                        ]}
                      >
                        {chip.count}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {filteredCoins.length === 0 && coins.length > 0 ? (
          <View style={{ paddingVertical: 32, alignItems: "center" }}>
            
            <Text
              style={{
                color: colors.mutedForeground,
                marginTop: 8,
                fontSize: 11,
                fontFamily: "Helvetica Neue",
              }}
            >
              {t("memes.noNetworkResults")}
            </Text>
          </View>
        ) : null}

        <View style={{ gap: 14 }}>
          {filteredCoins.map((coin) => {
            const change = parseFloat(coin.change24h);
            const tr = coin.technicalRecommendation;
            return (
              <View
                key={coin.id}
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                {/* Header with name + price */}
                <View style={styles.head}>
                  <View style={styles.headLeft}>
                    <View
                      style={[
                        styles.avatar,
                        {
                          backgroundColor:
                            sentimentColor(coin.sentiment) + "22",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.avatarText,
                          { color: sentimentColor(coin.sentiment) },
                        ]}
                      >
                        {coin.symbol.slice(0, 1)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.nameRow}>
                        <Text
                          style={[styles.name, { color: colors.foreground }]}
                          numberOfLines={1}
                        >
                          {coin.name}
                        </Text>
                        <InfluencerBadge
                          who={coin.influencer}
                          colors={colors}
                        />
                      </View>
                      <View style={styles.subRow}>
                        <Text
                          style={[
                            styles.symbol,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          ${coin.symbol}
                        </Text>
                        <View
                          style={[
                            styles.dot,
                            { backgroundColor: colors.mutedForeground },
                          ]}
                        />
                        
                        <Text
                          style={[
                            styles.symbol,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {formatAge(coin.ageInDays, t)}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text
                      style={[styles.price, { color: colors.foreground }]}
                    >
                      ${coin.price}
                    </Text>
                    <Text
                      style={[
                        styles.change,
                        {
                          color: change >= 0 ? colors.success : colors.danger,
                        },
                      ]}
                    >
                      {change >= 0 ? "+" : ""}
                      {change.toFixed(2)}%
                    </Text>
                  </View>
                </View>

                {/* Influencer correlation block */}
                {coin.influencer !== "NONE" ? (
                  <InfluencerBlock
                    who={coin.influencer}
                    reason={coin.influencerReason}
                    colors={colors}
                  />
                ) : null}

                <Text
                  style={[styles.desc, { color: colors.mutedForeground }]}
                >
                  {coin.description}
                </Text>

                <View style={styles.badgeRow}>
                  {coin.tier === "VERIFIED" ? (
                    <Badge
                      label={t("memes.tier.verified")}
                      color={colors.success}
                    />
                  ) : (
                    // Defensive default: anything that is not explicitly
                    // VERIFIED (including undefined / malformed) is shown as
                    // WATCHLIST so we never overstate safety.
                    <Badge
                      label={t("memes.tier.watchlist")}
                      color="#F59E0B"
                    />
                  )}
                  <Badge
                    label={coin.sentiment}
                    color={sentimentColor(coin.sentiment)}
                  />
                  <Badge
                    label={`${t("memes.risk")} ${coin.riskLevel}`}
                    color={riskColor(coin.riskLevel)}
                  />
                  {coin.liquidityLocked ? (
                    <Badge label={t("memes.locked")} color={colors.success} />
                  ) : null}
                  {coin.burnFeature ? (
                    <Badge label={t("memes.burn")} color="#F97316" />
                  ) : null}
                  {coin.earlyGemLabel === "GEM" ? (
                    <Badge label="⭐ EARLY GEM" color="#F59E0B" />
                  ) : coin.earlyGemLabel === "POTENSIAL" ? (
                    <Badge label="🔍 POTENSIAL" color="#8B5CF6" />
                  ) : null}
                </View>

                <SocialLinks coin={coin} colors={colors} />

                {/* Contract Info */}
                <View
                  style={[
                    styles.section,
                    {
                      backgroundColor: "rgba(255,255,255,0.03)",
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.sectionLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {t("memes.contractInfo")}
                  </Text>
                  <View style={styles.kvRow}>
                    <Text
                      style={[styles.kvKey, { color: colors.mutedForeground }]}
                    >
                      {t("memes.network")}
                    </Text>
                    <View
                      style={[
                        styles.netPill,
                        { borderColor: colors.cyan + "55" },
                      ]}
                    >
                      <View
                        style={[
                          styles.netDot,
                          { backgroundColor: colors.cyan },
                        ]}
                      />
                      <Text style={[styles.kvVal, { color: colors.cyan }]}>
                        {coin.network}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => copyAddress(coin.contractAddress, coin.id)}
                    style={({ pressed }) => [
                      styles.kvRow,
                      {
                        backgroundColor: pressed
                          ? "rgba(255,255,255,0.03)"
                          : "transparent",
                        marginHorizontal: -8,
                        paddingHorizontal: 8,
                        borderRadius: 6,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.kvKey, { color: colors.mutedForeground }]}
                    >
                      {t("memes.ca")}
                    </Text>
                    <View style={styles.caRow}>
                      <Text style={[styles.caText, { color: colors.foreground }]}>
                        {shortAddress(coin.contractAddress)}
                      </Text>
                      
                    </View>
                  </Pressable>
                  <View style={styles.kvRow}>
                    <Text
                      style={[styles.kvKey, { color: colors.mutedForeground }]}
                    >
                      {t("memes.circulating")}
                    </Text>
                    <Text style={[styles.kvVal, { color: colors.foreground }]}>
                      {formatNumber(coin.circulatingSupply, 0)}{" "}
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontSize: 11,
                        }}
                      >
                        {coin.symbol}
                      </Text>
                    </Text>
                  </View>
                  <View style={styles.kvRow}>
                    <Text
                      style={[styles.kvKey, { color: colors.mutedForeground }]}
                    >
                      {t("memes.totalSupply")}
                    </Text>
                    <Text style={[styles.kvVal, { color: colors.foreground }]}>
                      {formatNumber(coin.totalSupply, 0)}{" "}
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontSize: 11,
                        }}
                      >
                        {coin.symbol}
                      </Text>
                    </Text>
                  </View>
                  <View style={[styles.kvRow, { borderBottomWidth: 0 }]}>
                    <Text
                      style={[styles.kvKey, { color: colors.mutedForeground }]}
                    >
                      {t("memes.liquidity")}
                    </Text>
                    <Text style={[styles.kvVal, { color: colors.foreground }]}>
                      ${coin.liquidity}
                    </Text>
                  </View>
                </View>

                {/* Price chart (lazy-loaded, collapsed by default) */}
                <PriceChartSection coin={coin} colors={colors} t={t} />

                {/* LP Lock Info */}
                <LpLockSection coin={coin} colors={colors} t={t} />

                {/* Burn System */}
                <BurnSection coin={coin} colors={colors} t={t} />

                {/* Top Holders / Smart Wallets — collapsed by default */}
                <Collapsible
                  title={t("memes.holders.title")}
                  icon="users"
                  accent={colors.cyan}
                  colors={colors}
                  rightSlot={
                    coin.topHolders && coin.topHolders.list.length > 0 ? (
                      <View
                        style={[
                          styles.scanStatusPill,
                          {
                            backgroundColor:
                              coin.topHolders.concentrationTop10 > 70
                                ? colors.danger
                                : coin.topHolders.concentrationTop10 > 40
                                  ? "#F97316"
                                  : colors.success,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.scanStatusText,
                            { color: "#0B0E11" },
                          ]}
                        >
                          {coin.topHolders.concentrationTop10.toFixed(1)}%
                        </Text>
                      </View>
                    ) : null
                  }
                >
                  <TopHoldersSection
                    coin={coin}
                    colors={colors}
                    t={t}
                    copied={copied}
                    onCopy={copyAddress}
                    headerless
                  />
                </Collapsible>

                {/* Watchlist warnings (only shown when tier === WATCHLIST) */}
                <WatchlistWarningsSection
                  coin={coin}
                  colors={colors}
                  t={t}
                />

                {/* Smart Money Tracker — early-stage signal, collapsed by default */}
                <Collapsible
                  title={t("memes.smart.title")}
                  icon="zap"
                  accent="#A855F7"
                  colors={colors}
                  rightSlot={
                    (coin.smartWallets ?? []).length > 0 ? (
                      <View
                        style={[
                          styles.scanStatusPill,
                          {
                            backgroundColor:
                              (coin.smartWallets ?? []).length >= 3 ||
                              (coin.smartWallets ?? []).filter(
                                (w) => w.isLocked,
                              ).length >= 2
                                ? colors.success
                                : "#F59E0B",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.scanStatusText,
                            { color: "#0B0E11" },
                          ]}
                        >
                          {(coin.smartWallets ?? []).length}{" "}
                          {t("memes.smart.detected")}
                        </Text>
                      </View>
                    ) : null
                  }
                >
                  <SmartWalletsSection
                    coin={coin}
                    colors={colors}
                    t={t}
                    copied={copied}
                    onCopy={copyAddress}
                    headerless
                  />
                </Collapsible>

                {/* INDIKATOR MEME KHUSUS — Viral, Organik, Bebas Manipulasi */}
                <MemeIndicatorsSection coin={coin} colors={colors} />

                {/* EARLY GEM — Breakout Candidate Analysis */}
                <EarlyGemSection coin={coin} colors={colors} />

                {/* Technical Trader Recommendation — collapsed by default */}
                {tr ? (
                  <Collapsible
                    title={t("memes.traderAnalysis")}
                    icon="trending-up"
                    accent={actionColor(tr.action)}
                    colors={colors}
                    rightSlot={
                      <View
                        style={[
                          styles.actionBadge,
                          {
                            backgroundColor: actionColor(tr.action),
                            paddingVertical: 3,
                            paddingHorizontal: 8,
                          },
                        ]}
                      >
                        
                        <Text style={styles.actionText}>
                          {tr.action === "NO_TRADE"
                            ? t("memes.actionWait")
                            : tr.action}
                        </Text>
                      </View>
                    }
                  >
                  <View
                    style={[
                      styles.tradeCard,
                      {
                        backgroundColor: actionColor(tr.action) + "10",
                        borderColor: actionColor(tr.action) + "55",
                      },
                    ]}
                  >
                    <View style={styles.tradeHead}>
                      
                      <Text
                        style={[
                          styles.tradeTitle,
                          { color: actionColor(tr.action) },
                        ]}
                      >
                        {t("memes.traderAnalysis")}
                      </Text>
                      <View style={{ flex: 1 }} />
                      {typeof tr.confidence === "number" ? (
                        <View
                          style={[
                            styles.confPill,
                            {
                              backgroundColor:
                                tr.confidence >= 65
                                  ? colors.success + "22"
                                  : tr.confidence >= 45
                                    ? colors.primary + "22"
                                    : colors.danger + "22",
                              borderColor:
                                tr.confidence >= 65
                                  ? colors.success + "55"
                                  : tr.confidence >= 45
                                    ? colors.primary + "55"
                                    : colors.danger + "55",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.confPillText,
                              {
                                color:
                                  tr.confidence >= 65
                                    ? colors.success
                                    : tr.confidence >= 45
                                      ? colors.primary
                                      : colors.danger,
                              },
                            ]}
                          >
                            {tr.confidence}/100
                          </Text>
                        </View>
                      ) : null}
                      <Text
                        style={[
                          styles.tfText,
                          { color: colors.mutedForeground, marginLeft: 6 },
                        ]}
                      >
                        {tr.timeframe}
                      </Text>
                    </View>

                    <View style={styles.actionRow}>
                      <View
                        style={[
                          styles.actionBadge,
                          {
                            backgroundColor: actionColor(tr.action),
                          },
                        ]}
                      >
                        
                        <Text style={styles.actionText}>
                          {tr.action === "NO_TRADE"
                            ? t("memes.actionWait")
                            : tr.action}
                        </Text>
                      </View>
                      {tr.traderStyle ? (
                        <Text
                          style={[
                            styles.styleHint,
                            { color: colors.mutedForeground },
                          ]}
                          numberOfLines={1}
                        >
                          {tr.traderStyle}
                        </Text>
                      ) : null}
                    </View>

                    {tr.action === "NO_TRADE" ? (
                      <View
                        style={[
                          styles.noTradeBox,
                          {
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.noTradeLabel,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {t("memes.noTradeReason")}
                        </Text>
                        <Text
                          style={[
                            styles.noTradeText,
                            { color: colors.foreground },
                          ]}
                        >
                          {tr.noTradeReason || tr.analysis}
                        </Text>
                      </View>
                    ) : (
                      <>
                        <View style={styles.tpGrid}>
                          <TpCell
                            label={t("signals.entry")}
                            value={`$${tr.entryPrice}`}
                            color={colors.foreground}
                            colors={colors}
                          />
                          <TpCell
                            label="TP"
                            value={`$${tr.takeProfit}`}
                            color={colors.success}
                            colors={colors}
                          />
                          <TpCell
                            label="SL"
                            value={`$${tr.stopLoss}`}
                            color={colors.danger}
                            colors={colors}
                          />
                        </View>
                        {tr.riskReward && tr.riskReward !== "—" ? (
                          <View style={styles.rrLine}>
                            <Text
                              style={[
                                styles.rrLabel,
                                { color: colors.mutedForeground },
                              ]}
                            >
                              R:R
                            </Text>
                            <Text
                              style={[
                                styles.rrValue,
                                { color: colors.primary },
                              ]}
                            >
                              {tr.riskReward}
                            </Text>
                          </View>
                        ) : null}
                      </>
                    )}

                    <Text
                      style={[
                        styles.analysis,
                        { color: colors.foreground },
                      ]}
                    >
                      {tr.analysis}
                    </Text>

                    {tr.expertMindset ? (
                      <View
                        style={[
                          styles.mindsetBox,
                          { borderLeftColor: actionColor(tr.action) },
                        ]}
                      >
                        <Text
                          style={[
                            styles.mindsetLabel,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {t("memes.mindset")}
                        </Text>
                        <Text
                          style={[
                            styles.mindsetText,
                            { color: colors.foreground },
                          ]}
                        >
                          {tr.expertMindset}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  </Collapsible>
                ) : null}

                {/* Spot Strategy */}
                <View
                  style={[
                    styles.strategyBox,
                    {
                      backgroundColor: "rgba(240,185,11,0.06)",
                      borderColor: "rgba(240,185,11,0.25)",
                    },
                  ]}
                >
                  <Text
                    style={[styles.strategyTitle, { color: colors.primary }]}
                  >
                    {t("memes.spotStrategy")}
                  </Text>
                  <Text
                    style={[styles.strategyText, { color: colors.foreground }]}
                  >
                    {coin.spotStrategy}
                  </Text>
                </View>

                {/* Stats Row */}
                <View style={styles.statRow}>
                  <Stat
                    label={t("memes.marketCap")}
                    value={`$${coin.marketCap}`}
                    colors={colors}
                  />
                  <Stat
                    label={t("memes.vol24h")}
                    value={`$${coin.volume24h}`}
                    colors={colors}
                  />
                  <Stat
                    label={t("memes.security")}
                    value={`${coin.securityScore}/100`}
                    colors={colors}
                    valueColor={
                      coin.securityScore >= 70
                        ? colors.success
                        : coin.securityScore >= 40
                          ? colors.primary
                          : colors.danger
                    }
                  />
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function InfluencerBadge({
  who,
  colors,
}: {
  who: MemeCoin["influencer"];
  colors: any;
}) {
  if (who === "NONE") return null;
  if (who === "BOTH") {
    return (
      <View style={{ flexDirection: "row", marginLeft: 6, gap: 3 }}>
        <FaceAvatar who="TRUMP" size={20} />
        <FaceAvatar who="ELON" size={20} />
      </View>
    );
  }
  return (
    <View style={{ marginLeft: 6 }}>
      <FaceAvatar who={who} size={20} />
    </View>
  );
}

function FaceAvatar({
  who,
  size = 22,
}: {
  who: "TRUMP" | "ELON";
  size?: number;
}) {
  const isTrump = who === "TRUMP";
  const bg = isTrump ? "#DC2626" : "#1D9BF0";
  const ring = isTrump ? "#FBBF24" : "#FFFFFF";
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1.5,
        borderColor: ring,
      }}
    >
      <Text
        style={{
          color: "#FFFFFF",
          fontSize: size * 0.5,
          fontWeight: "900",
          fontFamily: "Helvetica Neue",
        }}
      >
        {isTrump ? "T" : "X"}
      </Text>
    </View>
  );
}

function InfluencerBlock({
  who,
  reason,
  colors,
}: {
  who: MemeCoin["influencer"];
  reason: string;
  colors: any;
}) {
  const t = useT();
  const isTrump = who === "TRUMP" || who === "BOTH";
  const isElon = who === "ELON" || who === "BOTH";
  const accent = isTrump && !isElon ? "#DC2626" : isElon && !isTrump ? "#1D9BF0" : "#A855F7";
  const label =
    who === "TRUMP"
      ? t("memes.influencer.trump")
      : who === "ELON"
        ? t("memes.influencer.elon")
        : t("memes.influencer.both");
  return (
    <View
      style={[
        styles.influencerBlock,
        {
          backgroundColor: accent + "1A",
          borderColor: accent,
        },
      ]}
    >
      <View style={{ flexDirection: "row", gap: 4 }}>
        {isTrump ? <FaceAvatar who="TRUMP" size={26} /> : null}
        {isElon ? <FaceAvatar who="ELON" size={26} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.influencerLabel, { color: accent }]}>
          {label}
        </Text>
        <Text
          style={[styles.influencerReason, { color: colors.foreground }]}
          numberOfLines={3}
        >
          {reason}
        </Text>
      </View>
    </View>
  );
}

function SocialLinks({
  coin,
  colors,
}: {
  coin: MemeCoin;
  colors: any;
}) {
  const items: {
    key: string;
    icon: keyof typeof Feather.glyphMap;
    label: string;
    url: string;
    color: string;
  }[] = [];

  if (coin.twitter) {
    items.push({
      key: "x",
      icon: "twitter",
      label: "X",
      url: coin.twitter,
      color: "#FFFFFF",
    });
  }
  if (coin.telegram) {
    items.push({
      key: "tg",
      icon: "send",
      label: "Telegram",
      url: coin.telegram,
      color: "#229ED9",
    });
  }
  if (coin.website) {
    items.push({
      key: "web",
      icon: "globe",
      label: "Website",
      url: coin.website,
      color: colors.cyan,
    });
  }
  if (coin.dexUrl) {
    items.push({
      key: "dex",
      icon: "bar-chart-2",
      label: "DexScreener",
      url: coin.dexUrl,
      color: colors.fuchsia,
    });
  }

  if (items.length === 0) return null;

  const ALLOWED_HOSTS: Record<string, ReadonlySet<string>> = {
    x: new Set(["x.com", "twitter.com", "t.co", "www.x.com", "www.twitter.com"]),
    tg: new Set(["t.me", "telegram.me", "telegram.org", "www.telegram.org"]),
    dex: new Set([
      "dexscreener.com",
      "www.dexscreener.com",
      "dextools.io",
      "www.dextools.io",
    ]),
  };

  const open = (url: string, key: string) => {
    let hostname: string;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return;
      hostname = parsed.hostname.toLowerCase();
    } catch {
      return;
    }
    const allowlist = ALLOWED_HOSTS[key];
    if (allowlist) {
      if (!allowlist.has(hostname)) return;
      Linking.openURL(url).catch(() => {});
    } else {
      Alert.alert(
        "External Link",
        `This will open an external website:\n${hostname}\n\nNexusAlpha does not control this destination.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open",
            onPress: () => Linking.openURL(url).catch(() => {}),
          },
        ],
      );
    }
  };

  return (
    <View style={styles.socialRow}>
      {items.map((it) => (
        <Pressable
          key={it.key}
          onPress={() => open(it.url, it.key)}
          style={({ pressed }) => [
            styles.socialBtn,
            {
              backgroundColor: pressed ? it.color + "33" : it.color + "18",
              borderColor: it.color + "55",
            },
          ]}
        >
          
          <Text style={[styles.socialBtnText, { color: it.color }]}>
            {it.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: color + "22", borderColor: color },
      ]}
    >
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function Stat({
  label,
  value,
  colors,
  valueColor,
}: {
  label: string;
  value: string;
  colors: any;
  valueColor?: string;
}) {
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text
        style={[styles.statValue, { color: valueColor ?? colors.foreground }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function TpCell({
  label,
  value,
  color,
  colors,
}: {
  label: string;
  value: string;
  color: string;
  colors: any;
}) {
  return (
    <View style={styles.tpCell}>
      <Text style={[styles.tpLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text style={[styles.tpVal, { color }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 14,
  },
  bannerText: { fontSize: 11, flex: 1, fontFamily: "Helvetica Neue" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  errorText: { fontSize: 12, flex: 1, fontFamily: "Helvetica Neue" },
  card: {
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
    marginRight: 8,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 16, fontFamily: "Helvetica Neue" },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
  },
  name: {
    fontSize: 15,
    fontFamily: "Helvetica Neue",
    flexShrink: 1,
  },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 3,
  },
  dot: { width: 3, height: 3, borderRadius: 2, opacity: 0.5 },
  symbol: { fontSize: 11, fontFamily: "Helvetica Neue" },
  price: { fontSize: 14, fontFamily: "Helvetica Neue" },
  change: { fontSize: 12, fontFamily: "Helvetica Neue", marginTop: 2 },
  desc: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Helvetica Neue",
  },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  socialRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  socialBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  socialBtnText: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.4,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: { fontSize: 9, fontFamily: "Helvetica Neue", letterSpacing: 0.8 },
  influencerBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  influencerLabel: {
    fontSize: 9,
    letterSpacing: 1.2,
    fontFamily: "Helvetica Neue",
    marginBottom: 3,
  },
  influencerReason: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: "Helvetica Neue",
  },
  section: {
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionLabel: {
    fontSize: 9,
    letterSpacing: 1.2,
    fontFamily: "Helvetica Neue",
    marginBottom: 8,
  },
  kvRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  kvKey: { fontSize: 11, fontFamily: "Helvetica Neue" },
  kvVal: { fontSize: 12, fontFamily: "Helvetica Neue" },
  netPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  netDot: { width: 6, height: 6, borderRadius: 3 },
  caRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  caText: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    fontVariant: ["tabular-nums"],
  },
  tradeCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  tradeHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tradeTitle: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1.2,
  },
  tfText: { fontSize: 10, fontFamily: "Helvetica Neue" },
  actionRow: { flexDirection: "row" },
  actionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  actionText: {
    color: "#0B0E11",
    fontSize: 12,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1,
  },
  tpGrid: { flexDirection: "row", gap: 8 },
  tpCell: {
    flex: 1,
    padding: 8,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  tpLabel: {
    fontSize: 9,
    letterSpacing: 1,
    fontFamily: "Helvetica Neue",
  },
  tpVal: { fontSize: 12, fontFamily: "Helvetica Neue", marginTop: 2 },
  analysis: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Helvetica Neue",
  },
  filterStrip: {
    marginBottom: 14,
    marginTop: 2,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 6,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLabel: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
  },
  chipCount: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  chipCountText: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
  },
  confPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  confPillText: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.5,
  },
  styleHint: {
    flex: 1,
    marginLeft: 10,
    fontSize: 10,
    fontFamily: "Helvetica Neue",
  },
  rrLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: -4,
  },
  rrLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1,
  },
  rrValue: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
  },
  noTradeBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  noTradeLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1.2,
  },
  noTradeText: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Helvetica Neue",
  },
  mindsetBox: {
    paddingLeft: 10,
    paddingVertical: 4,
    borderLeftWidth: 2,
    gap: 2,
  },
  mindsetLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1.2,
  },
  mindsetText: {
    fontSize: 11,
    lineHeight: 15,
    fontStyle: "italic",
    fontFamily: "Helvetica Neue",
  },
  strategyBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  strategyTitle: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  strategyText: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Helvetica Neue",
  },
  statRow: { flexDirection: "row", gap: 8 },
  statCell: {
    flex: 1,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  statLabel: {
    fontSize: 9,
    letterSpacing: 1,
    fontFamily: "Helvetica Neue",
  },
  statValue: { fontSize: 11, fontFamily: "Helvetica Neue", marginTop: 2 },
  scanSection: {
    padding: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  chartToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  chartToggleText: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1,
  },
  collapsibleToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
  },
  collapsibleTitle: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1,
  },
  tfRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  tfPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tfPillText: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.8,
  },
  chartLoading: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    paddingVertical: 30,
    justifyContent: "center",
  },
  chartStatsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  scanHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scanTitle: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1.2,
    flex: 1,
  },
  scanStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  scanStatusText: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.8,
  },
  scanSummary: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Helvetica Neue",
  },
  scanGrid: {
    flexDirection: "row",
    gap: 8,
  },
  scanCell: {
    flex: 1,
    padding: 8,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  scanCellLabel: {
    fontSize: 9,
    letterSpacing: 0.8,
    fontFamily: "Helvetica Neue",
  },
  scanCellValue: {
    fontSize: 12,
    fontFamily: "Helvetica Neue",
    marginTop: 2,
  },
  holderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  holderRank: {
    width: 18,
    fontSize: 10,
    fontFamily: "Helvetica Neue",
  },
  holderAddr: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    fontVariant: ["tabular-nums"],
  },
  holderTagPill: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  holderTagText: {
    fontSize: 8,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.5,
  },
  holderPct: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    minWidth: 50,
    textAlign: "right",
  },
  // ─── MemeIndicatorsSection styles ──────────────────────────────────────────
  miCard: {
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 10,
    overflow: "hidden",
  },
  miHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  miTitle: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.5,
  },
  miBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  miBody: {
    paddingBottom: 4,
  },
  miDivider: {
    height: 1,
    marginHorizontal: 12,
  },
  miRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  miRowLabel: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
  },
  miScoreBar: {
    height: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 2,
    marginTop: 4,
    overflow: "hidden",
  },
  miScoreFill: {
    height: 3,
    borderRadius: 2,
  },
  miScore: {
    fontSize: 13,
    fontFamily: "Helvetica Neue",
    minWidth: 28,
    textAlign: "right",
  },
  miSignals: {
    gap: 4,
    paddingTop: 6,
    paddingLeft: 4,
  },
  miSignalRow: {
    flexDirection: "row",
    gap: 5,
    alignItems: "flex-start",
  },
  miSignalText: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
    flex: 1,
    lineHeight: 14,
  },
  // ─── EarlyGemSection styles ────────────────────────────────────────────────
  egCard: {
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 10,
    overflow: "hidden",
  },
  egHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  egTitle: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.3,
  },
  egSubtitle: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    marginTop: 1,
  },
  egScorePill: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignItems: "center",
  },
  egScoreText: {
    fontSize: 14,
    fontFamily: "Helvetica Neue",
  },
  egBarBg: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 2,
    marginTop: 4,
    overflow: "hidden",
  },
  egBarFill: {
    height: 4,
    borderRadius: 2,
  },
  egBody: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 8,
    gap: 6,
  },
  egSectionLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  egSignalRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "flex-start",
  },
  egSignalText: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    flex: 1,
    lineHeight: 16,
  },
  egDisclaimerBox: {
    flexDirection: "row",
    gap: 6,
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
  },
  egDisclaimerText: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
    flex: 1,
    lineHeight: 14,
  },
});

function lpStatusColor(
  status: string,
  colors: any,
): { bg: string; fg: string } {
  if (status === "BURNED") return { bg: "#F97316" + "22", fg: "#F97316" };
  if (status === "LOCKED") return { bg: colors.success + "22", fg: colors.success };
  if (status === "VERIFIED_LISTING")
    return { bg: colors.primary + "22", fg: colors.primary };
  if (status === "PARTIAL") return { bg: colors.primary + "22", fg: colors.primary };
  if (status === "UNLOCKED") return { bg: colors.danger + "22", fg: colors.danger };
  return { bg: colors.mutedForeground + "22", fg: colors.mutedForeground };
}

function lpStatusLabel(status: string, t: (k: string) => string): string {
  if (status === "BURNED") return t("memes.lpLock.burned");
  if (status === "LOCKED") return t("memes.lpLock.locked");
  if (status === "VERIFIED_LISTING") return t("memes.lpLock.verifiedListing");
  if (status === "PARTIAL") return t("memes.lpLock.partial");
  if (status === "UNLOCKED") return t("memes.lpLock.unlocked");
  return t("memes.lpLock.unknown");
}

function formatLockDuration(days: number | null, t: (k: string) => string): string {
  if (days == null || days <= 0) return "—";
  if (days >= 365) return `${(days / 365).toFixed(1)} ${t("memes.age.years")}`;
  if (days >= 30) return `${Math.round(days / 30)} ${t("memes.age.months")}`;
  return `${days} ${t("memes.age.days")}`;
}

function formatExpiryDate(iso: string | null, t: (k: string) => string): string {
  if (!iso) return "—";
  if (iso === "PERMANENT") return t("memes.lpLock.permanent");
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function shortAddr(a: string): string {
  if (!a) return "—";
  if (a.length <= 12) return a;
  return `${a.slice(0, 4)}...${a.slice(-4)}`;
}

function LpLockSection({
  coin,
  colors,
  t,
}: {
  coin: MemeCoin;
  colors: any;
  t: (k: string) => string;
}) {
  const lp = coin.lpLockInfo;
  if (!lp) return null;
  const c = lpStatusColor(lp.status, colors);
  const isUnknown = lp.status === "UNKNOWN";
  const isVerifiedListing = lp.status === "VERIFIED_LISTING";
  return (
    <View
      style={[
        styles.scanSection,
        {
          backgroundColor: c.bg,
          borderColor: c.fg + "55",
        },
      ]}
    >
      <View style={styles.scanHead}>
        
        <Text style={[styles.scanTitle, { color: c.fg }]}>
          {t("memes.lpLock.title")}
        </Text>
        <View style={[styles.scanStatusPill, { backgroundColor: c.fg }]}>
          <Text style={[styles.scanStatusText, { color: "#0B0E11" }]}>
            {lpStatusLabel(lp.status, t)}
          </Text>
        </View>
      </View>
      <Text style={[styles.scanSummary, { color: colors.foreground }]}>
        {isUnknown ? t("memes.lpLock.unsupported") : lp.summary}
      </Text>
      {!isUnknown && !isVerifiedListing ? (
        <View style={styles.scanGrid}>
          <View style={styles.scanCell}>
            <Text style={[styles.scanCellLabel, { color: colors.mutedForeground }]}>
              {t("memes.lpLock.lockedPct")}
            </Text>
            <Text style={[styles.scanCellValue, { color: colors.success }]}>
              {lp.lockedPercent.toFixed(1)}%
            </Text>
          </View>
          <View style={styles.scanCell}>
            <Text style={[styles.scanCellLabel, { color: colors.mutedForeground }]}>
              {t("memes.lpLock.burnedPct")}
            </Text>
            <Text style={[styles.scanCellValue, { color: "#F97316" }]}>
              {lp.burnedPercent.toFixed(1)}%
            </Text>
          </View>
          <View style={styles.scanCell}>
            <Text style={[styles.scanCellLabel, { color: colors.mutedForeground }]}>
              {t("memes.lpLock.duration")}
            </Text>
            <Text style={[styles.scanCellValue, { color: colors.foreground }]}>
              {lp.status === "BURNED"
                ? "∞"
                : formatLockDuration(lp.longestLockDays, t)}
            </Text>
          </View>
        </View>
      ) : null}
      {!isUnknown && (lp.provider || lp.expiryDate) ? (
        <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
          {lp.provider ? (
            <Text style={[styles.scanCellLabel, { color: colors.mutedForeground }]}>
              {t("memes.lpLock.provider")}:{" "}
              <Text style={{ color: colors.foreground, fontFamily: "Helvetica Neue" }}>
                {lp.provider}
              </Text>
            </Text>
          ) : null}
          {lp.expiryDate ? (
            <Text style={[styles.scanCellLabel, { color: colors.mutedForeground }]}>
              {t("memes.lpLock.expiry")}:{" "}
              <Text style={{ color: colors.foreground, fontFamily: "Helvetica Neue" }}>
                {formatExpiryDate(lp.expiryDate, t)}
              </Text>
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function BurnSection({
  coin,
  colors,
  t,
}: {
  coin: MemeCoin;
  colors: any;
  t: (k: string) => string;
}) {
  const burn = coin.burnInfo;
  if (!burn) return null;
  const hasBurn = burn.burnedPercent > 0;
  const accent = hasBurn ? "#F97316" : colors.mutedForeground;
  return (
    <View
      style={[
        styles.scanSection,
        {
          backgroundColor: accent + "10",
          borderColor: accent + "44",
        },
      ]}
    >
      <View style={styles.scanHead}>
        
        <Text style={[styles.scanTitle, { color: accent }]}>
          {t("memes.burn.title")}
        </Text>
        {hasBurn ? (
          <View style={[styles.scanStatusPill, { backgroundColor: accent }]}>
            <Text style={[styles.scanStatusText, { color: "#0B0E11" }]}>
              {burn.burnedPercent.toFixed(1)}%
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.scanSummary, { color: colors.foreground }]}>
        {hasBurn
          ? burn.summary
          : burn.summary && burn.summary.length > 0
            ? burn.summary
            : t("memes.burn.noBurn")}
      </Text>
      {burn.burnedAddresses.length > 0 ? (
        <View style={{ gap: 4 }}>
          {burn.burnedAddresses.slice(0, 3).map((b, i) => (
            <View
              key={i}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              }}
            >
              
              <Text
                style={{
                  flex: 1,
                  fontSize: 10,
                  color: colors.mutedForeground,
                  fontFamily: "Helvetica Neue",
                }}
                numberOfLines={1}
              >
                {b.tag || t("memes.burn.deadAddress")} · {shortAddr(b.address)}
              </Text>
              <Text
                style={{
                  fontSize: 10,
                  color: accent,
                  fontFamily: "Helvetica Neue",
                }}
              >
                {b.percent.toFixed(2)}%
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// Generic collapsible wrapper used to hide long card sections (top holders,
// smart wallets, trader analysis) behind a tappable header. Mirrors the
// PriceChartSection pattern — closed by default to keep the meme card scrollable.
function Collapsible({
  title,
  icon,
  accent,
  rightSlot,
  defaultOpen = false,
  colors,
  children,
}: {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  accent: string;
  rightSlot?: React.ReactNode;
  defaultOpen?: boolean;
  colors: any;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          styles.collapsibleToggle,
          {
            borderColor: accent + "55",
            backgroundColor: accent + (pressed ? "22" : "12"),
          },
        ]}
      >
        
        <Text style={[styles.collapsibleTitle, { color: accent }]}>
          {title}
        </Text>
        <View style={{ flex: 1 }} />
        {rightSlot ? (
          <View style={{ marginRight: 6 }}>{rightSlot}</View>
        ) : null}
        
      </Pressable>
      {open ? children : null}
    </View>
  );
}

function TopHoldersSection({
  coin,
  colors,
  t,
  copied,
  onCopy,
  headerless = false,
}: {
  coin: MemeCoin;
  colors: any;
  t: (k: string) => string;
  copied: string | null;
  onCopy: (addr: string, id: string) => void;
  headerless?: boolean;
}) {
  const h = coin.topHolders;
  if (!h || h.list.length === 0) {
    return (
      <View
        style={[
          styles.scanSection,
          {
            backgroundColor: "rgba(255,255,255,0.03)",
            borderColor: colors.border,
          },
        ]}
      >
        {headerless ? null : (
          <View style={styles.scanHead}>
            
            <Text
              style={[styles.scanTitle, { color: colors.mutedForeground }]}
            >
              {t("memes.holders.title")}
            </Text>
          </View>
        )}
        <Text style={[styles.scanSummary, { color: colors.mutedForeground }]}>
          {t("memes.holders.empty")}
        </Text>
      </View>
    );
  }
  const concAccent =
    h.concentrationTop10 > 70
      ? colors.danger
      : h.concentrationTop10 > 40
        ? "#F97316"
        : colors.success;
  return (
    <View
      style={[
        styles.scanSection,
        {
          backgroundColor: "rgba(56,189,248,0.06)",
          borderColor: colors.cyan + "44",
        },
      ]}
    >
      {headerless ? null : (
        <View style={styles.scanHead}>
          
          <Text style={[styles.scanTitle, { color: colors.cyan }]}>
            {t("memes.holders.title")}
          </Text>
          <View
            style={[
              styles.scanStatusPill,
              { backgroundColor: concAccent },
            ]}
          >
            <Text style={[styles.scanStatusText, { color: "#0B0E11" }]}>
              {h.concentrationTop10.toFixed(1)}%
            </Text>
          </View>
        </View>
      )}
      <Text
        style={[styles.scanCellLabel, { color: colors.mutedForeground }]}
      >
        {t("memes.holders.concentration")}:{" "}
        <Text style={{ color: concAccent, fontFamily: "Helvetica Neue" }}>
          {h.concentrationTop10.toFixed(1)}%
        </Text>
        {h.concentrationTop10 > 50 ? (
          <Text style={{ color: colors.danger }}>
            {"  ⚠ "}
            {t("memes.holders.warning")}
          </Text>
        ) : null}
      </Text>
      <View style={{ marginTop: 4 }}>
        {h.list.map((holder, i) => {
          const tagLabel = holder.isContract
            ? t("memes.holders.contract")
            : holder.percent >= 1
              ? t("memes.holders.whale")
              : holder.tag;
          const tagBg = holder.isContract
            ? colors.mutedForeground + "33"
            : holder.percent >= 5
              ? colors.danger + "33"
              : holder.percent >= 1
                ? "#F97316" + "33"
                : colors.success + "22";
          const tagFg = holder.isContract
            ? colors.mutedForeground
            : holder.percent >= 5
              ? colors.danger
              : holder.percent >= 1
                ? "#F97316"
                : colors.success;
          const rowId = `${coin.id}-h-${i}`;
          return (
            <Pressable
              key={rowId}
              onPress={() => onCopy(holder.address, rowId)}
              style={({ pressed }) => [
                styles.holderRow,
                {
                  borderTopColor: colors.border,
                  backgroundColor: pressed
                    ? "rgba(255,255,255,0.04)"
                    : "transparent",
                },
              ]}
            >
              <Text style={[styles.holderRank, { color: colors.mutedForeground }]}>
                #{i + 1}
              </Text>
              <Text
                style={[styles.holderAddr, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {shortAddr(holder.address)}
              </Text>
              {tagLabel ? (
                <View style={[styles.holderTagPill, { backgroundColor: tagBg }]}>
                  <Text style={[styles.holderTagText, { color: tagFg }]}>
                    {tagLabel}
                  </Text>
                </View>
              ) : null}
              {holder.isLocked ? (
                <View
                  style={[
                    styles.holderTagPill,
                    { backgroundColor: colors.success + "33" },
                  ]}
                >
                  <Text style={[styles.holderTagText, { color: colors.success }]}>
                    {t("memes.holders.locked")}
                  </Text>
                </View>
              ) : null}
              
              <Text style={[styles.holderPct, { color: tagFg }]}>
                {holder.percent.toFixed(2)}%
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function formatChartPrice(v: number): string {
  if (!isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1) return `$${v.toFixed(4)}`;
  if (abs >= 0.01) return `$${v.toFixed(5)}`;
  if (abs >= 0.0001) return `$${v.toFixed(7)}`;
  // For ultra-small prices use scientific-ish 2 sig figs after first non-zero
  return `$${v.toExponential(2)}`;
}

function PriceChartSection({
  coin,
  colors,
  t,
}: {
  coin: MemeCoin;
  colors: any;
  t: (k: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [tf, setTf] = useState<ChartTimeframe>("24h");
  const [data, setData] = useState<ChartPayload | null>(null);
  const [loading, setLoading] = useState(false);
  // err === "empty" means upstream said "no data" (true 404) → show graceful
  // empty message; any other truthy value is a real error → show retry button.
  const [err, setErr] = useState<string | null>(null);
  // Cache results per timeframe within this coin instance to avoid refetching
  // when the user toggles back to a previously viewed window.
  const [cache, setCache] = useState<Partial<Record<ChartTimeframe, ChartPayload>>>(
    {},
  );
  // Monotonic request id — increments on every load() invocation. Stale
  // responses (e.g. user tapped 7d then 1h quickly) are dropped because their
  // captured id is no longer the latest.
  const reqIdRef = useRef(0);

  const network = coin.geckoNetwork ?? "";
  const pool = coin.poolAddress ?? "";
  const supported = !!network && !!pool;

  const load = useCallback(
    async (which: ChartTimeframe, isRetry = false) => {
      if (!supported) return;
      const hit = cache[which];
      if (hit) {
        reqIdRef.current += 1; // any in-flight is now stale
        setData(hit);
        setErr(null);
        setLoading(false);
        return;
      }
      const myId = ++reqIdRef.current;
      setLoading(true);
      setErr(null);
      try {
        const res = await api.getMemeChart(network, pool, which);
        if (reqIdRef.current !== myId) return; // stale — drop
        setCache((c) => ({ ...c, [which]: res }));
        setData(res);
      } catch (e: any) {
        if (reqIdRef.current !== myId) return; // stale — drop
        const msg = String(e?.message ?? "");
        // Backend distinguishes truly-no-data (404) from provider failure
        // (503). Surface them differently to the user.
        if (msg.includes("404")) {
          setErr("empty");
          setData(null);
        } else if (msg.includes("503") && !isRetry) {
          // Provider throttled — auto-retry once after a short delay before
          // giving up. Keeps the spinner visible so the user sees we're still
          // trying instead of an immediate red error.
          await new Promise((r) => setTimeout(r, 3000));
          if (reqIdRef.current !== myId) return; // user moved on
          try {
            const res = await api.getMemeChart(network, pool, which);
            if (reqIdRef.current !== myId) return;
            setCache((c) => ({ ...c, [which]: res }));
            setData(res);
            setErr(null);
          } catch (e2: any) {
            if (reqIdRef.current !== myId) return;
            const msg2 = String(e2?.message ?? "");
            setErr(msg2.includes("404") ? "empty" : msg2 || "error");
            setData(null);
          }
        } else {
          setErr(msg || "error");
          setData(null);
        }
      } finally {
        if (reqIdRef.current === myId) setLoading(false);
      }
    },
    [cache, network, pool, supported],
  );

  // Fetch when first opened, or when tf changes while open.
  useEffect(() => {
    if (open) load(tf);
  }, [open, tf, load]);

  const accent = colors.primary;
  const positive = data ? data.changePct >= 0 : true;
  const lineColor = positive ? colors.success : colors.danger;

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={open ? t("memes.chart.hide") : t("memes.chart.show")}
        style={({ pressed }) => [
          styles.chartToggle,
          {
            borderColor: accent + "55",
            backgroundColor: accent + (pressed ? "22" : "12"),
          },
        ]}
      >
        
        <Text style={[styles.chartToggleText, { color: accent }]}>
          {open ? t("memes.chart.hide") : t("memes.chart.show")}
        </Text>
      </Pressable>

      {open ? (
        <View
          style={[
            styles.scanSection,
            {
              backgroundColor: "rgba(255,255,255,0.03)",
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.scanHead}>
            
            <Text style={[styles.scanTitle, { color: accent }]}>
              {t("memes.chart.title")}
            </Text>
            {data ? (
              <Text
                style={{
                  color: positive ? colors.success : colors.danger,
                  fontFamily: "Helvetica Neue",
                  fontSize: 12,
                }}
              >
                {positive ? "+" : ""}
                {data.changePct.toFixed(2)}%
              </Text>
            ) : null}
          </View>

          {!supported ? (
            <Text
              style={[styles.scanSummary, { color: colors.mutedForeground }]}
            >
              {t("memes.chart.unsupported")}
            </Text>
          ) : (
            <>
              {/* Timeframe selector */}
              <View style={styles.tfRow}>
                {(["1h", "24h", "7d"] as ChartTimeframe[]).map((opt) => {
                  const active = tf === opt;
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setTf(opt)}
                      accessibilityRole="button"
                      accessibilityLabel={t(`memes.chart.tf.${opt}`)}
                      style={[
                        styles.tfPill,
                        {
                          borderColor: active ? accent : colors.border,
                          backgroundColor: active
                            ? accent + "22"
                            : "transparent",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.tfPillText,
                          {
                            color: active ? accent : colors.mutedForeground,
                          },
                        ]}
                      >
                        {t(`memes.chart.tf.${opt}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {loading ? (
                <View style={styles.chartLoading}>
                  <ActivityIndicator size="small" color={accent} />
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 11,
                      fontFamily: "Helvetica Neue",
                    }}
                  >
                    {t("memes.chart.loading")}
                  </Text>
                </View>
              ) : err === "empty" ? (
                <Text
                  style={[
                    styles.scanSummary,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {t("memes.chart.empty")}
                </Text>
              ) : err ? (
                <View style={{ gap: 8 }}>
                  <Text
                    style={[
                      styles.scanSummary,
                      { color: colors.danger },
                    ]}
                  >
                    {t("memes.chart.error")}
                  </Text>
                  <Pressable
                    onPress={() => load(tf)}
                    accessibilityRole="button"
                    style={[
                      styles.tfPill,
                      {
                        alignSelf: "flex-start",
                        borderColor: accent,
                        backgroundColor: accent + "22",
                      },
                    ]}
                  >
                    <Text style={[styles.tfPillText, { color: accent }]}>
                      {t("memes.chart.retry")}
                    </Text>
                  </Pressable>
                </View>
              ) : !data || data.points.length < 2 ? (
                <Text
                  style={[styles.scanSummary, { color: colors.mutedForeground }]}
                >
                  {t("memes.chart.empty")}
                </Text>
              ) : (
                <ChartCanvas
                  data={data}
                  bullColor={colors.success}
                  bearColor={colors.danger}
                  axisColor={colors.border}
                  textColor={colors.mutedForeground}
                  accent={accent}
                  t={t}
                />
              )}

              {data && data.points.length >= 2 ? (
                <View style={styles.chartStatsRow}>
                  <ChartStat
                    label={t("memes.chart.last")}
                    value={formatChartPrice(data.last)}
                    color={colors.foreground}
                  />
                  <ChartStat
                    label={t("memes.chart.high")}
                    value={formatChartPrice(data.max)}
                    color={colors.success}
                  />
                  <ChartStat
                    label={t("memes.chart.low")}
                    value={formatChartPrice(data.min)}
                    color={colors.danger}
                  />
                </View>
              ) : null}

              {data ? (
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontSize: 9,
                    fontFamily: "Helvetica Neue",
                    textAlign: "right",
                    letterSpacing: 0.5,
                  }}
                >
                  {t("memes.chart.source")}: {data.source}
                </Text>
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

function ChartStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text
        style={{
          color: "#6B7280",
          fontSize: 9,
          letterSpacing: 0.8,
          fontFamily: "Helvetica Neue",
          marginBottom: 2,
        }}
      >
        {label.toUpperCase()}
      </Text>
      <Text
        style={{
          color,
          fontSize: 12,
          fontFamily: "Helvetica Neue",
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

// ---------- Indicator math (pure functions, lightweight) ----------
// EMA: standard formula with k = 2/(period+1). Returns array same length as
// input; entries before period values fully accumulate are still computed
// as a smoothed running value (no NaNs) — fine for visual overlay.
function calcEma(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const e = i === 0 ? v : v * k + prev * (1 - k);
    out.push(e);
    prev = e;
  }
  return out;
}

// RSI 14 (Wilder smoothing). Returns array of same length; first `period`
// entries are NaN (insufficient data) and skipped during render.
// Edge case: when both avgGain and avgLoss are zero (flat market), RSI is
// undefined — we return 50 (neutral) instead of 100, since 100 would falsely
// trigger overbought signals on a perfectly flat series.
function rsiFromAvg(avgG: number, avgL: number): number {
  if (avgG === 0 && avgL === 0) return 50;
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}
function calcRsi(values: number[], period = 14): number[] {
  const n = values.length;
  const out: number[] = new Array(n).fill(NaN);
  if (n < period + 1) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  out[period] = rsiFromAvg(avgG, avgL);
  for (let i = period + 1; i < n; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = rsiFromAvg(avgG, avgL);
  }
  return out;
}

// Combined "is this near the bottom?" signal. Heuristic — useful as hint,
// not financial advice. Order matters: oversold > capitulation > near support.
function computeBottomSignal(args: {
  rsiLast: number;
  closeLast: number;
  closeMin: number;
  closeMax: number;
  vols: number[];
  isBearLast: boolean;
}):
  | "OVERSOLD"
  | "CAPITULATION"
  | "NEAR_SUPPORT"
  | "OVERBOUGHT"
  | "NEUTRAL" {
  const { rsiLast, closeLast, closeMin, closeMax, vols, isBearLast } = args;
  if (Number.isFinite(rsiLast) && rsiLast >= 70) return "OVERBOUGHT";
  if (Number.isFinite(rsiLast) && rsiLast <= 30) return "OVERSOLD";
  // Capitulation: last bar is bearish AND volume is >2× average of prior bars
  if (vols.length >= 4 && isBearLast) {
    const prior = vols.slice(0, -1);
    const avg = prior.reduce((a, b) => a + b, 0) / Math.max(prior.length, 1);
    if (avg > 0 && vols[vols.length - 1] >= 2 * avg) return "CAPITULATION";
  }
  // Near support: current close within bottom 15% of the visible range
  const range = closeMax - closeMin;
  if (range > 0) {
    const pos = (closeLast - closeMin) / range;
    if (pos <= 0.15) return "NEAR_SUPPORT";
  }
  return "NEUTRAL";
}

function ChartCanvas({
  data,
  bullColor,
  bearColor,
  axisColor,
  textColor,
  accent,
  t,
}: {
  data: ChartPayload;
  bullColor: string;
  bearColor: string;
  axisColor: string;
  textColor: string;
  accent: string;
  t: (k: string) => string;
}) {
  // Layout
  const W = 320;
  const priceH = 130;
  const volH = 26;
  const rsiH = 32;
  const gap = 6;
  const xLabelH = 14;
  const padL = 6;
  const padR = 6;
  const padT = 10;
  const H = padT + priceH + gap + volH + gap + rsiH + xLabelH;
  const innerW = W - padL - padR;

  const priceTop = padT;
  const volTop = priceTop + priceH + gap;
  const rsiTop = volTop + volH + gap;

  // ---------- Data prep ----------
  const points = data.points;
  const n = points.length;
  const validCandles = points.filter(
    (p) => p.o > 0 && p.h > 0 && p.l > 0 && p.c > 0,
  );
  // Forward-fill closes so EMA/RSI series align by index with the candles
  // (and thus with xFor(i)). Filtering would shift indices and misalign the
  // overlays from the time axis.
  const closes: number[] = [];
  let lastValidClose = 0;
  let firstValidIdx = -1;
  for (let i = 0; i < points.length; i++) {
    const c = points[i].c;
    if (c > 0) {
      lastValidClose = c;
      if (firstValidIdx < 0) firstValidIdx = i;
    }
    closes.push(lastValidClose);
  }
  // Trim closes to start from first valid (so EMA seed isn't 0). Track the
  // offset so we can reapply it when plotting.
  const closesAligned = firstValidIdx >= 0 ? closes.slice(firstValidIdx) : [];
  const closeOffset = firstValidIdx >= 0 ? firstValidIdx : 0;
  const validCloseCount = closesAligned.length;
  const vols = points.map((p) => p.v || 0);

  // Price range from candles (H/L) — fallback to closes if no valid candles
  let pMin: number;
  let pMax: number;
  if (validCandles.length >= 2) {
    pMin = Math.min(...validCandles.map((p) => p.l));
    pMax = Math.max(...validCandles.map((p) => p.h));
  } else if (closesAligned.length >= 2) {
    pMin = Math.min(...closesAligned);
    pMax = Math.max(...closesAligned);
  } else {
    pMin = 0;
    pMax = 1;
  }
  if (pMin === pMax) {
    const pad = Math.abs(pMin) * 0.01 || 1;
    pMin -= pad;
    pMax += pad;
  }
  const pRange = pMax - pMin;

  // Indicators (computed off forward-filled closes; chart is small, pennies of CPU).
  // We compute on closesAligned and plot at index (closeOffset + i) so overlays
  // line up with the candle/time axis. Forward-filling avoids index shifts that
  // would otherwise misalign the overlay from the candles.
  const ema9 = closesAligned.length >= 2 ? calcEma(closesAligned, 9) : [];
  const ema21 = closesAligned.length >= 2 ? calcEma(closesAligned, 21) : [];
  const rsi = closesAligned.length >= 15 ? calcRsi(closesAligned, 14) : [];

  // Support / Resistance — recent visible low / high
  const support = pMin;
  const resistance = pMax;

  // Volume scale
  const volMax = Math.max(...vols, 0) || 1;

  // Coordinate transforms
  const xFor = (i: number) =>
    padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yPrice = (v: number) =>
    priceTop + (1 - (v - pMin) / pRange) * priceH;
  const yVol = (v: number) => volTop + (1 - v / volMax) * volH;
  const yRsi = (v: number) => rsiTop + (1 - v / 100) * rsiH;

  // X-axis tick labels (start, mid, end)
  const labelTimes = [0, Math.floor((n - 1) / 2), n - 1].map((idx) => {
    const ts = points[idx]?.t ?? 0;
    const d = new Date(ts * 1000);
    let label = "";
    if (data.timeframe === "1h" || data.timeframe === "24h") {
      label = `${d.getHours().toString().padStart(2, "0")}:${d
        .getMinutes()
        .toString()
        .padStart(2, "0")}`;
    } else {
      label = `${d.getDate()}/${d.getMonth() + 1}`;
    }
    return { idx, label };
  });

  const candleW = Math.max(2, Math.min(10, (innerW / Math.max(n, 1)) * 0.65));
  const volBarW = Math.max(1.5, candleW * 0.85);

  // Build line path with index offset so overlays land on the right candles.
  const buildLinePath = (
    vals: number[],
    yMap: (v: number) => number,
    offset: number,
  ) => {
    let p = "";
    let started = false;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (!Number.isFinite(v)) continue;
      const x = xFor(i + offset);
      const y = yMap(v);
      p += !started ? `M ${x} ${y}` : ` L ${x} ${y}`;
      started = true;
    }
    return p;
  };
  const ema9Path = ema9.length ? buildLinePath(ema9, yPrice, closeOffset) : "";
  const ema21Path = ema21.length
    ? buildLinePath(ema21, yPrice, closeOffset)
    : "";
  const rsiPath = rsi.length ? buildLinePath(rsi, yRsi, closeOffset) : "";

  // Bottom signal (computed once). When we have no usable closes, force
  // NEUTRAL — the price-range fallback (0..1) would otherwise produce a
  // false NEAR_SUPPORT.
  const lastClose = closesAligned[closesAligned.length - 1] ?? 0;
  const lastRsi = rsi.length ? rsi[rsi.length - 1] : NaN;
  const lastBar = points[points.length - 1];
  const isBearLast = !!(lastBar && lastBar.c > 0 && lastBar.o > 0 && lastBar.c < lastBar.o);
  const signal: ReturnType<typeof computeBottomSignal> =
    validCloseCount === 0
      ? "NEUTRAL"
      : computeBottomSignal({
          rsiLast: lastRsi,
          closeLast: lastClose,
          closeMin: pMin,
          closeMax: pMax,
          vols,
          isBearLast,
        });
  const signalColor =
    signal === "OVERSOLD" || signal === "CAPITULATION" || signal === "NEAR_SUPPORT"
      ? bullColor
      : signal === "OVERBOUGHT"
        ? bearColor
        : textColor;

  // Colors for indicators
  const ema9Color = "#F5C842"; // gold
  const ema21Color = "#5BB6F2"; // light blue
  const supportColor = bullColor;
  const resistanceColor = bearColor;

  return (
    <View style={{ alignItems: "center", gap: 6 }}>
      {/* Bottom signal banner */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          alignSelf: "stretch",
          paddingHorizontal: 6,
        }}
      >
        
        <Text
          style={{
            color: signalColor,
            fontFamily: "Helvetica Neue",
            fontSize: 10,
            letterSpacing: 0.5,
          }}
        >
          {t(`memes.chart.signal.${signal.toLowerCase()}`)}
        </Text>
        {validCloseCount > 0 && Number.isFinite(lastRsi) ? (
          <Text
            style={{
              color: textColor,
              fontFamily: "Helvetica Neue",
              fontSize: 9,
              marginLeft: "auto",
            }}
          >
            RSI {lastRsi.toFixed(0)}
          </Text>
        ) : null}
      </View>

      <Svg width={W} height={H}>
        {/* Price area horizontal grid (top, mid, bottom) */}
        {[0, 0.5, 1].map((f, i) => (
          <SvgLine
            key={`pg${i}`}
            x1={padL}
            x2={padL + innerW}
            y1={priceTop + f * priceH}
            y2={priceTop + f * priceH}
            stroke={axisColor}
            strokeWidth={0.5}
            opacity={0.5}
          />
        ))}

        {/* Resistance line (red dashed) */}
        <SvgLine
          x1={padL}
          x2={padL + innerW}
          y1={yPrice(resistance)}
          y2={yPrice(resistance)}
          stroke={resistanceColor}
          strokeWidth={0.8}
          strokeDasharray="3,3"
          opacity={0.7}
        />
        <SvgText
          x={padL + 2}
          y={yPrice(resistance) - 2}
          fontSize={8}
          fill={resistanceColor}
        >
          R
        </SvgText>
        {/* Support line (green dashed) */}
        <SvgLine
          x1={padL}
          x2={padL + innerW}
          y1={yPrice(support)}
          y2={yPrice(support)}
          stroke={supportColor}
          strokeWidth={0.8}
          strokeDasharray="3,3"
          opacity={0.7}
        />
        <SvgText
          x={padL + 2}
          y={yPrice(support) + 8}
          fontSize={8}
          fill={supportColor}
        >
          S
        </SvgText>

        {/* Candles (or fallback line if no valid candles) */}
        {validCandles.length >= 2 ? (
          points.map((p, i) => {
            if (!(p.h > 0) || !(p.l > 0) || !(p.o > 0) || !(p.c > 0))
              return null;
            const isBull = p.c >= p.o;
            const color = isBull ? bullColor : bearColor;
            const cx = xFor(i);
            const yHigh = yPrice(p.h);
            const yLow = yPrice(p.l);
            const yOpen = yPrice(p.o);
            const yClose = yPrice(p.c);
            const bodyTop = Math.min(yOpen, yClose);
            const bodyHRaw = Math.abs(yClose - yOpen);
            const isDoji = bodyHRaw < 0.5;
            return (
              <React.Fragment key={`c${i}`}>
                <SvgLine
                  x1={cx}
                  x2={cx}
                  y1={yHigh}
                  y2={yLow}
                  stroke={color}
                  strokeWidth={1}
                />
                {isDoji ? (
                  <SvgLine
                    x1={cx - candleW / 2}
                    x2={cx + candleW / 2}
                    y1={yClose}
                    y2={yClose}
                    stroke={color}
                    strokeWidth={1}
                  />
                ) : (
                  <Rect
                    x={cx - candleW / 2}
                    y={bodyTop}
                    width={candleW}
                    height={bodyHRaw}
                    fill={color}
                    opacity={isBull ? 0.95 : 1}
                  />
                )}
              </React.Fragment>
            );
          })
        ) : (
          <Path
            d={buildLinePath(closesAligned, yPrice, closeOffset)}
            stroke={accent}
            strokeWidth={1.5}
            fill="none"
          />
        )}

        {/* EMA9 (gold) */}
        {ema9Path ? (
          <Path
            d={ema9Path}
            stroke={ema9Color}
            strokeWidth={1.2}
            fill="none"
            opacity={0.9}
          />
        ) : null}
        {/* EMA21 (blue) */}
        {ema21Path ? (
          <Path
            d={ema21Path}
            stroke={ema21Color}
            strokeWidth={1.2}
            fill="none"
            opacity={0.85}
          />
        ) : null}

        {/* Volume panel */}
        <SvgLine
          x1={padL}
          x2={padL + innerW}
          y1={volTop + volH}
          y2={volTop + volH}
          stroke={axisColor}
          strokeWidth={0.5}
          opacity={0.5}
        />
        {points.map((p, i) => {
          const v = p.v || 0;
          if (v <= 0) return null;
          const isBull = p.c >= p.o;
          const color = isBull ? bullColor : bearColor;
          const yTop = yVol(v);
          const h = volTop + volH - yTop;
          return (
            <Rect
              key={`v${i}`}
              x={xFor(i) - volBarW / 2}
              y={yTop}
              width={volBarW}
              height={Math.max(0.5, h)}
              fill={color}
              opacity={0.55}
            />
          );
        })}
        <SvgText
          x={padL + 2}
          y={volTop + 8}
          fontSize={7}
          fill={textColor}
          opacity={0.75}
        >
          VOL
        </SvgText>

        {/* RSI panel */}
        {/* 30 line (oversold) */}
        <SvgLine
          x1={padL}
          x2={padL + innerW}
          y1={yRsi(30)}
          y2={yRsi(30)}
          stroke={bullColor}
          strokeWidth={0.5}
          strokeDasharray="2,2"
          opacity={0.6}
        />
        {/* 70 line (overbought) */}
        <SvgLine
          x1={padL}
          x2={padL + innerW}
          y1={yRsi(70)}
          y2={yRsi(70)}
          stroke={bearColor}
          strokeWidth={0.5}
          strokeDasharray="2,2"
          opacity={0.6}
        />
        {/* RSI line */}
        {rsiPath ? (
          <Path
            d={rsiPath}
            stroke={accent}
            strokeWidth={1.2}
            fill="none"
            opacity={0.9}
          />
        ) : null}
        <SvgText
          x={padL + 2}
          y={rsiTop + 8}
          fontSize={7}
          fill={textColor}
          opacity={0.75}
        >
          RSI 14
        </SvgText>

        {/* X-axis labels */}
        {labelTimes.map(({ idx, label }, i) => (
          <SvgText
            key={`xl${i}`}
            x={xFor(idx)}
            y={H - 3}
            fontSize={9}
            fill={textColor}
            textAnchor={
              i === 0 ? "start" : i === labelTimes.length - 1 ? "end" : "middle"
            }
          >
            {label}
          </SvgText>
        ))}
      </Svg>

      {/* Indicator legend */}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          alignSelf: "stretch",
          paddingHorizontal: 4,
        }}
      >
        <LegendDot color={ema9Color} label="EMA9" textColor={textColor} />
        <LegendDot color={ema21Color} label="EMA21" textColor={textColor} />
        <LegendDot color={supportColor} label="S" textColor={textColor} dashed />
        <LegendDot
          color={resistanceColor}
          label="R"
          textColor={textColor}
          dashed
        />
      </View>
    </View>
  );
}

function LegendDot({
  color,
  label,
  textColor,
  dashed = false,
}: {
  color: string;
  label: string;
  textColor: string;
  dashed?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <View
        style={{
          width: 10,
          height: 0,
          borderTopWidth: 1.4,
          borderTopColor: color,
          borderStyle: dashed ? "dashed" : "solid",
        }}
      />
      <Text
        style={{
          color: textColor,
          fontSize: 9,
          fontFamily: "Helvetica Neue",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// ─── EARLY GEM SECTION ───────────────────────────────────────────────────────

function EarlyGemSection({ coin, colors }: { coin: MemeCoin; colors: any }) {
  const [expanded, setExpanded] = React.useState(false);

  const label = coin.earlyGemLabel;
  const score = coin.earlyGemScore ?? 0;
  const signals = coin.earlyGemSignals ?? [];

  if (!label || label === "BIASA") return null;

  const isGem = label === "GEM";
  const accent = isGem ? "#F59E0B" : "#8B5CF6";
  const bgColor = isGem ? "rgba(245,158,11,0.07)" : "rgba(139,92,246,0.07)";
  const borderColor = isGem ? "rgba(245,158,11,0.35)" : "rgba(139,92,246,0.35)";
  const icon = isGem ? "star" : "search";
  const title = isGem ? "⭐ EARLY GEM — KANDIDAT BREAKOUT" : "🔍 POTENSIAL BREAKOUT";
  const subtitle = isGem
    ? "Pola mirip DOGE/SHIB/WIF di fase awal sebelum viral"
    : "Sinyal awal terbentuk, pantau terus";

  return (
    <View style={[styles.egCard, { backgroundColor: bgColor, borderColor }]}>
      {/* Header */}
      <Pressable style={styles.egHeader} onPress={() => setExpanded((v) => !v)}>
        
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Text style={[styles.egTitle, { color: accent }]}>{title}</Text>
          <Text style={[styles.egSubtitle, { color: accent + "BB" }]}>{subtitle}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 3 }}>
          <View style={[styles.egScorePill, { backgroundColor: accent + "22", borderColor: accent }]}>
            <Text style={[styles.egScoreText, { color: accent }]}>{score}<Text style={{ fontSize: 9 }}>/100</Text></Text>
          </View>
          
        </View>
      </Pressable>

      {/* Score bar */}
      <View style={[styles.egBarBg, { marginHorizontal: 12, marginBottom: expanded ? 0 : 10 }]}>
        <View style={[styles.egBarFill, { width: `${score}%` as any, backgroundColor: accent }]} />
      </View>

      {/* Expanded signals */}
      {expanded && signals.length > 0 && (
        <View style={styles.egBody}>
          <View style={[styles.miDivider, { backgroundColor: borderColor, marginBottom: 8 }]} />
          <Text style={[styles.egSectionLabel, { color: accent }]}>MENGAPA BERPOTENSI VIRAL</Text>
          {signals.map((s, i) => (
            <View key={i} style={styles.egSignalRow}>
              <Text style={{ color: accent, fontSize: 10, marginTop: 1 }}>✦</Text>
              <Text style={[styles.egSignalText, { color: colors.foreground }]}>{s}</Text>
            </View>
          ))}
          <View style={[styles.egDisclaimerBox, { backgroundColor: "rgba(255,255,255,0.04)", borderColor: colors.border }]}>
            
            <Text style={[styles.egDisclaimerText, { color: colors.mutedForeground }]}>
              Ini analisis pola — bukan jaminan profit. Meme coin sangat berisiko. Selalu DYOR dan jangan invest lebih dari yang siap kamu rugi.
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── MEME INDICATORS SECTION ────────────────────────────────────────────────

function MemeIndicatorsSection({ coin, colors }: { coin: MemeCoin; colors: any }) {
  const [expanded, setExpanded] = React.useState(false);

  const hasData =
    coin.viralLabel !== undefined ||
    coin.organicLabel !== undefined ||
    coin.manipulationRisk !== undefined;
  if (!hasData) return null;

  const viral = coin.viralLabel ?? "QUIET";
  const organic = coin.organicLabel ?? "MODERAT";
  const manip = coin.manipulationRisk ?? "WASPADA";

  const viralColor =
    viral === "VIRAL" ? "#EC4899" : viral === "TRENDING" ? "#F59E0B" : colors.mutedForeground;
  const organicColor =
    organic === "ORGANIK" ? "#16A34A" : organic === "MODERAT" ? "#F59E0B" : colors.danger;
  const manipColor =
    manip === "AMAN" ? "#16A34A" : manip === "WASPADA" ? "#F59E0B" : colors.danger;

  const cleanDays = coin.cleanDays30d;
  const cleanLabel =
    cleanDays === undefined || cleanDays === -1
      ? "Data intraday"
      : cleanDays >= 25
        ? `${cleanDays}/30 hari bersih`
        : `${cleanDays}/30 hari bersih`;

  return (
    <View
      style={[
        styles.miCard,
        { backgroundColor: "rgba(99,102,241,0.06)", borderColor: "rgba(99,102,241,0.25)" },
      ]}
    >
      {/* Header */}
      <Pressable
        style={styles.miHeader}
        onPress={() => setExpanded((v) => !v)}
      >
        
        <Text style={[styles.miTitle, { color: "#6366F1" }]}>INDIKATOR MEME KHUSUS</Text>
        <View style={{ flexDirection: "row", gap: 4, marginLeft: "auto", alignItems: "center" }}>
          <View style={[styles.miBadge, { backgroundColor: viralColor + "22", borderColor: viralColor }]}>
            <Text style={{ color: viralColor, fontSize: 8, fontFamily: "Helvetica Neue" }}>{viral}</Text>
          </View>
          <View style={[styles.miBadge, { backgroundColor: organicColor + "22", borderColor: organicColor }]}>
            <Text style={{ color: organicColor, fontSize: 8, fontFamily: "Helvetica Neue" }}>{organic}</Text>
          </View>
          <View style={[styles.miBadge, { backgroundColor: manipColor + "22", borderColor: manipColor }]}>
            <Text style={{ color: manipColor, fontSize: 8, fontFamily: "Helvetica Neue" }}>{manip}</Text>
          </View>
          
        </View>
      </Pressable>

      {expanded && (
        <View style={styles.miBody}>
          {/* Divider */}
          <View style={[styles.miDivider, { backgroundColor: "rgba(99,102,241,0.2)" }]} />

          {/* 1. VIRAL MEME */}
          <MemeIndicatorRow
            icon="zap"
            label="🔥 VIRAL MEME"
            badge={viral}
            badgeColor={viralColor}
            score={coin.viralScore}
            signals={coin.viralSignals ?? []}
            colors={colors}
          />

          <View style={[styles.miDivider, { backgroundColor: colors.border }]} />

          {/* 2. KOMUNITAS ORGANIK */}
          <MemeIndicatorRow
            icon="users"
            label="🌱 KOMUNITAS ORGANIK"
            badge={organic}
            badgeColor={organicColor}
            score={coin.organicScore}
            signals={coin.organicSignals ?? []}
            colors={colors}
          />

          <View style={[styles.miDivider, { backgroundColor: colors.border }]} />

          {/* 3. BEBAS MANIPULASI 30 HARI */}
          <MemeIndicatorRow
            icon="shield"
            label="🛡️ BEBAS MANIPULASI"
            badge={manip}
            badgeColor={manipColor}
            score={undefined}
            signals={coin.manipulationFlags ?? []}
            colors={colors}
            extra={cleanLabel}
          />
        </View>
      )}
    </View>
  );
}

function MemeIndicatorRow({
  label,
  badge,
  badgeColor,
  score,
  signals,
  colors,
  extra,
}: {
  icon: string;
  label: string;
  badge: string;
  badgeColor: string;
  score?: number;
  signals: string[];
  colors: any;
  extra?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Pressable style={styles.miRow} onPress={() => setOpen((v) => !v)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[styles.miRowLabel, { color: colors.foreground }]}>{label}</Text>
            <View style={[styles.miBadge, { backgroundColor: badgeColor + "22", borderColor: badgeColor }]}>
              <Text style={{ color: badgeColor, fontSize: 9, fontFamily: "Helvetica Neue" }}>{badge}</Text>
            </View>
            {extra ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: "Helvetica Neue" }}>
                {extra}
              </Text>
            ) : null}
            {null}
          </View>
          {score !== undefined ? (
            <View style={styles.miScoreBar}>
              <View style={[styles.miScoreFill, { width: `${Math.min(100, score)}%` as any, backgroundColor: badgeColor }]} />
            </View>
          ) : null}
        </View>
        {score !== undefined ? (
          <Text style={[styles.miScore, { color: badgeColor }]}>{score}</Text>
        ) : null}
      </View>
      {open && signals.length > 0 && (
        <View style={styles.miSignals}>
          {signals.map((s, i) => (
            <View key={i} style={styles.miSignalRow}>
              <Text style={{ color: badgeColor, fontSize: 9 }}>•</Text>
              <Text style={[styles.miSignalText, { color: colors.mutedForeground }]}>{s}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

function WatchlistWarningsSection({
  coin,
  colors,
  t,
}: {
  coin: MemeCoin;
  colors: any;
  t: (k: string) => string;
}) {
  if (coin.tier !== "WATCHLIST") return null;
  const warnings = coin.warnings ?? [];
  if (warnings.length === 0) return null;
  const amber = "#F59E0B";
  return (
    <View
      style={[
        styles.scanSection,
        {
          backgroundColor: "rgba(245,158,11,0.10)",
          borderColor: amber + "66",
        },
      ]}
    >
      <View style={styles.scanHead}>
        
        <Text style={[styles.scanTitle, { color: amber }]}>
          {t("memes.warnings.title")}
        </Text>
        <View style={[styles.scanStatusPill, { backgroundColor: amber }]}>
          <Text style={[styles.scanStatusText, { color: "#0B0E11" }]}>
            {warnings.length}
          </Text>
        </View>
      </View>
      <Text style={[styles.scanSummary, { color: colors.mutedForeground }]}>
        {t("memes.warnings.intro")}
      </Text>
      <View style={{ marginTop: 8, gap: 6 }}>
        {warnings.map((w, idx) => {
          const key = `memes.warning.${w}`;
          const text = t(key);
          // Fall back to raw key if translation missing
          const display = text === key ? w : text;
          return (
            <View
              key={`${w}-${idx}`}
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: amber,
                  marginTop: 6,
                }}
              />
              <Text
                style={{
                  flex: 1,
                  color: colors.foreground,
                  fontSize: 12,
                  lineHeight: 17,
                  fontFamily: "Helvetica Neue",
                }}
              >
                {display}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function SmartWalletsSection({
  coin,
  colors,
  t,
  copied,
  onCopy,
  headerless = false,
}: {
  coin: MemeCoin;
  colors: any;
  t: (k: string) => string;
  copied: string | null;
  onCopy: (addr: string, id: string) => void;
  headerless?: boolean;
}) {
  const sw = coin.smartWallets ?? [];
  if (sw.length === 0) {
    return (
      <View
        style={[
          styles.scanSection,
          {
            backgroundColor: "rgba(255,255,255,0.03)",
            borderColor: colors.border,
          },
        ]}
      >
        {headerless ? null : (
          <View style={styles.scanHead}>
            
            <Text
              style={[styles.scanTitle, { color: colors.mutedForeground }]}
            >
              {t("memes.smart.title")}
            </Text>
          </View>
        )}
        <Text style={[styles.scanSummary, { color: colors.mutedForeground }]}>
          {t("memes.smart.empty")}
        </Text>
      </View>
    );
  }

  const lockedCount = sw.filter((w) => w.isLocked).length;
  const headlineColor =
    sw.length >= 3 || lockedCount >= 2 ? colors.success : "#F59E0B";
  const labelColor = (label: string) => {
    if (label === "LOCKED_ACCUMULATOR") return colors.success;
    if (label === "EARLY_WHALE") return "#A855F7";
    if (label === "CONVICTION_HOLDER") return colors.cyan;
    return "#F59E0B";
  };
  const labelText = (label: string) => {
    if (label === "LOCKED_ACCUMULATOR")
      return t("memes.smart.label.lockedAccumulator");
    if (label === "EARLY_WHALE") return t("memes.smart.label.earlyWhale");
    if (label === "CONVICTION_HOLDER")
      return t("memes.smart.label.convictionHolder");
    return t("memes.smart.label.smartMoney");
  };

  return (
    <View
      style={[
        styles.scanSection,
        {
          backgroundColor: "rgba(168,85,247,0.08)",
          borderColor: "#A855F7" + "55",
        },
      ]}
    >
      {headerless ? null : (
        <View style={styles.scanHead}>
          
          <Text style={[styles.scanTitle, { color: "#A855F7" }]}>
            {t("memes.smart.title")}
          </Text>
          <View
            style={[
              styles.scanStatusPill,
              { backgroundColor: headlineColor },
            ]}
          >
            <Text style={[styles.scanStatusText, { color: "#0B0E11" }]}>
              {sw.length} {t("memes.smart.detected")}
            </Text>
          </View>
        </View>
      )}
      <Text style={[styles.scanSummary, { color: colors.mutedForeground }]}>
        {t("memes.smart.summary")}{" "}
        <Text style={{ color: colors.success, fontFamily: "Helvetica Neue" }}>
          {lockedCount}
        </Text>{" "}
        {t("memes.smart.lockedCount")}
      </Text>
      <View style={{ marginTop: 4 }}>
        {sw.map((w, i) => {
          const rowId = `${coin.id}-sw-${i}`;
          const lc = labelColor(w.label);
          return (
            <View key={rowId} style={{ marginTop: i === 0 ? 6 : 8 }}>
              <Pressable
                onPress={() => onCopy(w.address, rowId)}
                style={({ pressed }) => [
                  styles.holderRow,
                  {
                    borderTopColor: colors.border,
                    backgroundColor: pressed
                      ? "rgba(255,255,255,0.04)"
                      : "transparent",
                  },
                ]}
              >
                <Text style={[styles.holderRank, { color: colors.mutedForeground }]}>
                  #{i + 1}
                </Text>
                <Text
                  style={[styles.holderAddr, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {w.shortAddress}
                </Text>
                <View
                  style={[styles.holderTagPill, { backgroundColor: lc + "33" }]}
                >
                  <Text style={[styles.holderTagText, { color: lc }]}>
                    {labelText(w.label)}
                  </Text>
                </View>
                {w.isLocked ? (
                  <View
                    style={[
                      styles.holderTagPill,
                      { backgroundColor: colors.success + "33" },
                    ]}
                  >
                    <Text style={[styles.holderTagText, { color: colors.success }]}>
                      {t("memes.smart.locked")}
                    </Text>
                  </View>
                ) : null}
                
                <Text style={[styles.holderPct, { color: lc }]}>
                  {w.percent.toFixed(2)}%
                </Text>
              </Pressable>
              <Text
                style={{
                  fontSize: 10,
                  color: colors.mutedForeground,
                  fontFamily: "Helvetica Neue",
                  marginTop: 2,
                  marginLeft: 24,
                  lineHeight: 14,
                }}
              >
                {w.reason}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
