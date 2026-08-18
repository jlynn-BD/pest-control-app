import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { addLocalTreatment } from "../../db/inspectionStore";
import { useAuth } from "../../context/AuthContext";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { Card, Field, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "TreatmentForm">;

interface ProductDraft {
  key: string;
  productName: string;
  quantity: string;
  unit: string;
  applicationMethod: string;
}

function emptyProduct(): ProductDraft {
  return { key: Math.random().toString(36).slice(2), productName: "", quantity: "", unit: "", applicationMethod: "" };
}

export default function TreatmentFormScreen({ route, navigation }: Props) {
  const { inspectionId } = route.params;
  const { user } = useAuth();
  const [method, setMethod] = useState("");
  const [targetPest, setTargetPest] = useState("");
  const [areaTreated, setAreaTreated] = useState("");
  const [safetyInstructions, setSafetyInstructions] = useState("");
  const [notes, setNotes] = useState("");
  const [products, setProducts] = useState<ProductDraft[]>([emptyProduct()]);
  const [error, setError] = useState<string | null>(null);

  function updateProduct(key: string, patch: Partial<ProductDraft>) {
    setProducts((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function removeProduct(key: string) {
    setProducts((prev) => prev.filter((p) => p.key !== key));
  }

  function handleSave() {
    if (!method.trim()) {
      setError("Method is required");
      return;
    }
    if (!user) return;
    const validProducts = products.filter((p) => p.productName.trim());
    addLocalTreatment(inspectionId, {
      findingId: null,
      technicianId: user.id,
      method: method.trim(),
      targetPest: targetPest.trim() || null,
      areaTreated: areaTreated.trim() || null,
      appliedAt: new Date().toISOString(),
      safetyInstructions: safetyInstructions.trim() || null,
      notes: notes.trim() || null,
      products: validProducts.map((p) => ({
        productName: p.productName.trim(),
        epaRegistrationNumber: null,
        activeIngredient: null,
        quantity: Number(p.quantity) || 0,
        unit: p.unit.trim() || "unit",
        concentration: null,
        applicationMethod: p.applicationMethod.trim() || null,
      })),
    });
    navigation.goBack();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Field label="Method" value={method} onChangeText={setMethod} placeholder="e.g. Gel bait application" />
      <Field label="Target pest" value={targetPest} onChangeText={setTargetPest} />
      <Field label="Area treated" value={areaTreated} onChangeText={setAreaTreated} />
      <Field label="Safety instructions" value={safetyInstructions} onChangeText={setSafetyInstructions} multiline numberOfLines={2} />
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline numberOfLines={2} />

      <Text style={styles.sectionTitle}>Products used</Text>
      {products.map((product) => (
        <Card key={product.key} style={styles.productCard}>
          <Field label="Product name" value={product.productName} onChangeText={(v) => updateProduct(product.key, { productName: v })} />
          <View style={styles.productRow}>
            <View style={styles.flex1}>
              <Field label="Quantity" value={product.quantity} onChangeText={(v) => updateProduct(product.key, { quantity: v })} keyboardType="decimal-pad" />
            </View>
            <View style={styles.flex1}>
              <Field label="Unit" value={product.unit} onChangeText={(v) => updateProduct(product.key, { unit: v })} placeholder="g, oz, mL" />
            </View>
          </View>
          <Field
            label="Application method"
            value={product.applicationMethod}
            onChangeText={(v) => updateProduct(product.key, { applicationMethod: v })}
          />
          {products.length > 1 ? (
            <Text style={styles.removeLink} onPress={() => removeProduct(product.key)}>
              Remove product
            </Text>
          ) : null}
        </Card>
      ))}
      <Pressable onPress={() => setProducts((prev) => [...prev, emptyProduct()])}>
        <Text style={styles.addLink}>+ Add another product</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.spacer} />
      <PrimaryButton title="Save treatment" onPress={handleSave} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 8, marginBottom: 10 },
  productCard: { marginBottom: 12 },
  productRow: { flexDirection: "row", gap: 12 },
  flex1: { flex: 1 },
  removeLink: { color: colors.danger, fontWeight: "600", fontSize: 13 },
  addLink: { color: colors.primary, fontWeight: "600", marginBottom: 16 },
  error: { color: colors.danger, marginBottom: 12, textAlign: "center" },
  spacer: { height: 8 },
});
