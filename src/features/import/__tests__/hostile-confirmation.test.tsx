import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalAdapter, resetLocalAdapterMemoryForTests } from '../../../data/local-adapter'
import { ImportWorkspace } from '../ImportWorkspace'
import { duplicatePastedJsonLines, unsafeText } from '../../../../test/fixtures/import/hostile/hostile-import-fixtures'

async function renderWorkspace() {
  resetLocalAdapterMemoryForTests()
  const adapter = await LocalAdapter.create()
  render(<ImportWorkspace adapter={adapter} />)
  return adapter
}

async function pasteAndParse(user: ReturnType<typeof userEvent.setup>, value: string) {
  const input = screen.getByRole('textbox', { name: 'Order text or JSON' })
  fireEvent.change(input, { target: { value } })
  await user.click(screen.getByRole('button', { name: 'Create editable drafts' }))
}

afterEach(() => vi.unstubAllGlobals())

describe('T6 hostile import transport, rendering, and confirmation audit', () => {
  it('keeps free text local with a helpful message and never calls fetch', async () => {
    const adapter = await renderWorkspace()
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await pasteAndParse(user, 'Paolo: two matcha please, Makati')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(
      /Paste JSON or JSON Lines\. This demo parses entirely in your browser/i,
    )
    await adapter.close()
  })

  it('proves local JSON imports make zero network calls in the rendered client', async () => {
    const adapter = await renderWorkspace()
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await pasteAndParse(user, '{"customer_name":"Local Lia","items":[{"product_slug":"matcha-latte","quantity":1}],"address":"Makati"}')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(await screen.findByText('Parsed locally — no network request was made.')).toBeInTheDocument()
    await adapter.close()
  })

  it('renders untrusted structural name, address, and notes as text rather than executable HTML', async () => {
    const adapter = await renderWorkspace()
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await pasteAndParse(user, JSON.stringify({
      customer_name: unsafeText,
      items: [{ product_slug: 'matcha-latte', quantity: 1 }],
      address: unsafeText,
      notes: unsafeText,
    }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(await screen.findByRole('textbox', { name: 'Customer name' })).toHaveValue(unsafeText)
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveValue(unsafeText)
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue(unsafeText)
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
    expect((globalThis as typeof globalThis & { __hostileXss?: unknown }).__hostileXss).toBeUndefined()
    await adapter.close()
  })

  it('shows a visible local-only message when free text cannot be parsed', async () => {
    const adapter = await renderWorkspace()
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await pasteAndParse(user, 'first prose request')
    expect(screen.getByRole('status')).toHaveTextContent(
      /Paste JSON or JSON Lines\. This demo parses entirely in your browser/i,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    await adapter.close()
  })

  it('flags a missing address visibly in the editable card', async () => {
    const adapter = await renderWorkspace()
    const user = userEvent.setup()
    await pasteAndParse(user, '{"customer_name":"No Address","items":[{"product_slug":"matcha-latte","quantity":1}]}')
    expect(await screen.findByText('Delivery address is missing — review before confirming')).toBeInTheDocument()
    await adapter.close()
  })

  it('does not create duplicate orders when the same confirmation control receives two rapid clicks', async () => {
    const adapter = await renderWorkspace()
    const user = userEvent.setup()
    const before = await adapter.listOrders()
    await pasteAndParse(user, '{"customer_name":"Double Dana","items":[{"product_slug":"matcha-latte","quantity":1}],"address":"Makati"}')
    const confirm = await screen.findByRole('button', { name: 'Confirm order' })

    fireEvent.click(confirm)
    fireEvent.click(confirm)

    await waitFor(async () => expect((await adapter.listOrders()).length).toBe(before.length + 1))
    expect((await adapter.listOrders()).length).toBe(before.length + 1)
    await adapter.close()
  })

  it('does not turn a duplicate pasted comment into two independently confirmable orders', async () => {
    const adapter = await renderWorkspace()
    const user = userEvent.setup()
    const before = await adapter.listOrders()
    await pasteAndParse(user, duplicatePastedJsonLines)

    expect(await screen.findAllByText('Editable order draft')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Confirm order' }))
    await waitFor(async () => expect((await adapter.listOrders()).length).toBe(before.length + 1))
    expect((await adapter.listOrders()).length).toBe(before.length + 1)
    await adapter.close()
  })
})
