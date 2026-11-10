import { CarriedIssues, carriedIssueItemIds } from "@pest-app/shared";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { LocalChecklistResponse } from "../db/types";
import { decideStandaloneIssue } from "../lib/followUp";
import { ChoiceButton } from "./ChecklistPanel";
import { Badge, Card, PrimaryButton, colors, fonts } from "./ui";

// Top of a follow-up inspection's page: which inspection it follows, how many
// of that inspection's issues have been answered, a way to look at the
// original, and the earlier issues that weren't under a checklist item (those
// are answered right here; the checklist ones are answered on their checklist
// rows, where the issue is).
export function FollowUpCard({
  carried,
  inspectionId,
  responses,
  onChange,
  onViewPrevious,
}: {
  carried: CarriedIssues;
  inspectionId: string;
  responses: LocalChecklistResponse[];
  onChange: () => void;
  onViewPrevious: () => void;
}) {
  const itemIds = carriedIssueItemIds(carried);
  const answeredItems = itemIds.filter((id) => responses.some((r) => r.templateItemId === id)).length;
  const answeredOther = carried.standalone.filter((s) => s.decision !== null).length;
  const total = itemIds.length + carried.standalone.length;
  const answered = answeredItems + answeredOther;
  const date = carried.sourceDate ? new Date(carried.sourceDate).toLocaleDateString() : "an earlier date";

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Follow-up inspection</Text>
        {total > 0 ? <Badge label={`${answered}/${total} issues`} tone={answered === total ? "success" : "warning"} /> : null}
      </View>
      <Text style={styles.meta}>
        Based on the inspection of {date}.{" "}
        {total > 0
          ? "For each issue found then, say whether it is still present or has been resolved - checklist issues are answered in the checklist."
          : "No issues were found then, so go through the checklist as usual."}
      </Text>
      <PrimaryButton title="View the previous inspection" onPress={onViewPrevious} />

      {carried.standalone.length > 0 ? <Text style={styles.subTitle}>Other issues from last time</Text> : null}
      {carried.standalone.map((s) => (
        <View key={s.id} style={styles.issue}>
          <Text style={styles.issueTitle}>
            {s.areaLocation}
            {s.locationDetail ? ` - ${s.locationDetail}` : ""} ({s.severity.toLowerCase()})
          </Text>
          {s.description ? <Text style={styles.meta}>{s.description}</Text> : null}
          <ChoiceButton
            label="This issue is still present"
            checked={s.decision === "STILL_PRESENT"}
            tone="issue"
            onPress={() => {
              decideStandaloneIssue(inspectionId, s.id, "STILL_PRESENT");
              onChange();
            }}
          />
          <ChoiceButton
            label="This issue has been resolved"
            checked={s.decision === "RESOLVED"}
            tone="ok"
            onPress={() => {
              decideStandaloneIssue(inspectionId, s.id, "RESOLVED");
              onChange();
            }}
          />
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 12, gap: 8 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontFamily: fonts.display, fontSize: 15, fontWeight: "700", color: colors.text },
  subTitle: { fontFamily: fonts.display, fontSize: 14, fontWeight: "700", color: colors.text, marginTop: 6 },
  meta: { fontSize: 13, color: colors.textMuted },
  issue: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  issueTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
});
