import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalAdapter, resetLocalAdapterMemoryForTests } from '../../../data/local-adapter'
import { ImportWorkspace } from '../ImportWorkspace'

afterEach(() => vi.unstubAllGlobals())

describe('ImportWorkspace local-only parsing', () => {
  it('parses pasted JSON into a draft with no fetch call', async () => {
    resetLocalAdapterMemoryForTests()
    const adapter = await LocalAdapter.create()
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<ImportWorkspace adapter={adapter} />)
    const input = screen.getByRole('textbox', { name: 'Order text or JSON' })
    fireEvent.change(input, {
      target: {
        value: '{"customer_name":"Lorenzo","items":[{"product_slug":"matcha-latte","quantity":1}],"address":"Makati"}',
      },
    })
    await user.click(screen.getByRole('button', { name: 'Create editable drafts' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await screen.findByText('Editable order draft')).toBeInTheDocument()
    await adapter.close()
  })
})
