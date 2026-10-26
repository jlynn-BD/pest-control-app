import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { colors } from "./src/components/ui";
import { UpdateBanner } from "./src/components/UpdateBanner";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/context/AuthContext";
import RootNavigator from "./src/navigation/RootNavigator";
import { initWebSqlDatabase } from "./src/db/webSqlDatabase";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// Native opens expo-sqlite synchronously on first use (see database.ts), but
// web's sql.js backend needs its WASM module fetched and instantiated first
// - block rendering the app on that instead of letting the first getDb()
// call on web throw while it's still loading.
function useWebSqlReady(): boolean {
  const [ready, setReady] = useState(Platform.OS !== "web");
  useEffect(() => {
    if (Platform.OS !== "web") return;
    initWebSqlDatabase().then(() => setReady(true));
  }, []);
  return ready;
}

export default function App() {
  const webSqlReady = useWebSqlReady();

  if (!webSqlReady) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F3F7FC" }}>
        <Text style={{ color: "#51668A" }}>Loading...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/* On a wide screen (tablet in landscape, desktop) the app is a centred
              column rather than content stretched edge to edge; on a phone or a
              portrait tablet this changes nothing. */}
          <View style={{ flex: 1, backgroundColor: "#E3EAF4" }}>
            <View style={{ flex: 1, width: "100%", maxWidth: 960, alignSelf: "center", backgroundColor: colors.bg, overflow: "hidden" }}>
              <UpdateBanner />
              <RootNavigator />
            </View>
          </View>
          <StatusBar style="auto" />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
