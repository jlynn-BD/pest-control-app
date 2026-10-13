import type { Customer, Property } from "@pest-app/shared";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ApiError } from "../api/client";
import { createAppointment, type AppointmentType } from "../api/appointments";
import { createCustomer, listCustomers, type CustomerWithProperties } from "../api/customers";
import { createProperty } from "../api/properties";
import { listUsers } from "../api/users";
import { useAuth } from "../context/AuthContext";
import { Card, Field, PrimaryButton, colors } from "./ui";

// Books a client straight from the Schedule page: pick someone who is already
// a customer, or type in a brand-new client (name + address) and schedule them
// in one go - no need to go to Customers first.

const TYPES: { value: AppointmentType; label: string }[] = [
  { value: "INITIAL_INSPECTION", label: "Inspection" },
  { value: "FOLLOWUP_INSPECTION", label: "Follow-up" },
  { value: "TREATMENT", label: "Treatment" },
  { value: "OTHER", label: "Other" },
];
const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const MINUTES = [0, 15, 30, 45];

function hourLabel(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError && err.status === 0) return "You're offline. Connect to the internet to schedule a client.";
  return err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function ScheduleClientForm({ day, onCreated, onCancel }: { day: string; onCreated: () => void; onCancel: () => void }) {
  const { user } = useAuth();
  const canPickTechnician = user?.role === "ADMIN" || user?.role === "OFFICE";

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CustomerWithProperties[]>([]);
  const [searching, setSearching] = useState(false);
  const [customer, setCustomer] = useState<CustomerWithProperties | null>(null);
  const [newClient, setNewClient] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [propertyId, setPropertyId] = useState<string | "new" | null>(null);
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");

  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [type, setType] = useState<AppointmentType>("INITIAL_INSPECTION");
  const [notes, setNotes] = useState("");
  const [technicians, setTechnicians] = useState<{ id: string; name: string }[]>([]);
  const [technicianId, setTechnicianId] = useState<string>(user?.id ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // If a later step fails, the pieces already created are kept so a retry
  // doesn't make a second copy of the client or address.
  const created = useRef<{ customer?: Customer; property?: Property }>({});

  // Client search: show the first few customers right away, then narrow as the
  // person types.
  useEffect(() => {
    if (customer || newClient) return;
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      listCustomers(search.trim() || undefined)
        .then((rows) => !cancelled && setResults(rows.slice(0, 6)))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setSearching(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, customer, newClient]);

  useEffect(() => {
    if (!canPickTechnician) return;
    listUsers()
      .then((users) => setTechnicians(users.filter((u) => u.active && (u.role === "TECHNICIAN" || u.id === user?.id)).map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}` }))))
      .catch(() => {});
  }, [canPickTechnician, user?.id]);

  function chooseCustomer(c: CustomerWithProperties) {
    setCustomer(c);
    setNewClient(false);
    setPropertyId(c.properties.length === 1 ? c.properties[0].id : c.properties.length === 0 ? "new" : null);
  }

  const needsAddress = newClient || propertyId === "new";
  const readyClient = newClient ? name.trim().length > 0 : Boolean(customer);
  const readyAddress = needsAddress ? [street, city, state, zip].every((v) => v.trim()) : Boolean(propertyId);

  async function submit() {
    if (!user) return;
    if (!readyClient) {
      setError(newClient ? "Enter the client's name." : "Choose a client, or add a new one.");
      return;
    }
    if (!readyAddress) {
      setError(needsAddress ? "Enter the full address: street, city, state and ZIP." : "Choose which property it's for.");
      return;
    }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("That email address doesn't look right.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      let customerId = customer?.id;
      if (newClient) {
        if (!created.current.customer) {
          created.current.customer = await createCustomer({
            type: "RESIDENTIAL",
            name: name.trim(),
            phone: phone.trim() || undefined,
            email: email.trim() || undefined,
            billingAddressLine1: street.trim(),
            city: city.trim(),
            state: state.trim(),
            postalCode: zip.trim(),
          });
        }
        customerId = created.current.customer.id;
      }
      let theProperty = propertyId && propertyId !== "new" ? propertyId : created.current.property?.id;
      if (!theProperty) {
        created.current.property = await createProperty({
          customerId: customerId!,
          addressLine1: street.trim(),
          city: city.trim(),
          state: state.trim(),
          postalCode: zip.trim(),
          propertyType: "RESIDENTIAL_SINGLE",
        });
        theProperty = created.current.property.id;
      }
      const [y, m, d] = day.split("-").map(Number);
      await createAppointment({
        customerId: customerId!,
        propertyId: theProperty,
        technicianId: technicianId || user.id,
        type,
        scheduledStart: new Date(y, m - 1, d, hour, minute).toISOString(),
        notes: notes.trim() || undefined,
      });
      onCreated();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Schedule a client</Text>

      <Text style={styles.label}>Client</Text>
      {customer ? (
        <View style={styles.selectedRow}>
          <Text style={styles.selectedText}>{customer.name}</Text>
          <Text style={styles.link} onPress={() => { setCustomer(null); setPropertyId(null); }}>
            Change
          </Text>
        </View>
      ) : newClient ? (
        <>
          <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="e.g. Jordan Miles" />
          <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Field label="Email (optional)" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Text style={styles.link} onPress={() => setNewClient(false)}>
            Pick an existing client instead
          </Text>
        </>
      ) : (
        <>
          <Field label="Search your clients" value={search} onChangeText={setSearch} placeholder="Name or address" autoCapitalize="none" />
          {results.map((c) => (
            <Pressable key={c.id} onPress={() => chooseCustomer(c)} style={styles.resultRow} accessibilityRole="button">
              <Text style={styles.resultName}>{c.name}</Text>
              <Text style={styles.resultMeta}>
                {c.properties.length === 0 ? "No address yet" : c.properties.map((p) => p.addressLine1).slice(0, 2).join(" · ")}
              </Text>
            </Pressable>
          ))}
          {!searching && results.length === 0 ? <Text style={styles.muted}>No matching clients.</Text> : null}
          <PrimaryButton title="+ New client" onPress={() => { setNewClient(true); setPropertyId("new"); }} />
        </>
      )}

      {customer && customer.properties.length > 0 ? (
        <>
          <Text style={styles.label}>Property</Text>
          <View style={styles.chipRow}>
            {customer.properties.map((p) => (
              <Chip key={p.id} label={`${p.addressLine1}, ${p.city}`} on={propertyId === p.id} onPress={() => setPropertyId(p.id)} />
            ))}
            <Chip label="+ Another address" on={propertyId === "new"} onPress={() => setPropertyId("new")} />
          </View>
        </>
      ) : null}

      {needsAddress ? (
        <>
          <Text style={styles.label}>Address</Text>
          <Field label="Street" value={street} onChangeText={setStreet} autoCapitalize="words" placeholder="123 Main Street" />
          <Field label="City" value={city} onChangeText={setCity} autoCapitalize="words" />
          <View style={styles.twoCols}>
            <View style={styles.colNarrow}>
              <Field label="State" value={state} onChangeText={setState} autoCapitalize="characters" maxLength={20} />
            </View>
            <View style={styles.colWide}>
              <Field label="ZIP" value={zip} onChangeText={setZip} keyboardType="numbers-and-punctuation" />
            </View>
          </View>
        </>
      ) : null}

      <Text style={styles.label}>Time</Text>
      <View style={styles.chipRow}>
        {HOURS.map((h) => (
          <Chip key={h} label={hourLabel(h)} on={hour === h} onPress={() => setHour(h)} />
        ))}
      </View>
      <View style={styles.chipRow}>
        {MINUTES.map((m) => (
          <Chip key={m} label={`:${String(m).padStart(2, "0")}`} on={minute === m} onPress={() => setMinute(m)} />
        ))}
      </View>

      <Text style={styles.label}>What for</Text>
      <View style={styles.chipRow}>
        {TYPES.map((t) => (
          <Chip key={t.value} label={t.label} on={type === t.value} onPress={() => setType(t.value)} />
        ))}
      </View>

      {canPickTechnician && technicians.length > 0 ? (
        <>
          <Text style={styles.label}>Technician</Text>
          <View style={styles.chipRow}>
            {technicians.map((t) => (
              <Chip key={t.id} label={t.id === user?.id ? `${t.name} (me)` : t.name} on={technicianId === t.id} onPress={() => setTechnicianId(t.id)} />
            ))}
          </View>
        </>
      ) : null}

      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline placeholder="Gate code, what the client mentioned..." />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.buttons}>
        <View style={styles.half}>
          <PrimaryButton title="Schedule" onPress={submit} loading={busy} />
        </View>
        <View style={styles.half}>
          <PrimaryButton title="Cancel" onPress={onCancel} disabled={busy} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6, borderColor: colors.primary, borderWidth: 1 },
  title: { fontSize: 17, fontWeight: "700", color: colors.text, marginBottom: 4 },
  label: { fontSize: 13, color: colors.textMuted, fontWeight: "600", marginTop: 8 },
  muted: { fontSize: 13, color: colors.textMuted, fontStyle: "italic" },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14, paddingVertical: 8 },
  selectedRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.chip, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  selectedText: { fontSize: 16, fontWeight: "700", color: colors.text },
  resultRow: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, backgroundColor: colors.card },
  resultName: { fontSize: 15, fontWeight: "700", color: colors.text },
  resultMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.text },
  chipTextOn: { color: "#fff" },
  twoCols: { flexDirection: "row", gap: 10 },
  colNarrow: { flex: 1 },
  colWide: { flex: 2 },
  error: { color: colors.danger, marginVertical: 6 },
  buttons: { flexDirection: "row", gap: 10, marginTop: 6 },
  half: { flex: 1 },
});
