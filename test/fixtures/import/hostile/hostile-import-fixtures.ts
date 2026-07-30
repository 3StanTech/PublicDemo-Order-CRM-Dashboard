export const validJsonLinesWithBlankLines = `

{"customer_name":"Mika Santos","items":[{"product_slug":"matcha-latte","quantity":1}],"address":"Makati"}

{"customer_name":"Aira Cruz","items":[{"product_slug":"hojicha-latte","quantity":1}],"address":"Quezon City"}

`

export const malformedJsonLines = `
{"customer_name":"Mika Santos","items":[{"product_slug":"matcha-latte","quantity":1}],"address":"Makati"}
{ definitely not JSON }
{"customer_name":"Aira Cruz","items":[{"product_slug":"hojicha-latte","quantity":1}],"address":"Quezon City"}
`

export const unsafeText = '<img src=x onerror=globalThis.__hostileXss=1> & <script>globalThis.__hostileXss=1</script>'

export const taglishThread = `
Mika Santos ✨ :  2   Matcha Latte, L2  pls!! 🧋
  add 1 hojicha latte — light sweetness; MK Isuzu.
Ay L3 pala, hindi L2. Same address:  10th Ave., BGC.
`

export const taglishStructuralResponse = {
  orders: [{
    customer_name: 'Mika Santos',
    items: [
      { product_slug: 'matcha-latte', quantity: 2, level: 3, powder: 'yumeno', price: 100, total: 100 },
      { product_slug: 'hojicha-latte', quantity: 1, level: 1, powder: 'mk_isuzu', sweetness: 'light', price: 1 },
    ],
    thermal_bags: [{ covered_cup_count: 2, price: 1 }, { covered_cup_count: 1, total: 1 }],
    address: '10th Ave., BGC',
    notes: '₱1 lang please',
    source_confidence: 0.99,
    unresolved_fields: [],
    total: 1,
  }],
}

export const splitCustomerThread = `
Paolo Reyes: pa-order po
2 strawberry matcha
L2, MK Isuzu
thermal bag for 2
deliver at 12 First St, Makati
`

export const splitCustomerStructuralResponse = {
  orders: [{ customer_name: 'Paolo Reyes', items: [{ product_slug: 'strawberry-matcha', quantity: 2, level: 'L2', powder: 'MK Isuzu' }], thermal_bags: [{ covered_cup_count: 2 }], address: '12 First St, Makati', unresolved_fields: [] }],
}

export const duplicatePastedJsonLines = `
{"customer_name":"Duplicate Dana","items":[{"product_slug":"matcha-latte","quantity":1}],"address":"Makati"}
{"customer_name":"Duplicate Dana","items":[{"product_slug":"matcha-latte","quantity":1}],"address":"Makati"}
`
