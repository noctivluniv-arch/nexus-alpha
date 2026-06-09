import React, { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebIcon } from "@/components/WebIcon";

import { Header } from "@/components/Header";
import { useColors } from "@/hooks/useColors";
import { api, formatNumber } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { WhaleAlert, DerivStat } from "@/lib/types";

function timeAgo(ts: number, t: (k: string) => string): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}${t("nexus.time.s")}`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}${t("nexus.time.m")}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${t("nexus.time.h")}`;
  return `${Math.floor(h / 24)}${t("nexus.time.d")}`;
}

function formatUsdShort(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function NexusScreen() {
  const colors = useColors();
  const t = useT();
  const [alerts, setAlerts] = useState<WhaleAlert[]>([]);
  const [derivatives, setDerivatives] = useState<DerivStat[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    longs: 0,
    shorts: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.getNexusFeed();
      setAlerts(data.alerts);
      setDerivatives(data.derivatives);
      setStats({
        total: data.totalLiquidatedUsd24h,
        longs: data.longsLiquidatedUsd,
        shorts: data.shortsLiquidatedUsd,
      });
    } catch (e: any) {
      setError(t("nexus.error"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
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
        subtitle={t("header.nexus")}
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
        <View
          style={[
            styles.banner,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <WebIcon name="anchor" size={18} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: colors.foreground }]}>
              {t("nexus.banner.title")}
            </Text>
            <Text
              style={[styles.bannerSub, { color: colors.mutedForeground }]}
            >
              {t("nexus.banner.sub")}
            </Text>
          </View>
        </View>

        {/* Derivatives Stats Grid */}
        {derivatives.length > 0 ? (
          <View style={styles.derivGrid}>
            {derivatives.map((d) => {
              const biasColor =
                d.bias === "LONG_HEAVY"
                  ? colors.success
                  : d.bias === "SHORT_HEAVY"
                    ? colors.danger
                    : colors.mutedForeground;
              return (
                <View
                  key={d.symbol}
                  style={[
                    styles.derivCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[styles.derivSymbol, { color: colors.foreground }]}
                  >
                    {d.symbol}
                  </Text>
                  <Text
                    style={[styles.derivLabel, { color: colors.mutedForeground }]}
                  >
                    {t("nexus.openInterest")}
                  </Text>
                  <Text style={[styles.derivVal, { color: colors.cyan }]}>
                    {formatUsdShort(d.oiUsd)}
                  </Text>
                  <Text
                    style={[styles.derivLabel, { color: colors.mutedForeground }]}
                  >
                    {t("nexus.funding")}
                  </Text>
                  <Text style={[styles.derivVal, { color: biasColor }]}>
                    {(d.fundingRate * 100).toFixed(4)}%
                  </Text>
                  <View
                    style={[
                      styles.biasPill,
                      { borderColor: biasColor, backgroundColor: biasColor + "1A" },
                    ]}
                  >
                    <Text style={[styles.biasText, { color: biasColor }]}>
                      {d.bias === "LONG_HEAVY"
                        ? t("nexus.bias.long")
                        : d.bias === "SHORT_HEAVY"
                          ? t("nexus.bias.short")
                          : t("nexus.bias.balanced")}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Liquidation Summary */}
        {stats.total > 0 ? (
          <View
            style={[
              styles.summaryBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text
              style={[styles.summaryTitle, { color: colors.mutedForeground }]}
            >
              {t("nexus.totalLiq")}
            </Text>
            <Text style={[styles.summaryAmount, { color: colors.foreground }]}>
              {formatUsdShort(stats.total)}
            </Text>
            <View style={styles.summarySplit}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.splitLabel, { color: colors.success }]}
                >
                  {t("nexus.longsLiq")}
                </Text>
                <Text
                  style={[styles.splitValue, { color: colors.foreground }]}
                >
                  {formatUsdShort(stats.longs)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.splitLabel, { color: colors.danger }]}
                >
                  {t("nexus.shortsLiq")}
                </Text>
                <Text
                  style={[styles.splitValue, { color: colors.foreground }]}
                >
                  {formatUsdShort(stats.shorts)}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {error ? (
          <View
            style={[
              styles.errorBox,
              { backgroundColor: "#2A1A1F", borderColor: colors.danger },
            ]}
          >
            <WebIcon name="alert-triangle" size={16} color={colors.danger} />
            <Text style={[styles.errorText, { color: colors.danger }]}>
              {error}
            </Text>
          </View>
        ) : null}

        {loading && alerts.length === 0 ? (
          <View style={{ paddingVertical: 60, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
            <Text
              style={{
                color: colors.mutedForeground,
                marginTop: 12,
                fontSize: 11,
                fontFamily: "Helvetica Neue",
              }}
            >
              {t("nexus.fetchingOnchain")}
            </Text>
          </View>
        ) : null}

        {alerts.length > 0 ? (
          <Text
            style={[
              styles.sectionLabel,
              { color: colors.mutedForeground },
            ]}
          >
            {t("nexus.recentEvents")}
          </Text>
        ) : null}

        <View style={{ gap: 10 }}>
          {alerts.map((alert) => {
            const isLong = alert.from.toLowerCase().startsWith("long");
            const sideColor = isLong ? colors.danger : colors.success;
            const sideLabel = isLong
              ? t("nexus.longLiquidated")
              : t("nexus.shortLiquidated");
            return (
              <View
                key={alert.id}
                style={[
                  styles.alertCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.alertHead}>
                  <View
                    style={[
                      styles.typeBadge,
                      {
                        backgroundColor: sideColor + "22",
                        borderColor: sideColor,
                      },
                    ]}
                  >
                    <WebIcon
                      name={isLong ? "arrow-down-right" : "arrow-up-right"}
                      size={11}
                      color={sideColor}
                    />
                    <Text style={[styles.typeLabel, { color: sideColor }]}>
                      {sideLabel}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.timeText,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {timeAgo(alert.timestamp, t)}
                  </Text>
                </View>

                <View style={styles.amountRow}>
                  <Text
                    style={[styles.amount, { color: colors.foreground }]}
                  >
                    {formatNumber(alert.amount, 4)}
                  </Text>
                  <Text style={[styles.symbol, { color: colors.primary }]}>
                    {alert.symbol}
                  </Text>
                </View>
                <Text style={[styles.usd, { color: colors.mutedForeground }]}>
                  ≈ ${formatNumber(alert.amountUsd, 0)}
                </Text>

                <View style={styles.flowRow}>
                  <Text
                    style={[styles.flowVenue, { color: colors.mutedForeground }]}
                  >
                    {t("nexus.venue")}: {alert.to}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  bannerTitle: { fontSize: 12, fontFamily: "Helvetica Neue", letterSpacing: 1 },
  bannerSub: { fontSize: 11, fontFamily: "Helvetica Neue", marginTop: 2 },
  derivGrid: { flexDirection: "row", gap: 8, marginBottom: 14 },
  derivCard: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  derivSymbol: {
    fontSize: 13,
    fontFamily: "Helvetica Neue",
    marginBottom: 4,
  },
  derivLabel: {
    fontSize: 8,
    letterSpacing: 1,
    fontFamily: "Helvetica Neue",
    marginTop: 4,
  },
  derivVal: { fontSize: 12, fontFamily: "Helvetica Neue" },
  biasPill: {
    marginTop: 6,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: "flex-start",
  },
  biasText: { fontSize: 8, fontFamily: "Helvetica Neue", letterSpacing: 0.8 },
  summaryBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 14,
  },
  summaryTitle: {
    fontSize: 9,
    letterSpacing: 1.2,
    fontFamily: "Helvetica Neue",
  },
  summaryAmount: {
    fontSize: 22,
    fontFamily: "Helvetica Neue",
    marginTop: 4,
    marginBottom: 12,
  },
  summarySplit: { flexDirection: "row", gap: 12 },
  splitLabel: {
    fontSize: 9,
    letterSpacing: 1,
    fontFamily: "Helvetica Neue",
    marginBottom: 4,
  },
  splitValue: { fontSize: 14, fontFamily: "Helvetica Neue" },
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
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 1.2,
    fontFamily: "Helvetica Neue",
    marginBottom: 8,
    marginTop: 4,
  },
  alertCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  alertHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeLabel: { fontSize: 9, fontFamily: "Helvetica Neue", letterSpacing: 1 },
  timeText: { fontSize: 10, fontFamily: "Helvetica Neue" },
  amountRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  amount: { fontSize: 20, fontFamily: "Helvetica Neue" },
  symbol: { fontSize: 14, fontFamily: "Helvetica Neue" },
  usd: { fontSize: 11, fontFamily: "Helvetica Neue", marginTop: 2 },
  flowRow: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.05)",
  },
  flowVenue: { fontSize: 10, fontFamily: "Helvetica Neue" },
});
