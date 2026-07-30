import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalAdapter, resetLocalAdapterMemoryForTests } from '../../data/local-adapter'
import { demoCustomers, demoOrders } from '../../demo/seed'
import { OrdersHistory } from './OrdersHistory'

/** Prefer a customer with a single order so heading queries stay unique. */
const singleCustomer = demoCustomers.find(
  (customer) => demoOrders.filter((order) => order.customerId === customer.id).length === 1,
)!
const multiPaid = demoOrders.find((order) => order.status === 'paid')!
const multiPaidCustomer = demoCustomers.find((customer) => customer.id === multiPaid.customerId)!

let adapter: LocalAdapter

beforeEach(async () => {
  resetLocalAdapterMemoryForTests()
  adapter = await LocalAdapter.create()
})

afterEach(async () => {
  await adapter.close()
})

describe('OrdersHistory', () => {
  it('searches order history and filters by status and delivery date', async () => {
    const isolatedDate = '2099-01-06'
    await adapter.updateOrder(multiPaid.id, { deliveryDate: isolatedDate })
    const user = userEvent.setup()
    render(<OrdersHistory adapter={adapter} />)

    expect(await screen.findByRole('heading', { name: singleCustomer.name })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Search orders'), multiPaidCustomer.name.split(' ')[0]!)
    expect(await screen.findAllByRole('heading', { name: multiPaidCustomer.name })).not.toHaveLength(0)
    expect(screen.queryByRole('heading', { name: singleCustomer.name })).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Search orders'))
    await user.selectOptions(screen.getByLabelText('Status filter'), 'paid')
    expect(await screen.findAllByRole('heading', { name: multiPaidCustomer.name })).not.toHaveLength(0)
    expect(screen.queryByRole('heading', { name: singleCustomer.name })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Status filter'), 'all')
    fireEvent.change(screen.getByLabelText('Delivery date filter'), { target: { value: isolatedDate } })
    expect(await screen.findByRole('heading', { name: multiPaidCustomer.name })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: singleCustomer.name })).not.toBeInTheDocument()
  })
})
