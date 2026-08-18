import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { getFollowUp, updateFollowUp } from "../../api/followups";
import { FollowUpsStackParamList } from "../../navigation/navigationTypes";
import { Badge, Card, ErrorView, LoadingView, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<FollowUpsStackParamList, "FollowUpDetail">;

const CORRECTIVE_ACTION_TONE: Record<string, "default" | "warning" | "success" | "danger"> = {
  PENDING: "warning",
  VERIFIED: "success",
  FAILED: "danger",
  NOT_APPLICABLE: "default",
};

export default function FollowUpDetailScreen({ route }: Props) {
  const { followUpId } = route.params;
  const queryClient = useQueryClient();

  const { data: followUp, isLoading, isError } = useQuery({
    queryKey: ["followups", followUpId],
    queryFn: () => getFollowUp(followUpId),
  });

  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof updateFollowUp>[1]) => updateFollowUp(followUpId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["followups"] });
    },
  });

  if (isLoading) return <LoadingView />;
  if (isError || !followUp) return <ErrorView message="Failed to load follow-up" />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{followUp.inspection.customer.name}</Text>
        <Badge label={followUp.status} tone={followUp.status === "COMPLETED" ? "success" : "default"} />
      </View>
      <Text style={styles.meta}>{followUp.inspection.property.addressLine1}</Text>
      {followUp.reason ? <Text style={styles.body}>{followUp.reason}</Text> : null}
      {followUp.scheduledDate ? (
        <Text style={styles.meta}>Scheduled {new Date(followUp.scheduledDate).toLocaleDateString()}</Text>
      ) : null}

      <Text style={styles.sectionTitle}>Corrective action</Text>
      <Card style={styles.card}>
        <Badge label={followUp.correctiveActionStatus} tone={CORRECTIVE_ACTION_TONE[followUp.correctiveActionStatus] ?? "default"} />
        <View style={styles.buttonRow}>
          <View style={styles.buttonHalf}>
            <PrimaryButton
              title="Mark verified"
              onPress={() => mutation.mutate({ correctiveActionStatus: "VERIFIED" })}
              loading={mutation.isPending}
            />
          </View>
          <View style={styles.buttonHalf}>
            <PrimaryButton
              title="Mark failed"
              onPress={() => mutation.mutate({ correctiveActionStatus: "FAILED" })}
              loading={mutation.isPending}
            />
          </View>
        </View>
      </Card>

      {followUp.status !== "COMPLETED" ? (
        <PrimaryButton
          title="Mark follow-up completed"
          onPress={() => mutation.mutate({ status: "COMPLETED" })}
          loading={mutation.isPending}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 4 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  body: { fontSize: 14, color: colors.text, marginTop: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 18, marginBottom: 8 },
  card: { gap: 10, marginBottom: 16 },
  buttonRow: { flexDirection: "row", gap: 10 },
  buttonHalf: { flex: 1 },
});
