import { useState } from 'react'
import { Banner, Button } from '@cloudflare/kumo'
import { WarningCircle } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Overseer } from '@gadgets/workshop-shared/api'
import { useActions } from './useActions'
import { useResolveAction } from './useResolveAction'

/**
 * The writes a "use" collaborator's own Gadget session has queued, for them to approve or reject.
 * The server scopes the list to that session, and an approved write goes out with their own
 * connected account, so this is the only place anyone can decide it.
 */
export function PendingObserverActions({ overseer }: { overseer: RpcStub<Overseer> }) {
  const { pending } = useActions(overseer)
  const [processing, setProcessing] = useState<Set<number>>(() => new Set())
  const { resolveAction } = useResolveAction(overseer, setProcessing)
  const actions = pending.filter(action => action.type === 'action')

  if (actions.length === 0) return null
  return (
    <section aria-label="Pending actions" aria-live="polite" className="flex flex-col gap-2 px-4 py-3 sm:px-6">
      {actions.map(action => (
        <Banner
          key={action.id}
          variant="alert"
          icon={<WarningCircle weight="fill" />}
          title={`Action requires your approval: ${action.description.title}`}
          aria-busy={processing.has(action.id)}
          description={(
            <div className="flex flex-col gap-2">
              <div className="max-h-56 overflow-auto [overflow-wrap:anywhere] [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-1 [&_pre]:overflow-x-auto [&_ul]:list-disc">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{action.description.description}</ReactMarkdown>
              </div>
              <p className="m-0 text-xs">
                Nothing has been sent yet. This request will use your connected account.
              </p>
            </div>
          )}
          action={(
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="secondary"
                disabled={processing.has(action.id)}
                onClick={() => void resolveAction(action, 'deny')}
              >
                Reject
              </Button>
              <Button
                variant="primary"
                disabled={processing.has(action.id)}
                onClick={() => void resolveAction(action, 'approve')}
              >
                Approve
              </Button>
            </div>
          )}
        />
      ))}
    </section>
  )
}
