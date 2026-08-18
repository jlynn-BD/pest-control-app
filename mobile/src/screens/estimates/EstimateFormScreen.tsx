import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getEstimate, LineItemInput, updateEstimate } from "../../api/estimates";
import { ApiError } from "../../api/client";
import { Card, Field, PrimaryButton, colors } from "../../components/ui";

// Registered in both the Customers stack and the Inspections stack - see
// the note in EstimateDetailScreen for why this uses a minimal nav surface
// instead of one stack's generated param-list types.
interface Props {
  route: { params: { estimateId: string } };
  navigation: { replace: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
}

interface DraftLineItem extends LineItemInput {
  key: string;
}

let keyCounter = 0;
function nextKey() {
  keyCounter += 1;
  return `line-${keyCounter}`;
}

export default function EstimateFormScreen({ route, navigation }: Props) {
  const { estimateId } = route.params;
  const queryClient = useQueryClient();
  const [lineItems, setLineItems] = useState<DraftLineItem[]>([]);
  const [taxRate, setTaxRate] = useState("0");
  const [notes, setNotes] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: estimate } = useQuery({ queryKey: ["estimates", estimateId], queryFn: () => getEstimate(estimateId) });

  useEffect(() => {
    if (!estimate || loaded) return;
    setLineItems(
      estimate.lineItems.map((li) => ({ key: nextKey(), description: li.description, quantity: li.quantity, unitPrice: li.unitPrice }))
    );
    setTaxRate(String(estimate.taxRate));
    setNotes(estimate.notes ?? "");
    setValidUntil(estimate.validUntil ? estimate.validUntil.slice(0, 10) : "");
    setLoaded(true);
  }, [estimate, loaded]);

  const subtotal = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
  const taxRateNum = Number(taxRate) || 0;
  const total = subtotal + subtotal * taxRateNum;

  const saveMutation = useMutation({
    mutationFn: () => {
      const cleanItems = lineItems
        .filter((li) => li.description.trim().length > 0)
        .map((li) => ({ description: li.description.trim(), quantity: li.quantity || 1, unitPrice: li.unitPrice || 0 }));
      if (cleanItems.length === 0) throw new Error("Add at least one line item");
      const iso = validUntil.trim() ? new Date(`${validUntil.trim()}T00:00:00.000Z`).toISOString() : null;
      if (validUntil.trim() && Number.isNaN(new Date(iso!).getTime())) throw new Error("Valid-until date must be YYYY-MM-DD");
      return updateEstimate(estimateId, { lineItems: cleanItems, taxRate: taxRateNum, notes: notes.trim() || null, validUntil: iso });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["estimates", estimateId] });
      queryClient.invalidateQueries({ queryKey: ["estimates", "customer"] });
      navigation.replace("EstimateDetail", { estimateId });
    },
    onError: (err) => setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to save estimate"),
  });

  function updateItem(key: string, patch: Partial<DraftLineItem>) {
    setLineItems((prev) => prev.map((li) => (li.key === key ? { ...li, ...patch } : li)));
  }
  function removeItem(key: string) {
    setLineItems((prev) => prev.filter((li) => li.key !== key));
  }
  function addItem() {
    setLineItems((prev) => [...prev, { key: nextKey(), description: "", quantity: 1, unitPrice: 0 }]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Line items</Text>
      {lineItems.map((item) => (
        <Card key={item.key} style={styles.itemCard}>
          <Field
            label="Description"
            value={item.description}
            onChangeText={(v) => updateItem(item.key, { description: v })}
            placeholder="e.g. Quarterly follow-up treatment"
          />
          <View style={styles.row}>
            <View style={styles.rowHalf}>
              <Field
                label="Quantity"
                keyboardType="numeric"
                value={String(item.quantity)}
                onChangeText={(v) => updateItem(item.key, { quantity: Number(v) || 0 })}
              />
            </View>
            <View style={styles.rowHalf}>
              <Field
                label="Unit price ($)"
                keyboardType="numeric"
                value={String(item.unitPrice)}
                onChangeText={(v) => updateItem(item.key, { unitPrice: Number(v) || 0 })}
              />
            </View>
          </View>
          <Pressable onPress={() => removeItem(item.key)}>
            <Text style={styles.removeLink}>Remove</Text>
          </Pressable>
        </Card>
      ))}
      <Pressable onPress={addItem}>
        <Text style={styles.addLink}>+ Add line item</Text>
      </Pressable>

      <Field label="Tax rate (0.08 = 8%)" keyboardType="numeric" value={taxRate} onChangeText={setTaxRate} />
      <Field label="Valid until (YYYY-MM-DD, optional)" value={validUntil} onChangeText={setValidUntil} placeholder="2026-09-30" />
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline numberOfLines={3} />

      <Card style={styles.totalsCard}>
        <View style={styles.totalsRow}>
          <Text style={styles.meta}>Subtotal</Text>
          <Text style={styles.body}>${subtotal.toFixed(2)}</Text>
        </View>
        <View style={styles.totalsRow}>
          <Text style={styles.totalLabel}>Total (est.)</Text>
          <Text style={styles.totalValue}>${total.toFixed(2)}</Text>
        </View>
      </Card>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <PrimaryButton title="Save estimate" onPress={() => saveMutation.mutate()} loading={saveMutation.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: 8 },
  itemCard: { marginBottom: 10, gap: 4 },
  row: { flexDirection: "row", gap: 10 },
  rowHalf: { flex: 1 },
  removeLink: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  addLink: { color: colors.primary, fontWeight: "600", fontSize: 14, marginBottom: 16 },
  meta: { fontSize: 13, color: colors.textMuted },
  body: { fontSize: 14, color: colors.text },
  totalsCard: { marginTop: 4, marginBottom: 16, gap: 4 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalLabel: { fontSize: 15, fontWeight: "700", color: colors.text },
  totalValue: { fontSize: 15, fontWeight: "700", color: colors.text },
  errorText: { color: colors.danger, textAlign: "center", marginBottom: 12 },
});
