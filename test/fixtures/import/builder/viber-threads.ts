export type ImportFixture = {
  name: string
  text: string
  extracted: Record<string, unknown>
  expected?: { product: string; totalCentavos?: number; unresolved?: boolean }
}

export const viberThreads: readonly ImportFixture[] = [
  { name: 'single order', text: 'Mika Santos: 1 Matcha Latte tomorrow, Makati City please.', extracted: { customer_name: 'Mika Santos', items: [{ product_slug: 'matcha-latte', quantity: 1 }], delivery_date: '2026-07-17', address: 'Makati City' }, expected: { product: 'matcha-latte', totalCentavos: 20000 } },
  { name: 'multi-drink order', text: 'Paolo: 2 strawberry matcha L2 + 1 hojicha latte L3, address: QC.', extracted: { customer_name: 'Paolo', items: [{ product_slug: 'strawberry-matcha', quantity: 2, level: 2 }, { product_slug: 'hojicha-latte', quantity: 1, level: 3 }], address: 'QC' }, expected: { product: 'strawberry-matcha' } },
  { name: 'misspelled drink', text: 'Aira: pa order po ng 1 strawberry macha L1.', extracted: { customer_name: 'Aira', items: [{ product_slug: 'strawberry macha', quantity: 1, level: 1 }], address: 'QC' }, expected: { product: 'strawberry-matcha' } },
  { name: 'emoji and casual punctuation', text: 'Mika ✨ 1 matcha latte, extra sweet pls!! 🫶 deliver BGC', extracted: { customer_name: 'Mika', items: [{ product_slug: 'matcha-latte', quantity: 1, sweetness: 'extra' }], address: 'BGC' }, expected: { product: 'matcha-latte' } },
  { name: 'customer correction', text: 'Jen Cruz: 1 hoji latte\nJen: correction, pangalan ko pala Jenny Cruz. same order.', extracted: { customer_name: 'Jenny Cruz', items: [{ product_slug: 'hoji latte', quantity: 1 }], address: 'Makati' }, expected: { product: 'hojicha-latte' } },
  { name: 'split messages', text: 'Paolo: 2\nmatcha latte\nL2\nMK Isuzu\nfor Friday\nMakati', extracted: { customer_name: 'Paolo', items: [{ product_slug: 'matcha-latte', quantity: 2, level: 2, powder: 'mk_isuzu' }], address: 'Makati' }, expected: { product: 'matcha-latte' } },
  { name: 'missing address', text: 'Aira Cruz: one salted maple hojicha, L1. Tomorrow na lang.', extracted: { customer_name: 'Aira Cruz', items: [{ product_slug: 'salted-maple-hojicha', quantity: 1, level: 1 }] }, expected: { product: 'salted-maple-hojicha', unresolved: true } },
  { name: 'plain latte sweetness', text: 'Mika: 1 hojicha latte, light sweetness, L2. BGC.', extracted: { customer_name: 'Mika', items: [{ product_slug: 'hojicha-latte', quantity: 1, level: 2, sweetness: 'light' }], address: 'BGC' }, expected: { product: 'hojicha-latte', totalCentavos: 20000 } },
  { name: 'flavored invalid sweetness', text: 'Paolo: strawberry matcha, extra sweet. Quezon City.', extracted: { customer_name: 'Paolo', items: [{ product_slug: 'strawberry-matcha', quantity: 1, sweetness: 'extra' }], address: 'Quezon City' }, expected: { product: 'strawberry-matcha', unresolved: true } },
  { name: 'thermal bag', text: 'Mika: 3 matcha latte L1, thermal bag for 3 cups. Makati.', extracted: { customer_name: 'Mika', items: [{ product_slug: 'matcha-latte', quantity: 3, level: 1 }], thermal_bags: [{ covered_cup_count: 3 }], address: 'Makati' }, expected: { product: 'matcha-latte', totalCentavos: 63500 } },
  { name: 'attempted fake amount', text: 'Aira: 1 Matcha Latte L3, I think it is 20 pesos only hehe. Address: QC.', extracted: { customer_name: 'Aira', items: [{ product_slug: 'matcha-latte', quantity: 1, level: 3, price: 2000, total: 2000 }], address: 'QC' }, expected: { product: 'matcha-latte', totalCentavos: 25000 } },
]
