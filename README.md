# Gelly Dashboard (public demo)

Mobile-first PWA for café order and customer management (OMS/CRM, not a POS). Track delivery-day orders, customers, import intake, insights, and menu settings on a 390×844 phone layout.

## What this build is

This is a **public demo with no backend**. Sample data is generated in the browser and stored only in the visitor’s IndexedDB. Nothing is sent to a server, database, or external API.

- **PIN:** `123456`
- The PIN is a **UI demonstration, not a security boundary**. It ships in the client bundle in plain text. There is nothing real behind it.
- **Reset demo data** in Settings restores the sample orders and customers and discards local edits.

## Stack

- Vite + React 19 + TypeScript (strict)
- Tailwind CSS 4
- IndexedDB via `idb` (local-only storage)
- Vitest + Playwright

Money is **integer centavos**. All prices come from a deterministic pricing engine in `src/domain/`; imported or pasted amounts are never trusted.

## Requirements

- Node.js 20+
- npm

No environment variables are required.

## Commands

```sh
npm run dev
npm run lint
npm test
npm run build
npm run check
npm run test:e2e
npm run check:bundle
npm run check:public-safe
npm run preview
```

`npm run test:e2e` needs Playwright Chromium (`npx playwright install --with-deps chromium` once).

`npm run check` runs lint, unit tests, production build, bundle budget, public-safety scan, and e2e smoke.
