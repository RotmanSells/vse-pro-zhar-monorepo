# Дорожная карта

- M0 Foundation — completed: workspace, API/contracts, Customer Web, Admin Web, PostgreSQL/Drizzle, CI and foundation verification.
- M1 Catalog — completed: categories, products, Admin mutations, Customer catalog view and web verification.
- M2 Products + Images — completed: server-side image upload, validation, WebP optimization and catalog integration.
- M3 iiko mapping + availability — partially completed inside M6: explicit read-only Product → iiko mapping, terminal health and stop-list are implemented fail-closed; durable mapping management and real-account conformance remain open.
- M4 Cart — completed: guest local cart, current PostgreSQL-backed quote and Customer persistence/UI.
- M5 Customer authentication — Web/iOS/Android используют server-backed lightweight identification по номеру телефона с cookie/bearer sessions; SMS-код не требуется.
- M6 Pickup checkout — completed: authenticated read-only pickup quote with explicit iiko-compatible availability adapter; real production iiko conformance remains outside this local slice
- M7 Orders — completed: internal `pending_payment` orders, idempotency and Customer-owned history; payment and iiko submission remain outside M7
- M8 Payment — completed for test-mode bank cards: persisted YooKassa payments/events, strict server-confirmed webhook flow and Customer pending/refresh UI; SBP is unavailable in the current test store and production payment readiness is not claimed.
- M9 iiko order submission — completed in the local simulator slice: durable payment-confirmed intent, stable correlation ID, runtime-validated write adapter, duplicate recovery and bounded in-process retries; real-account conformance remains open.
- M10 Kitchen statuses — completed in the local simulator slice: resumable polling, monotonic order history, Customer refresh/AppState presentation and controlled `fulfillment_problem`; Admin Orders and refunds remain later milestones.
- M11 Admin Orders — completed local vertical slice: separate staff auth/session boundary with one administrator access level, bounded Orders list/detail, audited idempotent iiko retry/reconciliation and protected catalog/media routes. Production identity bootstrap and real iiko account conformance remain operational prerequisites, not silently claimed as complete.
- M12 Cancellation + Refund — local safe Customer/Admin cancellation and provider-confirmed refund state implemented; dedicated YooKassa test-payment and receipt/accounting validation remain required before production readiness.
- M13 Loyalty — local implementation complete, external manual gate open: server-owned integer XP/coal ledger, fixed ranks, completed-paid order earn boundary, Customer summary/history and read-only Admin history are verified locally. M13.5 adds fixed-discount reward definitions, atomic coal redemption and redemption snapshots; dedicated YooKassa test-payment/refund and real-account accounting gates remain operational prerequisites.
- M13.3 Prototype visual parity — completed for the current Customer/Admin production surfaces; responsive/browser evidence is recorded in the completed execution plan, while prototype-only features remain unavailable.
- M14 Wheel + Quests — local server-owned vertical slice implemented with approved XP/coal-only rewards, immutable events/claims, idempotent spin/quest processing and responsive Customer/Admin surfaces; real-device release validation remains an operational checkpoint.
- M15 Push + SMS — native Expo push registration, server device/preferences API и phone-only auth реализованы; SMS provider adapter зарезервирован для будущих уведомлений без кодовых сообщений. Production credentials и device-store release validation остаются operational gates.
- M16 Analytics / Admin completion
- M16.7 Admin Category Management — completed: server-owned category list, create/edit/reorder/hide/restore UI, strict Staff/API contract, versioned append-only audit history and Customer fail-closed regression coverage.
- M17 Native validation
- M18 TestFlight / Google Play testing
- M19 Production release

После M0 каждый этап реализуется как vertical slice:

```text
Admin / Customer intent
→ Backend validation and API
→ PostgreSQL state
→ external provider adapter where applicable
→ Customer/Admin presentation
→ automated tests and verification
```

M0 не создаёт catalog, auth, orders, payments, iiko, loyalty или другую business functionality; M1 закрывает первый catalog slice.
