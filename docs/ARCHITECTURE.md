                         PostgreSQL
                             ▲
                             │
                    ┌────────┴────────┐
                    │   Backend API   │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   Customer App          Admin Web          Integrations
        │                                     │
 ┌──────┼──────┐                         ┌─────┼─────┐
 │      │      │                         │     │     │
Web    iOS  Android                     iiko  SBP   SMS/Push
Customer:
Expo + React Native + React Native Web
Web-first, not WebView-first

Admin:
React + Vite
Web only

Backend:
Node.js + TypeScript + Fastify
Modular monolith

Database:
PostgreSQL

Contracts:
Zod

Каталог/цена → Backend + PostgreSQL
Availability → iiko через Backend
Итог checkout → Backend
Оплата → payment provider + Backend
Kitchen status → iiko + persisted Backend history
Rewards → Backend
