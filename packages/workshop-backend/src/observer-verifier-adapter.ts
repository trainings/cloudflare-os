import { RpcTarget as NativeRpcTarget } from "cloudflare:workers";
import type {
  GatekeeperUserVerifier,
  ObserverMcpAccount,
  ObserverMcpConnection,
} from "@gadgets/workshop-shared/gatekeeper";

/**
 * The account capability `ApprovalQueue.getObserverVerifier` hands a gatekeeper facet serving one
 * collaborator's runtime, wrapping that collaborator's own connected-account verifier.
 *
 * The verifier is a native `Fetcher`. Returned directly from a `@validateRpc()` class, the generated
 * return validator wraps it in a Proxy that Workers RPC refuses to serialize ("Proxy could not be
 * serialized because it is not a valid RPC receiver type"), so it is forwarded through a plain
 * RpcTarget instead.
 *
 * This forwards only {@link ObserverMcpAccount}, so it serves the MCP gatekeepers, the only callers
 * of `getObserverVerifier` today. A gatekeeper with a different account surface needs its own
 * forwarder, or this one generalized.
 */
export class ObserverVerifierAdapter extends NativeRpcTarget implements ObserverMcpAccount {
  private verifier: ObserverMcpAccount;

  constructor(verifier: Fetcher<GatekeeperUserVerifier>) {
    super();
    // `GatekeeperUserVerifier` declares no methods on purpose: the Workshop only passes it back to
    // the gatekeeper that minted it (see its doc), so the one thing it cannot know, that this
    // vendor's verifier is an `ObserverMcpAccount`, is asserted here, once, rather than on every
    // forward. The interface is the same one the MCP gatekeepers' verifiers implement.
    this.verifier = verifier as unknown as ObserverMcpAccount;
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
