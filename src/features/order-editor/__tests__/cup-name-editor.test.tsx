import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { demoCustomers, demoOrders } from '../../../demo/seed'
import { OrderEditorCard } from '../OrderEditorCard'
import { blankImportDraft } from '../orderDraftMapping'
import type { ImportDraft } from '../../import/types'

/** Renders the editor as a controlled component so edits are visible to assertions. */
function Harness({ initial }: { initial: ImportDraft }) {
  const [draft, setDraft] = useState(initial)
  return <OrderEditorCard draft={draft} customers={demoCustomers} orders={demoOrders} confirming={false} onChange={setDraft} onConfirm={() => {}} />
}

function draftWithQuantity(quantity: number): ImportDraft {
  const base = blankImportDraft()
  return { ...base, customerName: 'Rina', items: [{ ...base.items[0], quantity }] }
}

describe('cup name fields in the order editor', () => {
  it('renders one name field per cup ordered', () => {
    render(<Harness initial={draftWithQuantity(4)} />)
    for (const cup of [1, 2, 3, 4]) {
      expect(screen.getByLabelText(`Drink 1 cup ${cup} name`)).toBeInTheDocument()
    }
    expect(screen.queryByLabelText('Drink 1 cup 5 name')).not.toBeInTheDocument()
  })

  it('records a name typed onto a single cup', async () => {
    const user = userEvent.setup()
    render(<Harness initial={draftWithQuantity(4)} />)

    await user.type(screen.getByLabelText('Drink 1 cup 1 name'), 'Ana')

    expect(screen.getByLabelText('Drink 1 cup 1 name')).toHaveValue('Ana')
  })

  it('keeps four different names side by side for a four-cup order', async () => {
    const user = userEvent.setup()
    render(<Harness initial={draftWithQuantity(4)} />)

    await user.type(screen.getByLabelText('Drink 1 cup 1 name'), 'Ana')
    await user.type(screen.getByLabelText('Drink 1 cup 2 name'), 'Ben')
    await user.type(screen.getByLabelText('Drink 1 cup 3 name'), 'Cara')
    await user.type(screen.getByLabelText('Drink 1 cup 4 name'), 'Dave')

    expect(screen.getByLabelText('Drink 1 cup 1 name')).toHaveValue('Ana')
    expect(screen.getByLabelText('Drink 1 cup 2 name')).toHaveValue('Ben')
    expect(screen.getByLabelText('Drink 1 cup 3 name')).toHaveValue('Cara')
    expect(screen.getByLabelText('Drink 1 cup 4 name')).toHaveValue('Dave')
  })

  it('shows no cup name fields until a quantity is set', () => {
    const base = blankImportDraft()
    render(<Harness initial={{ ...base, items: [{ ...base.items[0], quantity: null }] }} />)
    expect(screen.queryByLabelText('Drink 1 cup 1 name')).not.toBeInTheDocument()
  })
})
