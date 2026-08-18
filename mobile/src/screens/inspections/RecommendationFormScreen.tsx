import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RecommendationOwnerType, RecommendationPriority } from "@pest-app/shared";
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { addLocalRecommendation } from "../../db/inspectionStore";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { SegmentedControl } from "../../components/ChipMultiSelect";
import { Field, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "RecommendationForm">;

const PRIORITY_OPTIONS = [RecommendationPriority.LOW, RecommendationPriority.MEDIUM, RecommendationPriority.HIGH, RecommendationPriority.URGENT];
const OWNER_OPTIONS = [RecommendationOwnerType.CUSTOMER, RecommendationOwnerType.TECHNICIAN, RecommendationOwnerType.THIRD_PARTY];

export default function RecommendationFormScreen({ route, navigation }: Props) {
  const { inspectionId } = route.params;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>(RecommendationPriority.MEDIUM);
  const [ownerType, setOwnerType] = useState<string>(RecommendationOwnerType.CUSTOMER);
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    const deadlineIso = deadline.trim() ? new Date(`${deadline.trim()}T00:00:00.000Z`).toISOString() : null;
    if (deadline.trim() && Number.isNaN(new Date(deadlineIso!).getTime())) {
      setError("Deadline must be in YYYY-MM-DD format");
      return;
    }
    addLocalRecommendation(inspectionId, {
      findingId: null,
      title: title.trim(),
      description: description.trim() || null,
      priority,
      ownerType,
      deadline: deadlineIso,
    });
    navigation.goBack();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Fix under-sink leak" />
      <Field label="Description" value={description} onChangeText={setDescription} multiline numberOfLines={3} />
      <SegmentedControl label="Priority" options={PRIORITY_OPTIONS} value={priority} onChange={setPriority} />
      <SegmentedControl label="Owner" options={OWNER_OPTIONS} value={ownerType} onChange={setOwnerType} />
      <Field label="Deadline (YYYY-MM-DD, optional)" value={deadline} onChangeText={setDeadline} placeholder="2026-09-01" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton title="Save recommendation" onPress={handleSave} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  error: { color: colors.danger, marginBottom: 12, textAlign: "center" },
});
