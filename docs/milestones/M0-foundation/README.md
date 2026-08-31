# M0 — Project Foundation

Status: completed

## Цель

Получить минимальный технический фундамент, после которого продуктовые функции можно реализовывать вертикальными срезами.

M0 создаёт запускаемые границы приложений, общие контракты, database foundation, базовую проверку и документационную основу. Production business functionality в M0 ещё не требуется.

## Части milestone

- [x] [M0.1 — Workspace Foundation](../../exec-plans/completed/M0.1-workspace-foundation.md)
- [x] [M0.2 — API + Shared Contracts Foundation](../../exec-plans/completed/M0.2-api-shared-contracts.md)
- [x] M0.3 — Customer Web Foundation
- [x] M0.4 — Admin Web Foundation
- [x] M0.5 — Database Foundation
- [x] M0.6 — CI + Foundation Verification

Фактический результат M0.3–M0.6 зафиксирован в [completed execution plan](../../exec-plans/completed/M0-complete-foundation.md).

## High-level Definition of Done

- monorepo работает;
- Customer Web запускается;
- Admin Web запускается;
- API запускается;
- shared runtime contracts работают;
- Customer и Admin используют Backend API;
- database foundation и migrations работают;
- CI работает;
- lint проходит;
- typecheck проходит;
- tests проходят;
- builds проходят;
- foundation документирован;
- production business functionality ещё не требуется.

## Не входит в M0

Catalog, Auth, Orders, Payments, iiko и Loyalty относятся к последующим vertical slices, а не к Project Foundation.

## Связанные документы

- [Execution Plan convention](../../../PLANS.md)
- [Roadmap](../../ROADMAP.md)
