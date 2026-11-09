import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, Hexagon, WarningCircle, X } from '@phosphor-icons/react'
import { FormatGlyph } from './components/format/FormatVisuals'
import { RpcStub } from 'capnweb'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AuthenticatedApi,
  Overseer,
  GadgetClient,
  WorkspaceMetadata,
  WorkpieceId,
  GadgetSummary,
} from '@gadgets/workshop-shared/api'
import GadgetUI from './GadgetUI'
import { WorkshopButton } from './components/WorkshopControls'
import UserMenu from './components/UserMenu'
import { GadgetPresence } from './components/GadgetPresence'
import TopBarNotice from './TopBarNotice'
import SiteLogo from './components/SiteLogo'
import GadgetExportMenu from './GadgetExportMenu'
import { useActions } from './useActions'

// The minimal, "use"-only experience: a shared top bar plus the gadget's deployed UI, and nothing
// else. Collaborators with the "use" role may only render and interact with the gadget's mainline
// UI (see UseOverseerInterface in the backend), so we deliberately omit the chat sidebar, the
// Gadget/Code/Connections controls, workspace activity, and every editor-only control. The
// overseer and gadget passed in here are the restricted capabilities returned by openWorkspace() for
// "use" sessions; calling anything outside getMetadata()/subscribeToMetadata()/subscribeToPresence()/
// subscribeToWorkpieces()/getGadget() (and, on the gadget, UI connection and export methods)
// would throw, apart from listing, approving and rejecting the writes this user initiated.
//
// When the workspace has more than one gadget, a simple picker in the top bar switches between
// them (selection is owned by the parent, in the URL's `?w=` search param). Pending gadgets are
// never listed: the restricted overseer's workpiece subscription withholds them.
type Props = {
  overseer: RpcStub<Overseer>
  // Null while the selected gadget is being admitted, or while the workspace has no gadgets.
  gadget: RpcStub<GadgetClient> | null
  selectedGadgetId: WorkpieceId | null
  // Why the selected gadget couldn't be opened, such as declining to choose connected accounts;
  // the collaborator can retry it or pick another gadget.
  gadgetOpenFailure: string | null
  onRetryGadget: () => void
  // Use-role subscriptions receive gadgets only (worktrees, like pending gadgets, are withheld).
  gadgets: GadgetSummary[]
  onSelectGadget: (id: WorkpieceId) => void
  metadata: WorkspaceMetadata
  authenticatedApi: RpcStub<AuthenticatedApi>
  currentUserId: string | null
}

// Matches the top bar height used by the full editor (and the home page header).
const TOPBAR_H = 56

export default function GadgetUseView({
  overseer,
  gadget,
  selectedGadgetId,
  gadgets,
  gadgetOpenFailure,
  onRetryGadget,
  onSelectGadget,
  metadata,
  authenticatedApi,
  currentUserId,
}: Props) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-kumo-base">
      {/* ═══ TOP BAR ════════════════════════════════════════════════════════════ */}
      <div
        className="relative flex items-center justify-between px-4 sm:px-6 backdrop-blur-md border-b border-kumo-line flex-shrink-0 gap-3"
        style={{ height: TOPBAR_H, backgroundColor: 'color-mix(in srgb, var(--color-kumo-base) 80%, transparent)' }}
      >
        <TopBarNotice />
        {/* Left: logo / title */}
        <div className="flex items-center gap-2 min-w-0">
          <Link to="/" aria-label="Home" className="flex-shrink-0 hover:opacity-80 transition-opacity">
            <SiteLogo size={22}>
              <Hexagon size={22} className="text-kumo-brand" weight="bold" />
            </SiteLogo>
          </Link>

          <span className="text-kumo-inactive flex-shrink-0">/</span>

          <span className="text-[14px] leading-5 font-medium tracking-[-0.25px] text-kumo-default truncate">
            {metadata.title}
          </span>

          {metadata.owner && (
            <span className="text-xs text-kumo-inactive flex-shrink-0">
              by {metadata.owner.name}
            </span>
          )}
        </div>

        {/* Center: gadget picker (only when there's a real choice) */}
        {gadgets.length > 1 && (
          <div className="hidden min-w-0 items-center gap-1 overflow-x-auto md:flex">
            {gadgets.map(g => (
              <button
                key={g.id}
                type="button"
                onClick={() => onSelectGadget(g.id)}
                aria-current={g.id === selectedGadgetId ? 'true' : undefined}
                className={`flex-shrink-0 cursor-pointer rounded-full px-3 py-1 text-[12px] leading-4 tracking-[-0.2px] transition-colors duration-150 ease-out ${
                  g.id === selectedGadgetId
                    ? 'bg-kumo-contrast font-medium text-kumo-inverse'
                    : 'bg-kumo-tint text-kumo-subtle hover:text-kumo-default'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <FormatGlyph output={g.output} size="sm" className="flex-shrink-0" weight="regular" />
                  <span className="block max-w-[160px] truncate">{g.title}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Right: presence and user menu */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <GadgetExportMenu
            gadget={gadgetOpenFailure === null ? gadget : null}
            gadgetTitle={gadgets.find(g => g.id === selectedGadgetId)?.title ?? 'Gadget'}
          />
          <span className="hidden md:inline-flex">
            <GadgetPresence
              overseer={overseer}
              authenticatedApi={authenticatedApi}
              currentUserId={currentUserId}
            />
          </span>
          <UserMenu />
        </div>
      </div>

      {gadgets.length > 1 && (
        <div className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-kumo-line px-2 md:hidden">
          {gadgets.map(g => (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelectGadget(g.id)}
              aria-current={g.id === selectedGadgetId ? 'true' : undefined}
              className={`h-9 max-w-[180px] shrink-0 truncate rounded-lg px-3 text-[14px] font-medium ${
                g.id === selectedGadgetId
                  ? 'bg-kumo-tint text-kumo-default'
                  : 'text-kumo-subtle'
              }`}
            >
              {g.title}
            </button>
          ))}
        </div>
      )}
      <PendingObserverActions overseer={overseer} />

      {/* ═══ GADGET UI ══════════════════════════════════════════════════════════ */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {gadgetOpenFailure !== null ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            {/* Verification denials list one line per failed connection, so preserve newlines. */}
            <p className="max-w-lg whitespace-pre-line text-sm text-kumo-danger">{gadgetOpenFailure}</p>
            <WorkshopButton tone="primary" onClick={onRetryGadget}>
              Try again
            </WorkshopButton>
          </div>
        ) : gadget ? (
          <GadgetUI
            key={selectedGadgetId}
            gadget={gadget}
            height="100%"
            isVisible={true}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-sm text-kumo-subtle">
              {selectedGadgetId === null ? 'This workspace has no gadgets yet.' : 'Loading gadget…'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function PendingObserverActions({ overseer }: { overseer: RpcStub<Overseer> }) {
  // For a "use" collaborator the server scopes this list to the actions submitted through their
  // own session, so everything shown here will be sent with their own connected account.
  const { pending: pendingEntries } = useActions(overseer)
  const [processing, setProcessing] = useState<Set<number>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const pending = pendingEntries.filter(action => action.type === 'action')

  async function resolve(id: number, approve: boolean) {
    setProcessing(current => new Set(current).add(id))
    setError(null)
    try {
      if (approve) await overseer.approveAction(id)
      else await overseer.rejectAction(id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not resolve the action.')
    } finally {
      setProcessing(current => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  if (pending.length === 0 && !error) return null
  return (
    <section aria-label="Pending actions" aria-live="polite" className="bg-kumo-base px-4 py-3 sm:px-6">
      {pending.map(action => action.type === 'action' && (
        <article key={action.id} aria-busy={processing.has(action.id)} className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-amber-300 bg-kumo-base shadow-sm">
          <div className="flex gap-3 px-4 py-4 sm:px-5">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
              <WarningCircle size={21} weight="fill" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="text-sm font-semibold text-kumo-default">Action requires your approval</h2>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">Review before sending</span>
              </div>
              <p className="mt-1 text-sm font-medium text-kumo-default">{action.description.title}</p>
              <p className="mt-1 text-xs text-kumo-subtle">Nothing has been sent yet. Review the request, then choose whether to allow it.</p>
              <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-kumo-line bg-kumo-tint px-3 py-2 text-sm leading-6 text-kumo-default [overflow-wrap:anywhere] [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-kumo-line [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-kumo-base [&_code]:px-1 [&_code]:py-0.5 [&_li]:ml-5 [&_ol]:my-2 [&_ol]:list-decimal [&_p]:my-1.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-kumo-base [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{action.description.description}</ReactMarkdown>
              </div>
              {error && <p role="alert" className="mt-2 text-xs text-kumo-danger">{error}</p>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-kumo-line pt-3">
                <p className="text-xs text-kumo-subtle">This request will use your connected account.</p>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={processing.has(action.id)}
                    onClick={() => void resolve(action.id, false)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-kumo-line px-3 text-sm font-medium text-kumo-subtle transition hover:bg-kumo-tint hover:text-kumo-default disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X size={16} aria-hidden="true" />
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={processing.has(action.id)}
                    onClick={() => void resolve(action.id, true)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-kumo-brand px-3.5 text-sm font-semibold text-kumo-inverse transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check size={16} aria-hidden="true" />
                    Approve action
                  </button>
                </div>
              </div>
            </div>
          </div>
        </article>
      ))}
      {pending.length === 0 && error && <p role="alert" className="mx-auto max-w-5xl text-xs text-kumo-danger">{error}</p>}
    </section>
  )
}
