import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { Header } from "@/components/Header";
import { useColors } from "@/hooks/useColors";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { NewsFeedItem } from "@/lib/types";

const TRUMP_COLOR = "#DC2626";
const ELON_COLOR = "#1D9BF0";
const BLACKROCK_COLOR = "#F59E0B";
const SAYLOR_COLOR = "#F97316";
const CZ_COLOR = "#EAB308";
const VITALIK_COLOR = "#8B5CF6";
const CATHIE_COLOR = "#10B981";
const ARMSTRONG_COLOR = "#0EA5E9";
const KIYOSAKI_COLOR = "#F43F5E";
const DORSEY_COLOR = "#6366F1";
const HAYES_COLOR = "#EC4899";

const NEWS_LINK_HOSTS: Record<"X" | "NEWS", ReadonlySet<string>> = {
  X: new Set(["x.com", "twitter.com", "t.co", "www.x.com", "www.twitter.com"]),
  NEWS: new Set([
    "cointelegraph.com",
    "www.cointelegraph.com",
    "coindesk.com",
    "www.coindesk.com",
    "decrypt.co",
    "www.decrypt.co",
    "news.google.com",
  ]),
};

function openNewsUrl(url: string, sourceType: "X" | "NEWS") {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return;
    if (!NEWS_LINK_HOSTS[sourceType].has(parsed.hostname.toLowerCase())) return;
  } catch {
    return;
  }
  Linking.openURL(url).catch(() => {});
}

function influencerMeta(
  inf: NewsFeedItem["influencer"],
  colors: any,
): { color: string; letter: string; name: string; borderInner: string } {
  switch (inf) {
    case "ELON": return { color: ELON_COLOR, letter: "X", name: "Elon Musk", borderInner: "#fff" };
    case "BLACKROCK": return { color: BLACKROCK_COLOR, letter: "B", name: "BlackRock", borderInner: "#000" };
    case "SAYLOR": return { color: SAYLOR_COLOR, letter: "S", name: "Michael Saylor", borderInner: "#fff" };
    case "CZ": return { color: CZ_COLOR, letter: "CZ", name: "CZ Binance", borderInner: "#000" };
    case "VITALIK": return { color: VITALIK_COLOR, letter: "V", name: "Vitalik Buterin", borderInner: "#fff" };
    case "CATHIE": return { color: CATHIE_COLOR, letter: "C", name: "Cathie Wood", borderInner: "#fff" };
    case "ARMSTRONG": return { color: ARMSTRONG_COLOR, letter: "A", name: "Brian Armstrong", borderInner: "#fff" };
    case "KIYOSAKI": return { color: KIYOSAKI_COLOR, letter: "K", name: "Robert Kiyosaki", borderInner: "#fff" };
    case "DORSEY": return { color: DORSEY_COLOR, letter: "J", name: "Jack Dorsey", borderInner: "#fff" };
    case "HAYES": return { color: HAYES_COLOR, letter: "H", name: "Arthur Hayes", borderInner: "#fff" };
    default: return { color: TRUMP_COLOR, letter: "T", name: "Donald Trump", borderInner: colors.primary };
  }
}

export default function NewsScreen() {
  const colors = useColors();
  const t = useT();
  const [items, setItems] = useState<NewsFeedItem[]>([]);
  const [xBuzz, setXBuzz] = useState<NewsFeedItem[]>([]);
  const [trendingTopics, setTrendingTopics] = useState<import("@/lib/types").TrendingTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [data, buzz, trends] = await Promise.allSettled([
        api.getNews(),
        api.getXBuzz(),
        api.getTrending(),
      ]);
      if (data.status === "fulfilled") setItems(data.value);
      else if ((data as any).reason?.message === "QUOTA_EXCEEDED") setError(t("common.quotaError"));
      else setError(t("news.error"));

      if (buzz.status === "fulfilled") setXBuzz(buzz.value);
      if (trends.status === "fulfilled") setTrendingTopics(trends.value);
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

  const catColor = (cat: NewsFeedItem["category"]) => {
    switch (cat) {
      case "BTC":
        return colors.primary;
      case "ETH":
        return colors.cyan;
      case "ALT":
        return colors.fuchsia;
      case "DEFI":
        return colors.success;
      case "MEME":
        return "#A855F7";
      case "REGULATION":
        return "#F97316";
      default:
        return colors.mutedForeground;
    }
  };

  const sentColor = (s: NewsFeedItem["sentiment"]) =>
    s === "BULLISH"
      ? colors.success
      : s === "BEARISH"
        ? colors.danger
        : colors.mutedForeground;

  const influencerItems = items.filter((i) => i.isInfluencer);
  const newsItems = items.filter((i) => i.sourceType === "NEWS");

  // Top 5 trending headlines: HIGH impact first, then MEDIUM
  const trendingHeadlines = [...newsItems]
    .sort((a, b) => {
      const impOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return impOrder[a.impact] - impOrder[b.impact];
    })
    .slice(0, 5);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header subtitle={t("header.news")} />
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
        {/* TRENDING GOLD COLUMN — top of page */}
        {trendingHeadlines.length > 0 ? (
          <TrendingColumn
            items={trendingHeadlines}
            t={t}
            catColor={catColor}
          />
        ) : loading ? (
          <TrendingColumnSkeleton />
        ) : null}

        {/* TOPIK YANG DIBICARAKAN TOKOH */}
        {trendingTopics.length > 0 ? (
          <InfluencerTopicsCard
            topics={trendingTopics}
            colors={colors}
            catColor={catColor}
          />
        ) : null}

        <View
          style={[
            styles.banner,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="globe" size={18} color={colors.cyan} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: colors.foreground }]}>
              {t("news.banner.title")}
            </Text>
            <Text
              style={[styles.bannerSub, { color: colors.mutedForeground }]}
            >
              {t("news.banner.sub")}
            </Text>
          </View>
        </View>

        {loading ? (
          <View
            style={[
              styles.loaderBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <ActivityIndicator color={colors.primary} />
            <Text
              style={[styles.loaderText, { color: colors.mutedForeground }]}
            >
              {t("news.loaderText")}
            </Text>
          </View>
        ) : null}

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

        {influencerItems.length > 0 ? (
          <View style={{ marginBottom: 18 }}>
            <SectionTitle
              icon="alert-octagon"
              text={t("news.influencerSection")}
              color={colors.primary}
            />
            <View style={{ gap: 10 }}>
              {influencerItems.map((it) => (
                <InfluencerCard
                  key={it.id}
                  item={it}
                  colors={colors}
                  catColor={catColor}
                  sentColor={sentColor}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* X BUZZ — AI-generated influencer posts */}
        {xBuzz.length > 0 ? (
          <View style={{ marginBottom: 18 }}>
            <SectionTitle
              icon="message-circle"
              text={t("news.xSection")}
              color={colors.cyan}
            />
            <View
              style={[
                styles.aiBuzzBanner,
                { backgroundColor: colors.cyan + "12", borderColor: colors.cyan + "44" },
              ]}
            >
              <Feather name="cpu" size={11} color={colors.cyan} />
              <Text style={[styles.aiBuzzText, { color: colors.cyan }]}>
                {t("news.aiBuzzNote")}
              </Text>
            </View>
            <View style={{ gap: 10 }}>
              {xBuzz.map((it) => (
                <XBuzzCard
                  key={it.id}
                  item={it}
                  colors={colors}
                  catColor={catColor}
                  sentColor={sentColor}
                />
              ))}
            </View>
          </View>
        ) : null}

        {newsItems.length > 0 ? (
          <View>
            <SectionTitle
              icon="rss"
              text={t("news.mainstreamSection")}
              color={colors.fuchsia}
            />
            <View style={{ gap: 10 }}>
              {newsItems.map((it) => (
                <NewsCard
                  key={it.id}
                  item={it}
                  colors={colors}
                  catColor={catColor}
                  sentColor={sentColor}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const GOLD = "#F59E0B";
const GOLD_LIGHT = "#FCD34D";
const GOLD_DIM = "#F59E0B18";
const GOLD_BORDER = "#F59E0B55";

const SENT_ICON: Record<string, { icon: any; color: string }> = {
  BULLISH: { icon: "trending-up", color: "#16C784" },
  BEARISH: { icon: "trending-down", color: "#EA3943" },
  NEUTRAL: { icon: "minus", color: "#EAB308" },
};

function InfluencerTopicsCard({
  topics,
  colors,
  catColor,
}: {
  topics: import("@/lib/types").TrendingTopic[];
  colors: any;
  catColor: (c: any) => string;
}) {
  return (
    <View
      style={[
        styles.infTopicsCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.infTopicsHeader}>
        <Feather name="users" size={13} color="#8B5CF6" />
        <Text style={[styles.infTopicsTitle, { color: "#8B5CF6" }]}>
          SEDANG DIBICARAKAN TOKOH
        </Text>
        <View style={[styles.infTopicsBadge, { backgroundColor: "#8B5CF622", borderColor: "#8B5CF6" }]}>
          <Text style={{ color: "#8B5CF6", fontSize: 9, fontFamily: "Inter_700Bold" }}>LIVE</Text>
        </View>
      </View>
      <View style={[styles.trendingDivider, { backgroundColor: colors.border, marginBottom: 8 }]} />
      {topics.map((topic, idx) => {
        const sent = SENT_ICON[topic.sentiment] ?? SENT_ICON.NEUTRAL;
        const cc = catColor(topic.category as any);
        return (
          <View key={topic.category} style={styles.infTopicRow}>
            <Text style={[styles.infTopicNum, { color: colors.mutedForeground }]}>
              {String(idx + 1).padStart(2, "0")}
            </Text>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={[styles.infTopicLabel, { color: colors.foreground }]}>
                  {topic.label}
                </Text>
                <View style={[styles.infTopicSentBadge, { backgroundColor: sent.color + "22", borderColor: sent.color }]}>
                  <Feather name={sent.icon} size={9} color={sent.color} />
                  <Text style={{ color: sent.color, fontSize: 9, fontFamily: "Inter_700Bold" }}>
                    {topic.sentiment}
                  </Text>
                </View>
                <View style={[styles.infTopicCatBadge, { backgroundColor: cc + "22", borderColor: cc }]}>
                  <Text style={{ color: cc, fontSize: 9, fontFamily: "Inter_600SemiBold" }}>
                    {topic.category}
                  </Text>
                </View>
              </View>
              {topic.influencers && topic.influencers.length > 0 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                  <Feather name="message-circle" size={10} color={colors.mutedForeground} style={{ marginTop: 1 }} />
                  <Text style={[styles.infTopicWho, { color: colors.mutedForeground }]}>
                    {topic.influencers.slice(0, 4).join(", ")}
                    {topic.influencers.length > 4 ? ` +${topic.influencers.length - 4}` : ""}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.infTopicCount, { color: colors.mutedForeground }]}>
              {topic.count} artikel
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function TrendingColumn({
  items,
  t,
  catColor,
}: {
  items: NewsFeedItem[];
  t: (key: string) => string;
  catColor: (c: NewsFeedItem["category"]) => string;
}) {
  return (
    <View
      style={[
        styles.trendingCol,
        { backgroundColor: GOLD_DIM, borderColor: GOLD },
      ]}
    >
      {/* Header */}
      <View style={styles.trendingColHeader}>
        <View style={styles.trendingColHeaderLeft}>
          <Feather name="zap" size={14} color={GOLD} />
          <Text style={[styles.trendingColTitle, { color: GOLD }]}>
            {t("news.trendingSection")}
          </Text>
        </View>
        <View
          style={[
            styles.trendingLiveDot,
            { backgroundColor: GOLD_BORDER, borderColor: GOLD },
          ]}
        >
          <View
            style={[styles.trendingLiveInner, { backgroundColor: GOLD }]}
          />
          <Text style={[styles.trendingLiveText, { color: GOLD }]}>LIVE</Text>
        </View>
      </View>

      {/* Divider */}
      <View style={[styles.trendingDivider, { backgroundColor: GOLD_BORDER }]} />

      {/* Headlines */}
      {items.map((item, idx) => (
        <View key={item.id}>
          <View style={styles.trendingRow}>
            <Text style={[styles.trendingNum, { color: GOLD_LIGHT }]}>
              {String(idx + 1).padStart(2, "0")}
            </Text>
            <View style={{ flex: 1, gap: 5 }}>
              <Text
                style={styles.trendingHeadline}
                numberOfLines={2}
              >
                {item.title}
              </Text>
              <View style={styles.trendingMeta}>
                <View
                  style={[
                    styles.trendingCatBadge,
                    {
                      backgroundColor: catColor(item.category) + "22",
                      borderColor: catColor(item.category),
                    },
                  ]}
                >
                  <Text
                    style={[styles.trendingCatText, { color: catColor(item.category) }]}
                  >
                    {item.category}
                  </Text>
                </View>
                <Text style={styles.trendingSource}>
                  {item.source} • {item.time}
                </Text>
                {item.impact === "HIGH" ? (
                  <View
                    style={[
                      styles.trendingHotBadge,
                      { backgroundColor: "#EF444422", borderColor: "#EF4444" },
                    ]}
                  >
                    <Feather name="trending-up" size={8} color="#EF4444" />
                    <Text style={[styles.trendingHotText, { color: "#EF4444" }]}>
                      HOT
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
          {idx < items.length - 1 ? (
            <View
              style={[
                styles.trendingItemDivider,
                { backgroundColor: GOLD_BORDER },
              ]}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

function TrendingColumnSkeleton() {
  return (
    <View
      style={[
        styles.trendingCol,
        { backgroundColor: GOLD_DIM, borderColor: GOLD },
      ]}
    >
      <View style={styles.trendingColHeader}>
        <View style={styles.trendingColHeaderLeft}>
          <Feather name="zap" size={14} color={GOLD} />
          <Text style={[styles.trendingColTitle, { color: GOLD }]}>
            TRENDING SEKARANG
          </Text>
        </View>
      </View>
      <View style={[styles.trendingDivider, { backgroundColor: GOLD_BORDER }]} />
      {[1, 2, 3].map((i) => (
        <View key={i} style={[styles.trendingRow, { opacity: 0.4 }]}>
          <Text style={[styles.trendingNum, { color: GOLD_LIGHT }]}>
            {String(i).padStart(2, "0")}
          </Text>
          <View
            style={{
              flex: 1,
              height: 14,
              backgroundColor: GOLD_BORDER,
              borderRadius: 4,
            }}
          />
        </View>
      ))}
    </View>
  );
}

function SectionTitle({
  icon,
  text,
  color,
}: {
  icon: any;
  text: string;
  color: string;
}) {
  return (
    <View style={styles.sectionTitle}>
      <Feather name={icon} size={13} color={color} />
      <Text style={[styles.sectionText, { color }]}>{text}</Text>
    </View>
  );
}

function InfluencerCard({
  item,
  colors,
  catColor,
  sentColor,
}: {
  item: NewsFeedItem;
  colors: any;
  catColor: (c: NewsFeedItem["category"]) => string;
  sentColor: (s: NewsFeedItem["sentiment"]) => string;
}) {
  const t = useT();
  const meta = influencerMeta(item.influencer, colors);
  const accent = meta.color;
  const letter = meta.letter;

  return (
    <Pressable
      onPress={() => openNewsUrl(item.url, item.sourceType)}
      style={({ pressed }) => [
        styles.influencerCard,
        {
          backgroundColor: pressed ? colors.muted : accent + "12",
          borderColor: accent,
        },
      ]}
    >
      <View style={styles.influencerHead}>
        <View
          style={[
            styles.faceAvatar,
            {
              backgroundColor: accent,
              borderColor: meta.borderInner,
            },
          ]}
        >
          <Text style={styles.faceLetter}>{letter}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.influencerName, { color: colors.foreground }]}>
            {item.author ?? item.source}
          </Text>
          <Text style={[styles.source, { color: colors.mutedForeground }]}>
            {meta.name} • {item.time}
          </Text>
        </View>
        <View
          style={[
            styles.impactBadge,
            { backgroundColor: accent, borderColor: accent },
          ]}
        >
          <Text style={styles.impactText}>{item.impact}</Text>
        </View>
      </View>

      <Text style={[styles.title, { color: colors.foreground }]}>
        {item.title}
      </Text>
      <Text style={[styles.summary, { color: colors.mutedForeground }]}>
        {item.summary}
      </Text>

      <View style={styles.footer}>
        <View
          style={[
            styles.catBadge,
            {
              backgroundColor: catColor(item.category) + "22",
              borderColor: catColor(item.category),
            },
          ]}
        >
          <Text
            style={[styles.catText, { color: catColor(item.category) }]}
          >
            {item.category}
          </Text>
        </View>
        <View
          style={[
            styles.sentBadge,
            {
              backgroundColor: sentColor(item.sentiment) + "1A",
              borderColor: sentColor(item.sentiment),
            },
          ]}
        >
          <Text
            style={[styles.sentText, { color: sentColor(item.sentiment) }]}
          >
            {item.sentiment}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Feather name="external-link" size={12} color={accent} />
        <Text style={[styles.readMore, { color: accent }]}>
          {item.sourceType === "X" ? t("news.openTweet") : t("news.openArticle")}
        </Text>
      </View>
    </Pressable>
  );
}

function XBuzzCard({
  item,
  colors,
  catColor,
  sentColor,
}: {
  item: NewsFeedItem;
  colors: any;
  catColor: (c: NewsFeedItem["category"]) => string;
  sentColor: (s: NewsFeedItem["sentiment"]) => string;
}) {
  const t = useT();
  const handleInitial = (item.author ?? "@")
    .replace("@", "")
    .charAt(0)
    .toUpperCase();

  return (
    <Pressable
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.cyan + "55",
          borderWidth: 1,
        },
      ]}
    >
      <View style={styles.cardHead}>
        <View
          style={[
            styles.xAvatar,
            { backgroundColor: colors.cyan + "22", borderColor: colors.cyan },
          ]}
        >
          <Text style={[styles.xAvatarText, { color: colors.cyan }]}>
            {handleInitial}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.xAuthor, { color: colors.foreground }]}>
            {item.source}
          </Text>
          <Text style={[styles.xHandle, { color: colors.mutedForeground }]}>
            {item.author} • {item.time}
          </Text>
        </View>
        <View
          style={[
            styles.aiBadge,
            { backgroundColor: colors.cyan + "22", borderColor: colors.cyan },
          ]}
        >
          <Feather name="cpu" size={8} color={colors.cyan} />
          <Text style={[styles.aiBadgeText, { color: colors.cyan }]}>AI</Text>
        </View>
      </View>

      <Text style={[styles.xTweet, { color: colors.foreground }]}>
        {item.title}
      </Text>
      <Text style={[styles.summary, { color: colors.mutedForeground }]}>
        {item.summary}
      </Text>

      <View style={styles.footer}>
        <View
          style={[
            styles.catBadge,
            {
              backgroundColor: catColor(item.category) + "22",
              borderColor: catColor(item.category),
            },
          ]}
        >
          <Text style={[styles.catText, { color: catColor(item.category) }]}>
            {item.category}
          </Text>
        </View>
        <View
          style={[
            styles.sentBadge,
            {
              backgroundColor: sentColor(item.sentiment) + "1A",
              borderColor: sentColor(item.sentiment),
            },
          ]}
        >
          <Text style={[styles.sentText, { color: sentColor(item.sentiment) }]}>
            {item.sentiment}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={[styles.readMore, { color: colors.mutedForeground }]}>
          {t("news.aiBuzzSimulated")}
        </Text>
      </View>
    </Pressable>
  );
}

function NewsCard({
  item,
  colors,
  catColor,
  sentColor,
}: {
  item: NewsFeedItem;
  colors: any;
  catColor: (c: NewsFeedItem["category"]) => string;
  sentColor: (s: NewsFeedItem["sentiment"]) => string;
}) {
  const t = useT();
  const isX = item.sourceType === "X";
  return (
    <Pressable
      onPress={() => openNewsUrl(item.url, item.sourceType)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? colors.muted : colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.cardHead}>
        <View
          style={[
            styles.typeBadge,
            {
              backgroundColor: isX ? colors.cyan + "22" : colors.muted,
              borderColor: isX ? colors.cyan : colors.border,
            },
          ]}
        >
          <Feather
            name={isX ? "message-circle" : "rss"}
            size={10}
            color={isX ? colors.cyan : colors.mutedForeground}
          />
          <Text
            style={[
              styles.typeText,
              { color: isX ? colors.cyan : colors.mutedForeground },
            ]}
          >
            {isX ? t("news.xPost") : t("news.newsTag")}
          </Text>
        </View>
        <Text style={[styles.source, { color: colors.mutedForeground }]}>
          {item.source} • {item.time}
        </Text>
      </View>

      <Text style={[styles.title, { color: colors.foreground }]}>
        {item.title}
      </Text>
      <Text style={[styles.summary, { color: colors.mutedForeground }]}>
        {item.summary}
      </Text>

      <View style={styles.footer}>
        <View
          style={[
            styles.catBadge,
            {
              backgroundColor: catColor(item.category) + "22",
              borderColor: catColor(item.category),
            },
          ]}
        >
          <Text
            style={[styles.catText, { color: catColor(item.category) }]}
          >
            {item.category}
          </Text>
        </View>
        <View
          style={[
            styles.sentBadge,
            {
              backgroundColor: sentColor(item.sentiment) + "1A",
              borderColor: sentColor(item.sentiment),
            },
          ]}
        >
          <Text
            style={[styles.sentText, { color: sentColor(item.sentiment) }]}
          >
            {item.sentiment}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={[styles.readMore, { color: colors.primary }]}>
          {t("news.read")}
        </Text>
      </View>
    </Pressable>
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
  bannerTitle: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  bannerSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  loaderBox: {
    padding: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  loaderText: {
    fontSize: 11,
    textAlign: "center",
    fontFamily: "Inter_500Medium",
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
  errorText: { fontSize: 12, flex: 1, fontFamily: "Inter_500Medium" },
  sectionTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  sectionText: { fontSize: 11, letterSpacing: 1.4, fontFamily: "Inter_700Bold" },
  aiBuzzBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  aiBuzzText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    flex: 1,
    lineHeight: 14,
  },
  influencerCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  influencerHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  faceAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  faceLetter: {
    color: "#fff",
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  influencerName: { fontSize: 13, fontFamily: "Inter_700Bold" },
  impactBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  impactText: {
    color: "#fff",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
  },
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  xAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  xAvatarText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  xAuthor: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    lineHeight: 16,
  },
  xHandle: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    lineHeight: 14,
  },
  xTweet: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    lineHeight: 20,
    marginBottom: 5,
  },
  aiBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
  },
  aiBadgeText: {
    fontSize: 8,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  catBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  catText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  sentBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sentText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  source: { fontSize: 10, fontFamily: "Inter_500Medium", flex: 1 },
  title: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    lineHeight: 20,
    marginBottom: 6,
  },
  summary: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    marginBottom: 8,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  readMore: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
  },
  trendingCol: {
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 16,
    overflow: "hidden",
  },
  trendingColHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  trendingColHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  trendingColTitle: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.5,
  },
  trendingLiveDot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  trendingLiveInner: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  trendingLiveText: {
    fontSize: 8,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
  },
  trendingDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 0,
  },
  trendingItemDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 14,
  },
  trendingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  trendingNum: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    lineHeight: 22,
    letterSpacing: -0.5,
    minWidth: 26,
  },
  trendingHeadline: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    lineHeight: 18,
  },
  trendingMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  trendingCatBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  trendingCatText: {
    fontSize: 8,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
  },
  trendingSource: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "#F59E0B99",
    flex: 1,
  },
  trendingHotBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  trendingHotText: {
    fontSize: 8,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  infTopicsCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 14,
    overflow: "hidden",
  },
  infTopicsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  infTopicsTitle: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
    flex: 1,
  },
  infTopicsBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  infTopicRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ffffff10",
  },
  infTopicNum: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    minWidth: 22,
    lineHeight: 20,
    letterSpacing: -0.5,
  },
  infTopicLabel: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    lineHeight: 18,
  },
  infTopicSentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  infTopicCatBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  infTopicWho: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
    flexShrink: 1,
  },
  infTopicCount: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
});
