// Policy helpers for actions submitted through a collaborator's own observer-backed Gadget runtime.
// Such an action executes with that collaborator's connected account, so only that collaborator may
// see or resolve it; the workspace-wide action log must not expose it to anyone else.

/** True when the action was submitted by a collaborator's user-scoped runtime. */
export function isObserverAction(record: {observerProfileId?: string}): boolean {
  return record.observerProfileId !== undefined;
}

/**
 * Whether a workspace-level (owner or build) client may see an action. Workspace actions are
 * visible to every such client; a collaborator's observer actions are visible only to that
 * collaborator, never to the owner or to other build collaborators.
 */
export function isVisibleToWorkspaceClient(
    record: {observerProfileId?: string}, clientProfileId: string): boolean {
  return record.observerProfileId === undefined || record.observerProfileId === clientProfileId;
}

/**
 * Throws if a workspace-level (owner or build) client tries to resolve someone else's observer
 * action. Approving it would apply the write with the collaborator's credentials on another
 * person's decision.
 */
export function assertWorkspaceClientMayResolve(
    record: {id: number, observerProfileId?: string}, clientProfileId: string): void {
  if (!isVisibleToWorkspaceClient(record, clientProfileId)) {
    throw new Error(
        `Action ${record.id} belongs to a collaborator's own session and must be resolved there.`);
  }
}

/**
 * The profile whose isolated runtime and connected accounts an agent run must use, or undefined for
 * the workspace's own identity. A Gadget-started run (`type: "gadget"`) carries the triggering
 * user's profile id, set server-side, so it must resolve accounts exactly as that user's own run.
 */
export function agentViewerProfileId(
    initiator: {type: "user" | "agent" | "gadget", id: string}): string | undefined {
  return initiator.type === "user" || initiator.type === "gadget" ? initiator.id : undefined;
}
