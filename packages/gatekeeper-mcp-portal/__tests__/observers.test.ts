// The portal facet's observer contract: reads report no subresources, because a collaborator reads
// through their own per-viewer runtime and account. `addObserver()` opens the whole workspace only
// to the account the binding reads with, and admits anyone else to run the Gadget only if their own
// account reaches the portal; `verifyObserverAccess()` checks the `server/<id>` requirements older
// reads recorded. The endpoint is faked at `withClient`, and the catalog is served from the facet's
// cache.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Connection from "@gadgets/mcp-shared/connection";
import type { ToolScope } from "@gadgets/mcp-shared/scope";

const mocks = vi.hoisted(() => ({ withClient: vi.fn() }));

vi.mock("capnweb-validate", () => ({
  validateRpc: () => (value: unknown) => value,
  skipRpcValidation: () => (value: unknown) => value,
}));

vi.mock("@gadgets/mcp-shared/connection", async importOriginal => ({
  ...await importOriginal<typeof Connection>(),
  withClient: mocks.withClient,
}));

import { McpGatekeeperImpl, McpPortalVerifier } from "../src/portal.js";

const ENDPOINT = "https://gw.example.com/mcp?tenant=a";

/** The portal's tools: its own control tool, and tools of two upstream servers. */
const CATALOG = [
  { name: "portal_list_servers", annotations: { readOnlyHint: true } },
  { name: "jira_search", description: "Search issues", annotations: { readOnlyHint: true } },
  { name: "jira_create_issue", description: "Create an issue" },
  { name: "gitlab_list", annotations: { readOnlyHint: true } },
];

/**
 * A portal facet as `getGatekeeperClassFor` mints it: the portal's own `serverId` is `portal`, the
 * upstream server is the scope's. `scopeServerName` is left out, as on bindings minted before it
 * was persisted.
 */
function portalFacet(scope: ToolScope & { serverId: string }) {
  const kv = new Map<string, unknown>([
    ["catalog", { tools: CATALOG, revision: "cached", fetchedAt: Date.now(), truncated: false }],
  ]);
  const ctx = {
    props: {
      accountObjectId: "account-id", endpoint: ENDPOINT, serverId: "portal", serverName: "CF Portal", scope,
    },
    storage: {
      kv: {
        get: (key: string) => kv.get(key),
        put: (key: string, value: unknown) => { kv.set(key, value); },
        delete: (key: string) => { kv.delete(key); },
      },
    },
    exports: { McpAccount: { idFromString: () => "account-id", get: () => ({}) } },
  };
  return new McpGatekeeperImpl(ctx as never, {} as never);
}

type Observation = { title: string; subresources?: string[] };

function recordingQueue() {
  const observations: Observation[] = [];
  return {
    observations,
    dup() { return this; },
    authorizeObservation(description: Observation) { observations.push(description); },
  };
}

/** An observer whose verifier, as `getVerifier()` mints it, stands for portal account `account`. */
const observer = (id: string, account: string) => ({
  id,
  verifier: new McpPortalVerifier({ props: { accountObjectId: account } } as never, {} as never) as never,
});

beforeEach(() => {
  mocks.withClient.mockReset();
  // The endpoint answers every call with one line of text.
  mocks.withClient.mockImplementation(async (...args: unknown[]) => {
    const fn = args[3] as (client: object) => unknown;
    return fn({
      callTool: async () => ({ content: [{ type: "text", text: "PROJ-1" }] }),
      listTools: async () => [],
    });
  });
});

describe("portal observations", () => {
  it("report no subresources on any read, since each viewer reads with their own account", async () => {
    const facet = portalFacet({ serverId: "jira" });
    const queue = recordingQueue();
    const session = await facet.startSession(queue as never);

    expect(await session.listTools()).toHaveLength(2);
    expect(await session.listTools({ name: "jira_search" })).toHaveLength(1);
    expect(await session.listTools({ name: "jira_missing" })).toEqual([]);
    expect(await session.listTools({ search: "issue" })).toHaveLength(2);
    expect(await session.callTool("jira_search", {})).toMatchObject({ status: "ok", text: "PROJ-1" });

    expect(queue.observations).toHaveLength(5);
    for (const observation of queue.observations) {
      expect(observation.subresources, observation.title).toBeUndefined();
    }
  });

  it("keep a selected-tool grant to its tools and away from the portal's own", async () => {
    const facet = portalFacet({ serverId: "jira", tools: ["jira_search"] });
    const queue = recordingQueue();
    const session = await facet.startSession(queue as never);

    expect((await session.listTools()).map(tool => tool.name)).toEqual(["jira_search"]);
    for (const name of ["jira_create_issue", "gitlab_list", "portal_list_servers"]) {
      await expect(session.callTool(name, {}), name).rejects.toThrow(/does not grant/);
    }
    expect(queue.observations.map(observation => observation.subresources)).toEqual([undefined]);
  });
});

/** A collaborator's own account, as `getVerifier()` mints it, whose endpoint check answers `reaches`. */
function collaborator(account: string, reaches: boolean) {
  return {
    getAccountObjectId: async () => account,
    verifyEndpoint: async () => {
      if (!reaches) throw new Error("This account is not connected to the portal used by this binding.");
    },
    getConnection: async () => ({}),
    assertConnectionCurrent: async () => {},
    setMcpSessionId: async () => {},
    noteCredentialsExpired: async () => {},
  } as never;
}

describe("portal observer admission", () => {
  it("has no subresources to verify", () => {
    expect(portalFacet({ serverId: "jira" }).observationSubresources).toBeUndefined();
  });

  it("opens the whole workspace to the binding's own account only", async () => {
    const facet = portalFacet({ serverId: "jira" });
    const { verifier } = observer("connector", "account-id");

    await expect(facet.addObserver("connector", verifier, "workspace")).resolves.toBeUndefined();
    await expect(facet.addObserver("connector", verifier)).resolves.toBeUndefined();
    expect(mocks.withClient).not.toHaveBeenCalled();

    const other = observer("colleague", "colleague-account").verifier;
    await expect(facet.addObserver("colleague", other, "workspace"))
      .rejects.toThrow(/can't open a workspace that uses this MCP connection/);
    await expect(facet.addObserver("colleague", other))
      .rejects.toThrow(/Share the Gadget with them instead/);
    expect(mocks.withClient).not.toHaveBeenCalled();
  });

  it("admits another account to run the Gadget only if it reaches the portal and the endpoint accepts it", async () => {
    const facet = portalFacet({ serverId: "jira" });

    await expect(facet.addObserver("colleague", collaborator("colleague-account", true), "gadget"))
      .resolves.toBeUndefined();
    expect(mocks.withClient).toHaveBeenCalledOnce();
  });

  it("refuses an account that is not connected to this portal, without probing the endpoint", async () => {
    const facet = portalFacet({ serverId: "jira" });

    await expect(facet.addObserver("colleague", collaborator("colleague-account", false), "gadget"))
      .rejects.toThrow(/not connected to the portal/);
    expect(mocks.withClient).not.toHaveBeenCalled();
  });

  it("refuses a verifier that is not an observer-capable account", async () => {
    const facet = portalFacet({ serverId: "jira" });
    const bare = { getAccountObjectId: async () => "colleague-account" } as never;

    await expect(facet.addObserver("colleague", bare, "gadget"))
      .rejects.toThrow(/does not support observer-scoped sessions/);
  });
});

describe("portal requirements recorded by older reads", () => {
  const SERVER = "server/jira";

  it("pass for the binding's account and for a collaborator admitted to run the Gadget, and fail for others", async () => {
    const facet = portalFacet({ serverId: "jira" });
    const owner = observer("owner-account", "account-id");
    const viewer = observer("viewer", "viewer-account");
    const stranger = observer("stranger", "stranger-account");
    await facet.addObserver("viewer", collaborator("viewer-account", true), "gadget");

    await expect(facet.verifyObserverAccess([owner, viewer, stranger], [SERVER]))
      .resolves.toEqual({ allowedObserverIds: ["owner-account", "viewer"] });
  });

  it("stop passing for a collaborator once they are removed or refused the whole workspace", async () => {
    const facet = portalFacet({ serverId: "jira" });
    const viewer = observer("viewer", "viewer-account");
    await facet.addObserver("viewer", collaborator("viewer-account", true), "gadget");

    await facet.removeObserver("viewer");
    await expect(facet.verifyObserverAccess([viewer], [SERVER]))
      .resolves.toEqual({ allowedObserverIds: [] });

    await facet.addObserver("viewer", collaborator("viewer-account", true), "gadget");
    await expect(facet.addObserver("viewer", viewer.verifier, "workspace")).rejects.toThrow();
    await expect(facet.verifyObserverAccess([viewer], [SERVER]))
      .resolves.toEqual({ allowedObserverIds: [] });
  });

  it("fail the whole call for an ID that is not this binding's server", async () => {
    const facet = portalFacet({ serverId: "jira" });
    const owner = observer("owner-account", "account-id");

    await expect(facet.verifyObserverAccess([owner], ["server/gitlab"]))
      .rejects.toThrow(/different portal server/);
    await expect(facet.verifyObserverAccess([owner], ["workspace/jira"]))
      .rejects.toThrow(/Not an MCP Server Portals subresource ID/);
  });
});
