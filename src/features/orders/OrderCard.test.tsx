import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { demoCustomers, demoOrders } from '../../demo/seed'
import { formatLifecycleTimestamp } from './order-timestamps'
import { OrderCard } from './OrderCard'

const noop = async () => {}

describe('OrderCard edit and delete controls', () => {
  it('omits Edit order and Delete order buttons when the callbacks are not provided (back-compat with existing callers)', () => {
    render(<OrderCard order={demoOrders[0]} customer={demoCustomers[0]} onAdvance={noop} onCancel={noop} />)
    expect(screen.queryByRole('button', { name: 'Edit order' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete order' })).not.toBeInTheDocument()
  })

  it('calls onEdit with the order when Edit order is clicked', async () => {
    const onEdit = vi.fn()
    const user = userEvent.setup()
    render(<OrderCard order={demoOrders[0]} customer={demoCustomers[0]} onAdvance={noop} onCancel={noop} onEdit={onEdit} />)
    await user.click(screen.getByRole('button', { name: 'Edit order' }))
    expect(onEdit).toHaveBeenCalledWith(demoOrders[0])
  })

  it('requires a single confirmation before calling onDelete, and can be backed out of', async () => {
    const onDelete = vi.fn(async () => {})
    const user = userEvent.setup()
    render(<OrderCard order={demoOrders[0]} customer={demoCustomers[0]} onAdvance={noop} onCancel={noop} onDelete={onDelete} />)

    await user.click(screen.getByRole('button', { name: 'Delete order' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Delete this order permanently?')

    await user.click(screen.getByRole('button', { name: 'Keep order' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete order' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete order' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete order' }))
    expect(onDelete).toHaveBeenCalledWith(demoOrders[0])
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

describe('OrderCard cup names', () => {
  const order = demoOrders[0]
  const withNames = {
    ...order,
    items: [{ ...order.items[0], quantity: 4, productName: 'Matcha Latte', modifiers: { ...order.items[0].modifiers, cupNames: ['Ana', 'Ben', 'Cara', 'Dave'] } }],
  }

  it('lists the name on each cup so the drinks can be labelled', () => {
    render(<OrderCard order={withNames} customer={demoCustomers[0]} onAdvance={noop} onCancel={noop} />)
    expect(screen.getByText('4× Matcha Latte')).toBeInTheDocument()
    expect(screen.getByText('Ana, Ben, Cara, Dave')).toBeInTheDocument()
  })

  it('shows the drink line without a name suffix when no cups are named', () => {
    const unnamed = { ...withNames, items: [{ ...withNames.items[0], modifiers: { level: 1 as const, powder: 'yumeno' as const } }] }
    render(<OrderCard order={unnamed} customer={demoCustomers[0]} onAdvance={noop} onCancel={noop} />)
    expect(screen.getByText('4× Matcha Latte')).toBeInTheDocument()
    expect(screen.queryByText(/Ana/)).not.toBeInTheDocument()
  })
})

const newOrder = demoOrders.find((order) => order.status === 'new')!
const paidOrder = demoOrders.find((order) => order.status === 'paid')!
const newCustomer = demoCustomers.find((customer) => customer.id === newOrder.customerId)!
const paidCustomer = demoCustomers.find((customer) => customer.id === paidOrder.customerId)!

describe('OrderCard lifecycle controls', () => {
  it('advances a new order directly to Paid without separate receipt controls', async () => {
    const onAdvance = vi.fn(async () => {})
    const user = userEvent.setup()
    render(<OrderCard order={newOrder} customer={newCustomer} onAdvance={onAdvance} onCancel={noop} />)

    expect(screen.queryByText('Receipt pending')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'GCash screenshot received' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark Paid' }))
    expect(onAdvance).toHaveBeenCalledWith(newOrder)
  })
})

describe('OrderCard lifecycle timestamps', () => {
  it('renders neither Paid nor Delivered metadata for a new order', () => {
    render(<OrderCard order={newOrder} customer={newCustomer} onAdvance={noop} onCancel={noop} />)
    expect(screen.queryByText(/^Paid /)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Delivered /)).not.toBeInTheDocument()
  })

  it('renders Paid metadata for a paid order', () => {
    render(<OrderCard order={paidOrder} customer={paidCustomer} onAdvance={noop} onCancel={noop} />)
    const formatted = formatLifecycleTimestamp(paidOrder.paidAt)
    expect(formatted).not.toBeNull()
    expect(screen.getByText(`Paid ${formatted}`)).toBeInTheDocument()
    expect(screen.queryByText(/^Delivered /)).not.toBeInTheDocument()
  })

  it('renders both Paid and Delivered metadata for a delivered order', () => {
    const delivered = {
      ...paidOrder,
      status: 'delivered' as const,
      paidAt: '2026-07-16T08:00:00.000Z',
      deliveredAt: '2026-07-16T09:30:00.000Z',
    }
    render(<OrderCard order={delivered} customer={paidCustomer} onAdvance={noop} onCancel={noop} />)
    expect(screen.getByText(`Paid ${formatLifecycleTimestamp(delivered.paidAt)}`)).toBeInTheDocument()
    expect(screen.getByText(`Delivered ${formatLifecycleTimestamp(delivered.deliveredAt)}`)).toBeInTheDocument()
  })

  it('renders Paid but not Delivered for a cancelled-with-payment order', () => {
    const cancelledPaid = {
      ...paidOrder,
      status: 'cancelled' as const,
      paidAt: '2026-07-16T08:00:00.000Z',
      deliveredAt: null,
    }
    render(<OrderCard order={cancelledPaid} customer={paidCustomer} onAdvance={noop} onCancel={noop} />)
    expect(screen.getByText(`Paid ${formatLifecycleTimestamp(cancelledPaid.paidAt)}`)).toBeInTheDocument()
    expect(screen.queryByText(/^Delivered /)).not.toBeInTheDocument()
  })
})
