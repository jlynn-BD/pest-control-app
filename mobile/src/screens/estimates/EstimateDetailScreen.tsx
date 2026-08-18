import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { getEstimate, updateEstimate } from "../../api/estimates";
import { downloadAndShareEstimate } from "../../lib/report";
import { Badge, Card, ErrorView, LoadingView, PrimaryButton, colors } from "../../components/ui";

// Registered in both the Customers stack and the Inspections stack (an
// estimate can be opened from a customer's estimate list or from the
// inspection it was drafted from), so this takes a minimal nav surface
// instead of one stack's generated param-list types.
interface Props {
  route: { params: { estimateId: string } };
  navigation: { navigate: (screen: string, params?: Record<string, unknown>) => void };
}

const STATUS_TONE: Record<string, "default" | "warning" | "success" | "danger"> = {
  DRAFT: "default",
  SENT: "warning",
  APPROVED: "success",
  DECLINED: "danger",
  EXPIRED: "danger",
};

export default function EstimateDetailScreen({ route, navigation }: Props) {
  const { estimateId } = route.params;
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const { data: estimate, isLoading, isError } = useQuery({
    queryKey: ["estimates", estimateId],
    queryFn: () => getEstimate(estimateId),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateEstimate(estimateId, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["estimates", estimateId] }),
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to update estimate"),
  });

  async function handleShare() {
    setSharing(true);
    try {
      await downloadAndShareEstimate(estimateId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to share estimate");
    } finally {
      setSharing(false);
    }
  }

  if (isLoading) return <LoadingView />;
  if (isError || !estimate) return <ErrorView message="Failed to load estimate" />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{estimate.customer.name}</Text>
        <Badge label={estimate.status} tone={STATUS_TONE[estimate.status] ?? "default"} />
      </View>
      <Text style={styles.meta}>{estimate.property.addressLine1}</Text>
      {estimate.validUntil ? (
        <Text style={styles.meta}>Valid until {new Date(estimate.validUntil).toLocaleDateString()}</Text>
      ) : null}

      <Text style={styles.sectionTitle}>Line items</Text>
      {estimate.lineItems.map((item) => (
        <Card key={item.id} style={styles.card}>
          <View style={styles.rowTop}>
            <Text style={styles.itemDescription}>{item.description}</Text>
            <Text style={styles.itemAmount}>${item.amount.toFixed(2)}</Text>
          </View>
          <Text style={styles.meta}>
            {item.quantity} × ${item.unitPrice.toFixed(2)}
          </Text>
        </Card>
      ))}

      <Card style={styles.totalsCard}>
        <View style={styles.totalsRow}>
          <Text style={styles.meta}>Subtotal</Text>
          <Text style={styles.body}>${estimate.subtotal.toFixed(2)}</Text>
        </View>
        <View style={styles.totalsRow}>
          <Text style={styles.meta}>Tax ({(estimate.taxRate * 100).toFixed(2)}%)</Text>
          <Text style={styles.body}>${estimate.taxAmount.toFixed(2)}</Text>
        </View>
        <View style={styles.totalsRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>${estimate.total.toFixed(2)}</Text>
        </View>
      </Card>

      {estimate.notes ? (
        <>
          <Text style={styles.sectionTitle}>Notes</Text>
          <Text style={styles.body}>{estimate.notes}</Text>
        </>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.spacer} />
      {estimate.status === "DRAFT" ? (
        <PrimaryButton title="Edit estimate" onPress={() => navigation.navigate("EstimateForm", { estimateId })} />
      ) : null}
      <View style={styles.spacerSmall} />
      <PrimaryButton title="Share PDF" onPress={handleShare} loading={sharing} />
      <View style={styles.spacerSmall} />
      <View style={styles.buttonRow}>
        {estimate.status === "DRAFT" ? (
          <View style={styles.buttonHalf}>
            <PrimaryButton title="Mark sent" onPress={() => statusMutation.mutate("SENT")} loading={statusMutation.isPending} />
          </View>
        ) : null}
        {estimate.status === "SENT" ? (
          <>
            <View style={styles.buttonHalf}>
              <PrimaryButton
                title="Mark approved"
                onPress={() => statusMutation.mutate("APPROVED")}
                loading={statusMutation.isPending}
              />
            </View>
            <View style={styles.buttonHalf}>
              <PrimaryButton
                title="Mark declined"
                onPress={() => statusMutation.mutate("DECLINED")}
                loading={statusMutation.isPending}
              />
            </View>
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 4 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  body: { fontSize: 14, color: colors.text },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 18, marginBottom: 8 },
  card: { marginBottom: 8, gap: 2 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  itemDescription: { fontSize: 14, fontWeight: "600", color: colors.text, flex: 1, paddingRight: 8 },
  itemAmount: { fontSize: 14, fontWeight: "600", color: colors.text },
  totalsCard: { marginTop: 8, gap: 4 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalLabel: { fontSize: 15, fontWeight: "700", color: colors.text },
  totalValue: { fontSize: 15, fontWeight: "700", color: colors.text },
  errorText: { color: colors.danger, textAlign: "center", marginTop: 12 },
  spacer: { height: 20 },
  spacerSmall: { height: 10 },
  buttonRow: { flexDirection: "row", gap: 10 },
  buttonHalf: { flex: 1 },
});
