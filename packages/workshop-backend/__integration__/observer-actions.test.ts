import { runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { AuthenticatedApi, PublicApi } from "@gadgets/workshop-shared/api";
import { describe, expect, it } from "vitest";

const PASSWORD_HASH = new Uint8Array([1, 2, 3]);
const COLLABORATOR_ONLY = /collaborator's own session/;

function username(prefix: string): string {
  return prefix + crypto.randomUUID().replaceAll("-", "");
}

async function connect(): Promise<RpcStub<PublicApi>> {
  const response = await exports.default.fetch(new Request("https://workshop.invalid/api", {
    headers: { Upgrade: "websocket" },
  }));
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new TypeError("Expected a WebSocket response.");
  socket.accept();
  return newWebSocketRpcSession<PublicApi>(socket);
}

async function signIn(
    publicApi: RpcStub<PublicApi>, prefix: string)
    : Promise<{ name: string; token: string; api: RpcStub<AuthenticatedApi> }> {
  const name = username(prefix);
  const token = await publicApi.createAccount(name, name, PASSWORD_HASH);
  if (token === null) throw new Error(`Failed to create ${name}.`);
  return { name, token, api: await publicApi.authenticate(token) };
}

async function rejection(value: PromiseLike<unknown>): Promise<Error> {
  try {
    await value;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new TypeError("Expected RPC to reject with an Error.", { cause: error });
  }
  throw new Error("Expected RPC to reject.");
}

function pendingAction(id: number, observerProfileId?: string) {
  return {
    id,
    gatekeeperId: 1,
    caller: { from: "gadget" as const },
    ...(observerProfileId ? { observerProfileId } : {}),
    resourceTitle: "Jira",
    createdAt: new Date(),
    state: "pending" as const,
    type: "action" as const,
    action: id,
    description: {
      title: `action ${id}`,
      description: "write",
      implementsRevert: false,
    },
  };
}

// Actions submitted from a collaborator's own observer-backed runtime execute with that
// collaborator's connected account, so only the collaborator may see or resolve them. The records
// are seeded directly into the workspace DO; everything asserted goes through the real RPC surface.
describe("collaborator MCP actions across owner, build and use sessions", () => {
  it("keeps a collaborator's pending actions out of the owner's and build's reach", async () => {
    using publicApi = await connect();
    const owner = await signIn(publicApi, "owner");
    const builder = await signIn(publicApi, "builder");
    const reader = await signIn(publicApi, "reader");
    const other = await signIn(publicApi, "other");
    using ownerApi = owner.api;
    using builderApi = builder.api;
    using readerApi = reader.api;
    using _otherApi = other.api;

    using workspace = await ownerApi.newWorkspace();
    const { id } = await workspace.getMetadata();
    using gadget = await workspace.createGadget("App", undefined, "APP");
    const gadgetId = await gadget.getId();
    // "use" access is granted per gadget; the workspace grant is the "build" role.
    const builderInfo = await workspace.addCollaborator(builder.name, "workspace");
    const readerInfo = await workspace.addCollaborator(reader.name, { gadgetId });
    const otherInfo = await workspace.addCollaborator(other.name, { gadgetId });
    if (!builderInfo || !readerInfo || !otherInfo) throw new Error("Failed to add collaborators.");

    const ownAction = 100;
    const readerAction = 101;
    const otherAction = 102;
    const builderAction = 103;
    await runInDurableObject(
      exports.OverseerDurableObject.get(exports.OverseerDurableObject.idFromString(id)),
      async (instance: any) => {
        const actions = instance.impl.storage.actions;
        actions.put(pendingAction(ownAction));
        actions.put(pendingAction(readerAction, readerInfo.profile.id));
        actions.put(pendingAction(otherAction, otherInfo.profile.id));
        actions.put(pendingAction(builderAction, builderInfo.profile.id));
      },
    );

    // Owner: sees only workspace actions and can't resolve any collaborator's.
    expect((await workspace.listActions()).entries.map(entry => entry.id)).toEqual([ownAction]);
    expect(await rejection(workspace.approveAction(readerAction))).toMatchObject(
      { message: expect.stringMatching(COLLABORATOR_ONLY) });
    expect(await rejection(workspace.rejectAction(readerAction))).toMatchObject(
      { message: expect.stringMatching(COLLABORATOR_ONLY) });

    // Build collaborator: sees workspace actions and its own, never another collaborator's, even
    // though the role has full workspace access.
    using builderWorkspace = builderApi.openWorkspace(id);
    expect((await builderWorkspace.listActions()).entries.map(entry => entry.id))
        .toEqual([builderAction, ownAction]);
    expect(await rejection(builderWorkspace.approveAction(otherAction))).toMatchObject(
      { message: expect.stringMatching(COLLABORATOR_ONLY) });

    // Use collaborators: see only the actions from their own session.
    using readerWorkspace = readerApi.openWorkspace(id);
    expect((await readerWorkspace.listActions()).entries.map(entry => entry.id))
        .toEqual([readerAction]);
    expect(await rejection(readerWorkspace.approveAction(otherAction))).toMatchObject(
      { message: expect.stringMatching(/not pending for the current collaborator/) });
    expect(await rejection(readerWorkspace.approveAction(ownAction))).toMatchObject(
      { message: expect.stringMatching(/not pending for the current collaborator/) });

    // Refusals never change the stored state.
    await runInDurableObject(
      exports.OverseerDurableObject.get(exports.OverseerDurableObject.idFromString(id)),
      async (instance: any) => {
        for (const actionId of [ownAction, readerAction, otherAction, builderAction]) {
          expect(instance.impl.storage.actions.get(actionId).state).toBe("pending");
        }
      },
    );

    // Revocation ends the already-open collaborator session as well. The pending action remains in
    // storage for audit/history, but no longer appears to the owner after a fresh open, and the
    // revoked user's existing or newly opened capabilities cannot list or resolve it.
    await workspace.removeCollaborator(readerInfo.profile.id, []);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(await rejection(readerWorkspace.listActions())).toBeInstanceOf(Error);
    using freshReaderPublicApi = await connect();
    using freshReaderApi = await freshReaderPublicApi.authenticate(reader.token);
    using revokedWorkspace = freshReaderApi.openWorkspace(id);
    expect(await rejection(revokedWorkspace.listActions())).toMatchObject({
      message: expect.stringMatching(/don't have access to this workspace/i),
    });

    using freshOwnerPublicApi = await connect();
    using freshOwnerApi = await freshOwnerPublicApi.authenticate(owner.token);
    using freshOwnerWorkspace = freshOwnerApi.openWorkspace(id);
    expect((await freshOwnerWorkspace.listActions()).entries.map(entry => entry.id))
        .toEqual([ownAction]);
    await runInDurableObject(
      exports.OverseerDurableObject.get(exports.OverseerDurableObject.idFromString(id)),
      async (instance: any) => {
        expect(instance.impl.storage.actions.get(readerAction).state).toBe("pending");
      },
    );
  });
});
