import { describe, expect, it } from "vitest";
import {
  agentViewerProfileId,
  assertWorkspaceClientMayResolve,
  isObserverAction,
  isVisibleToWorkspaceClient,
} from "../src/observer-actions";

describe("observer actions", () => {
  it("identifies actions submitted from a collaborator's runtime", () => {
    expect(isObserverAction({observerProfileId: "bob"})).toBe(true);
    expect(isObserverAction({})).toBe(false);
  });

  it("shows workspace actions to everyone and observer actions only to their author", () => {
    expect(isVisibleToWorkspaceClient({}, "owner")).toBe(true);
    expect(isVisibleToWorkspaceClient({}, "bob")).toBe(true);
    expect(isVisibleToWorkspaceClient({observerProfileId: "bob"}, "bob")).toBe(true);
    expect(isVisibleToWorkspaceClient({observerProfileId: "bob"}, "owner")).toBe(false);
    expect(isVisibleToWorkspaceClient({observerProfileId: "bob"}, "carol")).toBe(false);
  });

  it("refuses to let another workspace client resolve a collaborator's action", () => {
    expect(() => assertWorkspaceClientMayResolve({id: 7, observerProfileId: "bob"}, "owner"))
        .toThrow(/collaborator's own session/);
    expect(() => assertWorkspaceClientMayResolve({id: 7, observerProfileId: "bob"}, "carol"))
        .toThrow(/collaborator's own session/);
  });

  it("lets a workspace client resolve workspace actions and its own", () => {
    expect(() => assertWorkspaceClientMayResolve({id: 8}, "owner")).not.toThrow();
    expect(() => assertWorkspaceClientMayResolve({id: 9, observerProfileId: "bob"}, "bob"))
        .not.toThrow();
  });
});

describe("agentViewerProfileId", () => {
  it("uses the triggering user's profile for user-started runs", () => {
    expect(agentViewerProfileId({type: "user", id: "bob"})).toBe("bob");
  });

  it("uses the triggering user's profile for Gadget-started runs", () => {
    expect(agentViewerProfileId({type: "gadget", id: "bob"})).toBe("bob");
  });

  it("has no viewer for AI-authored turns", () => {
    expect(agentViewerProfileId({type: "agent", id: "gpt"})).toBeUndefined();
  });
});
