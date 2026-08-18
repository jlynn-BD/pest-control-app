import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { createProperty } from "../../api/properties";
import { ApiError } from "../../api/client";
import { CustomersStackParamList } from "../../navigation/navigationTypes";
import { Field, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<CustomersStackParamList, "PropertyForm">;

const PROPERTY_TYPES = ["RESIDENTIAL_SINGLE", "RESIDENTIAL_MULTI", "COMMERCIAL", "INDUSTRIAL", "OTHER"] as const;

export default function PropertyFormScreen({ route, navigation }: Props) {
  const { customerId } = route.params;
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [propertyType, setPropertyType] = useState<(typeof PROPERTY_TYPES)[number]>("RESIDENTIAL_SINGLE");
  const [accessNotes, setAccessNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: createProperty,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers", customerId] });
      navigation.goBack();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create property"),
  });

  function handleSubmit() {
    if (!addressLine1.trim() || !city.trim() || !state.trim() || !postalCode.trim()) {
      setError("Address, city, state, and postal code are required");
      return;
    }
    setError(null);
    mutation.mutate({
      customerId,
      label: label.trim() || undefined,
      addressLine1: addressLine1.trim(),
      city: city.trim(),
      state: state.trim(),
      postalCode: postalCode.trim(),
      propertyType,
      accessNotes: accessNotes.trim() || undefined,
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Field label="Label (optional)" value={label} onChangeText={setLabel} placeholder="e.g. Main Residence" />
      <Field label="Address" value={addressLine1} onChangeText={setAddressLine1} />
      <Field label="City" value={city} onChangeText={setCity} />
      <Field label="State" value={state} onChangeText={setState} autoCapitalize="characters" />
      <Field label="Postal code" value={postalCode} onChangeText={setPostalCode} keyboardType="number-pad" />

      <Text style={styles.label}>Property type</Text>
      <View style={styles.typeRow}>
        {PROPERTY_TYPES.map((t) => (
          <Pressable
            key={t}
            onPress={() => setPropertyType(t)}
            style={[styles.typeChip, propertyType === t && styles.typeChipActive]}
          >
            <Text style={[styles.typeChipText, propertyType === t && styles.typeChipTextActive]}>
              {t.replace(/_/g, " ")}
            </Text>
          </Pressable>
        ))}
      </View>

      <Field label="Access notes" value={accessNotes} onChangeText={setAccessNotes} placeholder="Gate code, pets, etc." />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton title="Add property" onPress={handleSubmit} loading={mutation.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: "500" },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 },
  typeChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { color: colors.text, fontSize: 12, fontWeight: "500" },
  typeChipTextActive: { color: "#fff" },
  error: { color: colors.danger, marginBottom: 12, textAlign: "center" },
});
