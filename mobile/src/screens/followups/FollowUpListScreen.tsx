import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { listUpcomingFollowUps } from "../../api/followups";
import { FollowUpsStackParamList } from "../../navigation/navigationTypes";
import { Badge, Card, EmptyState, ErrorView, LoadingView, colors } from "../../components/ui";

type Props = NativeStackScreenProps<FollowUpsStackParamList, "FollowUpList">;

export default function FollowUpListScreen({ navigation }: Props) {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["followups", "upcoming"],
    queryFn: listUpcomingFollowUps,
  });

  return (
    <View style={styles.container}>
      {isLoading ? (
        <LoadingView />
      ) : isError ? (
        <ErrorView message="Failed to load follow-ups" />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No upcoming follow-ups" />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable onPress={() => navigation.navigate("FollowUpDetail", { followUpId: item.id })}>
              <Card style={styles.card}>
                <View style={styles.rowTop}>
                  <Text style={styles.customer}>{item.inspection.customer.name}</Text>
                  <Badge label={item.correctiveActionStatus.replace(/_/g, " ")} />
                </View>
                <Text style={styles.meta}>{item.inspection.property.addressLine1}</Text>
                {item.reason ? <Text style={styles.body}>{item.reason}</Text> : null}
                {item.scheduledDate ? (
                  <Text style={styles.meta}>Due {new Date(item.scheduledDate).toLocaleDateString()}</Text>
                ) : null}
              </Card>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16, paddingTop: 12 },
  list: { gap: 10, paddingBottom: 24 },
  card: { gap: 4 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  customer: { fontSize: 16, fontWeight: "600", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  body: { fontSize: 14, color: colors.text },
});
