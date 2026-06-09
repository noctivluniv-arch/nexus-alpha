import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useLang } from "@/lib/i18n";

interface HeaderProps {
  onRefresh?: () => void;
  refreshing?: boolean;
  // Kept for backward compatibility with existing screens; the header now
  // displays a unified brand tagline ("AI Crypto Signal" + "by Davesavio")
  // under the NEXUS ALPHA wordmark instead of a per-screen label.
  subtitle?: string;
}

export function Header({ onRefresh, refreshing }: HeaderProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { lang, setLang } = useLang();

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 8,
          backgroundColor: colors.background,
          borderBottomColor: "rgba(255,255,255,0.05)",
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.primary }]}>NEXUS</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>
            ALPHA
          </Text>
        </View>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          AI CRYPTO SIGNAL
        </Text>
        <Text style={[styles.byline, { color: colors.mutedForeground }]}>
          by Davesavio
        </Text>
      </View>

      <View style={styles.actions}>
        <View
          style={[
            styles.langToggle,
            { borderColor: "rgba(255,255,255,0.08)" },
          ]}
        >
          <Pressable
            onPress={() => setLang("id")}
            style={[
              styles.langBtn,
              lang === "id" && {
                backgroundColor: colors.primary,
              },
            ]}
          >
            <Text
              style={[
                styles.langText,
                {
                  color:
                    lang === "id" ? "#000" : colors.mutedForeground,
                },
              ]}
            >
              ID
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setLang("en")}
            style={[
              styles.langBtn,
              lang === "en" && {
                backgroundColor: colors.primary,
              },
            ]}
          >
            <Text
              style={[
                styles.langText,
                {
                  color:
                    lang === "en" ? "#000" : colors.mutedForeground,
                },
              ]}
            >
              EN
            </Text>
          </Pressable>
        </View>

        {onRefresh ? (
          <Pressable
            onPress={onRefresh}
            style={({ pressed }) => [
              styles.refresh,
              {
                borderColor: "rgba(255,255,255,0.05)",
                backgroundColor: pressed
                  ? "rgba(255,255,255,0.05)"
                  : "transparent",
              },
            ]}
          >
            <Feather
              name="refresh-cw"
              size={18}
              color={refreshing ? colors.primary : colors.mutedForeground}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    fontStyle: "italic",
    letterSpacing: -0.5,
    fontFamily: "Helvetica Neue",
  },
  subtitle: {
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 2,
    marginTop: 2,
    fontFamily: "Helvetica Neue",
  },
  byline: {
    fontSize: 9,
    fontWeight: "500",
    letterSpacing: 0.5,
    marginTop: 1,
    opacity: 0.7,
    fontFamily: "Helvetica Neue",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  langToggle: {
    flexDirection: "row",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    padding: 2,
  },
  langBtn: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  langText: {
    fontSize: 10,
    fontFamily: "Helvetica Neue",
    letterSpacing: 0.6,
  },
  refresh: {
    padding: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
