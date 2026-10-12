import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const UID = 'visitor-one'
const PROFILE = `demos/${UID}`
const old = () => Timestamp.fromMillis(Date.now() - 10_000)

function mapOfSize(size: number): Record<string, number> {
  return Object.fromEntries(Array.from({ length: size }, (_, index) => [`k${index}`, index]))
}

const orderPayload = () => ({
  deleted: false,
  order: { id: 'ord-1', customerId: 'cus-1', status: 'new' },
  items: [{ id: 'itm-1', productId: 'prd-1', quantity: 2 }],
  clientTotalCentavos: 24_000,
  updatedAt: serverTimestamp(),
})

interface DeltaCase {
  name: string
  validId: string
  badIds: string[]
  live: () => DocumentData
  /** Overrides that each make the live document invalid by type or size. */
  invalid: Record<string, DocumentData>
  /** A live-document key whose absence must be rejected. */
  required: string
}

const cases: DeltaCase[] = [
  {
    name: 'orders',
    validId: 'ord-2026-0001',
    badIds: ['bad_id', 'has space', 'a'.repeat(65)],
    live: orderPayload,
    invalid: {
      'deleted not a bool': { deleted: 'no' },
      'order not a map': { order: 'x' },
      'order over 40 keys': { order: mapOfSize(41) },
      'items not a list': { items: {} },
      'items over 20': { items: Array.from({ length: 21 }, () => ({})) },
      'items holding null': { items: [null] },
      'items holding a scalar': { items: [1] },
      'items holding a scalar after a map': { items: [{ id: 'itm-1' }, 'x'] },
      'items holding a scalar at the last index': { items: [...Array.from({ length: 19 }, () => ({})), 7] },
      'total not an int': { clientTotalCentavos: 12.5 },
      'total negative': { clientTotalCentavos: -1 },
    },
    required: 'clientTotalCentavos',
  },
  {
    name: 'customers',
    validId: 'cus-2026-0001',
    badIds: ['bad_id', 'has space', 'a'.repeat(65)],
    live: () => ({ deleted: false, customer: { id: 'cus-1', name: 'Test' }, updatedAt: serverTimestamp() }),
    invalid: {
      'deleted not a bool': { deleted: 1 },
      'customer not a map': { customer: [] },
      'customer over 20 keys': { customer: mapOfSize(21) },
    },
    required: 'customer',
  },
  {
    name: 'settings',
    validId: 'catalog.v1',
    badIds: ['Upper', 'has space', 'a'.repeat(65)],
    live: () => ({ deleted: false, setting: { value: 1 }, updatedAt: serverTimestamp() }),
    invalid: {
      'deleted not a bool': { deleted: null },
      'setting not a map': { setting: 'x' },
      'setting over 10 keys': { setting: mapOfSize(11) },
    },
    required: 'setting',
  },
]

let environment: RulesTestEnvironment

type Firestore = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>

beforeAll(async () => {
  // Never contact a live database if this suite is invoked without the CLI.
  const address = process.env.FIRESTORE_EMULATOR_HOST
  if (!address) throw new Error('Run this suite with npm run test:rules (Firestore emulator required).')
  const separator = address.lastIndexOf(':')
  const host = address.slice(0, separator)
  const port = Number(address.slice(separator + 1))
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) || !Number.isInteger(port) || port <= 0) {
    throw new Error('Rules tests require a local Firestore emulator.')
  }
  environment = await initializeTestEnvironment({
    projectId: 'demo-cafe-oms-rules',
    firestore: { host, port, rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  })
})
beforeEach(async () => {
  await environment.clearFirestore()
})
afterAll(async () => {
  await environment?.cleanup()
})

function visitor(uid: string | null = UID): Firestore {
  return uid === null
    ? environment.unauthenticatedContext().firestore()
    : environment.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore()
}

async function seed(path: string, data: DocumentData) {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data)
  })
}

async function seedProfile(docs = 0) {
  await seed(PROFILE, { createdAt: old(), updatedAt: old(), docs, last: '' })
}

/** Create a delta document the way the app does: one batch, profile counter +1. */
function createCounted(
  db: Firestore,
  path: string,
  data: DocumentData,
  nextDocs = 1,
  last = path.slice(`${PROFILE}/`.length),
) {
  const batch = writeBatch(db)
  batch.set(doc(db, path), data)
  batch.update(doc(db, PROFILE), { docs: nextDocs, last, updatedAt: serverTimestamp() })
  return batch.commit()
}

describe('visitor profile', () => {
  const create = () => ({ createdAt: serverTimestamp(), updatedAt: serverTimestamp(), docs: 0, last: '' })

  it('lets the owner create and read', async () => {
    const db = visitor()
    await assertSucceeds(setDoc(doc(db, PROFILE), create()))
    await assertSucceeds(getDoc(doc(db, PROFILE)))
  })

  it('denies the owner deleting the profile', async () => {
    await seedProfile()
    await assertFails(deleteDoc(doc(visitor(), PROFILE)))
  })

  it.each(['visitor-two', null])('denies another or unauthenticated visitor (%s)', async (uid) => {
    await seedProfile()
    const db = visitor(uid)
    await assertFails(getDoc(doc(db, PROFILE)))
    await assertFails(setDoc(doc(db, PROFILE), create()))
    await assertFails(deleteDoc(doc(db, PROFILE)))
  })

  it('denies extra fields, wrong types and a forged time', async () => {
    const db = visitor()
    await assertFails(setDoc(doc(db, PROFILE), { ...create(), unexpected: true }))
    await assertFails(setDoc(doc(db, PROFILE), { ...create(), docs: '0' }))
    await assertFails(setDoc(doc(db, PROFILE), { ...create(), docs: 0.5 }))
    await assertFails(setDoc(doc(db, PROFILE), { ...create(), last: 5 }))
    await assertFails(setDoc(doc(db, PROFILE), { ...create(), last: 'x'.repeat(101) }))
    const withoutLast: DocumentData = create()
    delete withoutLast.last
    await assertFails(setDoc(doc(db, PROFILE), withoutLast))
    await assertFails(setDoc(doc(db, PROFILE), { ...create(), createdAt: 'today' }))
    await assertFails(setDoc(doc(db, PROFILE), { ...create(), createdAt: old() }))
    await assertFails(setDoc(doc(db, PROFILE), { ...create(), updatedAt: old() }))
  })

  it('denies a counter above 300 and a counter that goes down', async () => {
    const db = visitor()
    await assertFails(setDoc(doc(db, PROFILE), { ...create(), docs: 301 }))
    await seedProfile(5)
    await assertFails(updateDoc(doc(db, PROFILE), { docs: 4, updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(doc(db, PROFILE), { docs: 6, updatedAt: serverTimestamp() }))
  })

  it('denies a last that is not a string on update', async () => {
    await seedProfile()
    await assertFails(updateDoc(doc(visitor(), PROFILE), { last: 1, updatedAt: serverTimestamp() }))
  })

  it('denies changing createdAt on update', async () => {
    await seedProfile()
    await assertFails(updateDoc(doc(visitor(), PROFILE), { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  })
})

describe.each(cases)('$name', (fixture) => {
  const path = (id = fixture.validId) => `${PROFILE}/${fixture.name}/${id}`

  beforeEach(async () => {
    await seedProfile()
  })

  it('lets the owner create, read and list', async () => {
    const db = visitor()
    await assertSucceeds(createCounted(db, path(), fixture.live()))
    await assertSucceeds(getDoc(doc(db, path())))
    await assertSucceeds(getDocs(collection(db, 'demos', UID, fixture.name)))
  })

  it('lets the owner create a tombstone', async () => {
    await assertSucceeds(
      createCounted(visitor(), path(), { deleted: true, updatedAt: serverTimestamp() }),
    )
  })

  it.each(['visitor-two', null])('denies another or unauthenticated visitor (%s)', async (uid) => {
    await seed(path(), { ...fixture.live(), updatedAt: old() })
    const db = visitor(uid)
    await assertFails(getDoc(doc(db, path())))
    await assertFails(getDocs(collection(db, 'demos', UID, fixture.name)))
    await assertFails(setDoc(doc(db, path()), fixture.live()))
    await assertFails(deleteDoc(doc(db, path())))
    await assertFails(setDoc(doc(db, path('someone-else')), fixture.live()))
  })

  it('denies extra fields', async () => {
    await assertFails(createCounted(visitor(), path(), { ...fixture.live(), unexpected: true }))
  })

  it.each(Object.entries(fixture.invalid))('denies %s', async (_label, override) => {
    await assertFails(createCounted(visitor(), path(), { ...fixture.live(), ...override }))
  })

  it('denies a live document that omits its payload', async () => {
    const data = fixture.live()
    delete data[fixture.required]
    await assertFails(createCounted(visitor(), path(), data))
  })

  it('denies a tombstone that carries a payload', async () => {
    await assertFails(createCounted(visitor(), path(), { ...fixture.live(), deleted: true }))
  })

  it('denies an omitted updatedAt', async () => {
    const data = fixture.live()
    delete data.updatedAt
    await assertFails(createCounted(visitor(), path(), data))
  })

  it('denies a malformed ID', async () => {
    for (const id of fixture.badIds) {
      await assertFails(createCounted(visitor(), path(id), fixture.live()))
    }
  })

  it('denies a client updatedAt that is not the request time', async () => {
    await assertFails(createCounted(visitor(), path(), { ...fixture.live(), updatedAt: old() }))
    await seed(path(), { ...fixture.live(), updatedAt: old() })
    await assertFails(setDoc(doc(visitor(), path()), { ...fixture.live(), updatedAt: Timestamp.now() }))
  })

  it('lets the owner update after the interval', async () => {
    await seed(path(), { ...fixture.live(), updatedAt: old() })
    await assertSucceeds(setDoc(doc(visitor(), path()), fixture.live()))
  })

  it('denies a second write within one second', async () => {
    // A future timestamp guarantees a sub-second interval even on a slow host.
    await seed(path(), { ...fixture.live(), updatedAt: Timestamp.fromMillis(Date.now() + 60_000) })
    await assertFails(setDoc(doc(visitor(), path()), fixture.live()))
  })

  it('denies a create without the profile counter', async () => {
    await assertFails(setDoc(doc(visitor(), path()), fixture.live()))
  })

  it('denies a create that raises the counter by more than one', async () => {
    await assertFails(createCounted(visitor(), path(), fixture.live(), 2))
  })

  it('denies a create whose last does not name the created document', async () => {
    await assertFails(createCounted(visitor(), path(), fixture.live(), 1, `${fixture.name}/another-doc`))
    await assertFails(createCounted(visitor(), path(), fixture.live(), 1, ''))
  })

  it('denies two creates in one batch that share a single counter step', async () => {
    const db = visitor()
    const batch = writeBatch(db)
    batch.set(doc(db, path()), fixture.live())
    batch.set(doc(db, path('second-doc')), fixture.live())
    batch.update(doc(db, PROFILE), {
      docs: 1,
      last: `${fixture.name}/second-doc`,
      updatedAt: serverTimestamp(),
    })
    await assertFails(batch.commit())
    // Neither document was written.
    await environment.withSecurityRulesDisabled(async (context) => {
      expect((await getDoc(doc(context.firestore(), path()))).exists()).toBe(false)
      expect((await getDoc(doc(context.firestore(), path('second-doc')))).exists()).toBe(false)
    })
  })

  it('denies the cap being reset by deleting and recreating the profile', async () => {
    await seedProfile(300)
    const db = visitor()
    await assertFails(deleteDoc(doc(db, PROFILE)))
    await assertFails(
      setDoc(doc(db, PROFILE), { createdAt: serverTimestamp(), updatedAt: serverTimestamp(), docs: 0, last: '' }),
    )
    await assertFails(createCounted(db, path(), fixture.live(), 301))
  })

  it('denies a create that leaves the counter unchanged', async () => {
    await assertFails(createCounted(visitor(), path(), fixture.live(), 0))
  })

  it('denies a create that would take the counter above 300', async () => {
    await seedProfile(300)
    await assertFails(createCounted(visitor(), path(), fixture.live(), 301))
  })

  it('lets the owner create at the cap boundary', async () => {
    await seedProfile(299)
    await assertSucceeds(createCounted(visitor(), path(), fixture.live(), 300))
  })

  it('does not count an update toward the cap', async () => {
    await seedProfile(300)
    await seed(path(), { ...fixture.live(), updatedAt: old() })
    await assertSucceeds(setDoc(doc(visitor(), path()), fixture.live()))
  })

  it('lets the owner delete for reset', async () => {
    await seed(path(), { ...fixture.live(), updatedAt: old() })
    await assertSucceeds(deleteDoc(doc(visitor(), path())))
  })
})

describe('verifications', () => {
  const path = `${PROFILE}/verifications/ord-1`
  const written = () => ({
    serverTotalCentavos: 24_000,
    clientTotalCentavos: 24_000,
    match: true,
    orderUpdatedAt: old(),
    verifiedAt: old(),
  })

  it('lets the owner read but never write', async () => {
    await seed(path, written())
    const db = visitor()
    expect((await assertSucceeds(getDoc(doc(db, path)))).data()?.match).toBe(true)
    await assertSucceeds(getDocs(collection(db, 'demos', UID, 'verifications')))
    await assertFails(setDoc(doc(db, path), written()))
    await assertFails(setDoc(doc(db, `${PROFILE}/verifications/ord-2`), written()))
    await assertFails(updateDoc(doc(db, path), { match: false }))
    await assertFails(deleteDoc(doc(db, path)))
  })

  it.each(['visitor-two', null])('denies another or unauthenticated visitor (%s)', async (uid) => {
    await seed(path, written())
    await assertFails(getDoc(doc(visitor(uid), path)))
  })
})

describe('paths outside the contract', () => {
  it('denies anything outside demos and unknown collections', async () => {
    await seedProfile()
    const db = visitor()
    await assertFails(setDoc(doc(db, 'other/thing'), { a: 1 }))
    await assertFails(getDoc(doc(db, 'other/thing')))
    await assertFails(getDocs(collection(db, 'demos')))
    await assertFails(setDoc(doc(db, `${PROFILE}/unknown/x`), { a: 1 }))
    await assertFails(getDoc(doc(db, `${PROFILE}/unknown/x`)))
    await assertFails(setDoc(doc(db, `${PROFILE}/orders/ord-1/extra/y`), { a: 1 }))
  })
})
