// The one subresource ID older bare MCP bindings reported: `server/<serverId>`, naming the connected
// server. Reads no longer report it, but workspaces that recorded it still carry it as a requirement.

import { formatSubresourceId, parseSubresourceId } from "@gadgets/gatekeeper-kit/subresource-ids";

const SERVER_SUBRESOURCE = "server";

/**
 * The subresource ID reads through a binding to `serverId` used to report. `serverId` is the
 * binding's display slug (see `server-id.ts`), which can collide across hosts; that is harmless
 * because only collaborators admitted to a runtime of their own pass, and endpoint equality and
 * action-kind tags keep using the full endpoint.
 */
export function serverSubresourceId(serverId: string): string {
  return formatSubresourceId({ fragments: [{ name: SERVER_SUBRESOURCE, id: serverId }] });
}

/**
 * Throws unless every ID is exactly `server/<serverId>` for this binding's `serverId`: no
 * namespace, one fragment. Anything else was never reported by this binding.
 */
export function assertOwnServerSubresources(subresources: string[], serverId: string): void {
  for (const id of subresources) {
    const { namespace, fragments: [server, ...rest] } = parseSubresourceId(id);
    if (namespace !== undefined || rest.length > 0 || server?.name !== SERVER_SUBRESOURCE) {
      throw new Error("Not an MCP server subresource ID.");
    }
    if (server.id !== serverId) {
      throw new Error("This subresource ID names a different MCP server than this binding.");
    }
  }
}
