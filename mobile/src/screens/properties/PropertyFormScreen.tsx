import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { createProperty } from "../../api/properties";
import { ApiError } from "../../api/client";
import { ADDRESS_FORMAT_ERROR, ADDRESS_LABEL, ADDRESS_PLACEHOLDER, parseSingleLineAddress } from "../../lib/address";
import { CustomersStackParamList } from "../../navigation/navigationTypes";
import { Field, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<CustomersStackParamList, "PropertyForm">;

const PROPERTY_TYPES = ["RESIDENTIAL_SINGLE", "RESIDENTIAL_MULTI", "COMMERCIAL", "INDUSTRIAL", "OTHER"] as const;

export default function PropertyFormScreen({ route, navigation }: Props) {
  const { customerId } = route.params;
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
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
    const parsed = parseSingleLineAddress(address);
    if (!parsed) {
      setError(ADDRESS_FORMAT_ERROR);
      return;
    }
    setError(null);
    mutation.mutate({
      customerId,
      label: label.trim() || undefined,
      ...parsed,
      propertyType,
      accessNotes: accessNotes.trim() || undefined,
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Field label="Label (optional)" value={label} onChangeText={setLabel} placeholder="e.g. Main Residence" />
      <Field label={ADDRESS_LABEL} value={address} onChangeText={setAddress} placeholder={ADDRESS_PLACEHOLDER} />

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
