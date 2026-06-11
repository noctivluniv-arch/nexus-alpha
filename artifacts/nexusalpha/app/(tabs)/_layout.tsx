import { Tabs } from "expo-router";
import React from "react";
import { Platform, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";

function TabIcon({ symbol, color }: { symbol: string; color: string }) {
  return (
    <Text style={{ fontSize: 18, color, fontFamily: "System" }}>{symbol}</Text>
  );
}

export default function TabLayout() {
  const colors = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();

  const tabBarHeight = Platform.OS === "ios" ? 50 : 56;
  const bottomPadding = Platform.OS === "ios" ? 0 : insets.bottom;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.sidebar,
          borderTopColor: "rgba(255,255,255,0.05)",
          borderTopWidth: 0.5,
          height: tabBarHeight + bottomPadding,
          paddingBottom: bottomPadding,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontFamily: "Helvetica Neue",
          letterSpacing: 0.5,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.market"),
          tabBarIcon: ({ color }) => <TabIcon symbol="📊" color={color} />,
        }}
      />
      <Tabs.Screen
        name="signals"
        options={{
          title: t("tabs.signals"),
          tabBarIcon: ({ color }) => <TabIcon symbol="⚡" color={color} />,
        }}
      />
      <Tabs.Screen
        name="nexus"
        options={{
          title: t("tabs.nexus"),
          tabBarIcon: ({ color }) => <TabIcon symbol="⚓" color={color} />,
        }}
      />
      <Tabs.Screen
        name="memes"
        options={{
          title: t("tabs.memes"),
          tabBarIcon: ({ color }) => <TabIcon symbol="🚀" color={color} />,
        }}
      />
      <Tabs.Screen
        name="altcoins"
        options={{
          title: t("tabs.altcoins"),
          tabBarIcon: ({ color }) => <TabIcon symbol="💎" color={color} />,
        }}
      />
      <Tabs.Screen
        name="news"
        options={{
          title: t("tabs.news"),
          tabBarIcon: ({ color }) => <TabIcon symbol="🌐" color={color} />,
        }}
      />
    </Tabs>
  );
}
