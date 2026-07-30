import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LocalAdapter, resetLocalAdapterMemoryForTests } from '../../../data/local-adapter'
import { demoCustomers, demoOrders } from '../../../demo/seed'
import { blankImportDraft } from '../orderDraftMapping'
import { OrderEditorModal } from '../OrderEditorModal'

async function renderModal(onClose = vi.fn()) {
  resetLocalAdapterMemoryForTests()
  const adapter = await LocalAdapter.create()
  render(
    <OrderEditorModal
      adapter={adapter}
      customers={demoCustomers}
      orders={demoOrders}
      initialDraft={blankImportDraft()}
      editingOrder={null}
      title="New order"
      onClose={onClose}
      onSaved={vi.fn()}
    />,
  )
  return { adapter, onClose }
}

describe('OrderEditorModal dialog behavior', () => {
  it('closes when Escape is pressed', async () => {
    const user = userEvent.setup()
    const { adapter, onClose } = await renderModal()

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    await adapter.close()
  })

  it('closes when the close button is used', async () => {
    const user = userEvent.setup()
    const { adapter, onClose } = await renderModal()

    await user.click(screen.getByRole('button', { name: 'Close editor' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    await adapter.close()
  })

  it('moves focus into the dialog on open so keyboard users land inside it', async () => {
    const { adapter } = await renderModal()

    const dialog = screen.getByRole('dialog', { name: 'New order' })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    await adapter.close()
  })
})
