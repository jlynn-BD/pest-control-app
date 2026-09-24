import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { colors } from "./ui";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

// Web only: helps staff put the app on their phone's home screen. Chrome and
// Android offer a real install prompt; iPhone Safari has none, so it gets
// the two-tap instructions instead. Hidden once the app is already installed.
export function InstallHint() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (Platform.OS !== "web") return null;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return null;

  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (installEvent) {
    return (
      <View style={styles.box}>
        <Text style={styles.link} onPress={() => installEvent.prompt()}>
          Install PestApp on this phone
        </Text>
      </View>
    );
  }
  if (isIos) {
    return (
      <View style={styles.box}>
        <Text style={styles.text}>To install: tap the Share button in Safari, then "Add to Home Screen".</Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  box: { marginTop: 24, alignItems: "center" },
  text: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
  link: { color: colors.primary, fontWeight: "700", fontSize: 14 },
});
