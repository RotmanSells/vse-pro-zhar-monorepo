# Дорожная карта

- M0 Foundation — completed candidate: workspace, API/contracts, Customer Web, Admin Web, PostgreSQL/Drizzle, CI and foundation verification.
- M1 Categories
- M2 Products + Images
- M3 iiko mapping + availability
- M4 Cart
- M5 Customer authentication
- M6 Pickup checkout
- M7 Orders
- M8 SBP payment
- M9 iiko order submission
- M10 Kitchen statuses
- M11 Admin Orders
- M12 Cancellation + Refund
- M13 Loyalty
- M14 Wheel + Quests
- M15 Push + SMS
- M16 Analytics / Admin completion
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

M0 не создаёт catalog, auth, orders, payments, iiko, loyalty или другую business functionality.
