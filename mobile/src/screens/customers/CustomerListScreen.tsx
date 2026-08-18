import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { listCustomers } from "../../api/customers";
import { CustomersStackParamList } from "../../navigation/navigationTypes";
import { Badge, EmptyState, ErrorView, Field, LoadingView, colors } from "../../components/ui";

type Props = NativeStackScreenProps<CustomersStackParamList, "CustomerList">;

export default function CustomerListScreen({ navigation }: Props) {
  const [search, setSearch] = useState("");
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["customers", search],
    queryFn: () => listCustomers(search || undefined),
  });

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <Field label="" placeholder="Search customers" value={search} onChangeText={setSearch} />
      </View>
      <Pressable style={styles.addButton} onPress={() => navigation.navigate("CustomerForm")}>
        <Text style={styles.addButtonText}>+ New Customer</Text>
      </Pressable>

      {isLoading ? (
        <LoadingView />
      ) : isError ? (
        <ErrorView message={error instanceof Error ? error.message : "Failed to load customers"} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No customers yet" subtitle="Add your first customer to get started" />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => navigation.navigate("CustomerDetail", { customerId: item.id })}
            >
              <View style={styles.rowMain}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {item.properties.length} propert{item.properties.length === 1 ? "y" : "ies"}
                  {item.city ? ` · ${item.city}, ${item.state}` : ""}
                </Text>
              </View>
              <Badge label={item.type === "COMMERCIAL" ? "Commercial" : "Residential"} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16, paddingTop: 12 },
  searchRow: { marginBottom: 4 },
  addButton: { alignSelf: "flex-start", marginBottom: 12 },
  addButtonText: { color: colors.primary, fontWeight: "600", fontSize: 15 },
  list: { paddingBottom: 24, gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  rowMain: { flex: 1 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
});
