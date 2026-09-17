import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCachedCustomer, getCachedProperties, getCachedTemplates, primeCache } from "../../db/cache";
import type { LocalProperty, LocalTemplate } from "../../db/types";
import { createLocalInspection, listLocalInspections } from "../../db/inspectionStore";
import { useAuth } from "../../context/AuthContext";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { Card, Field, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "NewInspection">;

export default function NewInspectionScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [properties, setProperties] = useState<LocalProperty[]>([]);
  const [templates, setTemplates] = useState<LocalTemplate[]>([]);
  const [inProgressByProperty, setInProgressByProperty] = useState<Map<string, string>>(new Map());

  useFocusEffect(
    useCallback(() => {
      let cachedProperties = getCachedProperties();
      // Local storage can still be initializing right after app start (web
      // in particular); if the cache looks empty, try priming it once more
      // before telling the technician there's nothing available offline.
      if (cachedProperties.length === 0) {
        primeCache()
          .then(() => {
            setProperties(getCachedProperties());
            setTemplates(getCachedTemplates());
          })
          .catch(() => {
            // still offline / not cached yet - keep showing the empty state
          });
      }
      setProperties(cachedProperties);
      setTemplates(getCachedTemplates());

      // A technician accidentally starting a second inspection at a
      // property that already has one going is exactly how this app ended
      // up with a pile of duplicate in-progress inspections that had to be
      // manually cleaned up - one property should only ever have one
      // in-progress inspection open at a time (per technician/device; a
      // second device or technician starting one there independently isn't
      // caught here, since this is local-only offline-first state).
      if (user) {
        const inProgress = new Map<string, string>();
        for (const i of listLocalInspections(user.id)) {
          if (i.status !== "COMPLETED") inProgress.set(i.propertyId, i.id);
        }
        setInProgressByProperty(inProgress);
      }
    }, [user])
  );

  const filteredProperties = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter((p) => {
      const customer = getCachedCustomer(p.customerId);
      return (
        p.addressLine1.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        (customer?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [search, properties]);

  const existingInspectionId = selectedPropertyId ? inProgressByProperty.get(selectedPropertyId) ?? null : null;

  function handleStart() {
    if (!selectedPropertyId || !user) return;
    if (existingInspectionId) {
      navigation.replace("InspectionWorkspace", { inspectionId: existingInspectionId });
      return;
    }
    const property = properties.find((p) => p.id === selectedPropertyId);
    if (!property) return;
    const inspection = createLocalInspection({
      propertyId: property.id,
      customerId: property.customerId,
      templateId: selectedTemplateId,
      technicianId: user.id,
    });
    navigation.replace("InspectionWorkspace", { inspectionId: inspection.id });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Property</Text>
      <Field label="" placeholder="Search by customer or address" value={search} onChangeText={setSearch} />
      {properties.length === 0 ? (
        <Text style={styles.emptyText}>
          No properties cached yet. Connect to the internet once to download customer &amp; property data for offline use.
        </Text>
      ) : (
        filteredProperties.map((property) => {
          const customer = getCachedCustomer(property.customerId);
          const selected = property.id === selectedPropertyId;
          const inProgress = inProgressByProperty.has(property.id);
          return (
            <Pressable key={property.id} onPress={() => setSelectedPropertyId(property.id)}>
              <Card style={[styles.card, selected && styles.cardSelected]}>
                <View style={styles.cardTitleRow}>
                  <Text style={styles.cardTitle}>{customer?.name ?? "Unknown customer"}</Text>
                  {inProgress ? <Text style={styles.inProgressBadge}>IN PROGRESS</Text> : null}
                </View>
                <Text style={styles.meta}>
                  {property.addressLine1}, {property.city}, {property.state}
                </Text>
                {inProgress ? (
                  <Text style={styles.inProgressHint}>Already has an inspection in progress - continuing it instead of starting a new one.</Text>
                ) : null}
              </Card>
            </Pressable>
          );
        })
      )}

      {existingInspectionId ? null : (
        <>
          <Text style={styles.sectionTitle}>Template (optional)</Text>
          <Pressable onPress={() => setSelectedTemplateId(null)}>
            <Card style={[styles.card, selectedTemplateId === null && styles.cardSelected]}>
              <Text style={styles.cardTitle}>No template — free-form inspection</Text>
            </Card>
          </Pressable>
          {templates.map((template) => {
            const selected = template.id === selectedTemplateId;
            return (
              <Pressable key={template.id} onPress={() => setSelectedTemplateId(template.id)}>
                <Card style={[styles.card, selected && styles.cardSelected]}>
                  <Text style={styles.cardTitle}>{template.name}</Text>
                  {template.description ? <Text style={styles.meta}>{template.description}</Text> : null}
                </Card>
              </Pressable>
            );
          })}
        </>
      )}

      <View style={styles.spacer} />
      <PrimaryButton
        title={existingInspectionId ? "Continue inspection" : "Start inspection"}
        onPress={handleStart}
        disabled={!selectedPropertyId}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 12, marginBottom: 8 },
  card: { marginBottom: 8 },
  cardSelected: { borderColor: colors.primary, borderWidth: 2 },
  cardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  inProgressBadge: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.warning,
    backgroundColor: colors.chip,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  inProgressHint: { fontSize: 12, color: colors.textMuted, marginTop: 4, fontStyle: "italic" },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  emptyText: { color: colors.textMuted, fontStyle: "italic" },
  spacer: { height: 8 },
});
