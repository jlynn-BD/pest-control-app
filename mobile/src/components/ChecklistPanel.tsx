import { useFocusEffect } from "@react-navigation/native";
import { Severity } from "@pest-app/shared";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { deleteChecklistResponse } from "../api/inspections";
import { getCachedTemplateSections } from "../db/cache";
import {
  addLocalChecklistResponsePhoto,
  deleteLocalChecklistResponsePhoto,
  addLocalFinding,
  addLocalFindingPhoto,
  deleteLocalChecklistResponse,
  getLocalInspectionDetail,
  upsertLocalChecklistResponse,
} from "../db/inspectionStore";
import type { LocalChecklistResponse, LocalChecklistResponsePhoto, LocalFinding, LocalFindingPhoto, LocalTemplateItem } from "../db/types";
import { CHECKLIST_CATEGORY_DISPLAY_ORDER, CHECKLIST_CATEGORY_LABEL } from "../lib/checklist";
import { capturePhoto, pickPhotosFromLibrary } from "../lib/photo";
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
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [confirmingCheckAll, setConfirmingCheckAll] = useState<string | null>(null);
  // The item the technician is working on. An "Issues" item with notes or
  // photos folds shut once they move on to a different item.
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const detail = getLocalInspectionDetail(inspectionId);
      setResponses(detail?.checklistResponses ?? []);
      setFindings(detail?.findings ?? []);
      setTemplateId(detail?.inspection.templateId ?? null);
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

  function handleUncheck(item: LocalTemplateItem) {
    const existing = responseByItem.get(item.id);
    if (!existing) return;
    deleteLocalChecklistResponse(existing.id);
    setResponses((prev) => prev.filter((r) => r.templateItemId !== item.id));
    deleteChecklistResponse(inspectionId, existing.id).catch(() => {});
    onChange?.();
  }

  function handleNotesChange(item: LocalTemplateItem, notes: string | null) {
    const existing = responseByItem.get(item.id);
    if (!existing) return;
    const response = upsertLocalChecklistResponse(inspectionId, item.id, existing.status, notes);
    setResponses((prev) => [...prev.filter((r) => r.templateItemId !== item.id), { ...response, photos: existing.photos }]);
    onChange?.();
  }

  function commitResponse(item: LocalTemplateItem, notes: string | null): ResponseWithPhotos {
    const existing = responseByItem.get(item.id);
    const status = existing?.status ?? "SATISFACTORY";
    const updated = upsertLocalChecklistResponse(inspectionId, item.id, status, notes);
    const response = { ...updated, photos: existing?.photos ?? [] };
    setResponses((prev) => [...prev.filter((r) => r.templateItemId !== item.id), response]);
    onChange?.();
    return response;
  }

  // Adds one picture from the camera, or any number chosen from the photo library.
  async function handleAddPhoto(item: LocalTemplateItem, notes: string | null, source: "camera" | "library") {
    const uris = source === "camera" ? [await capturePhoto()].filter((u): u is string => Boolean(u)) : await pickPhotosFromLibrary();
    if (uris.length === 0) return;
    const response = commitResponse(item, notes);
    const added = uris.map((uri, i) => addLocalChecklistResponsePhoto(response.id, { localUri: uri, caption: null, sortOrder: response.photos.length + i }));
    setResponses((prev) => [
      ...prev.filter((r) => r.templateItemId !== item.id),
      { ...response, photos: [...response.photos, ...added] },
    ]);
  }

  // Deletes one photo from a checklist item, leaving the item and its other photos alone.
  function handleDeletePhoto(item: LocalTemplateItem, photoId: string) {
    deleteLocalChecklistResponsePhoto(photoId);
    setResponses((prev) => prev.map((r) => (r.templateItemId === item.id ? { ...r, photos: r.photos.filter((p) => p.id !== photoId) } : r)));
    onChange?.();
  }

  // Another issue under the same checklist item, typed right here: its own
  // description, severity and photos, no trip to the site map or the finding
  // form. It's a regular finding linked to this checklist answer, so it shows
  // in the inspection's findings, the report and the "Issue N" list below.
  function handleAddIssue(item: LocalTemplateItem, notes: string | null, issue: { description: string; severity: string; photos: string[] }) {
    const response = commitResponse(item, notes);
    const finding = addLocalFinding(inspectionId, {
      areaLocation: item.prompt,
      locationDetail: null,
      severity: issue.severity,
      description: issue.description.trim() || null,
      lat: null,
      lng: null,
      checklistResponseId: response.id,
    });
    issue.photos.forEach((uri, index) => {
      addLocalFindingPhoto(finding.id, { localUri: uri, caption: null, lat: null, lng: null, sortOrder: index });
    });
    setFindings(getLocalInspectionDetail(inspectionId)?.findings ?? []);
  }

  function handleAddToSiteMap(item: LocalTemplateItem, notes: string | null) {
    const response = commitResponse(item, notes);
    onAddToSiteMap(response.id);
  }

  function handleCheckAllInCategory(items: LocalTemplateItem[]) {
    const unanswered = items.filter((i) => !responseByItem.has(i.id));
    const newResponses = unanswered.map((item) => ({
      ...upsertLocalChecklistResponse(inspectionId, item.id, "SATISFACTORY", null),
      photos: [] as LocalChecklistResponsePhoto[],
    }));
    setResponses((prev) => [...prev, ...newResponses]);
    setConfirmingCheckAll(null);
    onChange?.();
  }

  if (!templateId) {
    return <Text style={styles.emptyText}>This inspection has no template assigned, so there's no checklist to fill out.</Text>;
  }

  const visibleCategories = CHECKLIST_CATEGORY_DISPLAY_ORDER.filter((c) => sectionsByCategory.has(c));
  let anyMatches = false;

  // Unanswered items the technician can currently see in a category (a
  // search narrows this, so "check all" never touches hidden items).
  function visibleUnchecked(category: string): LocalTemplateItem[] {
    return (sectionsByCategory.get(category) ?? [])
      .flatMap((section) => (isSearching ? section.items.filter((i) => itemMatches(i, section, category)) : section.items))
      .filter((i) => !responseByItem.has(i.id));
  }

  // The bulk "check all" control with its inline confirm step - see
  // handleCheckAllInCategory. Rendered once at the very top when the panel
  // is scoped to a single category (the wizard step), otherwise under each
  // category.
  function renderCheckAll(category: string, items: LocalTemplateItem[], atTop: boolean) {
    if (items.length === 0) return null;
    const spacing = atTop ? styles.checkAllTop : null;
    return confirmingCheckAll === category ? (
      <View style={[styles.checkAllConfirmRow, spacing]}>
        <Text style={styles.checkAllConfirmText}>
          Mark {items.length} item{items.length === 1 ? "" : "s"} satisfactory?
        </Text>
        <Text style={styles.checkAllConfirmAction} onPress={() => handleCheckAllInCategory(items)}>
          Confirm
        </Text>
        <Text style={styles.checkAllCancelAction} onPress={() => setConfirmingCheckAll(null)}>
          Cancel
        </Text>
      </View>
    ) : (
      <Text style={[styles.checkAllLink, spacing]} onPress={() => setConfirmingCheckAll(category)}>
        ✓ Check all as satisfactory ({items.length} remaining)
      </Text>
    );
  }

  return (
    <View>
      {categoryFilter ? renderCheckAll(categoryFilter, visibleUnchecked(categoryFilter), true) : null}
      <Field label="" placeholder="Search checklist (e.g. door, weep hole, foundation)" value={search} onChangeText={setSearch} />

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
        const visibleUncheckedItems = visibleSections
          .flatMap(({ items }) => items)
          .filter((i) => !responseByItem.has(i.id));

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
                                active={activeItemId === item.id}
                                onActivate={() => setActiveItemId(item.id)}
                                notes={response?.notes ?? null}
                                photos={response?.photos ?? []}
                                issues={response ? issuesByResponse.get(response.id) ?? [] : []}
                                onChoose={(status, notes) => handleSetStatus(item, status, notes)}
                                onUncheck={() => handleUncheck(item)}
                                onNotesChange={(notes) => handleNotesChange(item, notes)}
                                onAddPhoto={(notes, source) => handleAddPhoto(item, notes, source)}
                                onDeletePhoto={(photoId) => handleDeletePhoto(item, photoId)}
                                onAddToSiteMap={(notes) => handleAddToSiteMap(item, notes)}
                                onAddIssue={(notes, issue) => handleAddIssue(item, notes, issue)}
                                onEditFinding={onEditFinding}
                              />
                            );
                          })
                        : null}
                    </View>
                  );
                })
              : null}
            {!categoryFilter && categoryExpanded ? renderCheckAll(category, visibleUncheckedItems, false) : null}
          </View>
        );
      })}
      {sections.length === 0 ? <Text style={styles.emptyText}>This template has no checklist items.</Text> : null}
      {isSearching && !anyMatches ? <Text style={styles.emptyText}>No checklist items match "{search.trim()}".</Text> : null}
    </View>
  );
}

// One tap per item for the normal case. "No visible issues" records a
// satisfactory answer and that's it - the technician just moves to the next
// item. "Issues" records a needs-attention answer and opens the details
// (notes, photo, add to site map) right there, no extra taps to reveal them.
// Tapping the chosen option again clears the answer.
function ChecklistItemRow({
  item,
  status,
  active,
  onActivate,
  notes,
  photos,
  issues,
  onChoose,
  onUncheck,
  onNotesChange,
  onAddPhoto,
  onDeletePhoto,
  onAddToSiteMap,
  onAddIssue,
  onEditFinding,
}: {
  item: LocalTemplateItem;
  status: string | null;
  active: boolean;
  onActivate: () => void;
  notes: string | null;
  photos: LocalChecklistResponsePhoto[];
  // Every issue (Finding) already raised from this item - Matt's ask: three
  // separate foundation cracks shouldn't have to be combined into one
  // description, so each gets listed here on its own with its own
  // description/photos/site-map marker, instead of only the one shared
  // Notes field above being able to describe a single issue at a time.
  issues: FindingWithPhotos[];
  onChoose: (status: "SATISFACTORY" | "NEEDS_ATTENTION", notes: string | null) => void;
  onUncheck: () => void;
  onNotesChange: (notes: string | null) => void;
  onAddPhoto: (notes: string | null, source: "camera" | "library") => void;
  // Removes just this one photo (the others on the item stay).
  onDeletePhoto: (photoId: string) => void;
  onAddToSiteMap: (notes: string | null) => void;
  onAddIssue: (notes: string | null, issue: { description: string; severity: string; photos: string[] }) => void;
  onEditFinding: (findingId: string) => void;
}) {
  // The inline "add another issue" mini-form.
  const [addingIssue, setAddingIssue] = useState(false);
  const [issueText, setIssueText] = useState("");
  const [issueSeverity, setIssueSeverity] = useState<string>(Severity.MEDIUM);
  const [issuePhotos, setIssuePhotos] = useState<string[]>([]);
  const [localNotes, setLocalNotes] = useState(notes ?? "");
  const hasIssue = status === "NEEDS_ATTENTION";
  const hasDetails = !!(notes && notes.trim()) || photos.length > 0;
  // Open while it's being filled in; once notes/photos exist and the
  // technician has moved on, fold down to a one-line summary.
  const detailsOpen = hasIssue && (active || !hasDetails);

  // Some phone browsers don't fire the field's "lost focus" event when a
  // button elsewhere is tapped, so save any typed note the moment the
  // technician moves on to another item instead of relying on that.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active && hasIssue && (localNotes.trim() || null) !== ((notes ?? "").trim() || null)) {
      onNotesChange(localNotes.trim() || null);
    }
    wasActive.current = active;
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(next: "SATISFACTORY" | "NEEDS_ATTENTION") {
    onActivate();
    if (status === next) onUncheck();
    else onChoose(next, localNotes.trim() || null);
  }

  return (
    <Card style={[styles.itemCard, hasIssue && styles.itemCardIssue]}>
      <Text style={styles.itemPrompt}>
        {item.prompt}
        {item.required ? " *" : ""}
      </Text>
      <View style={styles.choiceRow}>
        <ChoiceButton label="No visible issues" checked={status === "SATISFACTORY"} tone="ok" onPress={() => choose("SATISFACTORY")} />
        <ChoiceButton label="Issues" checked={hasIssue} tone="issue" onPress={() => choose("NEEDS_ATTENTION")} />
      </View>
      {hasIssue && !detailsOpen ? (
        <View>
          <View style={styles.issueSummary}>
            <Text style={styles.issueSummaryText} numberOfLines={2}>
              {notes && notes.trim() ? notes.trim() : "Photo added"}
              {photos.length > 0 ? `  ·  ${photos.length} photo${photos.length === 1 ? "" : "s"}` : ""}
            </Text>
            <Text style={styles.addPhotoLink} onPress={onActivate}>
              Edit
            </Text>
          </View>
          {/* The photos are right there on the item (tap one to see it full
              size, e.g. to show the customer) - no need to open Edit first. */}
          {photos.length > 0 ? (
            <View style={styles.summaryPhotos}>
              {photos.map((p) => (
                <PhotoThumb key={p.id} uri={p.localUri} style={styles.summaryThumb} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {hasIssue && issues.length > 0 ? (
        <View style={styles.issueListBlock}>
          {issues.map((issue, index) => (
            <View key={issue.id} style={styles.issueListRow}>
              <View style={styles.issueListText}>
                <Text style={styles.issueListTitle}>Issue {index + 1}</Text>
                <Text style={styles.issueListDescription} numberOfLines={2}>
                  {issue.description?.trim() || issue.areaLocation}
                  {issue.photos.length > 0 ? `  ·  ${issue.photos.length} photo${issue.photos.length === 1 ? "" : "s"}` : ""}
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
      {hasIssue && !addingIssue ? (
        <View style={styles.issueActionRow}>
          <Text
            style={styles.addAnotherIssueLink}
            onPress={() => {
              onActivate();
              setAddingIssue(true);
            }}
          >
            + Add another issue
          </Text>
          <Text
            style={styles.addAnotherIssueLink}
            onPress={() => {
              onActivate();
              onAddToSiteMap(localNotes.trim() || null);
            }}
          >
            {issues.length > 0 ? "📍 Another on site map" : "📍 Add to Site Map"}
          </Text>
        </View>
      ) : null}
      {hasIssue && addingIssue ? (
        <View style={styles.newIssueBox}>
          <Text style={styles.issueListTitle}>New issue</Text>
          <Field label="Describe the issue" placeholder="What did you find?" value={issueText} onChangeText={setIssueText} multiline />
          <View style={styles.severityRow}>
            {[Severity.LOW, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL].map((sev) => (
              <Pressable
                key={sev}
                onPress={() => setIssueSeverity(sev)}
                style={[styles.severityChip, issueSeverity === sev && styles.severityChipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: issueSeverity === sev }}
              >
                <Text style={[styles.severityText, issueSeverity === sev && styles.severityTextOn]}>{String(sev).charAt(0) + String(sev).slice(1).toLowerCase()}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.photoRow}>
            {issuePhotos.map((uri) => (
              <PhotoThumb key={uri} uri={uri} style={styles.photoThumb} onDelete={() => setIssuePhotos((prev) => prev.filter((u) => u !== uri))} />
            ))}
            <Text
              style={styles.addPhotoLink}
              onPress={async () => {
                const uri = await capturePhoto();
                if (uri) setIssuePhotos((prev) => [...prev, uri]);
              }}
            >
              📷 Take photo
            </Text>
            <Text
              style={styles.addPhotoLink}
              onPress={async () => {
                const uris = await pickPhotosFromLibrary();
                if (uris.length > 0) setIssuePhotos((prev) => [...prev, ...uris]);
              }}
            >
              🖼 From library
            </Text>
          </View>
          <View style={styles.newIssueButtons}>
            <View style={styles.newIssueButtonHalf}>
              <PrimaryButton
                title="Save issue"
                disabled={!issueText.trim() && issuePhotos.length === 0}
                onPress={() => {
                  onAddIssue(localNotes.trim() || null, { description: issueText, severity: issueSeverity, photos: issuePhotos });
                  setIssueText("");
                  setIssuePhotos([]);
                  setIssueSeverity(Severity.MEDIUM);
                  setAddingIssue(false);
                }}
              />
            </View>
            <View style={styles.newIssueButtonHalf}>
              <PrimaryButton title="Cancel" onPress={() => { setAddingIssue(false); setIssueText(""); setIssuePhotos([]); }} />
            </View>
          </View>
        </View>
      ) : null}
      {detailsOpen ? (
        <View style={styles.issueDetails}>
          <Field
            label="Notes"
            placeholder="Describe the issue"
            value={localNotes}
            onChangeText={setLocalNotes}
            onBlur={() => onNotesChange(localNotes.trim() || null)}
          />
          <View style={styles.photoRow}>
            {photos.map((p) => (
              <PhotoThumb key={p.id} uri={p.localUri} style={styles.photoThumb} onDelete={() => onDeletePhoto(p.id)} />
            ))}
            <Text
              style={styles.addPhotoLink}
              onPress={() => {
                onActivate();
                onAddPhoto(localNotes.trim() || null, "camera");
              }}
            >
              📷 Take photo
            </Text>
            <Text
              style={styles.addPhotoLink}
              onPress={() => {
                onActivate();
                onAddPhoto(localNotes.trim() || null, "library");
              }}
            >
              🖼 From library
            </Text>
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function ChoiceButton({
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
  issueDetails: { gap: 4 },
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
