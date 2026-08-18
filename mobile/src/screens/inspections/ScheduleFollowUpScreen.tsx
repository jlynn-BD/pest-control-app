import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { scheduleFollowUp } from "../../api/followups";
import { ApiError } from "../../api/client";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { Field, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "ScheduleFollowUp">;

export default function ScheduleFollowUpScreen({ route, navigation }: Props) {
  const { inspectionId } = route.params;
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const iso = scheduledDate.trim() ? new Date(`${scheduledDate.trim()}T00:00:00.000Z`).toISOString() : undefined;
      if (scheduledDate.trim() && iso && Number.isNaN(new Date(iso).getTime())) {
        throw new Error("Scheduled date must be in YYYY-MM-DD format");
      }
      return scheduleFollowUp(inspectionId, { reason: reason.trim() || undefined, scheduledDate: iso });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["followups"] });
      navigation.goBack();
    },
    onError: (err) => setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to schedule follow-up"),
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Field label="Reason" value={reason} onChangeText={setReason} placeholder="e.g. Verify roach activity resolved" multiline numberOfLines={3} />
      <Field label="Scheduled date (YYYY-MM-DD, optional)" value={scheduledDate} onChangeText={setScheduledDate} placeholder="2026-09-10" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton title="Schedule follow-up" onPress={() => mutation.mutate()} loading={mutation.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  error: { color: colors.danger, marginBottom: 12, textAlign: "center" },
});
