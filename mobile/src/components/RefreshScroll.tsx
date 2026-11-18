import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Platform, RefreshControl, ScrollView, ScrollViewProps, StyleSheet, Text, View } from "react-native";
import { colors } from "./ui";

const TRIGGER = 64; // how far (px) the page has to be pulled down before it refreshes

// A ScrollView that refreshes when pulled down from the top.
//  - In the phone app this is the normal pull-to-refresh spinner.
//  - On the web, the browser's own pull-to-refresh is switched off (it would reload
//    the whole page and drop what is on screen), so the pull is handled here:
//    pull the page down from the top, release, and it refreshes the data.
export function RefreshScroll({
  onRefresh,
  children,
  ...props
}: { onRefresh: () => Promise<unknown>; children: React.ReactNode } & ScrollViewProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [pull, setPull] = useState(0);
  const offsetY = useRef(0);
  const startY = useRef<number | null>(null);

  const run = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      /* offline - the screen keeps showing what it has */
    } finally {
      setRefreshing(false);
      setPull(0);
    }
  }, [onRefresh, refreshing]);

  if (Platform.OS !== "web") {
    return (
      <ScrollView {...props} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={run} tintColor={colors.primary} />}>
        {children}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      {...props}
      scrollEventThrottle={16}
      onScroll={(e) => {
        offsetY.current = e.nativeEvent.contentOffset.y;
        props.onScroll?.(e);
      }}
      onTouchStart={(e) => {
        startY.current = offsetY.current <= 0 && !refreshing ? e.nativeEvent.touches[0]?.pageY ?? null : null;
      }}
      onTouchMove={(e) => {
        if (startY.current == null) return;
        const dy = (e.nativeEvent.touches[0]?.pageY ?? startY.current) - startY.current;
        setPull(dy > 0 ? Math.min(dy * 0.5, TRIGGER + 24) : 0);
      }}
      onTouchEnd={() => {
        const shouldRefresh = startY.current != null && pull >= TRIGGER;
        startY.current = null;
        if (shouldRefresh) run();
        else setPull(0);
      }}
      onTouchCancel={() => {
        startY.current = null;
        setPull(0);
      }}
    >
      {refreshing || pull > 0 ? (
        <View style={[styles.indicator, { height: refreshing ? 44 : Math.max(pull, 0) }]}>
          {refreshing ? <ActivityIndicator color={colors.primary} /> : null}
          <Text style={styles.indicatorText}>{refreshing ? "Refreshing…" : pull >= TRIGGER ? "Release to refresh" : "Pull down to refresh"}</Text>
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  indicator: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, overflow: "hidden" },
  indicatorText: { fontSize: 13, color: colors.textMuted, fontWeight: "600" },
});
