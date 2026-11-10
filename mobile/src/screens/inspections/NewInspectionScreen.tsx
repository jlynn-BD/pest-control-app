import { useFocusEffect } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError } from "../../api/client";
import { createCustomer } from "../../api/customers";
import { listInspections } from "../../api/inspections";
import { createProperty } from "../../api/properties";
import { ensureLocalInspection } from "../../lib/resumeInspection";
import { ADDRESS_FORMAT_ERROR, ADDRESS_PLACEHOLDER, parseSingleLineAddress } from "../../lib/address";
import { getCachedCustomer, getCachedProperties, getCachedTemplates, primeCache } from "../../db/cache";
import type { LocalProperty, LocalTemplate } from "../../db/types";
import { createLocalInspection, listLocalInspections } from "../../db/inspectionStore";
import { useAuth } from "../../context/AuthContext";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { Card, Field, PrimaryButton, colors, fonts, wideScreen } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "NewInspection">;

// Street words people abbreviate when typing (and that are spelled out, or
// abbreviated differently, on the record) - both sides are reduced to the same
// form so "77 cedar ln" finds "77 Cedar Lane".
const STREET_WORDS: Record<string, string> = {
  st: "street", str: "street", ave: "avenue", av: "avenue", blvd: "boulevard", dr: "drive", rd: "road", ln: "lane", ct: "court",
  cir: "circle", pl: "place", ter: "terrace", terr: "terrace", trl: "trail", pkwy: "parkway", hwy: "highway", sq: "square", apt: "apartment",
  n: "north", s: "south", e: "east", w: "west", ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
};

// Lower-case, punctuation-free words, with street abbreviations spelled out.
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_WORDS[w] ?? w);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Starting an inspection begins with the address: type it, the app checks
// whether a record for that property already exists. A match is picked and the
// inspection started; no match, and the customer's name, address, phone and
// email are entered right here to create the record, then the inspection starts.
export default function NewInspectionScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(route.params?.prefillAddress ?? "");
  // Coming from a property's page: that property is already chosen.
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(route.params?.propertyId ?? null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateTouched, setTemplateTouched] = useState(false);
  const [properties, setProperties] = useState<LocalProperty[]>([]);
  const [templates, setTemplates] = useState<LocalTemplate[]>([]);
  const [localInProgress, setLocalInProgress] = useState<Map<string, string>>(new Map());
  const [remoteInProgress, setRemoteInProgress] = useState<Map<string, string>>(new Map());
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // The "no record for this address" form.
  const [adding, setAdding] = useState(Boolean(route.params?.addNew));
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newAddress, setNewAddress] = useState(route.params?.prefillAddress ?? "");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Local copies win over the server list (they may hold newer edits).
  const inProgressByProperty = useMemo(() => new Map([...remoteInProgress, ...localInProgress]), [remoteInProgress, localInProgress]);

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
        setLocalInProgress(inProgress);
        // Also ask the server: an in-progress inspection started on another
        // device (or not on this one yet) isn't in local storage, and
        // missing it is how a second, empty one got created for the same
        // property. Offline just means falling back to the local check.
        listInspections({ technicianId: user.id, status: "IN_PROGRESS" })
          .then((rows) => setRemoteInProgress(new Map(rows.map((r) => [r.propertyId, r.id]))))
          .catch(() => {});
      }
    }, [user])
  );

  // With only one checklist template, use it - most inspections want it, and
  // "free-form" stays one tap away. (Not once the technician has chosen.)
  const effectiveTemplateId = templateTouched ? selectedTemplateId : selectedTemplateId ?? (templates.length === 1 ? templates[0].id : null);

  const query = search.trim();
  const matches = useMemo(() => {
    const tokens = words(query);
    if (tokens.length === 0) return [];
    return properties
      .map((p) => ({ p, customer: getCachedCustomer(p.customerId) }))
      .filter(({ p, customer }) => {
        const haystack = words(`${p.addressLine1} ${p.city} ${p.state} ${p.postalCode} ${p.label ?? ""} ${customer?.name ?? ""}`).join(" ");
        return tokens.every((t) => haystack.includes(t));
      })
      .slice(0, 20);
  }, [query, properties]);

  const selectedProperty = selectedPropertyId ? properties.find((p) => p.id === selectedPropertyId) ?? null : null;
  const existingInspectionId = selectedPropertyId ? inProgressByProperty.get(selectedPropertyId) ?? null : null;

  async function handleStart() {
    if (!selectedPropertyId || !user || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      let existingId = existingInspectionId;
      if (!existingId) {
        // The list above may not have loaded yet (or is stale), so ask the
        // server right before creating - never start a second inspection
        // where one is already open.
        try {
          const open = await listInspections({ technicianId: user.id, status: "IN_PROGRESS" });
          existingId = open.find((r) => r.propertyId === selectedPropertyId)?.id ?? null;
        } catch {
          // offline - the local check above is all there is
        }
      }
      if (existingId) {
        await ensureLocalInspection(existingId);
        navigation.replace("InspectionWorkspace", { inspectionId: existingId });
        return;
      }
      const property = properties.find((p) => p.id === selectedPropertyId);
      if (!property) return;
      const inspection = createLocalInspection({
        propertyId: property.id,
        customerId: property.customerId,
        templateId: effectiveTemplateId,
        technicianId: user.id,
      });
      navigation.replace("InspectionWorkspace", { inspectionId: inspection.id });
    } catch {
      setStartError("Couldn't open the existing inspection - check your connection and try again.");
    } finally {
      setStarting(false);
    }
  }

  function openAddForm() {
    setAdding(true);
    setAddError(null);
    // Carry what was typed into the address, so it isn't typed twice.
    if (!newAddress.trim() && query) setNewAddress(query);
  }

  // Creates the customer and their property, then selects it so the inspection
  // can start. Needs a connection (the records live on the server).
  async function handleCreateRecord() {
    if (saving) return;
    const parsed = parseSingleLineAddress(newAddress);
    if (!newName.trim()) return setAddError("Enter the customer's name.");
    if (!parsed) return setAddError(ADDRESS_FORMAT_ERROR);
    // The phone number and email are required: the signed report is emailed to the customer automatically.
    if (newPhone.replace(/\D/g, "").length < 7) return setAddError("Enter the customer's phone number.");
    if (!newEmail.trim()) return setAddError("Enter the customer's email - the signed report is sent there.");
    if (!EMAIL.test(newEmail.trim())) return setAddError("That email address doesn't look right.");
    // Same street and ZIP as a record we already have: use that one, don't duplicate it.
    const sameAddress = properties.find(
      (p) => words(p.addressLine1).join(" ") === words(parsed.addressLine1).join(" ") && p.postalCode.trim() === parsed.postalCode.trim()
    );
    if (sameAddress) {
      setAdding(false);
      setSelectedPropertyId(sameAddress.id);
      setSearch(sameAddress.addressLine1);
      return;
    }
    setSaving(true);
    setAddError(null);
    try {
      const customer = await createCustomer({
        type: "RESIDENTIAL",
        name: newName.trim(),
        email: newEmail.trim(),
        phone: newPhone.trim(),
        billingAddressLine1: parsed.addressLine1,
        city: parsed.city,
        state: parsed.state,
        postalCode: parsed.postalCode,
      });
      const property = await createProperty({ customerId: customer.id, ...parsed, propertyType: "RESIDENTIAL_SINGLE" });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      await primeCache().catch(() => {});
      setProperties(getCachedProperties());
      setAdding(false);
      setSelectedPropertyId(property.id);
      setSearch(parsed.addressLine1);
    } catch (err) {
      setAddError(
        err instanceof ApiError
          ? err.message
          : "Couldn't save the new record - adding a customer needs an internet connection. Connect and try again."
      );
    } finally {
      setSaving(false);
    }
  }

  const showResults = query.length > 0 && !adding;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.sectionTitle}>Property address</Text>
      <Field
        label=""
        placeholder="Type the property's address..."
        value={search}
        onChangeText={(text) => {
          setSearch(text);
          // Typing again means looking for a different property.
          if (selectedPropertyId && !route.params?.propertyId) setSelectedPropertyId(null);
        }}
        autoFocus={!route.params?.propertyId && !route.params?.addNew}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Property address"
      />

      {!query && !selectedProperty && !adding ? (
        <Text style={styles.hint}>
          Start with the address. We'll check whether we already have this property on file.
          {properties.length === 0 ? " (Connect to the internet once to download your property list.)" : ""}
        </Text>
      ) : null}

      {showResults && matches.length > 0 ? (
        <>
          <Text style={styles.resultsLabel}>
            {matches.length === 1 ? "We have this property on file" : `${matches.length} properties on file match`} - tap the right one
          </Text>
          {matches.map(({ p, customer }) => {
            const selected = p.id === selectedPropertyId;
            const inProgress = inProgressByProperty.has(p.id);
            return (
              <Pressable key={p.id} onPress={() => setSelectedPropertyId(p.id)} accessibilityRole="button">
                <Card style={[styles.card, selected && styles.cardSelected]}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>{p.addressLine1}</Text>
                    {inProgress ? <Text style={styles.inProgressBadge}>IN PROGRESS</Text> : null}
                  </View>
                  <Text style={styles.meta}>
                    {p.city}, {p.state} {p.postalCode} · {customer?.name ?? "Unknown customer"}
                  </Text>
                  {inProgress ? (
                    <Text style={styles.inProgressHint}>Already has an inspection in progress - continuing it instead of starting a new one.</Text>
                  ) : null}
                </Card>
              </Pressable>
            );
          })}
        </>
      ) : null}

      {showResults && matches.length === 0 ? (
        <Card style={styles.noMatchCard}>
          <Text style={styles.cardTitle}>No property on file for that address</Text>
          <Text style={styles.meta}>Add the customer and the property to start the inspection.</Text>
          <PrimaryButton title="Add new customer & property" onPress={openAddForm} variant="cta" />
        </Card>
      ) : null}

      {showResults && matches.length > 0 && !selectedProperty ? (
        <Pressable onPress={openAddForm} hitSlop={8}>
          <Text style={styles.addLink}>Not listed? Add a new customer & property</Text>
        </Pressable>
      ) : null}

      {adding ? (
        <Card style={styles.addCard}>
          <Text style={styles.cardTitle}>New customer & property</Text>
          <Field label="Customer name *" value={newName} onChangeText={setNewName} placeholder="e.g. Dana Whitfield" autoFocus={Boolean(newAddress)} />
          <Field label="Property address *" value={newAddress} onChangeText={setNewAddress} placeholder={ADDRESS_PLACEHOLDER} />
          <Field label="Phone *" value={newPhone} onChangeText={setNewPhone} keyboardType="phone-pad" placeholder="(555) 123-4567" />
          <Field label="Email *" value={newEmail} onChangeText={setNewEmail} autoCapitalize="none" keyboardType="email-address" placeholder="name@example.com" />
          <Text style={styles.meta}>The signed inspection report is emailed to this address automatically once the inspection is completed.</Text>
          {addError ? <Text style={styles.error}>{addError}</Text> : null}
          <View style={styles.buttonRow}>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Save & continue" onPress={handleCreateRecord} loading={saving} variant="cta" />
            </View>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Cancel" onPress={() => setAdding(false)} disabled={saving} />
            </View>
          </View>
        </Card>
      ) : null}

      {selectedProperty && !adding ? (
        <>
          {!query ? (
            <Card style={[styles.card, styles.cardSelected]}>
              <Text style={styles.cardTitle}>{selectedProperty.addressLine1}</Text>
              <Text style={styles.meta}>
                {selectedProperty.city}, {selectedProperty.state} {selectedProperty.postalCode} · {getCachedCustomer(selectedProperty.customerId)?.name ?? "Unknown customer"}
              </Text>
            </Card>
          ) : null}

          {existingInspectionId || templates.length === 0 ? null : (
            <>
              <Text style={styles.sectionTitle}>Checklist</Text>
              {templates.map((template) => {
                const selected = template.id === effectiveTemplateId;
                return (
                  <Pressable
                    key={template.id}
                    onPress={() => {
                      setTemplateTouched(true);
                      setSelectedTemplateId(template.id);
                    }}
                  >
                    <Card style={[styles.card, selected && styles.cardSelected]}>
                      <Text style={styles.cardTitle}>{template.name}</Text>
                      {template.description ? <Text style={styles.meta}>{template.description}</Text> : null}
                    </Card>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => {
                  setTemplateTouched(true);
                  setSelectedTemplateId(null);
                }}
              >
                <Card style={[styles.card, effectiveTemplateId === null && styles.cardSelected]}>
                  <Text style={styles.cardTitle}>No checklist - free-form inspection</Text>
                </Card>
              </Pressable>
            </>
          )}

          <View style={styles.spacer} />
          <PrimaryButton title={existingInspectionId ? "Continue inspection" : "Start inspection"} onPress={handleStart} loading={starting} variant="cta" />
          {startError ? <Text style={styles.startError}>{startError}</Text> : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { ...wideScreen, padding: 16, paddingBottom: 40 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 12, marginBottom: 8 },
  hint: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  resultsLabel: { fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", marginTop: 6, marginBottom: 8 },
  card: { marginBottom: 8 },
  cardSelected: { borderColor: colors.primary, borderWidth: 2 },
  noMatchCard: { gap: 8, marginTop: 6 },
  addCard: { gap: 6, marginTop: 6 },
  cardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontFamily: fonts.display, fontSize: 15, fontWeight: "600", color: colors.text },
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
  addLink: { color: colors.primaryText, fontWeight: "600", fontSize: 14, marginTop: 4, marginBottom: 4 },
  error: { color: colors.danger, fontSize: 13, marginTop: 4 },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  buttonHalf: { flex: 1 },
  startError: { color: colors.danger, fontSize: 13, textAlign: "center", marginTop: 8 },
  spacer: { height: 8 },
});
