import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCustomer } from "../../api/customers";
import { createProperty } from "../../api/properties";
import { ApiError } from "../../api/client";
import {
  ADDRESS_FORMAT_ERROR,
  ADDRESS_LABEL,
  ADDRESS_PLACEHOLDER,
  formatSingleLineAddress,
  parseSingleLineAddress,
} from "../../lib/address";
import { CustomersStackParamList } from "../../navigation/navigationTypes";
import { Field, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<CustomersStackParamList, "PropertyForm">;

const PROPERTY_TYPES = ["RESIDENTIAL_SINGLE", "RESIDENTIAL_MULTI", "COMMERCIAL", "INDUSTRIAL", "OTHER"] as const;

export default function PropertyFormScreen({ route, navigation }: Props) {
  const { customerId } = route.params;
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [addressEdited, setAddressEdited] = useState(false);

  // The address typed when the customer was created, so it isn't entered a
  // second time. Same query key as the customer page, so it's usually already
  // loaded.
  const { data: customer } = useQuery({ queryKey: ["customers", customerId], queryFn: () => getCustomer(customerId) });
  const customerAddress = customer
    ? formatSingleLineAddress({
        addressLine1: customer.billingAddressLine1,
        city: customer.city,
        state: customer.state,
        postalCode: customer.postalCode,
      })
    : null;

  // Prefill once it's known, but never over something the technician typed.
  useEffect(() => {
    if (customerAddress && !addressEdited && !address) setAddress(customerAddress);
  }, [customerAddress, addressEdited, address]);
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
      <Field
        label={ADDRESS_LABEL}
        value={address}
        onChangeText={(text) => {
          setAddressEdited(true);
          setAddress(text);
        }}
        placeholder={ADDRESS_PLACEHOLDER}
      />
      {customerAddress && address === customerAddress ? (
        <Text style={styles.hint}>Filled in from the customer's address - change it if the property is somewhere else.</Text>
      ) : null}
      {customerAddress && address !== customerAddress ? (
        <Text
          style={styles.useLink}
          onPress={() => {
            setAddressEdited(true);
            setAddress(customerAddress);
          }}
        >
          Use the customer's address: {customerAddress}
        </Text>
      ) : null}

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
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { color: colors.text, fontSize: 12, fontWeight: "500" },
  typeChipTextActive: { color: "#fff" },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: -8, marginBottom: 16 },
  useLink: { fontSize: 13, color: colors.primary, fontWeight: "600", marginTop: -8, marginBottom: 4, paddingVertical: 12 },
  error: { color: colors.danger, marginBottom: 12, textAlign: "center" },
});
