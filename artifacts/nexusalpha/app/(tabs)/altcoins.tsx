import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Header } from "@/components/Header";
import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api";

type Category = "ALL" | "AI" | "L1" | "L2" | "DeFi" | "Privacy" | "RWA" | "Gaming" | "Payments";
type Rating = "STRONG BUY" | "BUY" | "HOLD" | "AVOID";

interface AltcoinScores {
  total: number;
  fundamental: number;
  technical: number;
  narrative: number;
  marketPosition: number;
  safety: number;
  rating: Rating;
  earlyGem: boolean;
}

interface Altcoin {
  id: string;
  symbol: string;
  name: string;
  category: string;
  narrative: string;
  image: string;
  price: number;
  priceFormatted: string;
  change24h: number;
  change7d: number;
  change30d: number;
  marketCap: number;
  marketCapFormatted: string;
  volume24h: number;
  rank: number;
  ath: number;
  athChangePercent: number;
  scores: AltcoinScores;
  rating: Rating;
  earlyGem: boolean;
  description: string;
  links: { website: string; twitter: string; github: string };
  developerScore: number;
  communityScore: number;
  liquidityScore: number;
  coingeckoScore: number;
}

const CATEGORIES: { id: Category; label: string; emoji: string }[] = [
  { id: "ALL", label: "ALL", emoji: "🌐" },
  { id: "AI", label: "AI", emoji: "🤖" },
  { id: "L1", label: "LAYER 1", emoji: "⚡" },
  { id: "L2", label: "LAYER 2", emoji: "🔗" },
  { id: "DeFi", label: "DeFi", emoji: "💰" },
  { id: "Privacy", label: "PRIVACY", emoji: "🔒" },
  { id: "RWA", label: "RWA", emoji: "🏦" },
  { id: "Gaming", label: "GAMING", emoji: "🎮" },
];

export default function AltcoinsScreen() {
  const colors = useColors();
  const t = useT();
  const [coins, setCoins] = useState<Altcoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<Category>("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchAltcoins = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${api.baseUrl}/altcoins`, {
        headers: { "x-app-secret": "nexusalpha-secret-2026" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCoins(data);
    } catch (e: any) {
      setError("Failed to load altcoins. Check connection.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAltcoins(); }, []);

  const filtered = useMemo(() => {
    if (activeCategory === "ALL") return coins;
    return coins.filter((c) => c.category === activeCategory);
  }, [coins, activeCategory]);

  const ratingColor = (rating: Rating) => {
    if (rating === "STRONG BUY") return "#22C55E";
    if (rating === "BUY") return "#84CC16";
    if (rating === "HOLD") return "#F59E0B";
    return "#EF4444";
  };

  const changeColor = (v: number) => v >= 0 ? colors.success : colors.danger;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header subtitle="Altcoin Watchlist" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAltcoins(true)} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Category Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll} contentContainerStyle={styles.categoryContent}>
          {CATEGORIES.map((cat) => {
            const count = cat.id === "ALL" ? coins.length : coins.filter(c => c.category === cat.id).length;
            const active = activeCategory === cat.id;
            return (
              <Pressable
                key={cat.id}
                onPress={() => setActiveCategory(cat.id)}
                style={[styles.catChip, {
                  backgroundColor: active ? colors.primary + "22" : "rgba(255,255,255,0.05)",
                  borderColor: active ? colors.primary : colors.border,
                }]}
              >
                <Text style={[styles.catChipText, { color: active ? colors.primary : colors.mutedForeground }]}>
                  {cat.emoji} {cat.label}
                </Text>
                {count > 0 && (
                  <View style={[styles.catBadge, { backgroundColor: active ? colors.primary : colors.border }]}>
                    <Text style={[styles.catBadgeText, { color: active ? "#000" : colors.mutedForeground }]}>{count}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Stats Bar */}
        {coins.length > 0 && (
          <View style={[styles.statsBar, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border }]}>
            {[
              { label: "STRONG BUY", count: coins.filter(c => c.rating === "STRONG BUY").length, color: "#22C55E" },
              { label: "BUY", count: coins.filter(c => c.rating === "BUY").length, color: "#84CC16" },
              { label: "HOLD", count: coins.filter(c => c.rating === "HOLD").length, color: "#F59E0B" },
              { label: "EARLY GEM", count: coins.filter(c => c.earlyGem).length, color: "#F59E0B" },
            ].map((s) => (
              <View key={s.label} style={styles.statItem}>
                <Text style={[styles.statVal, { color: s.color }]}>{s.count}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Loading */}
        {loading && (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
              Fetching altcoin data from CoinGecko...
            </Text>
          </View>
        )}

        {/* Error */}
        {error && !loading && (
          <View style={styles.centerBox}>
            <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
            <Pressable onPress={() => fetchAltcoins()} style={[styles.retryBtn, { borderColor: colors.primary }]}>
              <Text style={[styles.retryText, { color: colors.primary }]}>RETRY</Text>
            </Pressable>
          </View>
        )}

        {/* Coin List */}
        <View style={styles.coinList}>
          {filtered.map((coin) => {
            const expanded = expandedId === coin.id;
            const rc = ratingColor(coin.rating);
            return (
              <Pressable
                key={coin.id}
                onPress={() => setExpandedId(expanded ? null : coin.id)}
                style={[styles.coinCard, { backgroundColor: "rgba(255,255,255,0.02)", borderColor: colors.border }]}
              >
                {/* Header Row */}
                <View style={styles.coinHeader}>
                  <View style={styles.coinLeft}>
                    <View style={[styles.rankBadge, { backgroundColor: colors.border }]}>
                      <Text style={[styles.rankText, { color: colors.mutedForeground }]}>#{coin.rank}</Text>
                    </View>
                    <View>
                      <View style={styles.nameRow}>
                        <Text style={[styles.coinSymbol, { color: colors.foreground }]}>{coin.symbol}</Text>
                        {coin.earlyGem && (
                          <View style={[styles.gemBadge, { backgroundColor: "#F59E0B22", borderColor: "#F59E0B55" }]}>
                            <Text style={[styles.gemText, { color: "#F59E0B" }]}>⭐ EARLY GEM</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.coinName, { color: colors.mutedForeground }]}>{coin.name}</Text>
                    </View>
                  </View>
                  <View style={styles.coinRight}>
                    <Text style={[styles.coinPrice, { color: colors.foreground }]}>{coin.priceFormatted}</Text>
                    <Text style={[styles.coinChange, { color: changeColor(coin.change24h) }]}>
                      {coin.change24h >= 0 ? "+" : ""}{coin.change24h.toFixed(2)}%
                    </Text>
                  </View>
                </View>

                {/* Rating + Category + Score */}
                <View style={styles.metaRow}>
                  <View style={[styles.ratingBadge, { backgroundColor: rc + "22", borderColor: rc + "55" }]}>
                    <Text style={[styles.ratingText, { color: rc }]}>{coin.rating}</Text>
                  </View>
                  <View style={[styles.catTag, { backgroundColor: colors.border }]}>
                    <Text style={[styles.catTagText, { color: colors.mutedForeground }]}>
                      {CATEGORIES.find(c => c.id === coin.category)?.emoji} {coin.category}
                    </Text>
                  </View>
                  <Text style={[styles.scoreText, { color: colors.primary }]}>{coin.scores.total}/100</Text>
                  <Text style={[styles.mcapText, { color: colors.mutedForeground }]}>{coin.marketCapFormatted}</Text>
                </View>

                {/* Score Bar */}
                <View style={[styles.scoreBarBg, { backgroundColor: "rgba(255,255,255,0.06)" }]}>
                  <View style={[styles.scoreBarFill, { width: `${coin.scores.total}%` as any, backgroundColor: rc }]} />
                </View>

                {/* Narrative */}
                <Text style={[styles.narrativeText, { color: colors.mutedForeground }]} numberOfLines={expanded ? 0 : 2}>
                  {coin.narrative}
                </Text>

                {/* Expanded Details */}
                {expanded && (
                  <View style={styles.expandedSection}>
                    {/* Score Breakdown */}
                    <View style={[styles.scoreBreakdown, { borderColor: colors.border }]}>
                      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SCORE BREAKDOWN</Text>
                      {[
                        { label: "FUNDAMENTAL", val: coin.scores.fundamental, max: 30 },
                        { label: "TECHNICAL", val: coin.scores.technical, max: 25 },
                        { label: "NARRATIVE", val: coin.scores.narrative, max: 20 },
                        { label: "MARKET POSITION", val: coin.scores.marketPosition, max: 15 },
                        { label: "SAFETY", val: coin.scores.safety, max: 10 },
                      ].map((s) => (
                        <View key={s.label} style={styles.scoreRow}>
                          <Text style={[styles.scoreRowLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
                          <View style={[styles.scoreRowBar, { backgroundColor: "rgba(255,255,255,0.06)" }]}>
                            <View style={[styles.scoreRowFill, { width: `${(s.val / s.max) * 100}%` as any, backgroundColor: s.val / s.max >= 0.6 ? colors.success : s.val / s.max >= 0.3 ? colors.primary : colors.danger }]} />
                          </View>
                          <Text style={[styles.scoreRowVal, { color: colors.foreground }]}>{s.val}/{s.max}</Text>
                        </View>
                      ))}
                    </View>

                    {/* Price Changes */}
                    <View style={[styles.changesGrid, { borderColor: colors.border }]}>
                      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PRICE CHANGES</Text>
                      <View style={styles.changesRow}>
                        {[
                          { label: "24H", val: coin.change24h },
                          { label: "7D", val: coin.change7d },
                          { label: "30D", val: coin.change30d },
                          { label: "FROM ATH", val: coin.athChangePercent },
                        ].map((c) => (
                          <View key={c.label} style={styles.changeItem}>
                            <Text style={[styles.changeLabel, { color: colors.mutedForeground }]}>{c.label}</Text>
                            <Text style={[styles.changeVal, { color: changeColor(c.val) }]}>
                              {c.val >= 0 ? "+" : ""}{c.val.toFixed(1)}%
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>

                    {/* Scores */}
                    <View style={[styles.scoresGrid, { borderColor: colors.border }]}>
                      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>COINGECKO SCORES</Text>
                      <View style={styles.changesRow}>
                        {[
                          { label: "DEVELOPER", val: coin.developerScore },
                          { label: "COMMUNITY", val: coin.communityScore },
                          { label: "LIQUIDITY", val: coin.liquidityScore },
                          { label: "OVERALL", val: coin.coingeckoScore },
                        ].map((s) => (
                          <View key={s.label} style={styles.changeItem}>
                            <Text style={[styles.changeLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
                            <Text style={[styles.changeVal, { color: s.val >= 60 ? colors.success : s.val >= 30 ? colors.primary : colors.danger }]}>
                              {s.val.toFixed(0)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>

                    {/* Description */}
                    {coin.description && (
                      <View style={[styles.descBox, { borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.02)" }]}>
                        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>WHAT IS IT?</Text>
                        <Text style={[styles.descText, { color: colors.foreground }]}>{coin.description}</Text>
                      </View>
                    )}

                    {/* Early Gem Info */}
                    {coin.earlyGem && (
                      <View style={[styles.gemBox, { backgroundColor: "#F59E0B11", borderColor: "#F59E0B44" }]}>
                        <Text style={[styles.gemBoxTitle, { color: "#F59E0B" }]}>⭐ EARLY GEM DETECTED</Text>
                        <Text style={[styles.gemBoxText, { color: colors.foreground }]}>
                          This altcoin has a small-mid market cap with strong narrative momentum in the {coin.category} sector. High potential for significant gains as adoption grows.
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                <Text style={[styles.tapHint, { color: colors.mutedForeground }]}>
                  {expanded ? "▲ tap to collapse" : "▼ tap for details"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  categoryScroll: { paddingVertical: 10 },
  categoryContent: { paddingHorizontal: 14, gap: 8 },
  catChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  catChipText: { fontSize: 11, fontFamily: "Helvetica Neue", fontWeight: "600", letterSpacing: 0.4 },
  catBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 8 },
  catBadgeText: { fontSize: 9, fontFamily: "Helvetica Neue", fontWeight: "600" },
  statsBar: { marginHorizontal: 14, marginBottom: 12, padding: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", justifyContent: "space-around" },
  statItem: { alignItems: "center", gap: 2 },
  statVal: { fontSize: 18, fontFamily: "Helvetica Neue", fontWeight: "700" },
  statLabel: { fontSize: 9, fontFamily: "Helvetica Neue", letterSpacing: 0.5 },
  centerBox: { alignItems: "center", paddingVertical: 60, gap: 12 },
  loadingText: { fontSize: 12, fontFamily: "Helvetica Neue", textAlign: "center" },
  errorText: { fontSize: 13, fontFamily: "Helvetica Neue", textAlign: "center" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  retryText: { fontSize: 12, fontFamily: "Helvetica Neue", fontWeight: "600" },
  coinList: { paddingHorizontal: 14, gap: 10 },
  coinCard: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  coinHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  coinLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  rankBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  rankText: { fontSize: 10, fontFamily: "Helvetica Neue", fontWeight: "600" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  coinSymbol: { fontSize: 15, fontFamily: "Helvetica Neue", fontWeight: "700" },
  coinName: { fontSize: 11, fontFamily: "Helvetica Neue" },
  gemBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  gemText: { fontSize: 9, fontFamily: "Helvetica Neue", fontWeight: "600" },
  coinRight: { alignItems: "flex-end" },
  coinPrice: { fontSize: 14, fontFamily: "Helvetica Neue", fontWeight: "600" },
  coinChange: { fontSize: 12, fontFamily: "Helvetica Neue", fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" },
  ratingBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  ratingText: { fontSize: 10, fontFamily: "Helvetica Neue", fontWeight: "700", letterSpacing: 0.5 },
  catTag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  catTagText: { fontSize: 10, fontFamily: "Helvetica Neue" },
  scoreText: { fontSize: 12, fontFamily: "Helvetica Neue", fontWeight: "700", marginLeft: "auto" },
  mcapText: { fontSize: 10, fontFamily: "Helvetica Neue" },
  scoreBarBg: { height: 3, borderRadius: 2, marginBottom: 8 },
  scoreBarFill: { height: 3, borderRadius: 2 },
  narrativeText: { fontSize: 11, fontFamily: "Helvetica Neue", lineHeight: 16 },
  expandedSection: { marginTop: 12, gap: 10 },
  scoreBreakdown: { padding: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  sectionLabel: { fontSize: 9, fontFamily: "Helvetica Neue", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  scoreRowLabel: { fontSize: 9, fontFamily: "Helvetica Neue", width: 100 },
  scoreRowBar: { flex: 1, height: 4, borderRadius: 2 },
  scoreRowFill: { height: 4, borderRadius: 2 },
  scoreRowVal: { fontSize: 10, fontFamily: "Helvetica Neue", width: 30, textAlign: "right" },
  changesGrid: { padding: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  changesRow: { flexDirection: "row", justifyContent: "space-around" },
  changeItem: { alignItems: "center", gap: 3 },
  changeLabel: { fontSize: 9, fontFamily: "Helvetica Neue", letterSpacing: 0.5 },
  changeVal: { fontSize: 13, fontFamily: "Helvetica Neue", fontWeight: "600" },
  scoresGrid: { padding: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  descBox: { padding: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  descText: { fontSize: 11, fontFamily: "Helvetica Neue", lineHeight: 16 },
  gemBox: { padding: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  gemBoxTitle: { fontSize: 11, fontFamily: "Helvetica Neue", fontWeight: "700", marginBottom: 4 },
  gemBoxText: { fontSize: 11, fontFamily: "Helvetica Neue", lineHeight: 16 },
  tapHint: { fontSize: 9, fontFamily: "Helvetica Neue", textAlign: "center", marginTop: 8 },
});
