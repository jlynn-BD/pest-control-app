import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { listInspections } from "../../api/inspections";
import { openInspection } from "../../lib/openInspection";
import { getCachedCustomer, getCachedProperties, primeCache } from "../../db/cache";
import type { LocalProperty } from "../../db/types";
import { deleteLocalInspection, listLocalInspections, LocalInspectionListItem } from "../../db/inspectionStore";
import { useAuth } from "../../context/AuthContext";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { Badge, colors, fonts } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "Home">;

const RECENT_LIMIT = 5;

type Row = {
  id: string;
  customerName: string;
  propertyAddress: string;
  status: string;
  createdAt: string;
  synced: boolean;
};

// The first screen after signing in. It answers one question - "what do I do
// now?" - with a big New Inspection card, the inspections still in progress
// (so unfinished work is one tap away), and a search box for finding a
// property by address, whose page holds that property's past inspections.
export default function HomeScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [localRows, setLocalRows] = useState<LocalInspectionListItem[]>([]);
  const [properties, setProperties] = useState<LocalProperty[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (user) setLocalRows(listLocalInspections(user.id));
      const cached = getCachedProperties();
      setProperties(cached);
      // Right after install / first sign-in the device has no property list yet
      // (and local storage can still be starting up on the web): load it, so
      // the address search has something to search.
      if (cached.length === 0) {
        primeCache()
          .then(() => setProperties(getCachedProperties()))
          .catch(() => {
            // offline and nothing downloaded yet - the empty-state text explains
          });
      }
    }, [user])
  );

  const { data } = useQuery({
    queryKey: ["inspections", user?.id],
    queryFn: () => listInspections({ technicianId: user!.id }),
    enabled: !!user,
    retry: false,
  });

  // A local row that already made it to the server (syncStatus "synced") but
  // no longer appears in a successful remote fetch was deleted server-side
  // by someone/something else - the local copy is a stale ghost with no
  // further syncing to do, so prune it here rather than showing it forever.
  // A "pending" row is left alone even if absent remotely: that's just an
  // unsynced local inspection that hasn't had a chance to reach the server.
  useEffect(() => {
    if (!user || !data) return;
    const remoteIds = new Set(data.map((r) => r.id));
    const current = listLocalInspections(user.id);
    // An empty server list while this device holds synced inspections looks
    // like an outage or a reset, not "every one was deleted elsewhere" -
    // never wipe the device's copies on that evidence.
    if (data.length === 0 && current.some((r) => r.syncStatus === "synced")) return;
    const staleIds = current.filter((r) => r.syncStatus === "synced" && !remoteIds.has(r.id)).map((r) => r.id);
    if (staleIds.length === 0) return;
    for (const id of staleIds) deleteLocalInspection(id);
    setLocalRows(listLocalInspections(user.id));
  }, [data, user]);

  const rows: Row[] = useMemo(() => {
    const localIds = new Set(localRows.map((r) => r.id));
    return [
      ...localRows.map((r): Row => ({
        id: r.id,
        customerName: r.customerName,
        propertyAddress: r.propertyAddress,
        status: r.status,
        createdAt: r.createdAt,
        synced: r.syncStatus === "synced",
      })),
      ...(data ?? [])
        .filter((r) => !localIds.has(r.id))
        .map((r): Row => ({
          id: r.id,
          customerName: r.customer.name,
          propertyAddress: r.property.addressLine1,
          status: r.status,
          createdAt: r.createdAt,
          synced: true,
        })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [localRows, data]);

  const inProgress = rows.filter((r) => r.status !== "COMPLETED");
  // Just-finished work (including anything not uploaded yet, so a job done
  // without signal never disappears from view). Older ones: search the address.
  const completed = rows.filter((r) => r.status === "COMPLETED");
  const recent = [...completed.filter((r) => !r.synced), ...completed.filter((r) => r.synced).slice(0, RECENT_LIMIT)];

  const inProgressPropertyIds = useMemo(() => new Set(localRows.filter((r) => r.status !== "COMPLETED").map((r) => r.propertyId)), [localRows]);

  const query = search.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return [];
    return properties
      .map((p) => ({ p, customer: getCachedCustomer(p.customerId) }))
      .filter(({ p, customer }) => `${p.addressLine1} ${p.city} ${p.state} ${p.postalCode} ${p.label ?? ""} ${customer?.name ?? ""}`.toLowerCase().includes(query))
      .slice(0, 30);
  }, [query, properties]);

  async function open(row: Row) {
    if (openingId) return;
    setOpeningId(row.id);
    setOpenError(null);
    try {
      await openInspection(navigation, row);
    } catch {
      setOpenError("Couldn't open this inspection - check your connection and try again.");
    } finally {
      setOpeningId(null);
    }
  }

  function renderRow(row: Row) {
    return (
      <Pressable key={row.id} style={styles.row} onPress={() => open(row)} accessibilityRole="button">
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle}>{row.propertyAddress}</Text>
          <Text style={styles.meta}>
            {row.customerName} · {new Date(row.createdAt).toLocaleDateString()}
          </Text>
        </View>
        <View style={styles.badgeCol}>
          <Badge label={row.status === "COMPLETED" ? "COMPLETED" : "IN PROGRESS"} tone={row.status === "COMPLETED" ? "success" : "warning"} />
          {!row.synced ? <Badge label="Not synced" tone="warning" /> : null}
          {openingId === row.id ? <Text style={styles.meta}>Opening…</Text> : null}
        </View>
      </Pressable>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.searchBox}>
        <Text style={styles.searchIcon}>{"\u{1F50D}"}</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search property address..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search property address"
        />
        {search ? (
          <Pressable onPress={() => setSearch("")} hitSlop={10} accessibilityLabel="Clear search">
            <Text style={styles.clear}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      {query ? (
        <>
          <Text style={styles.sectionHeader}>Properties</Text>
          {matches.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>No property matches that address</Text>
              <Text style={styles.meta}>
                {properties.length === 0 ? "Connect to the internet once to download your property list. " : ""}
                A new property has to be added to its customer first.
              </Text>
              <Pressable onPress={() => navigation.getParent()?.navigate("Customers", { screen: "CustomerList" })} hitSlop={8}>
                <Text style={styles.link}>Add a customer or property</Text>
              </Pressable>
            </View>
          ) : (
            matches.map(({ p, customer }) => (
              <Pressable key={p.id} style={styles.row} onPress={() => navigation.navigate("PropertyDetail", { propertyId: p.id })} accessibilityRole="button">
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle}>{p.addressLine1}</Text>
                  <Text style={styles.meta}>
                    {p.city}, {p.state} · {customer?.name ?? "Unknown customer"}
                  </Text>
                </View>
                <View style={styles.badgeCol}>
                  {inProgressPropertyIds.has(p.id) ? <Badge label="IN PROGRESS" tone="warning" /> : null}
                  <Text style={styles.chevron}>›</Text>
                </View>
              </Pressable>
            ))
          )}
        </>
      ) : (
        <>
          <Pressable style={styles.newCard} onPress={() => navigation.navigate("NewInspection")} accessibilityRole="button" accessibilityLabel="New inspection">
            <View style={styles.newPlus}>
              <Text style={styles.newPlusText}>+</Text>
            </View>
            <Text style={styles.newTitle}>New Inspection</Text>
            <Text style={styles.newSubtitle}>Start an inspection at a property</Text>
          </Pressable>

          {openError ? <Text style={styles.error}>{openError}</Text> : null}

          {inProgress.length > 0 ? (
            <>
              <Text style={styles.sectionHeader}>In progress ({inProgress.length})</Text>
              {inProgress.map(renderRow)}
            </>
          ) : null}

          {recent.length > 0 ? (
            <>
              <Text style={styles.sectionHeader}>Recently completed</Text>
              {recent.map(renderRow)}
            </>
          ) : null}

          <Text style={styles.hint}>To see older inspections, search the property address above and open its record.</Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32, gap: 10 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  searchIcon: { fontSize: 16, marginRight: 10 },
  searchInput: { flex: 1, fontSize: 16, color: colors.text, fontFamily: fonts.body, paddingVertical: 12, outlineStyle: "none" as never },
  clear: { fontSize: 16, color: colors.textMuted, paddingLeft: 10 },
  newCard: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.primary,
    paddingVertical: 30,
    paddingHorizontal: 16,
  },
  newPlus: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  newPlusText: { color: "#FFFFFF", fontSize: 36, lineHeight: 38, fontWeight: "600", fontFamily: fonts.body },
  newTitle: { fontFamily: fonts.display, fontSize: 22, fontWeight: "700", color: colors.text },
  newSubtitle: { fontSize: 15, color: colors.textMuted, marginTop: 4 },
  sectionHeader: { fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", marginTop: 10 },
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
  rowMain: { flex: 1, paddingRight: 8 },
  rowTitle: { fontFamily: fonts.display, fontSize: 16, fontWeight: "600", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  badgeCol: { gap: 6, alignItems: "flex-end" },
  chevron: { fontSize: 24, color: colors.textMuted, lineHeight: 26 },
  emptyBox: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  link: { color: colors.primaryText, fontWeight: "600", fontSize: 15, marginTop: 6 },
  hint: { fontSize: 13, color: colors.textMuted, textAlign: "center", marginTop: 14 },
  error: { color: colors.danger, fontSize: 13 },
});
