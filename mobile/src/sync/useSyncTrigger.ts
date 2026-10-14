import NetInfo from "@react-native-community/netinfo";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "../context/AuthContext";
import { listDirtySiteMapSketchIds } from "../db/cache";
import { getPendingSyncCount, runSync } from "./syncEngine";

// Also pushes unsent work every ~20 seconds. Before that, finishing an
// inspection with a good connection left it "not yet synced" (and its report
// impossible to generate) until the app was closed and reopened. The repeat
// backs off (up to 5 minutes) while attempts make no progress, so a stuck item
// does not hammer the server.
//
// Fires a background sync on reconnect, on app foreground, and once right
// after login/app start - on top of the manual "Sync now" button in
// Settings. Failures are silent here (runSync reports its own error in the
// result it returns to callers that care, e.g. the Sync Status screen);
// this hook is just the "when," not the "what to show."
export function useSyncTrigger() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    let wasConnected: boolean | null = null;
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      const isConnected = !!state.isConnected;
      if (isConnected && wasConnected === false) {
        runSync();
      }
      wasConnected = isConnected;
    });

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") runSync();
    });

    runSync();

    const BASE_DELAY = 20000;
    let delay = BASE_DELAY;
    let nextAllowed = 0;
    const timer = setInterval(() => {
      if (AppState.currentState !== "active" || Date.now() < nextAllowed) return;
      let waiting = false;
      try {
        waiting = getPendingSyncCount() > 0 || listDirtySiteMapSketchIds().length > 0;
      } catch {
        return; // local storage not ready yet
      }
      if (!waiting) {
        delay = BASE_DELAY;
        return;
      }
      runSync().then((res) => {
        const progressed = !res.error && res.pushed + res.uploaded > 0;
        delay = progressed ? BASE_DELAY : Math.min(delay * 2, 300000);
        nextAllowed = Date.now() + delay;
      });
    }, BASE_DELAY);

    return () => {
      clearInterval(timer);
      unsubscribeNet();
      appStateSub.remove();
    };
  }, [user]);
}
