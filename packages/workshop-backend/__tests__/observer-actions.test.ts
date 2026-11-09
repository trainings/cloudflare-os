import { describe, expect, it } from "vitest";
import { agentViewerProfileId } from "../src/observer-actions";

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
