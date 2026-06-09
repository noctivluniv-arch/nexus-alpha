import React from "react";
import { Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import Svg, { Polyline, Line, Circle, Path, Rect, Polygon } from "react-native-svg";

const ICONS: Record<string, (color: string, size: number) => React.ReactNode> = {
  "activity": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></Svg>,
  "alert-circle": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Circle cx="12" cy="12" r="10" /><Line x1="12" y1="8" x2="12" y2="12" /><Line x1="12" y1="16" x2="12.01" y2="16" /></Svg>,
  "alert-triangle": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Polygon points="10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><Line x1="12" y1="9" x2="12" y2="13" /><Line x1="12" y1="17" x2="12.01" y2="17" /></Svg>,
  "anchor": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Circle cx="12" cy="5" r="3" /><Line x1="12" y1="22" x2="12" y2="8" /><Path d="M5 12H2a10 10 0 0 0 20 0h-3" /></Svg>,
  "arrow-up-right": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Line x1="7" y1="17" x2="17" y2="7" /><Polyline points="7 7 17 7 17 17" /></Svg>,
  "check": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Polyline points="20 6 9 17 4 12" /></Svg>,
  "clock": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Circle cx="12" cy="12" r="10" /><Polyline points="12 6 12 12 16 14" /></Svg>,
  "cpu": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Rect x="4" y="4" width="16" height="16" rx="2" ry="2" /><Rect x="9" y="9" width="6" height="6" /><Line x1="9" y1="1" x2="9" y2="4" /><Line x1="15" y1="1" x2="15" y2="4" /><Line x1="9" y1="20" x2="9" y2="23" /><Line x1="15" y1="20" x2="15" y2="23" /><Line x1="20" y1="9" x2="23" y2="9" /><Line x1="20" y1="14" x2="23" y2="14" /><Line x1="1" y1="9" x2="4" y2="9" /><Line x1="1" y1="14" x2="4" y2="14" /></Svg>,
  "external-link": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><Polyline points="15 3 21 3 21 9" /><Line x1="10" y1="14" x2="21" y2="3" /></Svg>,
  "filter": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></Svg>,
  "globe": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Circle cx="12" cy="12" r="10" /><Line x1="2" y1="12" x2="22" y2="12" /><Path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></Svg>,
  "layers": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Polygon points="12 2 2 7 12 12 22 7 12 2" /><Polyline points="2 17 12 22 22 17" /><Polyline points="2 12 12 17 22 12" /></Svg>,
  "lock": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><Path d="M7 11V7a5 5 0 0 1 10 0v4" /></Svg>,
  "message-circle": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Svg>,
  "star": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></Svg>,
  "target": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Circle cx="12" cy="12" r="10" /><Circle cx="12" cy="12" r="6" /><Circle cx="12" cy="12" r="2" /></Svg>,
  "trending-up": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><Polyline points="17 6 23 6 23 12" /></Svg>,
  "users": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><Circle cx="9" cy="7" r="4" /><Path d="M23 21v-2a4 4 0 0 0-3-3.87" /><Path d="M16 3.13a4 4 0 0 1 0 7.75" /></Svg>,
  "x": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Line x1="18" y1="6" x2="6" y2="18" /><Line x1="6" y1="6" x2="18" y2="18" /></Svg>,
  "x-circle": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Circle cx="12" cy="12" r="10" /><Line x1="15" y1="9" x2="9" y2="15" /><Line x1="9" y1="9" x2="15" y2="15" /></Svg>,
  "zap": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></Svg>,
  "zap-off": (c, s) => <Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Polyline points="12.41 6.75 13 2 10.57 4.92" /><Polyline points="18.57 12.91 21 10 15.66 10" /><Polyline points="8 8 3 14 12 14 11 22 17.79 14.33" /><Line x1="1" y1="1" x2="23" y2="23" /></Svg>,
};

interface WebIconProps {
  name: string;
  size?: number;
  color?: string;
  style?: any;
}

export function WebIcon({ name, size = 24, color = "#ffffff", style }: WebIconProps) {
  if (Platform.OS !== "web") {
    return <Feather name={name as any} size={size} color={color} style={style} />;
  }
  const icon = ICONS[name];
  if (!icon) return null;
  return <>{icon(color, size)}</>;
}
