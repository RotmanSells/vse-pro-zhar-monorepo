import { useCallback, useEffect, useRef, useState } from "react";

import {
  createAdminCustomersRequestController,
  type AdminCustomersClient,
  type AdminCustomersRequestController,
  type AdminCustomersState
} from "@vse-pro-zhar/api-client";
import type { AdminCustomersQueryInput, AdminCustomerRow } from "@vse-pro-zhar/contracts";

function money(valueMinor: number): string {
  return `${(valueMinor / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₽`;
}

function date(value: string | null): string {
  return value === null ? "—" : new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" });
}

const rankLabels: Record<NonNullable<AdminCustomerRow["rank"]>, string> = {
  spark: "🏕️ Искра",
  heat: "🔥 Жар",
  flame: "🍳 Пламя",
  volcano: "👑 Вулкан"
};

function CustomerRow({ customer }: { readonly customer: AdminCustomerRow }): React.JSX.Element {
  return <tr>
    <td data-label="Имя"><strong>{customer.name}</strong></td>
    <td data-label="Телефон">{customer.phoneMasked}</td>
    <td data-label="Заказов">{customer.orderCount.toLocaleString("ru-RU")}</td>
    <td data-label="Потрачено"><strong>{money(customer.spentMinor)}</strong></td>
    <td data-label="Угольки">{customer.coalBalance === null ? "—" : `🔥 ${customer.coalBalance.toLocaleString("ru-RU")}`}</td>
    <td data-label="Ранг">{customer.rank === null ? "—" : `${rankLabels[customer.rank]} · ${customer.xp?.toLocaleString("ru-RU") ?? "—"} XP`}</td>
    <td data-label="Последний визит">{date(customer.lastActivityAt)}</td>
  </tr>;
}

function CustomerTable({ customers }: { readonly customers: readonly AdminCustomerRow[] }): React.JSX.Element {
  return <div className="table-scroll"><table><thead><tr><th>Имя</th><th>Телефон</th><th>Заказов</th><th>Потрачено</th><th>Угольки</th><th>Ранг</th><th>Последний визит</th></tr></thead><tbody>{customers.map((customer) => <CustomerRow customer={customer} key={customer.id} />)}</tbody></table></div>;
}

export interface CustomersScreenProps { readonly client: AdminCustomersClient }

export function CustomersScreen({ client }: CustomersScreenProps): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<AdminCustomersState>({ status: "loading", query: { limit: 25, offset: 0, search: "" } });
  const controllerRef = useRef<AdminCustomersRequestController | null>(null);
  const query: AdminCustomersQueryInput = { limit: 25, offset, search };

  useEffect(() => {
    const controller = createAdminCustomersRequestController(client, setState);
    controllerRef.current = controller;
    controller.load(query);
    return () => { controller.dispose(); if (controllerRef.current === controller) controllerRef.current = null; };
  }, [client]);

  useEffect(() => {
    if (controllerRef.current === null) return;
    controllerRef.current.load(query);
  }, [offset, search]);

  const onSearch = useCallback((value: string): void => { setOffset(0); setSearch(value); }, []);
  const retry = useCallback((): void => { controllerRef.current?.retry(); }, []);
  const response = state.status === "success" ? state.response : null;
  const unavailable = response?.status === "unavailable";
  return <section aria-labelledby="customers-title" className="customers-screen">
    <div className="page-header"><div><h1 className="page-title" id="customers-title">Клиенты</h1><p className="page-subtitle">База данных клиентов и их активность</p></div><div className="header-actions"><button aria-disabled="true" className="btn btn-outline" disabled title="Экспорт персональных данных пока недоступен" type="button">⇩ Экспорт</button></div></div>
    <div className="table-card customers-table-card">
      <div className="table-header"><h2>Все клиенты</h2><input aria-label="Поиск клиента" className="table-search" onChange={(event) => onSearch(event.target.value)} placeholder="Поиск клиента..." type="search" value={search} /></div>
      {state.status === "loading" ? <div className="catalog-state" role="status">Загружаем клиентов…</div> : null}
      {state.status === "error" ? <div className="catalog-state catalog-state-error" role="alert"><strong>Не удалось загрузить клиентов</strong><span>{state.message}</span><button className="btn btn-outline" onClick={retry} type="button">Повторить</button></div> : null}
      {unavailable ? <div className="catalog-state catalog-state-error" role="alert"><strong>Клиенты временно недоступны</strong><span>Backend не подтвердил данные списка клиентов.</span><button className="btn btn-outline" onClick={retry} type="button">Повторить</button></div> : null}
      {response?.status === "confirmed" && response.customers.length === 0 ? <div className="table-empty">{search.trim() === "" ? "Клиентов пока нет" : "Клиенты не найдены"}</div> : null}
      {response?.status === "confirmed" && response.customers.length > 0 ? <CustomerTable customers={response.customers} /> : null}
      {response?.status === "confirmed" ? <div className="pagination-actions"><span>Показаны {response.customers.length === 0 ? 0 : response.pagination.offset + 1}–{response.pagination.offset + response.customers.length} из {response.pagination.total}</span><button aria-label="Предыдущая страница клиентов" className="btn btn-sm btn-outline" disabled={response.pagination.offset === 0} onClick={() => setOffset(Math.max(0, response.pagination.offset - response.pagination.limit))} type="button">Назад</button><button aria-label="Следующая страница клиентов" className="btn btn-sm btn-outline" disabled={!response.pagination.hasNext} onClick={() => setOffset(response.pagination.offset + response.pagination.limit)} type="button">Вперёд</button></div> : null}
    </div>
    <div className="loyalty-safe-note"><strong>Безопасная модель</strong><span>Список доступен только Admin. Телефоны маскируются Backend; баланс, XP, rank и историю нельзя менять из этого раздела.</span></div>
  </section>;
}
