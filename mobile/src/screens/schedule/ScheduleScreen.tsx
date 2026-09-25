import { NavigationProp, ParamListBase, useFocusEffect, useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { listInspections } from "../../api/inspections";
import { getTechnicianSchedule } from "../../api/appointments";
import { useAuth } from "../../context/AuthContext";
import { listLocalInspections, LocalInspectionListItem } from "../../db/inspectionStore";
import { ensureLocalInspection } from "../../lib/resumeInspection";
import { Badge, Card, colors } from "../../components/ui";

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
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(dayKey(today));
  const [localRows, setLocalRows] = useState<LocalInspectionListItem[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

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

  const appointmentsQuery = useQuery({
    queryKey: ["schedule", user?.id, selectedDay],
    queryFn: () => getTechnicianSchedule(user!.id, selectedDay),
    enabled: !!user,
    retry: false,
  });

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
    return map;
  }, [inspections]);

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
    return { completed, pending };
  }, [inspections, month]);

  const selectedInspections = inspections
    .filter((i) => i.day === selectedDay)
    .sort((a, b) => a.when.getTime() - b.when.getTime());
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

      <Text style={styles.heading}>
        {isToday ? "Today · " : ""}
        {selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
      </Text>
      {openError ? <Text style={styles.error}>{openError}</Text> : null}

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

      {(appointmentsQuery.data ?? []).map((item) => (
        <Card key={item.id} style={styles.card}>
          <View style={styles.rowTop}>
            <Text style={styles.time}>
              {new Date(item.scheduledStart).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </Text>
            <Badge label={item.type.replace(/_/g, " ")} />
          </View>
          <Text style={styles.customer}>{item.customer.name}</Text>
          <Text style={styles.meta}>
            {item.property.addressLine1}, {item.property.city}
          </Text>
        </Card>
      ))}

      {selectedInspections.length === 0 && (appointmentsQuery.data ?? []).length === 0 ? (
        <Text style={styles.empty}>Nothing scheduled or inspected on this day.</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
});
