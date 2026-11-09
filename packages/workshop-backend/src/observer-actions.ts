// Which collaborator an agent run acts for: the isolated Gadget runtime and connected accounts a
// run must use are those of the user who started it, never the workspace owner's.

/**
 * The profile whose isolated runtime and connected accounts an agent run must use, or undefined for
 * the workspace's own identity. A Gadget-started run (`type: "gadget"`) carries the triggering
 * user's profile id, set server-side, so it must resolve accounts exactly as that user's own run.
 */
export function agentViewerProfileId(
    initiator: {type: "user" | "agent" | "gadget", id: string}): string | undefined {
  return initiator.type === "user" || initiator.type === "gadget" ? initiator.id : undefined;
}
