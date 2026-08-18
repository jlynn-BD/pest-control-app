import { useQuery } from "@tanstack/react-query";
import React from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { getTechnicianSchedule } from "../../api/appointments";
import { useAuth } from "../../context/AuthContext";
import { Badge, Card, EmptyState, ErrorView, LoadingView, colors } from "../../components/ui";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ScheduleScreen() {
  const { user } = useAuth();
  const today = todayIso();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["schedule", user?.id, today],
    queryFn: () => getTechnicianSchedule(user!.id, today),
    enabled: !!user,
  });

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>
        Today ·{" "}
        {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
      </Text>
      {isLoading ? (
        <LoadingView />
      ) : isError ? (
        <ErrorView message="Failed to load schedule" />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No appointments today" subtitle="Pull to refresh" />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.rowTop}>
                <Text style={styles.time}>
                  {new Date(item.scheduledStart).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </Text>
                <Badge label={item.type.replace(/_/g, " ")} />
              </View>
              <Text style={styles.customer}>{item.customer.name}</Text>
              <Text style={styles.meta}>
                {item.property.addressLine1}, {item.property.city}
              </Text>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16, paddingTop: 12 },
  heading: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: 12 },
  list: { gap: 10, paddingBottom: 24 },
  card: { gap: 4 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  time: { fontSize: 15, fontWeight: "700", color: colors.primary },
  customer: { fontSize: 16, fontWeight: "600", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
});
