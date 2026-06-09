import React, { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Header } from "@/components/Header";
import { useColors } from "@/hooks/useColors";
import { api, formatNumber } from "@/lib/api";
import { useT } from "@/lib/i18n";

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s lalu`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j lalu`;
  return `${Math.floor(h / 24)}h lalu`;
}

function formatUsdShort(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function LongShortBar({ longPct, shortPct, ratio, symbol, type }: {
  longPct: number;
  shortPct: number;
  ratio: number;
  symbol: string;
  type: string;
}) {
  const colors = useColors();
  const isLongHeavy = longPct > shortPct;
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
        <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: "Helvetica Neue" }}>
          {symbol} <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>{type}</Text>
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: "Helvetica Neue" }}>
          Ratio: {ratio.toFixed(2)}
        </Text>
      </View>
      <View style={{ flexDirection: "row", height: 20, borderRadius: 6, overflow: "hidden" }}>
        <View style={{ flex: longPct, backgroundColor: "#16C784", justifyContent: "center", paddingLeft: 6 }}>
          {longPct > 15 ? <Text style={{ color: "#fff", fontSize: 9, fontFamily: "Helvetica Neue" }}>L {longPct.toFixed(1)}%</Text> : null}
        </View>
        <View style={{ flex: shortPct, backgroundColor: "#EA3943", justifyContent: "center", alignItems: "flex-end", paddingRight: 6 }}>
          {shortPct > 15 ? <Text style={{ color: "#fff", fontSize: 9, fontFamily: "Helvetica Neue" }}>S {shortPct.toFixed(1)}%</Text> : null}
        </View>
      </View>
    </View>
  );
}

export default function NexusScreen() {
  const colors = useColors();
  const t = useT();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const feed = await api.getNexusFeed();
      setData(feed);
    } catch (e: any) {
      setError("Gagal memuat data. Coba lagi.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header onRefresh={onRefresh} refreshing={refreshing} subtitle={t("header.nexus")} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {loading && !data ? (
          <View style={{ paddingVertical: 60, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.mutedForeground, marginTop: 12, fontSize: 11 }}>Memuat data...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: "#2A1A1F", borderColor: colors.danger }]}>
            <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          </View>
        ) : null}

        {/* LONG/SHORT RATIO OKX */}
        {data?.longShortOkx?.length > 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: "#F59E0B" }]}>LONG / SHORT RATIO</Text>
              <View style={[styles.exchangeBadge, { backgroundColor: "#F59E0B22", borderColor: "#F59E0B" }]}>
                <Text style={{ color: "#F59E0B", fontSize: 9, fontFamily: "Helvetica Neue" }}>OKX</Text>
              </View>
            </View>
            {data.longShortOkx.map((ls: any) => (
              <LongShortBar key={ls.symbol} longPct={ls.longPct} shortPct={ls.shortPct} ratio={ls.ratio} symbol={ls.symbol} type="Global" />
            ))}
          </View>
        ) : null}

        {/* LONG/SHORT RATIO BINANCE */}
        {data?.longShortBinance?.length > 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 10 }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: "#F3BA2F" }]}>LONG / SHORT RATIO</Text>
              <View style={[styles.exchangeBadge, { backgroundColor: "#F3BA2F22", borderColor: "#F3BA2F" }]}>
                <Text style={{ color: "#F3BA2F", fontSize: 9, fontFamily: "Helvetica Neue" }}>BINANCE</Text>
              </View>
            </View>
            {data.longShortBinance.map((ls: any, i: number) => (
              <LongShortBar key={`${ls.symbol}-${i}`} longPct={ls.longPct} shortPct={ls.shortPct} ratio={ls.ratio} symbol={ls.symbol} type={ls.type === "TOP_TRADER" ? "Top Trader" : "Global"} />
            ))}
          </View>
        ) : null}

        {/* DERIVATIVES STATS */}
        {data?.derivatives?.length > 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 10 }]}>
            <Text style={[styles.cardTitle, { color: colors.mutedForeground, marginBottom: 10 }]}>OPEN INTEREST & FUNDING</Text>
            <View style={styles.derivGrid}>
              {data.derivatives.map((d: any) => {
                const biasColor = d.bias === "LONG_HEAVY" ? colors.success : d.bias === "SHORT_HEAVY" ? colors.danger : colors.mutedForeground;
                return (
                  <View key={d.symbol} style={[styles.derivCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Text style={[styles.derivSymbol, { color: colors.foreground }]}>{d.symbol}</Text>
                    <Text style={[styles.derivLabel, { color: colors.mutedForeground }]}>OPEN INTEREST</Text>
                    <Text style={[styles.derivVal, { color: colors.cyan }]}>{formatUsdShort(d.oiUsd)}</Text>
                    <Text style={[styles.derivLabel, { color: colors.mutedForeground }]}>FUNDING</Text>
                    <Text style={[styles.derivVal, { color: biasColor }]}>{(d.fundingRate * 100).toFixed(4)}%</Text>
                    <View style={[styles.biasPill, { borderColor: biasColor, backgroundColor: biasColor + "1A" }]}>
                      <Text style={[styles.biasText, { color: biasColor }]}>
                        {d.bias === "LONG_HEAVY" ? "LONG BIAS" : d.bias === "SHORT_HEAVY" ? "SHORT BIAS" : "BALANCED"}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* LIQUIDATION SUMMARY */}
        {data?.totalLiquidatedUsd24h > 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 10 }]}>
            <Text style={[styles.cardTitle, { color: colors.mutedForeground, marginBottom: 10 }]}>TOTAL LIKUIDASI</Text>
            <Text style={[styles.summaryAmount, { color: colors.foreground }]}>{formatUsdShort(data.totalLiquidatedUsd24h)}</Text>
            <View style={styles.summarySplit}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.splitLabel, { color: colors.success }]}>LONGS LIQUIDATED</Text>
                <Text style={[styles.splitValue, { color: colors.foreground }]}>{formatUsdShort(data.longsLiquidatedUsd)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.splitLabel, { color: colors.danger }]}>SHORTS LIQUIDATED</Text>
                <Text style={[styles.splitValue, { color: colors.foreground }]}>{formatUsdShort(data.shortsLiquidatedUsd)}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* WHALE ALERTS */}
        {data?.whales?.length > 0 ? (
          <View style={{ marginTop: 10 }}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.cardTitle, { color: "#8B5CF6" }]}>WHALE ALERTS</Text>
              <View style={[styles.exchangeBadge, { backgroundColor: "#8B5CF622", borderColor: "#8B5CF6" }]}>
                <Text style={{ color: "#8B5CF6", fontSize: 9 }}>MIN $100K</Text>
              </View>
            </View>
            <View style={{ gap: 8 }}>
              {data.whales.map((alert: any, idx: number) => {
                const isLong = alert.from.toLowerCase().startsWith("long");
                const sideColor = isLong ? colors.danger : colors.success;
                return (
                  <View key={`${alert.timestamp}-${idx}`} style={[styles.alertCard, { backgroundColor: colors.card, borderColor: sideColor + "44" }]}>
                    <View style={styles.alertHead}>
                      <View style={[styles.typeBadge, { backgroundColor: sideColor + "22", borderColor: sideColor }]}>
                        <Text style={[styles.typeLabel, { color: sideColor }]}>
                          {isLong ? "LONG DI-LIQUIDATE" : "SHORT DI-LIQUIDATE"}
                        </Text>
                      </View>
                      <Text style={[styles.timeText, { color: colors.mutedForeground }]}>{timeAgo(alert.timestamp)}</Text>
                    </View>
                    <View style={styles.amountRow}>
                      <Text style={[styles.amount, { color: colors.foreground }]}>{formatNumber(alert.amount, 4)}</Text>
                      <Text style={[styles.symbol, { color: colors.primary }]}>{alert.symbol}</Text>
                      <View style={[styles.whaleBadge, { backgroundColor: "#8B5CF622", borderColor: "#8B5CF6" }]}>
                        <Text style={{ color: "#8B5CF6", fontSize: 8, fontFamily: "Helvetica Neue" }}>WHALE</Text>
                      </View>
                    </View>
                    <Text style={[styles.usd, { color: colors.mutedForeground }]}>≈ ${formatNumber(alert.amountUsd, 0)}</Text>
                    <Text style={[styles.flowVenue, { color: colors.mutedForeground, marginTop: 6 }]}>Venue: {alert.to}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* ALL LIQUIDATIONS */}
        {data?.alerts?.length > 0 ? (
          <View style={{ marginTop: 10 }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SEMUA EVENT LIKUIDASI</Text>
            <View style={{ gap: 8 }}>
              {data.alerts.filter((a: any) => !a.isWhale).map((alert: any, idx: number) => {
                const isLong = alert.from.toLowerCase().startsWith("long");
                const sideColor = isLong ? colors.danger : colors.success;
                return (
                  <View key={`${alert.timestamp}-${idx}`} style={[styles.alertCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.alertHead}>
                      <View style={[styles.typeBadge, { backgroundColor: sideColor + "22", borderColor: sideColor }]}>
                        <Text style={[styles.typeLabel, { color: sideColor }]}>
                          {isLong ? "LONG DI-LIQUIDATE" : "SHORT DI-LIQUIDATE"}
                        </Text>
                      </View>
                      <Text style={[styles.timeText, { color: colors.mutedForeground }]}>{timeAgo(alert.timestamp)}</Text>
                    </View>
                    <View style={styles.amountRow}>
                      <Text style={[styles.amount, { color: colors.foreground }]}>{formatNumber(alert.amount, 4)}</Text>
                      <Text style={[styles.symbol, { color: colors.primary }]}>{alert.symbol}</Text>
                    </View>
                    <Text style={[styles.usd, { color: colors.mutedForeground }]}>≈ ${formatNumber(alert.amountUsd, 0)}</Text>
                    <Text style={[styles.flowVenue, { color: colors.mutedForeground, marginTop: 6 }]}>Venue: {alert.to}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 2 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  cardTitle: { fontSize: 11, fontFamily: "Helvetica Neue", letterSpacing: 1.2 },
  exchangeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  derivGrid: { flexDirection: "row", gap: 8 },
  derivCard: { flex: 1, padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, gap: 3 },
  derivSymbol: { fontSize: 13, fontFamily: "Helvetica Neue", marginBottom: 4 },
  derivLabel: { fontSize: 8, letterSpacing: 1, fontFamily: "Helvetica Neue", marginTop: 3 },
  derivVal: { fontSize: 12, fontFamily: "Helvetica Neue" },
  biasPill: { marginTop: 6, paddingVertical: 3, paddingHorizontal: 6, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, alignSelf: "flex-start" },
  biasText: { fontSize: 8, fontFamily: "Helvetica Neue", letterSpacing: 0.8 },
  summaryAmount: { fontSize: 22, fontFamily: "Helvetica Neue", marginBottom: 12 },
  summarySplit: { flexDirection: "row", gap: 12 },
  splitLabel: { fontSize: 9, letterSpacing: 1, fontFamily: "Helvetica Neue", marginBottom: 4 },
  splitValue: { fontSize: 14, fontFamily: "Helvetica Neue" },
  sectionLabel: { fontSize: 10, letterSpacing: 1.2, fontFamily: "Helvetica Neue", marginBottom: 8, marginTop: 4 },
  alertCard: { padding: 14, borderRadius: 12, borderWidth: 1 },
  alertHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  typeBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  typeLabel: { fontSize: 9, fontFamily: "Helvetica Neue", letterSpacing: 1 },
  timeText: { fontSize: 10, fontFamily: "Helvetica Neue" },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  amount: { fontSize: 18, fontFamily: "Helvetica Neue" },
  symbol: { fontSize: 13, fontFamily: "Helvetica Neue" },
  whaleBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  usd: { fontSize: 11, fontFamily: "Helvetica Neue" },
  flowVenue: { fontSize: 10, fontFamily: "Helvetica Neue" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  errorText: { fontSize: 12, flex: 1, fontFamily: "Helvetica Neue" },
});
