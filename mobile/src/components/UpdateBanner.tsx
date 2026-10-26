import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

// Web only. The app is a single page that stays open for days on a phone, so a
// new version can be live on the server while the person is still looking at
// the old one ("I still can't see it"). This notices that (the page's script
// file name changes with every release) and offers a one-tap reload.
const BUNDLE = /_expo\/static\/js\/web\/[^"'\s]+\.js/;

export function UpdateBanner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const running = document.querySelector('script[src*="/_expo/static/js/web/"]')?.getAttribute("src")?.match(BUNDLE)?.[0];
    if (!running) return;
    let stopped = false;
    async function check() {
      try {
        const html = await (await fetch("/", { cache: "no-store" })).text();
        const latest = html.match(BUNDLE)?.[0];
        if (!stopped && latest && latest !== running) setReady(true);
      } catch {
        /* offline - try again later */
      }
    }
    check();
    const timer = setInterval(check, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!ready) return null;
  return (
    <View style={styles.bar} accessibilityRole="alert">
      <Text style={styles.text}>A new version of PestApp is ready.</Text>
      <Pressable onPress={() => window.location.reload()} style={styles.button} accessibilityRole="button">
        <Text style={styles.buttonText}>Reload</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, backgroundColor: "#1F7A5C", paddingHorizontal: 16, paddingVertical: 10 },
  text: { color: "#fff", fontSize: 14, fontWeight: "600", flex: 1 },
  button: { backgroundColor: "#fff", paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999 },
  buttonText: { color: "#1F7A5C", fontSize: 14, fontWeight: "800" },
});
