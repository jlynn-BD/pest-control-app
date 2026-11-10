import { CarriedIssues, carriedIssueItemIds } from "@pest-app/shared";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { LocalChecklistResponse } from "../db/types";
import { Badge, Card, PrimaryButton, colors, fonts } from "./ui";

// Top of a follow-up inspection's page: which inspection it follows, how many
// of that inspection's checklist issues have been answered so far, and a way to
// look at the original. The issues themselves are answered on their checklist
// rows, where they are.
export function FollowUpCard({
  carried,
  responses,
  onViewPrevious,
}: {
  carried: CarriedIssues;
  responses: LocalChecklistResponse[];
  onViewPrevious: () => void;
}) {
  const itemIds = carriedIssueItemIds(carried);
  const answered = itemIds.filter((id) => responses.some((r) => r.templateItemId === id)).length;
  const date = carried.sourceDate ? new Date(carried.sourceDate).toLocaleDateString() : "an earlier date";

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Follow-up inspection</Text>
        {itemIds.length > 0 ? <Badge label={`${answered}/${itemIds.length} issues`} tone={answered === itemIds.length ? "success" : "warning"} /> : null}
      </View>
      <Text style={styles.meta}>
        Based on the inspection of {date}.{" "}
        {itemIds.length > 0
          ? "For each issue found then, say in the checklist whether it is still present or has been resolved."
          : "No checklist issues were found then, so go through the checklist as usual."}
      </Text>
      <PrimaryButton title="View the previous inspection" onPress={onViewPrevious} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 12, gap: 8 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontFamily: fonts.display, fontSize: 15, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
});
