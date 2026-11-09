import { afterEach, expect, it, vi } from "vitest";

import { McpFacetBase } from "../src/facet.js";
import { McpSessionBase } from "../src/session.js";
import { classifyTool, type ServerTrust } from "../src/tools.js";
import type { McpClient, McpTool } from "../src/client.js";
import type { ToolScope } from "../src/scope.js";
import type { ScopedCatalog } from "../src/catalog.js";
import type { ConnectionAccount, McpObserverAccount } from "../src/connection.js";
import type { ResourceDescription } from "@gadgets/workshop-shared/gatekeeper";

const log = {
  debug() {}, info() {}, error() {},
  warnings: [] as string[],
  warn(message: string) { this.warnings.push(message); },
  with() { return this; },
};

class TestSession extends McpSessionBase {}

class TestFacet extends McpFacetBase<object, {
  endpoint: string;
  scope: ToolScope;
}, TestSession> {
  catalogResult: Promise<ScopedCatalog> = Promise.resolve({
    isPortal: false,
    truncated: false,
    tools: [
      classifyTool({ name: "list_issues", annotations: { readOnlyHint: true } } as never, "byo"),
    ],
  });
  catalogReads = 0;
  remoteTools: McpTool[] = [];
  remoteCalls = 0;
  beforeCatalogRead: (() => Promise<void>) | undefined;

  protected get log() { return log; }
  protected get trust(): ServerTrust { return "byo"; }
  protected get sessionClass() { return TestSession; }
  protected get actionScopeTag() { return "test"; }
  protected account(): ConnectionAccount { throw new Error("not used"); }
  get observationSubresources() { return undefined; }
  describe(): Promise<ResourceDescription> { throw new Error("not used"); }
  getTypeScriptTypes(): Promise<string> { throw new Error("not used"); }
  get serverName() { return "Test"; }
  protected override async catalog() {
    this.catalogReads++;
    await this.beforeCatalogRead?.();
    return this.catalogResult;
  }
  override async call<T>(
    fn: (client: McpClient) => Promise<T>,
  ): Promise<T> {
    this.remoteCalls++;
    const client = {
      findTool: async (name: string) => this.remoteTools.find(tool => tool.name === name),
      listTools: async (
        _maxTools: number,
        include: (tool: McpTool) => boolean,
      ) => ({ tools: this.remoteTools.filter(include), truncated: false }),
      listMatchingToolSummaries: async (
        maxTools: number,
        include: (tool: McpTool) => boolean,
      ) => this.remoteTools.filter(include).slice(0, maxTools),
    } as unknown as McpClient;
    return fn(client);
  }
  viewerObserver(id: string): boolean { return this.isViewerObserver(id); }
  runDiscoveryTest<T>(operation: () => Promise<T>): Promise<T> {
    return this.runDiscovery(operation);
  }
}

function facet(scope: ToolScope = {}) {
  const values = new Map<string, unknown>();
  const ctx = {
    props: { endpoint: "https://example.com/mcp", scope },
    storage: { kv: {
      get: <T>(key: string) => values.get(key) as T | undefined,
      put: <T>(key: string, value: T) => { values.set(key, value); },
      delete: (key: string) => { values.delete(key); },
    } },
  };
  return new TestFacet(ctx as never, {});
}

const queue = {
  dup() { return this; },
  [Symbol.dispose]() {},
  authorizeObservation() {},
};

afterEach(() => vi.unstubAllGlobals());

/** Answers an MCP endpoint's handshake and one `whoami` tool, recording what each request carried. */
function stubMcpEndpoint() {
  const requests: Array<{ method: string; authorization: string | null }> = [];
  vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    requests.push({
      method: request.method,
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = request.method === "initialize"
      ? { protocolVersion: "2025-03-26", capabilities: { tools: {} },
          serverInfo: { name: "Test MCP", version: "1" } }
      : request.method === "tools/list"
        ? { tools: [{ name: "whoami", description: "Current account",
            inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] }
        : { content: [{ type: "text", text: "collaborator" }], isError: false };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
      headers: {
        "Content-Type": "application/json",
        ...(request.method === "initialize" ? { "Mcp-Session-Id": "test-session" } : {}),
      },
    });
  });
  return requests;
}

it("runs an observer session against the collaborator's MCP account", async () => {
  const requests = stubMcpEndpoint();
  const subject = facet();
  const observerAccount: McpObserverAccount = {
    async getAccountObjectId() { return "collaborator-account"; },
    async verifyEndpoint(endpoint) { expect(endpoint).toBe("https://example.com/mcp"); },
    async getConnection() {
      return { authorization: "collaborator-token", sessionId: null, generation: 1 };
    },
    async assertConnectionCurrent() {},
    async setMcpSessionId() { return true; },
    async noteCredentialsExpired() {},
  };
  const observerQueue = {
    ...queue,
    getObserverVerifier: async () => observerAccount,
  };

  using session = await subject.startSession(observerQueue as never);
  await expect(session.callTool("whoami")).resolves.toMatchObject({
    status: "ok",
    content: [{ type: "text", text: "collaborator" }],
  });
  expect(requests.map(request => request.method)).toContain("tools/call");
  expect(requests.every(request => request.authorization === "Bearer collaborator-token")).toBe(true);
});

it("builds tool methods and falls back to the plain session when catalog loading fails", async () => {
  const subject = facet();
  const dynamic = await subject.startSession(queue as never);
  expect("listIssues" in dynamic).toBe(true);

  subject.catalogResult = Promise.reject(new Error("offline"));
  const fallback = await subject.startSession(queue as never);
  expect("listIssues" in fallback).toBe(false);
  expect(log.warnings).toContain("starting session without per-tool methods");
});

it("fails closed when an observer does not provide an MCP account capability", async () => {
  await expect(facet().addObserver("observer", {} as never, "gadget"))
    .rejects.toThrow(/does not support observer-scoped sessions/);
});

it("refuses to open the whole workspace to a collaborator, by default and when asked for", async () => {
  const subject = facet();
  await expect(subject.addObserver("observer", {} as never))
    .rejects.toThrow(/can't open a workspace that uses this MCP connection/);
  await expect(subject.addObserver("observer", {} as never, "workspace"))
    .rejects.toThrow(/Share the Gadget with them instead/);
});

it("remembers a collaborator admitted to run the Gadget until they are removed or refused as build", async () => {
  const subject = facet();
  const account = {
    getAccountObjectId: async () => "account-1",
    verifyEndpoint: async () => {},
    getConnection: async () => ({ authorization: "token", sessionId: null, generation: 1 }),
    assertConnectionCurrent: async () => {},
    setMcpSessionId: async () => true,
    noteCredentialsExpired: async () => {},
  } as never;
  stubMcpEndpoint();
  const admit = () => subject.addObserver("observer", account, "gadget");

  await admit();
  expect(subject.viewerObserver("observer")).toBe(true);

  await subject.removeObserver("observer");
  expect(subject.viewerObserver("observer")).toBe(false);

  await admit();
  await expect(subject.addObserver("observer", account, "workspace")).rejects.toThrow();
  expect(subject.viewerObserver("observer")).toBe(false);
});

it("discovers and resolves tools beyond the initially described catalog", async () => {
  const subject = facet();
  subject.catalogResult = Promise.resolve({ tools: [], isPortal: false, truncated: true });
  subject.remoteTools = [
    { name: "search_issues", description: "Search issues", annotations: { readOnlyHint: true } },
    { name: "create_issue", description: "Create an issue" },
  ];

  await expect(subject.searchTools("search")).resolves.toMatchObject([{
    tool: { name: "search_issues" }, mode: "read",
  }]);
  await expect(subject.findTool("create_issue")).resolves.toMatchObject({
    tool: { name: "create_issue" }, mode: "action",
  });
});

it("answers searches from a complete catalog without rescanning the endpoint", async () => {
  const subject = facet();
  subject.remoteTools = [{ name: "search_issues", description: "Remote copy" }];

  await expect(subject.searchTools("issues")).resolves.toMatchObject([{
    tool: { name: "list_issues" }, mode: "read",
  }]);
  expect(subject.remoteCalls).toBe(0);
});

it("does not hydrate a new portal-native tool past a complete non-portal catalog", async () => {
  const subject = facet();
  subject.remoteTools = [{ name: "portal_toggle_servers" }];

  await expect(subject.findTool("portal_toggle_servers")).resolves.toBeUndefined();
  expect(subject.remoteCalls).toBe(0);
});

it("rejects a name outside the grant before loading the catalog or calling the endpoint", async () => {
  const subject = facet({ tools: ["allowed"] });
  subject.catalogResult = Promise.resolve({ tools: [], isPortal: false, truncated: false });

  await expect(subject.findTool("forbidden")).resolves.toBeUndefined();
  expect(subject.catalogReads).toBe(0);
  expect(subject.remoteCalls).toBe(0);
});

it("does not hydrate portal-native tools from a portal's incomplete catalog", async () => {
  const subject = facet();
  subject.catalogResult = Promise.resolve({ tools: [], isPortal: true, truncated: true });
  subject.remoteTools = [{ name: "portal_toggle_servers" }];

  await expect(subject.findTool("portal_toggle_servers")).resolves.toBeUndefined();
  expect(subject.remoteCalls).toBe(0);
});

it("bounds concurrent discovery work across distinct requests", async () => {
  const subject = facet();
  let active = 0;
  let maxActive = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls = Array.from({ length: 12 }, () => subject.runDiscoveryTest(async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await gate;
    active--;
  }));

  await vi.waitFor(() => expect(active).toBe(4));
  expect(maxActive).toBe(4);
  release();
  await Promise.all(calls);
  expect(maxActive).toBe(4);
});

it("bounds concurrent catalog reads", async () => {
  const subject = facet();
  let active = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  subject.beforeCatalogRead = async () => {
    active++;
    await gate;
    active--;
  };

  const searches = Array.from({ length: 12 }, () => subject.searchTools("issues"));

  await vi.waitFor(() => expect(active).toBeGreaterThan(0));
  expect(active).toBe(4);
  release();
  await Promise.all(searches);
});
