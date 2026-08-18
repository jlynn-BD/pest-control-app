import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCustomer } from "../../api/customers";
import { CustomersStackParamList } from "../../navigation/navigationTypes";
import { Badge, Card, ErrorView, LoadingView, colors } from "../../components/ui";

type Props = NativeStackScreenProps<CustomersStackParamList, "CustomerDetail">;

export default function CustomerDetailScreen({ route, navigation }: Props) {
  const { customerId } = route.params;
  const { data: customer, isLoading, isError, error } = useQuery({
    queryKey: ["customers", customerId],
    queryFn: () => getCustomer(customerId),
  });

  if (isLoading) return <LoadingView />;
  if (isError || !customer) return <ErrorView message={error instanceof Error ? error.message : "Failed to load customer"} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.name}>{customer.name}</Text>
        <Badge label={customer.type === "COMMERCIAL" ? "Commercial" : "Residential"} />
      </View>
      {customer.phone ? <Text style={styles.meta}>{customer.phone}</Text> : null}
      {customer.email ? <Text style={styles.meta}>{customer.email}</Text> : null}

      <Text style={styles.sectionTitle}>Contacts</Text>
      {customer.contacts.length === 0 ? (
        <Text style={styles.emptyText}>No contacts on file</Text>
      ) : (
        customer.contacts.map((contact) => (
          <Card key={contact.id} style={styles.card}>
            <Text style={styles.cardTitle}>
              {contact.firstName} {contact.lastName} {contact.isPrimary ? "· Primary" : ""}
            </Text>
            {contact.role ? <Text style={styles.meta}>{contact.role}</Text> : null}
            {contact.phone ? <Text style={styles.meta}>{contact.phone}</Text> : null}
          </Card>
        ))
      )}

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Estimates</Text>
        <Pressable onPress={() => navigation.navigate("EstimateList", { customerId })}>
          <Text style={styles.addLink}>View estimates</Text>
        </Pressable>
      </View>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Properties</Text>
        <Pressable onPress={() => navigation.navigate("PropertyForm", { customerId })}>
          <Text style={styles.addLink}>+ Add property</Text>
        </Pressable>
      </View>
      {customer.properties.length === 0 ? (
        <Text style={styles.emptyText}>No properties on file</Text>
      ) : (
        customer.properties.map((property) => (
          <Pressable key={property.id} onPress={() => navigation.navigate("PropertyDetail", { propertyId: property.id })}>
            <Card style={styles.card}>
              <Text style={styles.cardTitle}>{property.label || property.addressLine1}</Text>
              <Text style={styles.meta}>
                {property.addressLine1}, {property.city}, {property.state} {property.postalCode}
              </Text>
            </Card>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 22, fontWeight: "700", color: colors.text },
  meta: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 18, marginBottom: 8 },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18 },
  addLink: { color: colors.primary, fontWeight: "600" },
  emptyText: { color: colors.textMuted, fontStyle: "italic" },
  card: { marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
});
