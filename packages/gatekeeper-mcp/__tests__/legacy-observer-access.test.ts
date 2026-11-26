import { describe, expect, it, vi } from "vitest";

// `cloudflare:workers` exists only inside workerd; the base classes are enough to construct the
// facet with a fake `ctx`.
vi.mock("cloudflare:workers", () => {
  class Base { constructor(readonly ctx: unknown, readonly env: unknown) {} }
  return { DurableObject: Base, WorkerEntrypoint: Base, RpcTarget: class {}, RpcStub: class {} };
});
vi.mock("capnweb-validate", () => ({
  validateRpc: () => (value: unknown) => value,
  skipRpcValidation: () => (value: unknown) => value,
}));

import { McpGatekeeperImpl } from "../src/mcp.js";

// Workspaces that recorded `server/<serverId>` before reads stopped reporting subresources still
// carry it as a requirement, and the Workshop asks the binding about it on every admission.
describe("verifyObserverAccess for requirements recorded by older reads", () => {
  function facet(admitted: string[]) {
    const kv = { get: vi.fn((key: string) => admitted.some(id => key === `viewer-observer:${id}`)
      ? true : undefined), put: vi.fn(), delete: vi.fn(), list: vi.fn() };
    return new McpGatekeeperImpl(
      { props: { serverId: "linear", endpoint: "https://mcp.linear.app/mcp" },
        storage: { kv } } as never,
      {} as never);
  }
  const who = (id: string) => ({ id, verifier: {} as never });

  it("admits only collaborators admitted to a runtime of their own", async () => {
    await expect(facet(["viewer"]).verifyObserverAccess(
        [who("viewer"), who("stranger")], ["server/linear"]))
      .resolves.toEqual({ allowedObserverIds: ["viewer"] });
  });

  it("admits nobody when no collaborator was admitted that way", async () => {
    await expect(facet([]).verifyObserverAccess([who("someone")], ["server/linear"]))
      .resolves.toEqual({ allowedObserverIds: [] });
  });

  it("fails the whole call for an ID this binding never reported", async () => {
    await expect(facet(["viewer"]).verifyObserverAccess([who("viewer")], ["server/github"]))
      .rejects.toThrow(/different MCP server/);
    await expect(facet(["viewer"]).verifyObserverAccess([who("viewer")], ["workspace/linear"]))
      .rejects.toThrow(/Not an MCP server/);
  });
});
