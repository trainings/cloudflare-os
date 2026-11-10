import { RpcTarget as NativeRpcTarget } from "cloudflare:workers";
import type { GatekeeperUserVerifier } from "@gadgets/workshop-shared/gatekeeper";

// What an MCP connected account's verifier hands the MCP gatekeepers. Its source of truth is
// `McpObserverAccount` and `ConnectionAccount` in `mcp-shared/src/connection.ts`; the Workshop does
// not depend on that package, so the shapes are restated here and must change together with it.

/** Credentials and session state an MCP account returns for one endpoint. */
export interface ObserverMcpConnection {
  authorization: string | null;
  sessionId: string | null;
  generation: number;
}

/** The calls the MCP gatekeepers make on a collaborator's connected-account verifier. */
export interface ObserverMcpVerifier {
  getAccountObjectId(): Promise<string>;
  verifyEndpoint(endpoint: string): Promise<void>;
  getConnection(endpoint: string): Promise<ObserverMcpConnection>;
  assertConnectionCurrent(endpoint: string, generation: number): Promise<void>;
  setMcpSessionId(
      endpoint: string, generation: number, previous: string | null, next: string | null)
      : Promise<boolean>;
  noteCredentialsExpired(endpoint: string, generation: number): Promise<void>;
}

/**
 * The account capability `ApprovalQueue.getObserverVerifier` hands a gatekeeper facet serving one
 * collaborator's runtime, wrapping that collaborator's own connected-account verifier.
 *
 * The verifier is a native `Fetcher`. Returned directly from a `@validateRpc()` class, the generated
 * return validator wraps it in a Proxy that Workers RPC refuses to serialize ("Proxy could not be
 * serialized because it is not a valid RPC receiver type"), so it is forwarded through a plain
 * RpcTarget instead.
 *
 * This forwards only {@link ObserverMcpVerifier}, so it serves the MCP gatekeepers, the only callers
 * of `getObserverVerifier` today. A gatekeeper with a different account surface needs its own
 * forwarder, or this one generalized.
 */
export class ObserverVerifierAdapter extends NativeRpcTarget implements ObserverMcpVerifier {
  private verifier: ObserverMcpVerifier;

  constructor(verifier: Fetcher<GatekeeperUserVerifier>) {
    super();
    // `GatekeeperUserVerifier` declares no methods on purpose: the Workshop only passes it back to
    // the gatekeeper that minted it (see its doc), so the MCP surface can only be asserted here,
    // once, rather than on every forward.
    this.verifier = verifier as unknown as ObserverMcpVerifier;
  }

  getAccountObjectId(): Promise<string> {
    return this.verifier.getAccountObjectId();
  }

  verifyEndpoint(endpoint: string): Promise<void> {
    return this.verifier.verifyEndpoint(endpoint);
  }

  getConnection(endpoint: string): Promise<ObserverMcpConnection> {
    return this.verifier.getConnection(endpoint);
  }

  assertConnectionCurrent(endpoint: string, generation: number): Promise<void> {
    return this.verifier.assertConnectionCurrent(endpoint, generation);
  }

  setMcpSessionId(
      endpoint: string, generation: number, previous: string | null, next: string | null)
      : Promise<boolean> {
    return this.verifier.setMcpSessionId(endpoint, generation, previous, next);
  }

  noteCredentialsExpired(endpoint: string, generation: number): Promise<void> {
    return this.verifier.noteCredentialsExpired(endpoint, generation);
  }
}
