// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { Overseer } from '@gadgets/workshop-shared/api'

const toasts = vi.hoisted(() => ({ add: vi.fn<(options: unknown) => void>() }))
vi.mock('@cloudflare/kumo', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@cloudflare/kumo')
  return { ...actual, useKumoToastManager: () => toasts }
})

import { deferred, entry, flushFrames, makeOverseer, makeTestRoot } from './action-test-harness'
import { PendingObserverActions } from './PendingObserverActions'

const view = makeTestRoot()

afterEach(() => {
  view.cleanup()
  vi.restoreAllMocks()
  toasts.add.mockReset()
})

// Renders the panel against a server that reports `entries` as pending, and decides each action
// through the given handlers.
async function renderPending(
  entries: ReturnType<typeof entry>[],
  decide: Partial<Pick<Overseer, 'approveAction' | 'rejectAction'>> = {},
) {
  const server = makeOverseer()
  const overseer = Object.assign(server.overseer, {
    approveAction: vi.fn<Overseer['approveAction']>(async () => {}),
    rejectAction: vi.fn<Overseer['rejectAction']>(async () => {}),
    ...decide,
  }) as RpcStub<Overseer> & Pick<Overseer, 'approveAction' | 'rejectAction'>
  await view.render(<PendingObserverActions overseer={overseer} />)
  await server.resolveSubscription()
  await server.resolvePendingQuery({ entries })
  flushFrames()
  return overseer
}

const button = (name: string) => {
  const found = [...document.querySelectorAll('button')].find(b => b.textContent === name)
  if (!found) throw new Error(`No ${name} button rendered`)
  return found
}

describe('PendingObserverActions', () => {
  it('renders nothing while no write is waiting', async () => {
    await renderPending([])
    expect(document.querySelector('[aria-label="Pending actions"]')).toBeNull()
  })

  it('shows each waiting write with what it will send', async () => {
    await renderPending([
      entry(1, { description: { title: 'Post comment', description: 'Hello **team**', implementsRevert: false } }),
      entry(2, { description: { title: 'Close issue', description: '', implementsRevert: false } }),
    ])
    const text = document.querySelector('[aria-label="Pending actions"]')!.textContent
    expect(text).toContain('Post comment')
    expect(text).toContain('Close issue')
    expect(document.querySelector('strong')?.textContent).toBe('team')
    expect(text).toContain('Nothing has been sent yet')
  })

  it('approves and rejects the write it was clicked on', async () => {
    const overseer = await renderPending([entry(7), entry(8)])
    const [approve, reject] = [button('Approve'), button('Reject')]

    await act(async () => approve.click())
    await act(async () => reject.click())

    expect(overseer.approveAction).toHaveBeenCalledWith(7, undefined)
    expect(overseer.rejectAction).toHaveBeenCalledWith(7)
  })

  it('holds a write\'s buttons while its decision is in flight', async () => {
    const decision = deferred()
    await renderPending([entry(1)], { approveAction: () => decision.promise })

    await act(async () => button('Approve').click())
    expect(button('Approve').disabled).toBe(true)
    expect(button('Reject').disabled).toBe(true)

    await decision.resolve()
    expect(button('Approve').disabled).toBe(false)
  })

  it('tells the user when a decision is refused', async () => {
    await renderPending([entry(1)], {
      approveAction: vi.fn<Overseer['approveAction']>(async () => {
        throw new Error('belongs to another session')
      }),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => button('Approve').click())

    expect(toasts.add).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Failed to approve action', variant: 'error',
    }))
  })
})
