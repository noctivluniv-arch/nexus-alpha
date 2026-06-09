import React, { useEffect, useState, useCallback } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { Header } from "@/components/Header";
import { useColors } from "@/hooks/useColors";
import { api, formatNumber } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { FearGreedData, PriceData, SUPPORTED_PAIRS } from "@/lib/types";

function fgColor(value: number): string {
  if (value <= 24) return "#EA3943";
  if (value <= 49) return "#F97316";
  if (value <= 54) return "#EAB308";
  if (value <= 74) return "#84CC16";
  return "#16C784";
}

function fgLabel(t: (k: string) => string, value: number): string {
  const v = value;
  if (v <= 24) return t("market.fg.extremeFear");
  if (v <= 49) return t("market.fg.fear");
  if (v <= 54) return t("market.fg.neutral");
  if (v <= 74) return t("market.fg.greed");
  return t("market.fg.extremeGreed");
}

export default function MarketScreen() {
  const colors = useColors();
  const t = useT();
  const [prices, setPrices] = useState<PriceData[]>([]);
  const [fg, setFg] = useState<FearGreedData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retryRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (attempt = 0) => {
    try {
      setError(null);
      const [data, fgData] = await Promise.all([
        api.getPrices(SUPPORTED_PAIRS),
        api.getFearGreed().catch(() => null),
      ]);
      if (data.length === 0 && attempt < 3) {
        setRetryCount(attempt + 1);
        retryRef.current = setTimeout(() => load(attempt + 1), 4000);
        if (fgData) setFg(fgData);
        return;
      }
      setRetryCount(0);
      setPrices(data);
      if (fgData) setFg(fgData);
    } catch (e: any) {
      if (attempt < 3) {
        setRetryCount(attempt + 1);
        retryRef.current = setTimeout(() => load(attempt + 1), 4000);
        return;
      }
      setError(e?.message ?? t("market.error"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const i = setInterval(() => load(), 60000);
    return () => {
      clearInterval(i);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header
        onRefresh={onRefresh}
        refreshing={refreshing}
        subtitle={t("header.market")}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.heroBox}>
          <View
            style={[
              styles.hero,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>
              {t("market.totalCap")}
            </Text>
            <Text style={[styles.heroValue, { color: colors.foreground }]}>
              $2.{Math.floor(Math.random() * 99) + 10}T
            </Text>
            <View style={styles.heroRow}>
              <Feather name="arrow-up-right" size={14} color={colors.success} />
              <Text style={[styles.heroChange, { color: colors.success }]}>
                +2,4% {t("market.changeSuffix")}
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.hero,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>
              {t("market.btcDom")}
            </Text>
            <Text style={[styles.heroValue, { color: colors.primary }]}>
              52,3%
            </Text>
            <View style={styles.heroRow}>
              <Feather name="trending-up" size={14} color={colors.primary} />
              <Text style={[styles.heroChange, { color: colors.primary }]}>
                {t("market.bullishTrend")}
              </Text>
            </View>
          </View>
        </View>

        <FearGreedCard fg={fg} colors={colors} t={t} />

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          {t("market.livePrices")}
        </Text>

        {error ? (
          <View
            style={[
              styles.errorBox,
              { backgroundColor: "#2A1A1F", borderColor: colors.danger },
            ]}
          >
            <Feather name="alert-triangle" size={16} color={colors.danger} />
            <Text style={[styles.errorText, { color: colors.danger }]}>
              {error}
            </Text>
          </View>
        ) : null}

        {(loading || retryCount > 0) && prices.length === 0 ? (
          <View style={{ paddingVertical: 36, alignItems: "center", gap: 10 }}>
            <ActivityIndicator color={colors.primary} />
            {retryCount > 0 ? (
              <Text style={{ fontSize: 12, fontFamily: "Helvetica Neue", color: colors.mutedForeground, textAlign: "center" }}>
                {`Menghubungkan ke server...\n(${retryCount}/3)`}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {SUPPORTED_PAIRS.map((pair) => {
              const p = prices.find((x) => x.symbol === pair);
              const changeNum = p ? parseFloat(p.priceChangePercent) : 0;
              const isUp = changeNum >= 0;
              const baseSymbol = pair.replace("USDT", "");
              return (
                <View
                  key={pair}
                  style={[
                    styles.row,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <View style={styles.rowLeft}>
                    <View
                      style={[
                        styles.coinAvatar,
                        { backgroundColor: colors.primary + "22" },
                      ]}
                    >
                      <Text
                        style={[styles.coinAvatarText, { color: colors.primary }]}
                      >
                        {baseSymbol.slice(0, 1)}
                      </Text>
                    </View>
                    <View>
                      <Text style={[styles.coinName, { color: colors.foreground }]}>
                        {baseSymbol}
                      </Text>
                      <Text
                        style={[styles.coinPair, { color: colors.mutedForeground }]}
                      >
                        {pair}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.rowRight}>
                    <Text style={[styles.price, { color: colors.foreground }]}>
                      ${p ? formatNumber(p.lastPrice, 2) : "—"}
                    </Text>
                    <View style={styles.changeRow}>
                      <Feather
                        name={isUp ? "arrow-up-right" : "arrow-down-right"}
                        size={12}
                        color={isUp ? colors.success : colors.danger}
                      />
                      <Text
                        style={[
                          styles.change,
                          { color: isUp ? colors.success : colors.danger },
                        ]}
                      >
                        {isUp ? "+" : ""}
                        {changeNum.toFixed(2)}%
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 24 }]}>
          {t("market.spotStrategy")}
        </Text>
        <View
          style={[
            styles.strategyCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.strategyHead}>
            <Feather name="target" size={16} color={colors.primary} />
            <Text style={[styles.strategyTitle, { color: colors.foreground }]}>
              {t("market.strategy.btcDcaTitle")}
            </Text>
          </View>
          <Text style={[styles.strategyBody, { color: colors.mutedForeground }]}>
            {t("market.strategy.btcDcaBody")}
          </Text>
        </View>
        <View
          style={[
            styles.strategyCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.strategyHead}>
            <Feather name="layers" size={16} color={colors.cyan} />
            <Text style={[styles.strategyTitle, { color: colors.foreground }]}>
              {t("market.strategy.ethSolTitle")}
            </Text>
          </View>
          <Text style={[styles.strategyBody, { color: colors.mutedForeground }]}>
            {t("market.strategy.ethSolBody")}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function FearGreedCard({
  fg,
  colors,
  t,
}: {
  fg: FearGreedData | null;
  colors: any;
  t: (k: string) => string;
}) {
  if (!fg) {
    return (
      <View
        style={[
          fgStyles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[fgStyles.label, { color: colors.mutedForeground }]}>
          {t("market.fgIndex")}
        </Text>
        <View style={{ paddingVertical: 18, alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  const v = fg.current.value;
  const c = fgColor(v);
  const label = fgLabel(t, v);
  const segments = [
    { hi: 24, color: "#EA3943" },
    { hi: 49, color: "#F97316" },
    { hi: 54, color: "#EAB308" },
    { hi: 74, color: "#84CC16" },
    { hi: 100, color: "#16C784" },
  ];
  const lo = (i: number) => (i === 0 ? 0 : segments[i - 1].hi + 1);

  return (
    <View
      style={[
        fgStyles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={fgStyles.head}>
        <Text style={[fgStyles.label, { color: colors.mutedForeground }]}>
          {t("market.fgIndex")}
        </Text>
        <View
          style={[
            fgStyles.classBadge,
            { backgroundColor: c + "22", borderColor: c },
          ]}
        >
          <Text style={[fgStyles.classText, { color: c }]}>{label}</Text>
        </View>
      </View>

      <View style={fgStyles.valueRow}>
        <Text style={[fgStyles.bigValue, { color: c }]}>{v}</Text>
        <Text style={[fgStyles.outOf, { color: colors.mutedForeground }]}>
          / 100
        </Text>
      </View>

      {/* Segmented gauge */}
      <View style={fgStyles.barRow}>
        {segments.map((seg, i) => {
          const inSeg = v >= lo(i) && v <= seg.hi;
          return (
            <View
              key={seg.color}
              style={[
                fgStyles.barSeg,
                {
                  backgroundColor: inSeg ? seg.color : seg.color + "33",
                  borderColor: inSeg ? seg.color : "transparent",
                },
              ]}
            />
          );
        })}
      </View>
      <View style={fgStyles.scaleRow}>
        <Text style={[fgStyles.scaleText, { color: colors.mutedForeground }]}>
          0
        </Text>
        <Text style={[fgStyles.scaleText, { color: colors.mutedForeground }]}>
          25
        </Text>
        <Text style={[fgStyles.scaleText, { color: colors.mutedForeground }]}>
          50
        </Text>
        <Text style={[fgStyles.scaleText, { color: colors.mutedForeground }]}>
          75
        </Text>
        <Text style={[fgStyles.scaleText, { color: colors.mutedForeground }]}>
          100
        </Text>
      </View>

      {/* 7-day mini bar chart */}
      {fg.history && fg.history.length > 1 ? (
        <View style={fgStyles.miniChartWrap}>
          <Text style={[fgStyles.miniChartLabel, { color: colors.mutedForeground }]}>
            TREND 7 HARI
          </Text>
          <View style={fgStyles.miniChartBars}>
            {fg.history.slice(0, 7).reverse().map((p, i) => {
              const barColor = p.value <= 24 ? "#EA3943" : p.value <= 49 ? "#F97316" : p.value <= 54 ? "#EAB308" : p.value <= 74 ? "#84CC16" : "#16C784";
              const isToday = i === 6;
              const dayLabel = i === 6 ? "Hari\nIni" : i === 5 ? "Kmrn" : `-${6 - i}h`;
              return (
                <View key={i} style={fgStyles.miniBarCol}>
                  <Text style={[fgStyles.miniBarVal, { color: barColor }]}>{p.value}</Text>
                  <View style={fgStyles.miniBarTrack}>
                    <View
                      style={[
                        fgStyles.miniBarFill,
                        {
                          height: `${Math.max(p.value, 8)}%` as any,
                          backgroundColor: isToday ? barColor : barColor + "99",
                          borderColor: isToday ? barColor : "transparent",
                        },
                      ]}
                    />
                  </View>
                  <Text style={[fgStyles.miniBarDay, { color: isToday ? barColor : colors.mutedForeground }]}>
                    {dayLabel}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* History strip */}
      <View style={fgStyles.histRow}>
        <FgHistCell
          label={t("market.fg.yesterday")}
          point={fg.yesterday}
          colors={colors}
          t={t}
        />
        <FgHistCell
          label={t("market.fg.lastWeek")}
          point={fg.lastWeek}
          colors={colors}
          t={t}
        />
        <FgHistCell
          label={t("market.fg.lastMonth")}
          point={fg.lastMonth}
          colors={colors}
          t={t}
        />
      </View>
    </View>
  );
}

function FgHistCell({
  label,
  point,
  colors,
  t,
}: {
  label: string;
  point: { value: number; classification: string } | null;
  colors: any;
  t: (k: string) => string;
}) {
  return (
    <View style={fgStyles.histCell}>
      <Text style={[fgStyles.histLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text
        style={[
          fgStyles.histValue,
          { color: point ? fgColor(point.value) : colors.mutedForeground },
        ]}
      >
        {point ? point.value : "—"}
      </Text>
      <Text style={[fgStyles.histClass, { color: colors.mutedForeground }]}>
        {point ? fgLabel(t, point.value) : ""}
      </Text>
    </View>
  );
}

const fgStyles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 18,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  label: {
    fontSize: 10,
    letterSpacing: 1.5,
    fontFamily: "Helvetica Neue",
  },
  classBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  classText: { fontSize: 10, fontFamily: "Helvetica Neue", letterSpacing: 0.5 },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginBottom: 12,
  },
  bigValue: { fontSize: 44, fontFamily: "Helvetica Neue", lineHeight: 48 },
  outOf: { fontSize: 12, fontFamily: "Helvetica Neue" },
  barRow: {
    flexDirection: "row",
    gap: 4,
    marginBottom: 6,
  },
  barSeg: {
    flex: 1,
    height: 10,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  scaleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  scaleText: { fontSize: 9, fontFamily: "Helvetica Neue" },
  histRow: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  histCell: { flex: 1, alignItems: "center" },
  histLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  histValue: { fontSize: 18, fontFamily: "Helvetica Neue", lineHeight: 22 },
  histClass: { fontSize: 9, fontFamily: "Helvetica Neue", marginTop: 2 },
  miniChartWrap: {
    marginBottom: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  miniChartLabel: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  miniChartBars: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    height: 72,
  },
  miniBarCol: {
    flex: 1,
    alignItems: "center",
    height: "100%",
    justifyContent: "flex-end",
    gap: 3,
  },
  miniBarVal: {
    fontSize: 9,
    fontFamily: "Helvetica Neue",
    lineHeight: 11,
  },
  miniBarTrack: {
    flex: 1,
    width: "100%",
    justifyContent: "flex-end",
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
    maxHeight: 48,
  },
  miniBarFill: {
    width: "100%",
    borderRadius: 3,
    borderWidth: 1,
    minHeight: 4,
  },
  miniBarDay: {
    fontSize: 8,
    fontFamily: "Helvetica Neue",
    textAlign: "center",
    lineHeight: 10,
  },
});

const styles = StyleSheet.create({
  heroBox: { flexDirection: "row", gap: 10, marginBottom: 18 },
  hero: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroLabel: { fontSize: 9, letterSpacing: 1.5, fontFamily: "Helvetica Neue" },
  heroValue: { fontSize: 22, fontWeight: "800", marginTop: 6, fontFamily: "Helvetica Neue" },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  heroChange: { fontSize: 11, fontFamily: "Helvetica Neue" },
  sectionTitle: {
    fontSize: 11,
    letterSpacing: 2,
    fontFamily: "Helvetica Neue",
    marginBottom: 10,
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  coinAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  coinAvatarText: { fontSize: 16, fontWeight: "800", fontFamily: "Helvetica Neue" },
  coinName: { fontSize: 14, fontWeight: "700", fontFamily: "Helvetica Neue" },
  coinPair: { fontSize: 10, fontFamily: "Helvetica Neue", marginTop: 2 },
  rowRight: { alignItems: "flex-end" },
  price: { fontSize: 14, fontWeight: "700", fontFamily: "Helvetica Neue" },
  changeRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 },
  change: { fontSize: 11, fontFamily: "Helvetica Neue" },
  strategyCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  strategyHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  strategyTitle: { fontSize: 14, fontWeight: "700", fontFamily: "Helvetica Neue" },
  strategyBody: { fontSize: 12, lineHeight: 18, fontFamily: "Helvetica Neue" },
});
