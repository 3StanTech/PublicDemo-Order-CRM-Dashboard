# Gelly Dashboard (public demo)

Mobile-first PWA for café order and customer management (OMS/CRM, not a POS). Track delivery-day orders, customers, import intake, insights, and menu settings on a 390×844 phone layout.

This is a public demo with sample data only. It is a stand-in for a real client project and contains no production data, brand, or credentials.

## Try it

Open **https://cafe-oms-demo.web.app/** on a phone, or in a desktop browser at phone width.

- The lock screen shows the demo PIN. The PIN is a UI demonstration, not a security boundary: it ships in the client bundle in plain text and protects nothing.
- Add, edit, and delete orders and customers, change menu settings, and reload. Your changes are still there.
- **Reset demo data** in Settings deletes your changes and shows the original sample data again.
- Orders you save get a small chip: **Checking…**, then **Server-verified** when a server-side recalculation agrees with the total shown in the app, or **Not verified** when it does not.

The old Vercel address now redirects permanently to the link above.

## How it is built

Vite + React 19 + TypeScript (strict), Tailwind CSS 4, Firebase (Hosting, Anonymous Authentication, Firestore, App Check, one Cloud Function), Vitest + Playwright.

Money is **integer centavos**. Every price comes from a deterministic pricing engine in `src/domain/`; imported or pasted amounts are never trusted.

### Sample data and saved changes

The sample orders, customers, products, and settings are generated in the browser and never stored. Firestore holds only what a visitor changes, as small documents under `demos/{uid}`:

| Path | Holds |
|---|---|
| `demos/{uid}` | a profile with a counter of how many change documents the visitor has ever created, and a pointer to the latest one (`last`) |
| `demos/{uid}/orders/{orderId}` | an order and its items, plus the total the app calculated |
| `demos/{uid}/customers/{customerId}` | a customer |
| `demos/{uid}/settings/{key}` | a menu or dashboard setting |
| `demos/{uid}/verifications/{orderId}` | the server's recalculated total (written only by the Function) |

A deleted sample record is stored as a small marker so it stays deleted after a reload. The app renders the sample data immediately, then merges the visitor's changes in once sign-in finishes; writes wait until then. Firestore's persistent local cache keeps the app usable offline.

The document shapes are described at the top of `src/data/firestore-adapter.ts`.

### Security rules

`firestore.rules` is deny-by-default. A signed-in visitor can read and write only their own `demos/{uid}` tree. Writes are checked for exact field names and types, bounded sizes (up to 20 items per order, capped maps), and server timestamps. Creating a change document must raise the visitor's counter by exactly one in the same batch and record which document it counts in `last`, with a ceiling of 300 documents. The profile cannot be deleted by the client, so the counter only grows: resetting does not lift the 300-document lifetime limit for a visitor. Updates to a document must be at least one second apart. Verification documents can be read but never written by a client.

The rules have an emulator test suite (`npm run test:rules`).

### Sign-in and App Check

Each browser signs in with an **anonymous Firebase ID**. There is no email, name, or account. The ID is kept in the browser, so the same browser sees its own changes later, while a new browser or cleared site data starts fresh.

Requests to Firestore are checked by **Firebase App Check** with a reCAPTCHA Enterprise provider, so they must come from this app rather than a script. On localhost, App Check uses a debug token instead of reCAPTCHA.

The Firebase web configuration and the reCAPTCHA site key in `src/data/firebase.ts` are public by design: they identify the project and grant no access. Access is enforced by the rules and App Check above.

### Server verification (Cloud Function)

`functions/src/index.ts` defines `verifyOrderTotal`, a Firestore trigger on `demos/{uid}/orders/{orderId}`. When an order is written, it rebuilds the order from the stored fields, loads that visitor's menu settings (or the default catalog), prices it with the same engine the browser uses, and writes the result to `verifications/{orderId}`. It writes only when the result changed, and it never writes to orders, so it cannot trigger itself. When an order is deleted, it removes the verification. Events can arrive late or out of order, so the Function re-reads the order inside a transaction and skips any event that no longer describes it: an older write never overwrites a newer verification, and a stale delete never clears the verification of a recreated order.

The pricing engine from `src/domain/` is bundled into the Function with esbuild, so browser and server share one implementation. The bundle is built locally (`npm run build:functions`) before deploy; `functions/package.json` sets an empty `gcp-build` so the cloud build does not rebuild it.

Guardrails:

- Region `asia-southeast1`, the same region as the Firestore database
- `maxInstances: 1`, 256 MiB memory, 10 second timeout
- A spend cap and budget alert on the Firebase project

**The Function is additive.** The browser still prices and saves every order itself. If the Function is unavailable, the demo keeps working and the chip simply does not appear after a short wait.

### Data boundaries

- Sample data only. Nothing here comes from a real business, and no production system is connected.
- Visitors are identified only by the anonymous ID above; there are no accounts, emails, or sign-in details.
- Anything you type, such as a customer name, phone number, or address, is stored under your anonymous visitor ID until you reset. Please use made-up details.
- Reset deletes only your own changes; other visitors are not affected. It does not reset the per-visitor document counter.
- No AI or language-model calls anywhere in the app or the Function.

## Requirements

- Node.js 22 (see `.nvmrc`)
- npm
- Java 21, only for the Firestore rules tests (the Firestore emulator)

## Commands

```sh
npm install
npm --prefix functions install
VITE_STORAGE=local npm run dev   # sample data in IndexedDB, no Firebase
npm run dev                      # Firebase-backed (see below)
npm run lint
npm test
npm run build
npm run build:functions
npm run check:bundle
npm run check:public-safe
npm run test:rules
npm run test:e2e
npm run check
npm run preview
```

`VITE_STORAGE=local` swaps Firestore for the browser's IndexedDB. Unit tests and the end-to-end smoke test run this way, so they need no network or credentials.

`npm run dev` without it talks to the real Firebase project. On localhost, App Check needs a debug token registered in the Firebase console: run once with `VITE_APPCHECK_DEBUG=true`, copy the token printed in the browser console, register it, then set `VITE_APPCHECK_DEBUG` to that token. To run against your own project, override the `VITE_FIREBASE_*` values read in `src/data/firebase.ts`.

`npm run test:e2e` needs Playwright Chromium (`npx playwright install --with-deps chromium` once).

`npm run check` runs lint, unit tests, production build, the Function bundle, bundle budget, public-safety scan, rules tests, and the e2e smoke test.

`npm run check:public-safe` scans the source, the Function, and the built `dist/` for backend credentials, vendor SDKs, and production brand strings, and fails if any are found.

## CI

`.github/workflows/quality.yml` runs on every pull request and on pushes to `main`: lint, unit tests, production build, Function bundle, public-safety scan, bundle budget, Firestore rules tests against the emulator, and the e2e smoke test on local storage. It needs no repository secrets.

## Hosting

Firebase Hosting serves the built app (`dist/`) as a single-page app with security headers, including a Content Security Policy, defined in `firebase.json`.
