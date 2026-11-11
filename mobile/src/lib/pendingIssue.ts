// An issue being added from the checklist, between "Add to site map" on the item
// and the person tapping where it is on the map. It lives here (not in the
// screen's navigation params) because it carries a photo, which can be large.
export interface PendingIssue {
  inspectionId: string;
  responseId: string;
  description: string;
  photoUri: string;
}

let pending: PendingIssue | null = null;

export function setPendingIssue(issue: PendingIssue): void {
  pending = issue;
}

export function getPendingIssue(inspectionId: string, responseId?: string): PendingIssue | null {
  if (!pending || pending.inspectionId !== inspectionId) return null;
  if (responseId && pending.responseId !== responseId) return null;
  return pending;
}

export function clearPendingIssue(): void {
  pending = null;
}
