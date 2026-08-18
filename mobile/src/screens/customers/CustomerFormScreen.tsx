import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { createCustomer } from "../../api/customers";
import { ApiError } from "../../api/client";
import { CustomersStackParamList } from "../../navigation/navigationTypes";
import { Field, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<CustomersStackParamList, "CustomerForm">;

export default function CustomerFormScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<"RESIDENTIAL" | "COMMERCIAL">("RESIDENTIAL");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: createCustomer,
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      navigation.replace("CustomerDetail", { customerId: customer.id });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create customer"),
  });

  function handleSubmit() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setError(null);
    mutation.mutate({
      type,
      name: name.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.typeRow}>
        {(["RESIDENTIAL", "COMMERCIAL"] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setType(t)}
            style={[styles.typeChip, type === t && styles.typeChipActive]}
          >
            <Text style={[styles.typeChipText, type === t && styles.typeChipTextActive]}>
              {t === "RESIDENTIAL" ? "Residential" : "Commercial"}
            </Text>
          </Pressable>
        ))}
      </View>

      <Field label="Customer / Business name" value={name} onChangeText={setName} />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="City" value={city} onChangeText={setCity} />
      <Field label="State" value={state} onChangeText={setState} autoCapitalize="characters" />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton title="Create customer" onPress={handleSubmit} loading={mutation.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  typeRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  typeChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { color: colors.text, fontWeight: "500" },
  typeChipTextActive: { color: "#fff" },
  error: { color: colors.danger, marginBottom: 12, textAlign: "center" },
});
