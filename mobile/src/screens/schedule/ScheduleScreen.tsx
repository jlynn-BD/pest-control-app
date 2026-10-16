import { NavigationProp, ParamListBase, useFocusEffect, useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { listInspections } from "../../api/inspections";
import { cancelAppointment, listAppointments, type ScheduledAppointment } from "../../api/appointments";
import { useAuth } from "../../context/AuthContext";
import { primeCache } from "../../db/cache";
import { listLocalInspections, LocalInspectionListItem } from "../../db/inspectionStore";
import { ensureLocalInspection } from "../../lib/resumeInspection";
import { inspectionForAppointment, startInspectionFromAppointment } from "../../lib/startInspection";
import { ScheduleClientForm } from "../../components/ScheduleClientForm";
import { Badge, Card, PrimaryButton, colors } from "../../components/ui";

const COMPLETED_GREEN = "#2E9E5B";
const PENDING_YELLOW = "#F2B705";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Local calendar day (not UTC) - a 9pm-local inspection must land on that
// day, not the next one.
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface CalendarInspection {
  id: string;
  kind: "local" | "remote";
  customerName: string;
  propertyAddress: string;
  completed: boolean;
  day: string;
  when: Date;
}

interface DateFields {
  status: string;
  scheduledAt?: string | Date | null;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  createdAt: string | Date;
}

// Finished inspections sit on the day they were completed; open ones on the
// day they're scheduled for or, failing that, started.
function inspectionDate(i: DateFields): Date {
  const iso = i.status === "COMPLETED" ? i.completedAt ?? i.startedAt ?? i.createdAt : i.scheduledAt ?? i.startedAt ?? i.createdAt;
  return new Date(iso);
}

export default function ScheduleScreen() {
  const { user } = useAuth();
  const wide = useWindowDimensions().width >= 900;
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(dayKey(today));
  const [localRows, setLocalRows] = useState<LocalInspectionListItem[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (user) setLocalRows(listLocalInspections(user.id));
    }, [user])
  );

  // Same query key as the Inspections list, so the two share one fetch.
  const inspectionsQuery = useQuery({
    queryKey: ["inspections", user?.id],
    queryFn: () => listInspections({ technicianId: user!.id }),
    enabled: !!user,
    retry: false,
  });

  // Booked appointments for the month on screen. A technician sees their own;
  // admins and office staff see everyone's.
  const ownOnly = user?.role === "TECHNICIAN";
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const appointmentsQuery = useQuery({
    queryKey: ["appointments", ownOnly ? user?.id : "all", dayKey(monthStart)],
    queryFn: () =>
      listAppointments({
        technicianId: ownOnly ? user!.id : undefined,
        from: monthStart.toISOString(),
        to: new Date(monthEnd.getTime() - 1).toISOString(),
      }),
    enabled: !!user,
    retry: false,
  });

  // Canceled / no-show bookings stay off the calendar; one that already
  // became an inspection is shown as that inspection instead.
  // A booking that has been started is represented by its inspection (on
  // this device, or IN_PROGRESS on the server for other devices).
  const bookings = useMemo(
    () =>
      (appointmentsQuery.data ?? []).filter(
        (a) =>
          !a.inspectionId &&
          a.status !== "CANCELED" &&
          a.status !== "NO_SHOW" &&
          a.status !== "IN_PROGRESS" &&
          !inspectionForAppointment(a.id)
      ),
    // localRows changes when an inspection is started here
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appointmentsQuery.data, localRows]
  );

  const inspections = useMemo(() => {
    const localIds = new Set(localRows.map((r) => r.id));
    const rows: CalendarInspection[] = [
      ...localRows
        .filter((r) => r.status !== "CANCELED")
        .map((r): CalendarInspection => {
          const when = inspectionDate(r);
          return {
            id: r.id,
            kind: "local",
            customerName: r.customerName,
            propertyAddress: r.propertyAddress,
            completed: r.status === "COMPLETED",
            day: dayKey(when),
            when,
          };
        }),
      ...(inspectionsQuery.data ?? [])
        .filter((r) => !localIds.has(r.id) && r.status !== "CANCELED")
        .map((r): CalendarInspection => {
          const when = inspectionDate(r);
          return {
            id: r.id,
            kind: "remote",
            customerName: r.customer.name,
            propertyAddress: r.property.addressLine1,
            completed: r.status === "COMPLETED",
            day: dayKey(when),
            when,
          };
        }),
    ];
    return rows;
  }, [localRows, inspectionsQuery.data]);

  const byDay = useMemo(() => {
    const map = new Map<string, { completed: number; pending: number }>();
    for (const i of inspections) {
      const entry = map.get(i.day) ?? { completed: 0, pending: 0 };
      if (i.completed) entry.completed += 1;
      else entry.pending += 1;
      map.set(i.day, entry);
    }
    for (const a of bookings) {
      const day = dayKey(new Date(a.scheduledStart));
      const entry = map.get(day) ?? { completed: 0, pending: 0 };
      if (a.status === "COMPLETED") entry.completed += 1;
      else entry.pending += 1;
      map.set(day, entry);
    }
    return map;
  }, [inspections, bookings]);

  const monthCells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = Array(first.getDay()).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month]);

  const monthTotals = useMemo(() => {
    let completed = 0;
    let pending = 0;
    for (const i of inspections) {
      if (i.when.getFullYear() !== month.getFullYear() || i.when.getMonth() !== month.getMonth()) continue;
      if (i.completed) completed += 1;
      else pending += 1;
    }
    for (const a of bookings) {
      const when = new Date(a.scheduledStart);
      if (when.getFullYear() !== month.getFullYear() || when.getMonth() !== month.getMonth()) continue;
      if (a.status === "COMPLETED") completed += 1;
      else pending += 1;
    }
    return { completed, pending };
  }, [inspections, bookings, month]);

  const selectedInspections = inspections
    .filter((i) => i.day === selectedDay)
    .sort((a, b) => a.when.getTime() - b.when.getTime());
  const selectedBookings = bookings
    .filter((a) => dayKey(new Date(a.scheduledStart)) === selectedDay)
    .sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime());
  const selectedDate = new Date(`${selectedDay}T00:00:00`);
  const isToday = selectedDay === dayKey(today);

  function shiftMonth(delta: number) {
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  async function openInspection(i: CalendarInspection) {
    if (openingId) return;
    setOpenError(null);
    if (i.completed) {
      navigation.navigate("Inspections", {
        screen: i.kind === "local" ? "LocalInspectionDetail" : "InspectionDetail",
        params: { inspectionId: i.id },
        initial: false,
      });
      return;
    }
    setOpeningId(i.id);
    try {
      // An open inspection that only exists on the server has to be loaded
      // onto this device before the editable workspace can show it.
      await ensureLocalInspection(i.id);
      navigation.navigate("Inspections", { screen: "InspectionWorkspace", params: { inspectionId: i.id }, initial: false });
    } catch {
      setOpenError("Couldn't open this inspection - check your connection and try again.");
    } finally {
      setOpeningId(null);
    }
  }

  const refreshing = inspectionsQuery.isRefetching || appointmentsQuery.isRefetching;

  const [startingId, setStartingId] = useState<string | null>(null);
  async function startInspectionFor(a: ScheduledAppointment) {
    if (!user || startingId) return;
    setStartingId(a.id);
    setOpenError(null);
    try {
      const inspectionId = await startInspectionFromAppointment(a, user.id);
      setLocalRows(listLocalInspections(user.id));
      navigation.navigate("Inspections", { screen: "InspectionWorkspace", params: { inspectionId }, initial: false });
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : "Couldn't start the inspection - try again.");
    } finally {
      setStartingId(null);
    }
  }

  async function confirmCancel(a: ScheduledAppointment) {
    setCancelBusy(true);
    setOpenError(null);
    try {
      await cancelAppointment(a.id);
      setCancelingId(null);
      await appointmentsQuery.refetch();
    } catch {
      setOpenError("Couldn't cancel that appointment - check your connection and try again.");
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            inspectionsQuery.refetch();
            appointmentsQuery.refetch();
          }}
        />
      }
    >
      {/* On a wide screen (tablet / landscape) the calendar and the selected
          day's list sit side by side; on a phone they stack. */}
      <View style={wide ? styles.wideRow : styles.stackCol}>
      <View style={wide ? styles.wideCol : styles.stackCol}>
      <View style={styles.monthRow}>
        <Pressable onPress={() => shiftMonth(-1)} style={styles.monthButton} accessibilityLabel="Previous month">
          <Text style={styles.monthButtonText}>‹</Text>
        </Pressable>
        <Text style={styles.monthTitle}>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</Text>
        <Pressable onPress={() => shiftMonth(1)} style={styles.monthButton} accessibilityLabel="Next month">
          <Text style={styles.monthButtonText}>›</Text>
        </Pressable>
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: COMPLETED_GREEN }]} />
          <Text style={styles.legendText}>Completed ({monthTotals.completed})</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: PENDING_YELLOW }]} />
          <Text style={styles.legendText}>Pending ({monthTotals.pending})</Text>
        </View>
        {month.getMonth() !== today.getMonth() || month.getFullYear() !== today.getFullYear() ? (
          <Text
            style={styles.todayLink}
            onPress={() => {
              setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
              setSelectedDay(dayKey(today));
            }}
          >
            Today
          </Text>
        ) : null}
      </View>

      <View style={styles.grid}>
        {WEEKDAYS.map((w) => (
          <View key={w} style={styles.cell}>
            <Text style={styles.weekday}>{w}</Text>
          </View>
        ))}
        {monthCells.map((date, idx) => {
          if (!date) return <View key={`e${idx}`} style={styles.cell} />;
          const key = dayKey(date);
          const counts = byDay.get(key);
          const selected = key === selectedDay;
          const isTodayCell = key === dayKey(today);
          return (
            <Pressable key={key} style={styles.cell} onPress={() => setSelectedDay(key)} accessibilityLabel={`${key}`}>
              <View style={[styles.dayBox, isTodayCell && styles.dayBoxToday, selected && styles.dayBoxSelected]}>
                <Text style={[styles.dayNumber, selected && styles.dayNumberSelected]}>{date.getDate()}</Text>
                <View style={styles.dotRow}>
                  {counts && counts.completed > 0 ? <View style={[styles.dot, { backgroundColor: COMPLETED_GREEN }]} /> : null}
                  {counts && counts.pending > 0 ? <View style={[styles.dot, { backgroundColor: PENDING_YELLOW }]} /> : null}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
      </View>

      <View style={wide ? styles.wideCol : styles.stackCol}>
      <Text style={styles.heading}>
        {isToday ? "Today · " : ""}
        {selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
      </Text>
      {openError ? <Text style={styles.error}>{openError}</Text> : null}

      {scheduling ? (
        <ScheduleClientForm
          day={selectedDay}
          onCancel={() => setScheduling(false)}
          onCreated={() => {
            setScheduling(false);
            appointmentsQuery.refetch();
            // A brand-new client/address should be available to start an
            // inspection from right away.
            primeCache().catch(() => {});
          }}
        />
      ) : (
        <PrimaryButton
          title={`+ Schedule a client on ${selectedDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
          onPress={() => setScheduling(true)}
        />
      )}

      {selectedInspections.map((i) => (
        <Pressable key={i.id} onPress={() => openInspection(i)}>
          <Card style={[styles.card, { borderLeftWidth: 4, borderLeftColor: i.completed ? COMPLETED_GREEN : PENDING_YELLOW }]}>
            <View style={styles.rowTop}>
              <Text style={styles.customer}>{i.customerName}</Text>
              <Badge label={i.completed ? "COMPLETED" : "PENDING"} tone={i.completed ? "success" : "warning"} />
            </View>
            <Text style={styles.meta}>{i.propertyAddress}</Text>
            <Text style={styles.meta}>
              {openingId === i.id ? "Opening…" : i.when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </Text>
          </Card>
        </Pressable>
      ))}

      {selectedBookings.map((item) => {
        const open = item.status === "SCHEDULED" || item.status === "CONFIRMED";
        return (
          <Card key={item.id} style={[styles.card, { borderLeftWidth: 4, borderLeftColor: item.status === "COMPLETED" ? COMPLETED_GREEN : PENDING_YELLOW }]}>
            <View style={styles.rowTop}>
              <Text style={styles.time}>{new Date(item.scheduledStart).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
              <Badge label={item.type.replace(/_/g, " ")} />
            </View>
            <Text style={styles.customer}>{item.customer.name}</Text>
            <Text style={styles.meta}>
              {item.property.addressLine1}, {item.property.city}
            </Text>
            {!ownOnly && item.technician ? (
              <Text style={styles.meta}>
                Technician: {item.technician.firstName} {item.technician.lastName}
              </Text>
            ) : null}
            {item.notes ? <Text style={styles.meta}>{item.notes}</Text> : null}
            {open ? (
              cancelingId === item.id ? (
                <View style={styles.actionRow}>
                  <Text style={styles.meta}>Cancel this appointment?</Text>
                  <View style={styles.actionButtons}>
                    <View style={styles.actionHalf}>
                      <PrimaryButton title="Yes, cancel it" onPress={() => confirmCancel(item)} loading={cancelBusy} />
                    </View>
                    <View style={styles.actionHalf}>
                      <PrimaryButton title="Keep it" onPress={() => setCancelingId(null)} disabled={cancelBusy} />
                    </View>
                  </View>
                </View>
              ) : (
                <View style={styles.actionButtons}>
                  <View style={styles.actionHalf}>
                    <PrimaryButton title="Start inspection" onPress={() => startInspectionFor(item)} loading={startingId === item.id} />
                  </View>
                  <View style={styles.actionHalf}>
                    <PrimaryButton title="Cancel" onPress={() => setCancelingId(item.id)} />
                  </View>
                </View>
              )
            ) : null}
          </Card>
        );
      })}

      {selectedInspections.length === 0 && selectedBookings.length === 0 ? (
        <Text style={styles.empty}>Nothing scheduled or inspected on this day.</Text>
      ) : null}
      </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  wideRow: { flexDirection: "row", gap: 20, alignItems: "flex-start" },
  wideCol: { flex: 1, gap: 8 },
  stackCol: { gap: 8 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 8 },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  monthButton: { paddingHorizontal: 14, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  monthButtonText: { fontSize: 26, color: colors.primary, fontWeight: "600" },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendText: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  todayLink: { marginLeft: "auto", color: colors.primary, fontWeight: "700", fontSize: 13, paddingVertical: 12 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, alignItems: "center", paddingVertical: 2 },
  weekday: { fontSize: 12, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", paddingVertical: 4 },
  dayBox: {
    width: "88%",
    minHeight: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayBoxToday: { borderColor: colors.primary, borderWidth: 2 },
  dayBoxSelected: { backgroundColor: colors.chip, borderColor: colors.primary, borderWidth: 2 },
  dayNumber: { fontSize: 14, fontWeight: "600", color: colors.text },
  dayNumberSelected: { color: colors.primary, fontWeight: "800" },
  dotRow: { flexDirection: "row", gap: 3, height: 9 },
  heading: { fontSize: 16, fontWeight: "700", color: colors.text, marginTop: 12 },
  card: { gap: 4, marginBottom: 2 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  time: { fontSize: 15, fontWeight: "700", color: colors.primary },
  customer: { fontSize: 16, fontWeight: "600", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  empty: { color: colors.textMuted, fontSize: 13, fontStyle: "italic", marginTop: 4 },
  error: { color: colors.danger, fontSize: 13 },
  actionRow: { gap: 6, marginTop: 6 },
  actionButtons: { flexDirection: "row", gap: 10, marginTop: 6 },
  actionHalf: { flex: 1 },
});
