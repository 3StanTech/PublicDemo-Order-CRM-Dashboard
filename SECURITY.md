# Security

## Reporting a problem

Contact the maintainer privately through the email link on https://tristandolfo.netlify.app/, with "Café demo security" in the subject. Please do not open a public issue for a vulnerability.

## What this demo is

A client-rendered React app (Vite) served from Firebase Hosting, with fictional sample data. Each visitor's changes are stored under an anonymous Firebase ID; Firestore access is limited by `firestore.rules` and App Check. One Cloud Function, `verifyOrderTotal` (`functions/`), re-prices every saved order on the server and records whether the totals agree.

## Dependency notes

`npm audit` was last reviewed on 2026-11-12, for the web app and for `functions/`. Every fix that does not downgrade a package has been applied. The advisories below remain, all in the web app's tree; `functions/` reports none. "Browser bundle" means the code ships to visitors; "build or CI tooling" means it runs only on a developer machine or in GitHub Actions.

| Advisory | Severity | Path | Where it runs | Why it remains |
| --- | --- | --- | --- | --- |
| [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j), [GHSA-f596-whhp-79r4](https://github.com/advisories/GHSA-f596-whhp-79r4) | high, low | `firebase` → `@firebase/firestore` → `@grpc/grpc-js` 1.9.16 | Not shipped. `@grpc/grpc-js` is Firestore's Node.js transport; the browser build uses WebChannel. A search of the built `dist/` for `@grpc/grpc-js` and gRPC-only strings finds nothing. | Both are server-side gRPC issues. The latest Firebase SDK (13.x) still pins `@grpc/grpc-js ~1.9.0`; npm's suggested fix is a downgrade to `firebase@9`, which is not taken. |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | moderate | `firebase-tools` → `glob`; `vite-plugin-pwa` → `workbox-build` → `glob` | Build or CI tooling (emulators; service-worker generation at build time). | Waiting for upstream releases. `vite-plugin-pwa` 2.0.0 was tried and still depends on `workbox-build` 7.4, so it was not kept. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | moderate | `firebase-tools`, `vite-plugin-pwa` → `workbox-build` → `minimatch` | Build or CI tooling. | Waiting for upstream releases. |
| [GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf) | moderate | `firebase-tools` → `@google-cloud/pubsub` → `@opentelemetry/core` | Build or CI tooling. | Waiting for an upstream `firebase-tools` release. |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | moderate | `firebase-tools` → `gaxios` → `uuid` | Build or CI tooling. | Waiting for an upstream `firebase-tools` release. |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | low | `vite-plugin-pwa` → `workbox-build` → `deepmerge` | Build tooling (service-worker generation). | No patched `deepmerge` release exists. |

Fixed in this review, for the record: `react-router` → 7.18.5 (its advisory concerned React Server Components mode; this app is client-rendered), `re2js` → 2.10.0, and in `functions/`, `firebase-admin` 13 → 14 with `firebase-functions` 6 → 7, which clears the function's `uuid` advisory. The function's deployed settings (region `asia-southeast1`, one instance, 256 MiB, 10 s, Node.js 22) are unchanged.
