import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { colors } from "./ui";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Web only: helps staff put the app on their home screen. Chrome offers a real
// install prompt; browsers that don't (iPhone Safari, Samsung Internet, Firefox,
// or Chrome after the prompt was already dismissed) get the steps to do it by
// hand. Hidden once the app is already installed.
export function InstallHint() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (Platform.OS !== "web" || installed) return null;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return null;

  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const device = /Mobile|iPhone|Android/.test(ua) ? "this phone" : "this device";

  // The browser lets a saved install prompt be used once: after it has been
  // shown (and maybe dismissed) tapping again does nothing, so fall back to the
  // by-hand steps instead of a button that seems dead.
  async function install() {
    const ev = installEvent;
    setInstallEvent(null);
    if (!ev) {
      setShowSteps(true);
      return;
    }
    try {
      await ev.prompt();
      const choice = await ev.userChoice;
      if (choice?.outcome === "dismissed") setShowSteps(true);
    } catch {
      setShowSteps(true);
    }
  }

  if (installEvent) {
    return (
      <View style={styles.box}>
        <Text style={styles.link} onPress={install}>
          Install PestApp on {device}
        </Text>
      </View>
    );
  }

  const steps = isIos
    ? 'To install: tap the Share button in Safari, then "Add to Home Screen".'
    : isAndroid
      ? 'To install: tap the ⋮ menu in Chrome (top right), then "Install app" or "Add to Home screen".'
      : 'To install: use the install icon at the right end of the address bar, or the browser menu → "Install PestApp" / "Add to Dock".';

  // iPhone Safari never offers a prompt, so its steps are always shown; elsewhere
  // they appear after a prompt that was used up, or as a quiet link.
  if (isIos || showSteps) {
    return (
      <View style={styles.box}>
        <Text style={styles.text}>{steps}</Text>
      </View>
    );
  }
  return (
    <View style={styles.box}>
      <Text style={styles.link} onPress={install}>
        Install PestApp on {device}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 24, alignItems: "center" },
  text: { color: colors.textMuted, fontSize: 13, textAlign: "center", lineHeight: 19 },
  link: { color: colors.primary, fontWeight: "700", fontSize: 14 },
});
