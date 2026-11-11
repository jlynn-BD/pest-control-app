import { useFocusEffect } from "@react-navigation/native";
import { CarriedIssue, CarriedIssues, parseCarriedIssues } from "@pest-app/shared";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { deleteChecklistResponse } from "../api/inspections";
import { getCachedTemplateSections } from "../db/cache";
import { deleteLocalChecklistResponse, getLocalInspectionDetail, upsertLocalChecklistResponse } from "../db/inspectionStore";
import type { LocalChecklistResponse, LocalChecklistResponsePhoto, LocalFinding, LocalFindingPhoto, LocalTemplateItem } from "../db/types";
import { CHECKLIST_CATEGORY_DISPLAY_ORDER, CHECKLIST_CATEGORY_LABEL } from "../lib/checklist";
import { capturePhoto } from "../lib/photo";
import { setPendingIssue } from "../lib/pendingIssue";
import { copyCarriedItemIssues, removeItemFindings } from "../lib/followUp";
import { PhotoThumb } from "./PhotoThumb";
import { Badge, Card, Field, PrimaryButton, colors } from "./ui";

type ResponseWithPhotos = LocalChecklistResponse & { photos: LocalChecklistResponsePhoto[] };
type FindingWithPhotos = LocalFinding & { photos: LocalFindingPhoto[] };
type TemplateSection = ReturnType<typeof getCachedTemplateSections>[number];

// The actual checklist UI (search, collapsible categories/sections, items),
// factored out of ChecklistScreen so it can be rendered several ways: as
// that screen's full-page review body, embedded directly on SiteMapScreen
// (Tate's "Site Map + Checklist + Finding Editor, all in one workspace"
// ask), and one-category-at-a-time inside the mandatory checklist wizard
// (Matt's ask - see InspectionWizardScreen). `onAddToSiteMap` is the one
// behavioral difference between the navigate-away hosts and the embedded
// ones: ChecklistScreen navigates to a separate SiteMap route, while
// SiteMapScreen/the wizard (already showing the map, or driving their own
// navigation) just update state in place.
export function ChecklistPanel({
  inspectionId,
  onAddToSiteMap,
  onEditFinding,
  categoryFilter,
  hideCategoryHeader,
  allowedCategories,
  onChange,
  refreshSignal,
  topExtra,
}: {
  inspectionId: string;
  onAddToSiteMap: (responseId: string) => void;
  // Opens an already-created issue (Finding) for editing - one checklist
  // item can have several (Matt's "3 separate foundation cracks" ask, see
  // the issues list in ChecklistItemRow below), each still just a normal
  // Finding, edited the exact same way any other one is: on the site map
  // (SiteMapScreen already has its own inline editor, reused here) or, for
  // hosts with no map on screen, the standalone FindingForm route.
  onEditFinding: (findingId: string) => void;
  // Show only this one category (the wizard, scoped to its current step).
  categoryFilter?: string;
  // Skip the collapsible category header/badge row - pairs with
  // categoryFilter so a single-step view isn't wrapped in redundant chrome.
  hideCategoryHeader?: boolean;
  // Restrict which categories are visible at all (OTHER is always exempt,
  // same as before) without narrowing to just one - used by ChecklistScreen
  // and SiteMapScreen to show every category the wizard has unlocked so
  // far, so a technician can review/edit anything already reached but can't
  // answer a category out of sequence from these entry points.
  allowedCategories?: string[];
  // Shown right under the "check all as satisfactory" link, above the search
  // box and the items - for the wizard's "this property doesn't have one"
  // choice, so it is the first thing offered instead of buried below every item.
  topExtra?: React.ReactNode;
  // Fires after every response mutation (check/uncheck/notes/photo) - lets
  // a host that derives its own state from responses (the wizard's
  // step-resolved/Next-button gating) stay in sync live instead of only on
  // next focus, since this component owns its response state independently.
  onChange?: () => void;
  // Bump this (e.g. pass the inspection's own updatedAt) when a finding may
  // have been added/edited without this panel ever losing focus - only
  // needed by SiteMapScreen, which embeds this panel alongside its own
  // inline finding editor rather than navigating to a separate screen, so
  // useFocusEffect below never re-fires on its own. ChecklistScreen and the
  // wizard route to a separate SiteMap screen and back, which already
  // re-triggers useFocusEffect, so they have no need to pass this.
  refreshSignal?: string;
}) {
  const [responses, setResponses] = useState<ResponseWithPhotos[]>([]);
  const [findings, setFindings] = useState<FindingWithPhotos[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  // A follow-up inspection: what the earlier inspection found, item by item.
  const [carried, setCarried] = useState<CarriedIssues | null>(null);
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      const detail = getLocalInspectionDetail(inspectionId);
      setResponses(detail?.checklistResponses ?? []);
      setFindings(detail?.findings ?? []);
      setTemplateId(detail?.inspection.templateId ?? null);
      setCarried(parseCarriedIssues(detail?.inspection.carriedIssues));
    }, [inspectionId])
  );

  useEffect(() => {
    if (refreshSignal === undefined) return;
    const detail = getLocalInspectionDetail(inspectionId);
    setResponses(detail?.checklistResponses ?? []);
    setFindings(detail?.findings ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const responseByItem = useMemo(() => {
    const map = new Map<string, ResponseWithPhotos>();
    for (const r of responses) map.set(r.templateItemId, r);
    return map;
  }, [responses]);

  // Every issue (Finding) raised from a given checklist response, in the
  // order they were added - "Issue 1", "Issue 2", ... in ChecklistItemRow.
  const issuesByResponse = useMemo(() => {
    const map = new Map<string, FindingWithPhotos[]>();
    for (const f of findings) {
      if (!f.checklistResponseId) continue;
      const list = map.get(f.checklistResponseId) ?? [];
      list.push(f);
      map.set(f.checklistResponseId, list);
    }
    return map;
  }, [findings]);

  const sections = useMemo(() => (templateId ? getCachedTemplateSections(templateId) : []), [templateId]);

  const sectionsByCategory = useMemo(() => {
    const grouped = new Map<string, TemplateSection[]>();
    for (const section of sections) {
      if (categoryFilter) {
        if (section.category !== categoryFilter) continue;
      } else if (allowedCategories && section.category !== "OTHER" && !allowedCategories.includes(section.category)) {
        continue;
      }
      const list = grouped.get(section.category) ?? [];
      list.push(section);
      grouped.set(section.category, list);
    }
    return grouped;
  }, [sections, categoryFilter, allowedCategories]);

  const query = search.trim().toLowerCase();
  const isSearching = query.length > 0;

  function itemMatches(item: LocalTemplateItem, section: TemplateSection, category: string): boolean {
    return (
      item.prompt.toLowerCase().includes(query) ||
      section.name.toLowerCase().includes(query) ||
      (CHECKLIST_CATEGORY_LABEL[category] ?? category).toLowerCase().includes(query)
    );
  }

  function toggleCategory(category: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function toggleSection(sectionId: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function handleSetStatus(item: LocalTemplateItem, status: "SATISFACTORY" | "NEEDS_ATTENTION", notes: string | null) {
    const response = upsertLocalChecklistResponse(inspectionId, item.id, status, notes);
    const existingPhotos = responseByItem.get(item.id)?.photos ?? [];
    setResponses((prev) => [...prev.filter((r) => r.templateItemId !== item.id), { ...response, photos: existingPhotos }]);
    onChange?.();
  }

  // Follow-up inspection: the item had an issue last time. "Still present"
  // answers it Needs attention and copies last time's issues in to edit;
  // "Resolved" answers it No visible issues and leaves no issues on it.
  // Choosing the same answer again clears it.
  function handleDecide(item: LocalTemplateItem, decision: "STILL_PRESENT" | "RESOLVED", notes: string | null) {
    const existing = responseByItem.get(item.id);
    const target = decision === "STILL_PRESENT" ? "NEEDS_ATTENTION" : "SATISFACTORY";
    if (existing && existing.status === target) {
      removeItemFindings(inspectionId, existing.id);
      handleUncheck(item);
    } else if (decision === "RESOLVED") {
      if (existing) removeItemFindings(inspectionId, existing.id);
      handleSetStatus(item, "SATISFACTORY", notes);
    } else {
      const response = upsertLocalChecklistResponse(inspectionId, item.id, "NEEDS_ATTENTION", notes);
      setResponses((prev) => [...prev.filter((r) => r.templateItemId !== item.id), { ...response, photos: existing?.photos ?? [] }]);
      copyCarriedItemIssues(inspectionId, item.id, response.id);
      onChange?.();
    }
    setFindings(getLocalInspectionDetail(inspectionId)?.findings ?? []);
  }

  function handleUncheck(item: LocalTemplateItem) {
    const existing = responseByItem.get(item.id);
    if (!existing) return;
    deleteLocalChecklistResponse(existing.id);
    setResponses((prev) => prev.filter((r) => r.templateItemId !== item.id));
    deleteChecklistResponse(inspectionId, existing.id).catch(() => {});
    onChange?.();
  }

  // "Add to site map" on an issue: the description is typed and the photo taken
  // (the item row does both), then the map opens so the person can tap where it
  // is; the issue is saved there, with the photo attached to it.
  function handleAddToSiteMap(item: LocalTemplateItem, description: string, photoUri: string) {
    const response = responseByItem.get(item.id);
    if (!response) return;
    setPendingIssue({ inspectionId, responseId: response.id, description, photoUri });
    onAddToSiteMap(response.id);
  }

  if (!templateId) {
    return <Text style={styles.emptyText}>This inspection has no template assigned, so there's no checklist to fill out.</Text>;
  }

  const visibleCategories = CHECKLIST_CATEGORY_DISPLAY_ORDER.filter((c) => sectionsByCategory.has(c));
  let anyMatches = false;

  return (
    <View>
      {topExtra}
      {/* The step-by-step walk-through just takes you down the area, item by item; search is for the full list. */}
      {categoryFilter ? null : <Field label="" placeholder="Search checklist (e.g. door, weep hole, foundation)" value={search} onChangeText={setSearch} />}

      {visibleCategories.map((category) => {
        const categorySections = sectionsByCategory.get(category)!;
        const totalItems = categorySections.reduce((sum, s) => sum + s.items.length, 0);
        const checkedCount = categorySections.reduce(
          (sum, s) => sum + s.items.filter((i) => responseByItem.has(i.id)).length,
          0
        );

        const visibleSections = categorySections
          .map((section) => ({
            section,
            items: isSearching ? section.items.filter((i) => itemMatches(i, section, category)) : section.items,
          }))
          .filter(({ items }) => !isSearching || items.length > 0);

        if (isSearching && visibleSections.length === 0) return null;
        if (isSearching) anyMatches = true;

        const categoryExpanded = hideCategoryHeader || isSearching || expandedCategories.has(category);

        return (
          <View key={category} style={styles.categoryBlock}>
            {!hideCategoryHeader ? (
              <Pressable style={styles.categoryHeaderRow} onPress={() => toggleCategory(category)}>
                <Text style={styles.categoryTitle}>
                  {categoryExpanded ? "▾" : "▸"} {CHECKLIST_CATEGORY_LABEL[category] ?? category}
                </Text>
                <Badge
                  label={`${checkedCount}/${totalItems}`}
                  tone={checkedCount === totalItems && totalItems > 0 ? "success" : "default"}
                />
              </Pressable>
            ) : null}
            {categoryExpanded
              ? visibleSections.map(({ section, items }) => {
                  const sectionChecked = section.items.filter((i) => responseByItem.has(i.id)).length;
                  const sectionExpanded = isSearching || hideCategoryHeader || expandedSections.has(section.id);
                  return (
                    <View key={section.id} style={styles.sectionBlock}>
                      <Pressable
                        style={styles.sectionHeaderRow}
                        onPress={() => (hideCategoryHeader ? undefined : toggleSection(section.id))}
                        disabled={!!hideCategoryHeader}
                      >
                        <Text style={styles.sectionName}>
                          {hideCategoryHeader ? "" : sectionExpanded ? "▾ " : "▸ "}
                          {section.name}
                        </Text>
                        <Text style={styles.sectionCount}>
                          {sectionChecked}/{section.items.length}
                        </Text>
                      </Pressable>
                      {sectionExpanded
                        ? items.map((item) => {
                            const response = responseByItem.get(item.id);
                            return (
                              <ChecklistItemRow
                                key={item.id}
                                item={item}
                                status={response?.status ?? null}
                                notes={response?.notes ?? null}
                                photos={response?.photos ?? []}
                                issues={response ? issuesByResponse.get(response.id) ?? [] : []}
                                carried={
                                  carried?.responses[item.id]
                                    ? {
                                        status: carried.responses[item.id].status,
                                        notes: carried.responses[item.id].notes,
                                        issues: carried.issuesByItem[item.id] ?? [],
                                        sourceDate: carried.sourceDate,
                                      }
                                    : null
                                }
                                onDecide={(decision, notes) => handleDecide(item, decision, notes)}
                                onChoose={(status, notes) => handleSetStatus(item, status, notes)}
                                onUncheck={() => handleUncheck(item)}
                                onAddToSiteMap={(description, photoUri) => handleAddToSiteMap(item, description, photoUri)}
                                onEditFinding={onEditFinding}
                              />
                            );
                          })
                        : null}
                    </View>
                  );
                })
              : null}
          </View>
        );
      })}
      {sections.length === 0 ? <Text style={styles.emptyText}>This template has no checklist items.</Text> : null}
      {isSearching && !anyMatches ? <Text style={styles.emptyText}>No checklist items match "{search.trim()}".</Text> : null}
    </View>
  );
}

// One tap per item for the normal case: "No visible issues" records a
// satisfactory answer and that's it - on to the next item. "Issues" asks for
// two things only: say what the issue is, then "Add to site map". That takes a
// photo, then the person taps the map where it is, and the photo stays with the
// issue. An item can have several issues (the same one may turn up 3 or 4
// times); each goes in the same way. Tapping the chosen option again clears it.
function ChecklistItemRow({
  item,
  status,
  notes,
  photos,
  issues,
  carried,
  onDecide,
  onChoose,
  onUncheck,
  onAddToSiteMap,
  onEditFinding,
}: {
  item: LocalTemplateItem;
  status: string | null;
  // Older inspections kept one note and photos straight on the item; they are
  // still shown, but new issues are added through "Add to site map".
  notes: string | null;
  photos: LocalChecklistResponsePhoto[];
  // Every issue (Finding) already raised from this item, each with its own
  // description, photo and place on the site map.
  issues: FindingWithPhotos[];
  // Follow-up inspection: how this item was answered last time (null otherwise).
  carried: { status: string; notes: string | null; issues: CarriedIssue[]; sourceDate: string | null } | null;
  onDecide: (decision: "STILL_PRESENT" | "RESOLVED", notes: string | null) => void;
  onChoose: (status: "SATISFACTORY" | "NEEDS_ATTENTION", notes: string | null) => void;
  onUncheck: () => void;
  onAddToSiteMap: (description: string, photoUri: string) => void;
  onEditFinding: (findingId: string) => void;
}) {
  const [issueText, setIssueText] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasIssue = status === "NEEDS_ATTENTION";
  const legacyDetail = !!(notes && notes.trim()) || photos.length > 0;
  // Marked "Issues" but nothing says what or where: not finished yet.
  const needsIssue = hasIssue && issues.length === 0 && !legacyDetail;

  const hadIssue = carried?.status === "NEEDS_ATTENTION";
  function decide(next: "STILL_PRESENT" | "RESOLVED") {
    onDecide(next, null);
  }

  function choose(next: "SATISFACTORY" | "NEEDS_ATTENTION") {
    if (status === next) onUncheck();
    else onChoose(next, null);
  }

  async function addToMap() {
    if (busy) return;
    if (!issueText.trim()) {
      setHint("First write what the issue is.");
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      const uri = await capturePhoto();
      if (!uri) {
        setHint("A photo of the issue is needed - tap Add to site map again and take one.");
        return;
      }
      onAddToSiteMap(issueText.trim(), uri);
      setIssueText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={[styles.itemCard, hasIssue && styles.itemCardIssue]}>
      <Text style={styles.itemPrompt}>
        {item.prompt}
        {item.required ? " *" : ""}
      </Text>
      {carried ? (
        <View style={styles.carriedBox}>
          <Text style={styles.carriedTitle}>
            Last inspection{carried.sourceDate ? ` (${new Date(carried.sourceDate).toLocaleDateString()})` : ""}:{" "}
            {carried.status === "NEEDS_ATTENTION" ? "issue found" : carried.status === "SATISFACTORY" ? "no visible issues" : "not applicable"}
          </Text>
          {carried.notes && carried.notes.trim() ? <Text style={styles.carriedText}>{carried.notes.trim()}</Text> : null}
          {carried.issues.map((issue, i) => (
            <Text key={i} style={styles.carriedText}>
              • {issue.description?.trim() || issue.areaLocation}
              {issue.severity ? ` (${issue.severity.toLowerCase()})` : ""}
            </Text>
          ))}
        </View>
      ) : null}
      {hadIssue ? (
        <View style={styles.carriedChoices}>
          <ChoiceButton label="This issue is still present" checked={hasIssue} tone="issue" onPress={() => decide("STILL_PRESENT")} />
          <ChoiceButton label="This issue has been resolved" checked={status === "SATISFACTORY"} tone="ok" onPress={() => decide("RESOLVED")} />
        </View>
      ) : (
        <View style={styles.choiceRow}>
          <ChoiceButton label="No visible issues" checked={status === "SATISFACTORY"} tone="ok" onPress={() => choose("SATISFACTORY")} />
          <ChoiceButton label="Issues" checked={hasIssue} tone="issue" onPress={() => choose("NEEDS_ATTENTION")} />
        </View>
      )}
      {hasIssue && legacyDetail ? (
        <View style={styles.issueSummary}>
          <Text style={styles.issueSummaryText} numberOfLines={3}>
            {notes && notes.trim() ? notes.trim() : "Photo added"}
            {photos.length > 0 ? `  ·  ${photos.length} photo${photos.length === 1 ? "" : "s"}` : ""}
          </Text>
        </View>
      ) : null}
      {hasIssue && issues.length > 0 ? (
        <View style={styles.issueListBlock}>
          {issues.map((issue, index) => (
            <View key={issue.id} style={styles.issueListRow}>
              <View style={styles.issueListText}>
                <Text style={styles.issueListTitle}>Issue {index + 1}</Text>
                <Text style={styles.issueListDescription} numberOfLines={3}>
                  {issue.description?.trim() || issue.areaLocation}
                  {issue.siteMapArrowStartX != null ? "  ·  📍 on site map" : ""}
                </Text>
                {issue.photos.length > 0 ? (
                  <View style={styles.summaryPhotos}>
                    {issue.photos.map((p) => (
                      <PhotoThumb key={p.id} uri={p.localUri} style={styles.summaryThumb} />
                    ))}
                  </View>
                ) : null}
              </View>
              <Text style={styles.addPhotoLink} onPress={() => onEditFinding(issue.id)}>
                Edit
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {hasIssue ? (
        <View style={styles.issueDetails}>
          {needsIssue ? <Text style={styles.needsIssueText}>Write what the issue is, then add it to the site map to finish this item.</Text> : null}
          <Field
            label={issues.length > 0 || legacyDetail ? "Another issue here? Describe it" : "What is the issue?"}
            placeholder="e.g. Door sweep is worn out"
            value={issueText}
            onChangeText={(t) => {
              setIssueText(t);
              if (hint) setHint(null);
            }}
            multiline
          />
          <Text style={styles.issueNextHint}>Next you'll take a photo, then tap the map to show where it is.</Text>
          {hint ? <Text style={styles.needsIssueText}>{hint}</Text> : null}
          <PrimaryButton variant="cta" title="📍 Add to site map" onPress={addToMap} loading={busy} />
        </View>
      ) : null}
    </Card>
  );
}

export function ChoiceButton({
  label,
  checked,
  tone,
  onPress,
}: {
  label: string;
  checked: boolean;
  tone: "ok" | "issue";
  onPress: () => void;
}) {
  const accent = tone === "ok" ? colors.success : colors.danger;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={[styles.choice, checked && { borderColor: accent, backgroundColor: tone === "ok" ? "#E3F5F1" : "#FBEAE8" }]}
    >
      <View style={[styles.choiceBox, { borderColor: accent }, checked && { backgroundColor: accent }]}>
        {checked ? <Text style={styles.choiceMark}>✓</Text> : null}
      </View>
      <Text style={[styles.choiceLabel, checked && { color: accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  emptyText: { color: colors.textMuted, textAlign: "center", marginTop: 12 },
  categoryBlock: { marginBottom: 12 },
  categoryHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  categoryTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  sectionBlock: { marginBottom: 8, marginLeft: 8 },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    marginBottom: 4,
  },
  sectionName: { fontSize: 13, fontWeight: "600", color: colors.textMuted, textTransform: "uppercase" },
  sectionCount: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  itemCard: { marginBottom: 8, gap: 8 },
  itemCardIssue: { borderColor: colors.danger },
  itemPrompt: { fontSize: 15, fontWeight: "600", color: colors.text },
  choiceRow: { flexDirection: "row", gap: 10 },
  carriedChoices: { gap: 8 },
  carriedBox: { backgroundColor: colors.chip, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 10, gap: 3 },
  carriedTitle: { fontSize: 13, fontWeight: "700", color: colors.text },
  carriedText: { fontSize: 13, color: colors.textMuted },
  choice: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  choiceBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  choiceMark: { color: "#fff", fontSize: 15, fontWeight: "800", lineHeight: 16 },
  choiceLabel: { flexShrink: 1, fontSize: 14, fontWeight: "600", color: colors.text },
  issueDetails: { gap: 6 },
  needsIssueText: { fontSize: 13, color: colors.danger, fontWeight: "600" },
  issueNextHint: { fontSize: 12, color: colors.textMuted },
  issueSummary: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  issueSummaryText: { flex: 1, fontSize: 13, color: colors.textMuted },
  issueListBlock: { gap: 8, marginTop: 4 },
  issueListRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.chip,
    borderRadius: 8,
  },
  issueListText: { flex: 1 },
  issueListTitle: { fontSize: 12, fontWeight: "700", color: colors.text },
  issueListDescription: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  issueActionRow: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  newIssueBox: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, marginTop: 6, gap: 6, backgroundColor: colors.bg },
  severityRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  severityChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  severityChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  severityText: { fontSize: 12, fontWeight: "600", color: colors.text },
  severityTextOn: { color: "#fff" },
  newIssueButtons: { flexDirection: "row", gap: 10, marginTop: 4 },
  newIssueButtonHalf: { flex: 1 },
  addAnotherIssueLink: { color: colors.primaryText, fontWeight: "600", fontSize: 13, marginTop: 4, paddingVertical: 12 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 4 },
  photoThumb: { width: 56, height: 56, borderRadius: 6 },
  // Photos shown straight on the item, big enough to recognise at a glance.
  summaryPhotos: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  summaryThumb: { width: 84, height: 84, borderRadius: 8, borderWidth: 1, borderColor: "#D9E3F0" },
  addPhotoLink: { color: colors.primaryText, fontWeight: "600", fontSize: 13, paddingVertical: 12 },
  checkAllTop: { marginLeft: 0, marginTop: 0, marginBottom: 12, fontSize: 15 },
  checkAllLink: { color: colors.primaryText, fontWeight: "600", fontSize: 13, marginLeft: 8, marginTop: 4, paddingVertical: 12 },
  checkAllConfirmRow: { flexDirection: "row", alignItems: "center", gap: 12, marginLeft: 8, marginTop: 4 },
  checkAllConfirmText: { fontSize: 13, color: colors.text, flexShrink: 1 },
  checkAllConfirmAction: { color: colors.primaryText, fontWeight: "700", fontSize: 13 },
  checkAllCancelAction: { color: colors.textMuted, fontWeight: "600", fontSize: 13 },
});
