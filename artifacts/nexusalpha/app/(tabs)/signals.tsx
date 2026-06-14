import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Header } from "@/components/Header";
import { useColors } from "@/hooks/useColors";
import { api, formatNumber } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { cacheGet, cacheSet, memGet, memSet } from "@/lib/persistentCache";
import {
  ScalpingPlan,
  ScoreBreakdown,
  SUPPORTED_PAIRS,
  TradingPair,
  TradingSignal,
} from "@/lib/types";

// Backend cache TTL is 5 min — match it client-side so we don't show
// signals the server would have already invalidated.
const SIGNAL_CACHE_MAX_AGE = 5 * 60 * 1000;
const signalCacheKey = (pair: TradingPair, lang: string) =>
  `signal.${pair}.${lang}`;

export default function SignalsScreen() {
  const colors = useColors();
  const t = useT();
  const { lang } = useLang();
  const [pair, setPair] = useState<TradingPair>("BTCUSDT");
  // Hydrate from in-memory snapshot for instant tab navigation.
  const initialSignal = memGet<TradingSignal>(
    signalCacheKey("BTCUSDT", lang),
    SIGNAL_CACHE_MAX_AGE,
  );
  const [signal, setSignal] = useState<TradingSignal | null>(initialSignal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tgSending, setTgSending] = useState(false);
  const [tgSent, setTgSent] = useState(false);
  const TELEGRAM_CHAT_ID = "305425021";

  const sendToTelegram = async () => {
    if (!signal || tgSending) return;
    setTgSending(true);
    setTgSent(false);
    try {
      const res = await fetch(`${api.baseUrl}/telegram/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: TELEGRAM_CHAT_ID, signal }),
      });
      const data = await res.json();
      if (data.success) {
        setTgSent(true);
        setTimeout(() => setTgSent(false), 3000);
      }
    } catch {
      // silent fail
    } finally {
      setTgSending(false);
    }
  };
  const requestIdRef = useRef(0);

  // When language changes, drop the current signal — its narrative text is
  // in the wrong language. We try the other-language cache for the same pair
  // before clearing entirely so the user still gets instant content if cached.
  React.useEffect(() => {
    requestIdRef.current += 1;
    const cached = memGet<TradingSignal>(
      signalCacheKey(pair, lang),
      SIGNAL_CACHE_MAX_AGE,
    );
    if (cached) {
      setSignal(cached);
    } else {
      setSignal(null);
      // Disk fallback — async, so we use the requestId guard.
      const myReq = requestIdRef.current;
      cacheGet<TradingSignal>(
        signalCacheKey(pair, lang),
        SIGNAL_CACHE_MAX_AGE,
      ).then((hit) => {
        if (requestIdRef.current !== myReq) return;
        if (hit) {
          setSignal(hit.value);
          memSet(signalCacheKey(pair, lang), hit.value);
        }
      });
    }
    setError(null);
    setLoading(false);
  }, [lang, pair]);

  const generate = async (selected: TradingPair) => {
    const myRequestId = ++requestIdRef.current;
    const myLang = lang;
    setPair(selected);
    // Hydrate from cache before regenerating so the user sees the previous
    // result immediately instead of an empty card while Gemini runs.
    const cached =
      memGet<TradingSignal>(
        signalCacheKey(selected, myLang),
        SIGNAL_CACHE_MAX_AGE,
      ) ?? null;
    if (cached) {
      setSignal(cached);
    } else {
      setSignal(null);
    }
    setLoading(true);
    setError(null);
    try {
      const prices = await api.getPrices([selected]);
      const result = await api.generateSignal(
        selected,
        prices[0],
        myLang,
      );
      if (requestIdRef.current !== myRequestId) return;
      setSignal(result);
      // Persist for instant subsequent loads.
      memSet(signalCacheKey(selected, myLang), result);
      cacheSet(signalCacheKey(selected, myLang), result);
    } catch (e: any) {
      if (requestIdRef.current !== myRequestId) return;
      if (e?.message === "QUOTA_EXCEEDED") {
        setError(t("common.quotaError"));
      } else if (e?.message === "AI_RESPONSE_TRUNCATED") {
        setError(t("signals.truncatedError"));
      } else {
        setError(t("signals.error"));
      }
    } finally {
      if (requestIdRef.current === myRequestId) setLoading(false);
    }
  };

  const structColor = (s: TradingSignal["marketStructure"]) =>
    s === "BULLISH"
      ? colors.success
      : s === "BEARISH"
        ? colors.danger
        : colors.mutedForeground;

  const sideColor =
    !signal || signal.side === "NO_TRADE"
      ? colors.mutedForeground
      : signal.side === "BUY"
        ? colors.success
        : colors.danger;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header subtitle={t("header.signals")} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      >
        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          {t("signals.selectPair")}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
          style={{ marginBottom: 16 }}
        >
          {SUPPORTED_PAIRS.map((p) => {
            const active = pair === p;
            return (
              <Pressable
                key={p}
                onPress={() => setPair(p)}
                style={[
                  styles.pill,
                  {
                    backgroundColor: active ? colors.primary : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.pillText,
                    {
                      color: active
                        ? colors.primaryForeground
                        : colors.foreground,
                    },
                  ]}
                >
                  {p.replace("USDT", "")}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable
          disabled={loading}
          onPress={() => generate(pair)}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: pressed ? "#D4A300" : colors.primary,
              opacity: loading ? 0.6 : 1,
            },
          ]}
        >
          
          <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>
            {loading ? t("signals.cta.loading") : t("signals.cta.generate")}
          </Text>
        </Pressable>

        <View
          style={[
            styles.discBox,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          
          <Text style={[styles.discText, { color: colors.mutedForeground }]}>
            {t("signals.disclaimer")}
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

        {loading ? (
          <View
            style={[
              styles.loaderBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loaderText, { color: colors.mutedForeground }]}>
              {t("signals.loaderText")}
            </Text>
          </View>
        ) : null}

        {signal ? (
          <View
            style={[
              styles.signalCard,
              {
                backgroundColor: colors.card,
                borderColor:
                  signal.noTrade ? colors.border : sideColor + "55",
              },
            ]}
          >
            {/* Header Row */}
            <View style={styles.signalHead}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.signalPair, { color: colors.foreground }]}
                >
                  {signal.pair}
                </Text>
                <Text
                  style={[
                    styles.signalStyle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {signal.traderStyle}
                </Text>
                {signal.isFallback ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      marginTop: 4,
                      alignSelf: "flex-start",
                      backgroundColor: "#F59E0B22",
                      borderColor: "#F59E0B",
                      borderWidth: 1,
                      borderRadius: 6,
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      gap: 4,
                    }}
                  >
                    
                    <Text style={{ color: "#F59E0B", fontSize: 10, fontFamily: "Helvetica Neue" }}>
                      MODE TEKNIKAL
                    </Text>
                  </View>
                ) : null}
              </View>
              <View
                style={[
                  styles.sideBadge,
                  {
                    backgroundColor: sideColor + "22",
                    borderColor: sideColor,
                  },
                ]}
              >
                
                <Text style={[styles.sideText, { color: sideColor }]}>
                  {signal.side}
                </Text>
              </View>
            </View>

            {/* Market Structure + TF pills */}
            <View style={styles.metaRow}>
              <View
                style={[
                  styles.metaPill,
                  {
                    backgroundColor:
                      structColor(signal.marketStructure) + "1A",
                    borderColor: structColor(signal.marketStructure),
                  },
                ]}
              >
                
                <Text
                  style={[
                    styles.metaText,
                    { color: structColor(signal.marketStructure) },
                  ]}
                >
                  {signal.marketStructure}
                </Text>
              </View>
              {!signal.noTrade ? (
                <View
                  style={[
                    styles.metaPill,
                    {
                      backgroundColor: colors.primary + "1A",
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  
                  <Text style={[styles.metaText, { color: colors.primary }]}>
                    R:R {signal.riskReward}
                  </Text>
                </View>
              ) : null}
              {signal.timeframe ? (
                <View
                  style={[
                    styles.metaPill,
                    {
                      backgroundColor: colors.cyan + "1A",
                      borderColor: colors.cyan,
                    },
                  ]}
                >
                  
                  <Text style={[styles.metaText, { color: colors.cyan }]}>
                    {signal.timeframe}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* NO TRADE explanation */}
            {signal.noTrade ? (
              <View
                style={[
                  styles.noTradeBox,
                  {
                    backgroundColor: "rgba(239,68,68,0.05)",
                    borderColor: "rgba(239,68,68,0.3)",
                  },
                ]}
              >
                <View style={styles.noTradeHeader}>
                  
                  <Text
                    style={[styles.noTradeTitle, { color: colors.danger }]}
                  >
                    {t("signals.noTradeTitle")}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.noTradeText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {signal.noTradeReason ?? t("signals.noTradeFallback")}
                </Text>
              </View>
            ) : null}

            {/* Confidence bar */}
            <View style={styles.confidenceBox}>
              <View style={styles.confLabelRow}>
                <Text
                  style={[styles.minLabel, { color: colors.mutedForeground }]}
                >
                  {t("signals.confidence")}
                </Text>
                <Text
                  style={[
                    styles.confThreshold,
                    {
                      color:
                        (signal.confidence >= 45 && signal.confidence < 55)
                          ? colors.success
                          : colors.danger,
                    },
                  ]}
                >
                  {(signal.confidence >= 45 && signal.confidence < 55)
                    ? t("signals.confValid")
                    : t("signals.confBelowThreshold")}
                </Text>
              </View>
              <View
                style={[
                  styles.bar,
                  { backgroundColor: "rgba(255,255,255,0.06)" },
                ]}
              >
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${Math.min(signal.confidence, 100)}%`,
                      backgroundColor:
                        (signal.confidence >= 45 && signal.confidence < 55)
                          ? colors.success
                          : colors.danger,
                    },
                  ]}
                />
              </View>
              <Text
                style={[
                  styles.confValue,
                  {
                    color:
                      (signal.confidence >= 45 && signal.confidence < 55) ? colors.success : colors.danger,
                  },
                ]}
              >
                {signal.confidence}/100
              </Text>
            </View>

            {/* Score breakdown */}
            {signal.scoreBreakdown ? (
              <ScoreCard
                score={signal.scoreBreakdown}
                colors={colors}
              />
            ) : null}

            {/* Trade stats — hide for NO_TRADE */}
            {!signal.noTrade ? (
              <View style={styles.statGrid}>
                <Stat
                  label={t("signals.entry")}
                  value={signal.entryRange}
                  colors={colors}
                />
                <Stat
                  label={t("signals.stopLoss")}
                  value={`${signal.stopLoss}${signal.stopLossRiskPct ? ` (${signal.stopLossRiskPct})` : ""}`}
                  colors={colors}
                  valueColor={colors.danger}
                />

                <Stat
                  label={t("signals.support")}
                  value={`${signal.keySupport}`}
                  colors={colors}
                  valueColor={colors.cyan}
                />
                <Stat
                  label={t("signals.resistance")}
                  value={`${signal.keyResistance}`}
                  colors={colors}
                  valueColor={colors.fuchsia}
                />
              </View>
            ) : null}



            {/* Leverage & Risk Calculator */}
            {!signal.noTrade && (
              <LeverageCalculator signal={signal} colors={colors} />
            )}

            {/* Spot Accumulation Zone */}
            {signal.spotAccumulation && (
              <SpotAccumulationCard data={signal.spotAccumulation} colors={colors} />
            )}

            {/* Scalping Plan (short-term sniper plan from Gemini) */}
            {signal.scalpingPlan ? (
              <ScalpingPlanCard
                plan={signal.scalpingPlan}
                colors={colors}
                t={t}
              />
            ) : null}

            {/* Confluences */}
            {signal.confluences && signal.confluences.length > 0 ? (
              <View style={{ marginBottom: 14 }}>
                <Text
                  style={[styles.tpLabel, { color: colors.mutedForeground }]}
                >
                  {t("signals.confluences")} ({signal.confluences.length})
                </Text>
                <View style={{ gap: 6 }}>
                  {signal.confluences.map((c, i) => (
                    <View key={i} style={styles.confluenceRow}>
                      <View
                        style={[
                          styles.checkDot,
                          { backgroundColor: colors.success },
                        ]}
                      >
                        
                      </View>
                      <Text
                        style={[
                          styles.confluenceText,
                          { color: colors.foreground },
                        ]}
                      >
                        {c}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Technical Analysis */}
            <View
              style={[
                styles.reasonBox,
                {
                  backgroundColor: "rgba(240,185,11,0.06)",
                  borderColor: "rgba(240,185,11,0.25)",
                },
              ]}
            >
              <Text style={[styles.reasonTitle, { color: colors.primary }]}>
                {t("signals.technicalAnalysis")}
              </Text>
              <Text
                style={[styles.reasonText, { color: colors.foreground }]}
              >
                {signal.reasoning}
              </Text>
            </View>

            {/* Invalidation */}
            <View
              style={[
                styles.reasonBox,
                {
                  backgroundColor: "rgba(239,68,68,0.06)",
                  borderColor: "rgba(239,68,68,0.25)",
                  marginTop: 10,
                },
              ]}
            >
              <Text style={[styles.reasonTitle, { color: colors.danger }]}>
                {t("signals.invalidation")}
              </Text>
              <Text
                style={[styles.reasonText, { color: colors.foreground }]}
              >
                {signal.invalidation}
              </Text>
            </View>

            {/* Expert Mindset */}
            <View
              style={[
                styles.reasonBox,
                {
                  backgroundColor: "rgba(34,211,238,0.06)",
                  borderColor: "rgba(34,211,238,0.25)",
                  marginTop: 10,
                },
              ]}
            >
              <Text style={[styles.reasonTitle, { color: colors.cyan }]}>
                {t("signals.expertMindset")}
              </Text>
              <Text
                style={[styles.reasonText, { color: colors.foreground }]}
              >
                {signal.expertMindset}
              </Text>
            </View>

            {/* Price & Time Scenarios */}
            {signal.priceScenarios ? (
              <View style={{ marginTop: 14 }}>
                <Text
                  style={[
                    styles.reasonTitle,
                    {
                      color: colors.foreground,
                      marginBottom: 8,
                      fontSize: 11,
                    },
                  ]}
                >
                  {t("signals.scenarios.title")}
                </Text>

                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                >
                  {/* Bearish */}
                  <View
                    style={[
                      styles.scenarioBox,
                      {
                        backgroundColor: "rgba(239,68,68,0.06)",
                        borderColor: "rgba(239,68,68,0.30)",
                      },
                    ]}
                  >
                    <View style={styles.scenarioHeader}>
                      
                      <Text
                        style={[
                          styles.scenarioTitle,
                          { color: colors.danger },
                        ]}
                      >
                        {t("signals.scenarios.bearish")}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.scenarioPrice,
                        { color: colors.danger },
                      ]}
                    >
                      {signal.priceScenarios.bearishTarget}
                    </Text>
                    <View style={styles.scenarioRow}>
                      
                      <Text
                        style={[
                          styles.scenarioMeta,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {signal.priceScenarios.bearishTimeframe}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.scenarioCondition,
                        { color: colors.foreground },
                      ]}
                    >
                      {signal.priceScenarios.bearishCondition}
                    </Text>
                  </View>

                  {/* Bullish */}
                  <View
                    style={[
                      styles.scenarioBox,
                      {
                        backgroundColor: "rgba(34,197,94,0.06)",
                        borderColor: "rgba(34,197,94,0.30)",
                      },
                    ]}
                  >
                    <View style={styles.scenarioHeader}>
                      
                      <Text
                        style={[
                          styles.scenarioTitle,
                          { color: colors.success },
                        ]}
                      >
                        {t("signals.scenarios.bullish")}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.scenarioPrice,
                        { color: colors.success },
                      ]}
                    >
                      {signal.priceScenarios.bullishTarget}
                    </Text>
                    <View style={styles.scenarioRow}>
                      
                      <Text
                        style={[
                          styles.scenarioMeta,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {signal.priceScenarios.bullishTimeframe}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.scenarioCondition,
                        { color: colors.foreground },
                      ]}
                    >
                      {signal.priceScenarios.bullishCondition}
                    </Text>
                  </View>
                </View>

                {/* Base case */}
                {signal.priceScenarios.baseCase ? (
                  <View
                    style={[
                      styles.baseCaseBox,
                      {
                        backgroundColor: colors.primary + "0D",
                        borderColor: colors.primary + "33",
                      },
                    ]}
                  >
                    
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.baseCaseLabel,
                          { color: colors.primary },
                        ]}
                      >
                        {t("signals.scenarios.baseCase")}
                      </Text>
                      <Text
                        style={[
                          styles.baseCaseText,
                          { color: colors.foreground },
                        ]}
                      >
                        {signal.priceScenarios.baseCase}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Valid Until */}
            {signal.validUntil ? (
              <Text
                style={[
                  styles.validUntil,
                  { color: colors.mutedForeground },
                ]}
              >
                {t("signals.validUntil")}{" "}
                {new Date(signal.validUntil).toLocaleString()}
              </Text>
            ) : null}

            {/* Raw Indicator Data */}
            {signal.indicatorSnapshot ? (
              <View
                style={[
                  styles.snapshotBox,
                  {
                    backgroundColor: "rgba(255,255,255,0.03)",
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.reasonTitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {t("signals.rawIndicators")}
                </Text>
                <Text
                  style={[
                    styles.snapshotText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {signal.indicatorSnapshot}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const SCORE_ITEMS: {
  key: keyof ScoreBreakdown;
  labelKey: string;
  max: number;
}[] = [
  { key: "trend", labelKey: "signals.score.trend", max: 20 },
  { key: "confluence", labelKey: "signals.score.confluence", max: 20 },
  { key: "srLevel", labelKey: "signals.score.srLevel", max: 20 },
  { key: "volume", labelKey: "signals.score.volume", max: 15 },
  { key: "sentiment", labelKey: "signals.score.sentiment", max: 10 },
  { key: "funding", labelKey: "signals.score.funding", max: 10 },
  { key: "macro", labelKey: "signals.score.macro", max: 5 },
];

function ScoreCard({
  score,
  colors,
}: {
  score: ScoreBreakdown;
  colors: any;
}) {
  const t = useT();
  return (
    <View
      style={[
        styles.scoreCard,
        {
          backgroundColor: "rgba(255,255,255,0.03)",
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.scoreTitleRow}>
        <Text style={[styles.scoreTitle, { color: colors.mutedForeground }]}>
          {t("signals.scoreBreakdown")}
        </Text>
        <Text
          style={[
            styles.scoreTotalVal,
            { color: (score.total >= 45 && score.total < 55) ? colors.success : colors.danger },
          ]}
        >
          {score.total}/100
        </Text>
      </View>
      {SCORE_ITEMS.map(({ key, labelKey, max }) => {
        const val = score[key] as number;
        const pct = max > 0 ? Math.min((val / max) * 100, 100) : 0;
        const barColor = pct >= 60 ? colors.success : pct >= 30 ? colors.primary : colors.danger;
        return (
          <View key={key} style={styles.scoreRow}>
            <Text
              style={[styles.scoreLabel, { color: colors.mutedForeground }]}
            >
              {t(labelKey)}
            </Text>
            <View style={styles.scoreBarWrap}>
              <View
                style={[
                  styles.scoreBar,
                  { backgroundColor: "rgba(255,255,255,0.06)" },
                ]}
              >
                <View
                  style={[
                    styles.scoreBarFill,
                    { width: `${pct}%`, backgroundColor: barColor },
                  ]}
                />
              </View>
            </View>
            <Text style={[styles.scoreVal, { color: colors.foreground }]}>
              {val}/{max}
            </Text>
          </View>
        );
      })}
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
    <View
      style={[
        styles.stat,
        {
          backgroundColor: "rgba(255,255,255,0.03)",
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.statValue,
          { color: valueColor ?? colors.foreground },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function ScalpingPlanCard({
  plan,
  colors,
  t,
}: {
  plan: ScalpingPlan;
  colors: any;
  t: (k: string) => string;
}) {
  const isNoScalp = plan.side === "NO_SCALP";
  // Cyan accent so this section is visually distinct from the BUY/SELL ribbon.
  const accent = colors.cyan ?? "#22d3ee";
  const sideColor = isNoScalp
    ? colors.mutedForeground
    : plan.side === "LONG"
      ? colors.success
      : colors.fuchsia;

  return (
    <View
      style={[
        styles.scalpCard,
        {
          backgroundColor: accent + "0D",
          borderColor: accent + "44",
        },
      ]}
    >
      <View style={styles.scalpHeader}>
        <View style={styles.scalpHeaderLeft}>
          
          <Text style={[styles.scalpTitle, { color: accent }]}>
            {t("signals.scalp.title")}
          </Text>
        </View>
        <View
          style={[
            styles.scalpSideBadge,
            { backgroundColor: sideColor + "22", borderColor: sideColor + "55" },
          ]}
        >
          <Text style={[styles.scalpSideText, { color: sideColor }]}>
            {plan.side}
          </Text>
        </View>
      </View>

      {isNoScalp ? (
        <Text
          style={[styles.scalpNoteText, { color: colors.mutedForeground }]}
        >
          {plan.notes || t("signals.scalp.noScalp")}
        </Text>
      ) : (
        <>
          <View style={styles.scalpGrid}>
            <ScalpField
              label={t("signals.scalp.entry")}
              value={plan.entryPrice}
              colors={colors}
              accent={accent}
            />
            <ScalpField
              label={t("signals.scalp.stopLoss")}
              value={plan.stopLoss}
              colors={colors}
              accent={colors.fuchsia}
            />
            <ScalpField
              label={t("signals.scalp.leverage")}
              value={plan.leverage}
              colors={colors}
              accent={accent}
            />
            <ScalpField
              label={t("signals.scalp.timeframe")}
              value={plan.timeframe}
              colors={colors}
              accent={colors.foreground}
            />
            <ScalpField
              label={t("signals.scalp.holdTime")}
              value={plan.holdTime}
              colors={colors}
              accent={colors.foreground}
            />
            <ScalpField
              label={t("signals.scalp.session")}
              value={plan.sessionWindow}
              colors={colors}
              accent={colors.foreground}
            />
          </View>

          {plan.entryTrigger ? (
            <View style={styles.scalpTriggerBox}>
              <Text
                style={[
                  styles.scalpTriggerLabel,
                  { color: colors.mutedForeground },
                ]}
              >
                {t("signals.scalp.trigger")}
              </Text>
              <Text
                style={[
                  styles.scalpTriggerText,
                  { color: colors.foreground },
                ]}
              >
                {plan.entryTrigger}
              </Text>
            </View>
          ) : null}

          {plan.takeProfit && plan.takeProfit.length > 0 ? (
            <View style={{ marginTop: 10 }}>
              <Text
                style={[
                  styles.scalpTpLabel,
                  { color: colors.mutedForeground },
                ]}
              >
                {t("signals.scalp.tpTargets")}
              </Text>
              <View style={{ gap: 4, marginTop: 4 }}>
                {plan.takeProfit.map((tp, i) => {
                  const rr = plan.takeProfitRR?.[i];
                  return (
                    <View key={i} style={styles.scalpTpRow}>
                      <Text style={[styles.scalpTpIdx, { color: accent }]}>
                        TP{i + 1}
                      </Text>
                      <Text
                        style={[
                          styles.scalpTpVal,
                          { color: colors.foreground },
                        ]}
                      >
                        {tp}
                      </Text>
                      {rr ? (
                        <View
                          style={[
                            styles.scalpRrPill,
                            {
                              backgroundColor: accent + "22",
                              borderColor: accent + "55",
                            },
                          ]}
                        >
                          <Text
                            style={[styles.scalpRrText, { color: accent }]}
                          >
                            {rr}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {plan.notes ? (
            <Text
              style={[
                styles.scalpNoteText,
                { color: colors.mutedForeground, marginTop: 10 },
              ]}
            >
              {plan.notes}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

function ScalpField({
  label,
  value,
  colors,
  accent,
}: {
  label: string;
  value: string;
  colors: any;
  accent: string;
}) {
  return (
    <View style={styles.scalpFieldBox}>
      <Text
        style={[styles.scalpFieldLabel, { color: colors.mutedForeground }]}
      >
        {label}
      </Text>
      <Text style={[styles.scalpFieldValue, { color: accent }]}>
        {value || "—"}
      </Text>
    </View>
  );
}



// ─── Spot Accumulation Zone Card ─────────────────────────────────────────────
function SpotAccumulationCard({
  data,
  colors,
}: {
  data: any;
  colors: any;
}) {
  const t = useT();
  const riskColor = data.riskLevel === "LOW"
    ? colors.success
    : data.riskLevel === "HIGH"
    ? colors.danger
    : colors.primary;

  const riskLabel = data.riskLevel === "LOW"
    ? t("signals.spot.riskLow")
    : data.riskLevel === "HIGH"
    ? t("signals.spot.riskHigh")
    : t("signals.spot.riskMedium");

  return (
    <View style={[styles.spotAccumCard, { borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.02)" }]}>
      <View style={styles.spotAccumHeader}>
        <Text style={[styles.spotAccumTitle, { color: colors.mutedForeground }]}>
          {t("signals.spot.title")}
        </Text>
        <View style={[styles.spotAccumRiskBadge, { backgroundColor: riskColor + "22", borderColor: riskColor + "55" }]}>
          <Text style={[styles.spotAccumRiskText, { color: riskColor }]}>
            {data.riskLevel}
          </Text>
        </View>
      </View>

      <Text style={[styles.spotAccumRiskLabel, { color: riskColor }]}>
        {riskLabel}
      </Text>

      {/* 3 Zona DCA */}
      <View style={styles.spotAccumZones}>
        <View style={[styles.spotAccumZone, { borderColor: colors.danger + "44", backgroundColor: colors.danger + "08" }]}>
          <Text style={[styles.spotAccumZoneLabel, { color: colors.mutedForeground }]}>{t("signals.spot.aggressive")}</Text>
          <Text style={[styles.spotAccumZoneValue, { color: colors.danger }]}>{data.aggressive}</Text>
          <Text style={[styles.spotAccumZoneDesc, { color: colors.mutedForeground }]}>{t("signals.spot.aggressiveDesc")}</Text>
        </View>
        <View style={[styles.spotAccumZone, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "08" }]}>
          <Text style={[styles.spotAccumZoneLabel, { color: colors.mutedForeground }]}>{t("signals.spot.normal")}</Text>
          <Text style={[styles.spotAccumZoneValue, { color: colors.primary }]}>{data.normal}</Text>
          <Text style={[styles.spotAccumZoneDesc, { color: colors.mutedForeground }]}>{t("signals.spot.normalDesc")}</Text>
        </View>
        <View style={[styles.spotAccumZone, { borderColor: colors.success + "44", backgroundColor: colors.success + "08" }]}>
          <Text style={[styles.spotAccumZoneLabel, { color: colors.mutedForeground }]}>{t("signals.spot.conservative")}</Text>
          <Text style={[styles.spotAccumZoneValue, { color: colors.success }]}>{data.conservative}</Text>
          <Text style={[styles.spotAccumZoneDesc, { color: colors.mutedForeground }]}>{t("signals.spot.conservativeDesc")}</Text>
        </View>
      </View>

      {/* DCA Strategy */}
      <View style={[styles.spotAccumStrategy, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border }]}>
        <Text style={[styles.spotAccumStrategyLabel, { color: colors.mutedForeground }]}>{t("signals.spot.dcaStrategy")}</Text>
        <Text style={[styles.spotAccumStrategyText, { color: colors.foreground }]}>{data.dcaStrategy}</Text>
      </View>

      {/* Ideal Conditions */}
      {data.idealConditions?.length > 0 && (
        <View style={{ marginTop: 10, gap: 5 }}>
          <Text style={[styles.spotAccumStrategyLabel, { color: colors.mutedForeground, marginBottom: 4 }]}>
            {t("signals.spot.marketConditions")}
          </Text>
          {data.idealConditions.map((cond: string, i: number) => (
            <View key={i} style={styles.spotAccumCondRow}>
              <View style={[styles.checkDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.spotAccumCondText, { color: colors.foreground }]}>{cond}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Long Term Target */}
      <View style={[styles.spotAccumTarget, { borderColor: colors.success + "44", backgroundColor: colors.success + "08" }]}>
        <Text style={[styles.spotAccumStrategyLabel, { color: colors.mutedForeground }]}>{t("signals.spot.longTermTarget")}</Text>
        <Text style={[styles.spotAccumZoneValue, { color: colors.success }]}>{data.longTermTarget}</Text>
      </View>
    </View>
  );
}

// ─── Leverage & Risk Calculator ──────────────────────────────────────────────
function LeverageCalculator({
  signal,
  colors,
}: {
  signal: TradingSignal;
  colors: any;
}) {
  const t = useT();
  const LEVERAGE_OPTIONS = [3, 5, 10, 20, 50, 100];
  const [leverage, setLeverage] = React.useState(10);
  const [capital, setCapital] = React.useState("100");

  const entryPrice = parseFloat(
    (signal.entryPrice ?? signal.entryRange ?? "0").replace(/[^0-9.]/g, "")
  );
  const slPrice = parseFloat(
    (signal.stopLoss ?? "0").replace(/[^0-9.]/g, "")
  );
  const tpPrices = (signal.takeProfit ?? []).map((tp: string) =>
    parseFloat(tp.replace(/[^0-9.]/g, ""))
  );
  const isShort = signal.side === "SELL";
  const capitalNum = parseFloat(capital) || 0;
  const margin = capitalNum;
  const positionSize = margin * leverage;
  const qty = entryPrice > 0 ? positionSize / entryPrice : 0;

  // Liquidation price
  const liqPrice = entryPrice > 0
    ? isShort
      ? entryPrice * (1 + 1 / leverage)
      : entryPrice * (1 - 1 / leverage)
    : 0;

  // PnL calculations
  const calcPnl = (targetPrice: number) => {
    if (!entryPrice || !targetPrice) return 0;
    const priceDiff = isShort
      ? entryPrice - targetPrice
      : targetPrice - entryPrice;
    return (priceDiff / entryPrice) * positionSize;
  };

  const slPnl = calcPnl(slPrice);
  const slPct = capitalNum > 0 ? (slPnl / capitalNum) * 100 : 0;

  return (
    <View
      style={[
        styles.leverageCard,
        { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border },
      ]}
    >
      {/* Header */}
      <Text style={[styles.leverageTitle, { color: colors.mutedForeground }]}>
        {t("signals.leverage.title")}
      </Text>

      {/* Capital Input */}
      <View style={styles.leverageInputRow}>
        <Text style={[styles.leverageLabel, { color: colors.mutedForeground }]}>
          {t("signals.leverage.capital")}
        </Text>
        <TextInput
          style={[
            styles.leverageInput,
            { color: colors.foreground, borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.05)" },
          ]}
          value={capital}
          onChangeText={setCapital}
          keyboardType="numeric"
          placeholder="100"
          placeholderTextColor={colors.mutedForeground}
        />
      </View>

      {/* Leverage Selector */}
      <Text style={[styles.leverageLabel, { color: colors.mutedForeground, marginBottom: 8 }]}>
        {t("signals.leverage.selectLeverage")}
      </Text>
      <View style={styles.leverageBtnRow}>
        {LEVERAGE_OPTIONS.map((lv) => (
          <Pressable
            key={lv}
            onPress={() => setLeverage(lv)}
            style={[
              styles.leverageBtn,
              {
                backgroundColor: leverage === lv ? colors.primary + "33" : "rgba(255,255,255,0.05)",
                borderColor: leverage === lv ? colors.primary : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.leverageBtnText,
                { color: leverage === lv ? colors.primary : colors.mutedForeground },
              ]}
            >
              {lv}x
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Summary Grid */}
      <View style={styles.leverageGrid}>
        <View style={[styles.leverageStatBox, { borderColor: colors.border }]}>
          <Text style={[styles.leverageStatLabel, { color: colors.mutedForeground }]}>{t("signals.leverage.positionSize")}</Text>
          <Text style={[styles.leverageStatVal, { color: colors.foreground }]}>
            ${positionSize.toFixed(2)}
          </Text>
        </View>
        <View style={[styles.leverageStatBox, { borderColor: colors.border }]}>
          <Text style={[styles.leverageStatLabel, { color: colors.mutedForeground }]}>QTY</Text>
          <Text style={[styles.leverageStatVal, { color: colors.foreground }]}>
            {qty.toFixed(4)}
          </Text>
        </View>
        <View style={[styles.leverageStatBox, { borderColor: colors.danger + "99" }]}>
          <Text style={[styles.leverageStatLabel, { color: colors.mutedForeground }]}>{t("signals.leverage.liquidation")}</Text>
          <Text style={[styles.leverageStatVal, { color: colors.danger }]}>
            ${liqPrice.toFixed(2)}
          </Text>
        </View>
        <View style={[styles.leverageStatBox, { borderColor: colors.danger + "99" }]}>
          <Text style={[styles.leverageStatLabel, { color: colors.mutedForeground }]}>{t("signals.leverage.lossAtSL")}</Text>
          <Text style={[styles.leverageStatVal, { color: colors.danger }]}>
            ${Math.abs(slPnl).toFixed(2)} ({Math.abs(slPct).toFixed(1)}%)
          </Text>
        </View>
      </View>

      {/* TP PnL Rows */}
      {tpPrices.length > 0 && (
        <View style={{ marginTop: 12, gap: 6 }}>
          <Text style={[styles.leverageLabel, { color: colors.mutedForeground, marginBottom: 4 }]}>
            {t("signals.leverage.profitPerTP")}
          </Text>
          {tpPrices.map((tp, i) => {
            const pnl = calcPnl(tp);
            const pct = capitalNum > 0 ? (pnl / capitalNum) * 100 : 0;
            const rr = signal.takeProfitRR?.[i] ?? `1:${(i + 1) * 1.5}`;
            return (
              <View
                key={i}
                style={[
                  styles.leverageTpRow,
                  { backgroundColor: colors.success + "10", borderColor: colors.success + "33" },
                ]}
              >
                <Text style={[styles.leverageTpIdx, { color: colors.success }]}>TP{i + 1}</Text>
                <Text style={[styles.leverageTpPrice, { color: colors.foreground }]}>
                  ${tp.toFixed(2)}
                </Text>
                <Text style={[styles.leverageTpPnl, { color: colors.success }]}>
                  +${pnl.toFixed(2)} (+{pct.toFixed(1)}%)
                </Text>
                <View style={[styles.rrPill, { backgroundColor: colors.success + "22", borderColor: colors.success + "55" }]}>
                  <Text style={[styles.rrText, { color: colors.success }]}>{rr}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Warning for high leverage */}
      {leverage >= 20 && (
        <View style={[styles.leverageWarning, { backgroundColor: colors.danger + "15", borderColor: colors.danger + "44" }]}>
          <Text style={[styles.leverageWarningText, { color: colors.danger }]}>
            ⚠ Leverage {leverage}x sangat berisiko tinggi. Liquidasi hanya {(100 / leverage).toFixed(1)}% pergerakan harga. Gunakan hanya jika berpengalaman.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 10,
    letterSpacing: 1.5,
    fontFamily: "Helvetica Neue",
    marginBottom: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: { fontSize: 12, fontFamily: "Helvetica Neue", letterSpacing: 0.5 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  ctaText: { fontSize: 13, fontFamily: "Helvetica Neue", letterSpacing: 1 },
  discBox: {
    flexDirection: "row",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    alignItems: "flex-start",
  },
  discText: {
    fontSize: 11,
    lineHeight: 16,
    flex: 1,
    fontFamily: "Helvetica Neue",
  },
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
  loaderBox: {
    padding: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    gap: 12,
  },
  loaderText: {
    fontSize: 11,
    textAlign: "center",
    fontFamily: "Helvetica Neue",
  },
  signalCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  signalHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  signalPair: { fontSize: 18, fontFamily: "Helvetica Neue" },
  signalStyle: { fontSize: 11, fontFamily: "Helvetica Neue", marginTop: 2 },
  sideBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  sideText: { fontSize: 12, fontFamily: "Helvetica Neue", letterSpacing: 1 },
  metaRow: { flexDirection: "row", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  metaText: { fontSize: 10, fontFamily: "Helvetica Neue", letterSpacing: 0.8 },
  noTradeBox: {
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 14,
  },
  noTradeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  noTradeTitle: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1,
  },
  noTradeText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Helvetica Neue",
  },
  confidenceBox: { marginBottom: 14 },
  confLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  minLabel: {
    fontSize: 9,
    letterSpacing: 1.5,
    fontFamily: "Helvetica Neue",
  },
  confThreshold: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.8,
  },
  bar: { height: 6, borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
  confValue: {
    fontSize: 13,
    fontFamily: "Helvetica Neue",
    marginTop: 4,
    textAlign: "right",
  },
  scoreCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 14,
    gap: 8,
  },
  scoreTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  scoreTitle: {
    fontSize: 9,
    letterSpacing: 1.5,
    fontFamily: "Helvetica Neue",
  },
  scoreTotalVal: { fontSize: 13, fontFamily: "Helvetica Neue" },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  scoreLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.8,
    width: 72,
  },
  scoreBarWrap: { flex: 1 },
  scoreBar: { height: 4, borderRadius: 2, overflow: "hidden" },
  scoreBarFill: { height: "100%", borderRadius: 2 },
  scoreVal: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    width: 32,
    textAlign: "right",
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  stat: {
    flexBasis: "48%",
    flexGrow: 1,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statLabel: {
    fontSize: 9,
    letterSpacing: 1.2,
    fontFamily: "Helvetica Neue",
  },
  statValue: { fontSize: 13, fontFamily: "Helvetica Neue", marginTop: 2 },
  spotBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 14,
  },
  spotLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1,
    flex: 1,
  },
  spotValue: {
    fontSize: 12,
    fontFamily: "Helvetica Neue",
  },
  tpLabel: {
    fontSize: 9,
    letterSpacing: 1.5,
    fontFamily: "Helvetica Neue",
    marginBottom: 6,
  },
  tpRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  tpIdx: { fontSize: 11, fontFamily: "Helvetica Neue", letterSpacing: 1 },
  tpVal: {
    fontSize: 13,
    fontFamily: "Helvetica Neue",
    flex: 1,
  },
  rrPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rrText: { fontSize: 9, fontFamily: "Helvetica Neue", letterSpacing: 0.5 },
  confluenceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 4,
  },
  checkDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  confluenceText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Helvetica Neue",
  },
  reasonBox: {
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reasonTitle: {
    fontSize: 10,
    letterSpacing: 1.5,
    fontFamily: "Helvetica Neue",
    marginBottom: 6,
  },
  reasonText: { fontSize: 12, lineHeight: 18, fontFamily: "Helvetica Neue" },
  scenarioBox: {
    flex: 1,
    minWidth: 140,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scenarioHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 6,
  },
  scenarioTitle: {
    fontSize: 9,
    letterSpacing: 1.2,
    fontFamily: "Helvetica Neue",
  },
  scenarioPrice: {
    fontSize: 16,
    fontFamily: "Helvetica Neue",
    marginBottom: 4,
  },
  scenarioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
  },
  scenarioMeta: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
  },
  scenarioCondition: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: "Helvetica Neue",
  },
  baseCaseBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  baseCaseLabel: {
    fontSize: 9,
    letterSpacing: 1.2,
    fontFamily: "Helvetica Neue",
    marginBottom: 3,
  },
  baseCaseText: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Helvetica Neue",
  },
  validUntil: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
    textAlign: "center",
    marginTop: 12,
  },
  snapshotBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  snapshotText: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
    lineHeight: 15,
  },
  scalpCard: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  scalpHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  scalpHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scalpTitle: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1.2,
  },
  scalpSideBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scalpSideText: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.8,
  },
  scalpGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  scalpFieldBox: {
    flexBasis: "31%",
    flexGrow: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  scalpFieldLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  scalpFieldValue: {
    fontSize: 12,
    fontFamily: "Helvetica Neue",
  },
  scalpTriggerBox: {
    marginTop: 10,
    padding: 9,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  scalpTriggerLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  scalpTriggerText: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    lineHeight: 16,
  },
  scalpTpLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  scalpTpRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  scalpTpIdx: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.8,
    minWidth: 26,
  },
  scalpTpVal: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Helvetica Neue",
  },
  scalpRrPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scalpRrText: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.5,
  },
  scalpNoteText: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    lineHeight: 16,
    fontStyle: "italic",
  },
  leverageCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 16,
  },
  leverageTitle: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  leverageInputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  leverageLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  leverageInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    fontFamily: "Helvetica Neue",
    minWidth: 100,
    textAlign: "right",
  },
  leverageBtnRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 14,
    flexWrap: "wrap",
  },
  leverageBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  leverageBtnText: {
    fontSize: 12,
    fontFamily: "Helvetica Neue",
    fontWeight: "600",
  },
  leverageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  leverageStatBox: {
    flexBasis: "47%",
    flexGrow: 1,
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  leverageStatLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  leverageStatVal: {
    fontSize: 13,
    fontFamily: "Helvetica Neue",
    fontWeight: "600",
  },
  leverageTpRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  leverageTpIdx: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.8,
    minWidth: 26,
  },
  leverageTpPrice: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    flex: 1,
  },
  leverageTpPnl: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    fontWeight: "600",
  },
  leverageWarning: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  leverageWarningText: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    lineHeight: 16,
  },
  spotAccumCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 16,
  },
  spotAccumHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  spotAccumTitle: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1.2,
  },
  spotAccumRiskBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  spotAccumRiskText: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
    fontWeight: "600",
    letterSpacing: 0.8,
  },
  spotAccumRiskLabel: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    marginBottom: 12,
  },
  spotAccumZones: {
    gap: 8,
    marginBottom: 12,
  },
  spotAccumZone: {
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  spotAccumZoneLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  spotAccumZoneValue: {
    fontSize: 14,
    fontFamily: "Helvetica Neue",
    fontWeight: "600",
    marginBottom: 2,
  },
  spotAccumZoneDesc: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
  },
  spotAccumStrategy: {
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  spotAccumStrategyLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  spotAccumStrategyText: {
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    lineHeight: 16,
  },
  spotAccumCondRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  spotAccumCondText: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Helvetica Neue",
    lineHeight: 16,
  },
  spotAccumTarget: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tgBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  tgBtnText: {
    fontSize: 13,
    fontFamily: "Helvetica Neue",
    fontWeight: "600",
    letterSpacing: 0.4,
  },
});
