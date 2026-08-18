import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { getCustomer } from "../../api/customers";
import { ApiError } from "../../api/client";
import { createEstimate, listEstimates } from "../../api/estimates";
import { CustomersStackParamList } from "../../navigation/navigationTypes";
import { Badge, Card, EmptyState, ErrorView, LoadingView, colors } from "../../components/ui";

type Props = NativeStackScreenProps<CustomersStackParamList, "EstimateList">;

const STATUS_TONE: Record<string, "default" | "warning" | "success" | "danger"> = {
  DRAFT: "default",
  SENT: "warning",
  APPROVED: "success",
  DECLINED: "danger",
  EXPIRED: "danger",
};

export default function EstimateListScreen({ route, navigation }: Props) {
  const { customerId } = route.params;
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: customer } = useQuery({ queryKey: ["customers", customerId], queryFn: () => getCustomer(customerId) });
  const { data: estimates, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["estimates", "customer", customerId],
    queryFn: () => listEstimates({ customerId }),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const propertyId = customer?.properties[0]?.id;
      if (!propertyId) throw new Error("This customer has no property on file yet");
      return createEstimate({ customerId, propertyId, lineItems: [{ description: "Service", quantity: 1, unitPrice: 0 }] });
    },
    onSuccess: (estimate) => {
      queryClient.invalidateQueries({ queryKey: ["estimates", "customer", customerId] });
      navigation.navigate("EstimateForm", { estimateId: estimate.id });
    },
    onError: (err) => setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to create estimate"),
  });

  return (
    <View style={styles.container}>
      <Pressable onPress={() => createMutation.mutate()} disabled={createMutation.isPending}>
        <Text style={styles.addLink}>+ New estimate</Text>
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {isLoading ? (
        <LoadingView />
      ) : isError ? (
        <ErrorView message="Failed to load estimates" />
      ) : !estimates || estimates.length === 0 ? (
        <EmptyState title="No estimates yet" subtitle="Create one to send pricing to this customer." />
      ) : (
        <FlatList
          data={estimates}
          keyExtractor={(item) => item.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable onPress={() => navigation.navigate("EstimateDetail", { estimateId: item.id })}>
              <Card style={styles.card}>
                <View style={styles.rowTop}>
                  <Text style={styles.title}>${item.total.toFixed(2)}</Text>
                  <Badge label={item.status} tone={STATUS_TONE[item.status] ?? "default"} />
                </View>
                <Text style={styles.meta}>{item.property.addressLine1}</Text>
                <Text style={styles.meta}>{new Date(item.createdAt).toLocaleDateString()}</Text>
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
  addLink: { color: colors.primary, fontWeight: "600", fontSize: 14, marginBottom: 12 },
  errorText: { color: colors.danger, marginBottom: 12 },
  list: { gap: 10, paddingBottom: 24 },
  card: { gap: 4 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
});
