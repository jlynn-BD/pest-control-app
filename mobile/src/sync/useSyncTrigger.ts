import NetInfo from "@react-native-community/netinfo";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "../context/AuthContext";
import { runSync } from "./syncEngine";

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

    return () => {
      unsubscribeNet();
      appStateSub.remove();
    };
  }, [user]);
}
