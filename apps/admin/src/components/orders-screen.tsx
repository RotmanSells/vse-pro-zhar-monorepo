import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createAdminOrdersRequestController,
  type AdminOrderDetailState,
  type AdminCancellationState,
  type AdminOrdersClient,
  type AdminOrdersListState,
  type AdminOrdersQuery,
  type AdminOrdersRequestController,
  type AdminRecoveryState
} from "@vse-pro-zhar/api-client";
import type { AdminOrderListItem } from "@vse-pro-zhar/contracts";

interface OrdersScreenProps { readonly client: AdminOrdersClient }

const statusLabels: Record<string, string> = {
  pending_payment: "Ожидает оплаты",
  payment_confirmed: "Оплачен",
  kitchen_accepted: "Принят кухней",
  preparing: "Готовится",
  ready_for_pickup: "Готов к выдаче",
  completed: "Выдан",
  fulfillment_problem: "Проблема исполнения",
  canceled: "Отменён"
};
const fulfillmentLabels: Record<string, string> = {
  pending: "В очереди",
  creating: "Создаётся",
  command_pending: "Ожидает команды",
  submitted: "Отправлен в iiko",
  failed: "Ошибка"
};

function money(value: number, currency: string): string {
  return `${(value / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2 })} ${currency}`;
}
function date(value: string): string {
  return new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}
function statusLabel(value: string): string { return statusLabels[value] ?? value; }
function fulfillmentLabel(value: string | null): string { return value === null ? "—" : fulfillmentLabels[value] ?? value; }

function OrderRow({ order, onOpen }: { readonly order: AdminOrderListItem; readonly onOpen: () => void }): React.JSX.Element {
  const problem = order.status === "fulfillment_problem" || order.fulfillmentStatus === "failed";
  return (
    <tr className={problem ? "order-problem-row" : undefined}>
      <td data-label="Заказ"><button className="link-button" onClick={onOpen} type="button">#{order.id}</button></td>
      <td data-label="Клиент"><strong>{order.customer.name}</strong><span className="product-description">{order.customer.phoneMasked}</span></td>
      <td data-label="Сумма"><strong>{money(order.totalMinor, order.currency)}</strong></td>
      <td data-label="Статус"><span className={`status-badge ${problem ? "status-problem" : "status-visible"}`}>{problem ? "⚠ " : ""}{statusLabel(order.status)}</span></td>
      <td data-label="Оплата">{order.paymentStatus ?? "—"}</td>
      <td data-label="Исполнение"><span className={problem ? "danger-text" : undefined}>{fulfillmentLabel(order.fulfillmentStatus)}{order.fulfillmentErrorCode === null ? "" : ` · ${order.fulfillmentErrorCode}`}</span></td>
      <td data-label="Создан"><span className="product-description">{date(order.createdAt)}</span><button className="btn btn-sm btn-outline" onClick={onOpen} type="button">Открыть</button></td>
    </tr>
  );
}

function Detail({ state, recovery, cancellation, controller }: { readonly state: AdminOrderDetailState; readonly recovery: AdminRecoveryState; readonly cancellation: AdminCancellationState; readonly controller: AdminOrdersRequestController }): React.JSX.Element | null {
  if (state.status !== "success") {
    if (state.status === "loading") return <div className="order-detail-card" role="status">Загружаем заказ…</div>;
    if (state.status === "error") return <div className="order-detail-card catalog-state-error" role="alert"><strong>Не удалось загрузить заказ</strong><span>{state.message}</span><button className="btn btn-outline" onClick={() => controller.refreshOrder()} type="button">Повторить</button></div>;
    return null;
  }
  const order = state.order;
  const canRecover = order.status === "fulfillment_problem" && order.fulfillment?.status === "failed";
  const canCancel = (order.status === "pending_payment" || order.status === "payment_confirmed") && (order.cancellation === undefined || order.cancellation === null) && (order.fulfillment === null || (order.fulfillment.status === "pending" && order.fulfillment.providerOrderId === null));
  const recover = (): void => {
    if (!canRecover || typeof window !== "undefined" && !window.confirm("Повторно запустить безопасную отправку заказа? Новый заказ создаваться не будет.")) return;
    controller.retryFulfillment(order.id);
  };
  const cancel = (): void => {
    if (!canCancel || typeof window !== "undefined" && !window.confirm("Отменить заказ и, если он оплачен, запустить полный возврат сохранённой суммы?")) return;
    controller.cancelOrder(order.id, `admin-cancel-${order.id}`);
  };
  const reconcile = (): void => {
    if (order.refund?.status !== "reconciliation_required" || typeof window !== "undefined" && !window.confirm("Проверить статус возврата у YooKassa? Новый возврат создан не будет.")) return;
    controller.reconcileRefund(order.id, `admin-reconcile-${order.id}`);
  };
  return (
    <section className="order-detail-card" aria-labelledby="order-detail-title">
      <div className="order-detail-header"><div><p className="eyebrow">ЗАКАЗ #{order.id}</p><h2 id="order-detail-title">{order.customer.name}</h2><p className="page-subtitle">Создан {date(order.history[0]?.createdAt ?? new Date().toISOString())}</p></div><button className="btn btn-outline" onClick={() => controller.refreshOrder()} type="button">Обновить</button></div>
      {order.status === "fulfillment_problem" ? <div className="problem-banner" role="alert"><strong>⚠ Требуется внимание</strong><span>iiko не подтвердил исполнение. Статус кухни не изменён вручную.</span></div> : null}
      {recovery.status === "error" ? <div className="catalog-action-error" role="alert">{recovery.message}</div> : null}
      {recovery.status === "success" ? <div className="success-banner" role="status">Операция принята: {recovery.response.recovery.mode === "reconcile" ? "запущена сверка с iiko" : recovery.response.recovery.mode === "create" ? "заказ возвращён в очередь" : "операция уже выполняется"}.</div> : null}
      {cancellation.status === "error" ? <div className="catalog-action-error" role="alert">{cancellation.message}</div> : null}
      {cancellation.status === "success" ? <div className="success-banner" role="status">Отмена сохранена. Состояние возврата подтверждается отдельно провайдером.</div> : null}
      <div className="order-detail-grid">
        <div><h3>Клиент</h3><p>{order.customer.name}<br /><a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a></p></div>
        <div><h3>Самовывоз</h3><p>{order.pickup.locationName}<br />{order.pickup.address}<br />{order.pickup.slotLabel}</p></div>
        <div><h3>Оплата</h3><p>{order.payment === null ? "Нет платежа" : `${order.payment.status} · ${order.payment.providerStatus}`}<br />{money(order.totalMinor, order.currency)}</p></div>
        <div><h3>Статус заказа</h3><p><span className="status-badge status-visible">{statusLabel(order.status)}</span></p></div>
      </div>
      <h3>Позиции</h3>
      <div className="order-items-list">{order.items.map((item) => <div className="order-item" key={item.productId}><span>{item.productName} × {item.quantity}</span><strong>{money(item.lineTotalMinor, order.currency)}</strong></div>)}</div>
      <div className="fulfillment-panel"><div><h3>Исполнение</h3><p>{order.fulfillment === null ? "Dispatch не создан" : `${fulfillmentLabel(order.fulfillment.status)} · попыток: ${order.fulfillment.attemptCount}`}</p>{order.fulfillment?.errorCode !== null && order.fulfillment !== null ? <p className="danger-text">{order.fulfillment.errorCode}</p> : null}<p className="product-description">Correlation ID: {order.fulfillment?.correlationId ?? "—"}<br />Provider order ID: {order.fulfillment?.providerOrderId ?? "—"}</p></div>{canRecover ? <button className="btn btn-primary" disabled={recovery.status === "loading"} onClick={recover} type="button">{recovery.status === "loading" ? "Запускаем…" : order.fulfillment?.providerOrderId === null ? "Повторить отправку" : "Сверить с iiko"}</button> : null}</div>
      <div className="fulfillment-panel"><div><h3>Отмена и возврат</h3>{order.cancellation === undefined || order.cancellation === null ? <p>Отмена не запрашивалась.</p> : <p>Инициатор: {order.cancellation.actorType === "admin" ? "Admin" : "Customer"}<br />Причина: {order.cancellation.reasonCode}<br />Создано: {date(order.cancellation.createdAt)}</p>}{order.refund === undefined || order.refund === null ? <p>Возврат не требуется или ещё не создан.</p> : <p>Статус: <strong>{order.refund.status}</strong><br />Сумма: {money(order.refund.amountMinor, order.refund.currency)}<br />Provider refund ID: {order.refund.providerRefundId ?? "ещё не присвоен"}<br />Попытка: {order.refund.attemptedAt === null ? "—" : date(order.refund.attemptedAt)}<br />Подтверждение: {order.refund.lastConfirmedAt === null ? "—" : date(order.refund.lastConfirmedAt)}{order.refund.lastErrorCode === null ? "" : <><br />Код: {order.refund.lastErrorCode}</>}</p>}{order.refundEvents?.map((event) => <p className="product-description" key={`${event.eventType}-${event.receivedAt}`}>Событие {event.eventType}: {event.providerStatus} · {date(event.receivedAt)}</p>)}</div><div className="row-actions">{canCancel ? <button className="btn btn-primary" disabled={cancellation.status === "loading"} onClick={cancel} type="button">{cancellation.status === "loading" ? "Сохраняем…" : "Отменить заказ"}</button> : null}{order.refund?.status === "reconciliation_required" ? <button className="btn btn-outline" disabled={cancellation.status === "loading"} onClick={reconcile} type="button">Проверить возврат</button> : null}</div></div>
      <h3>История</h3><ol className="order-timeline">{order.history.map((entry) => <li key={`${entry.status}-${entry.createdAt}`}><span>{statusLabel(entry.status)}</span><time>{date(entry.createdAt)}</time></li>)}</ol>
    </section>
  );
}

export function OrdersScreen({ client }: OrdersScreenProps): React.JSX.Element {
  const [listState, setListState] = useState<AdminOrdersListState>({ status: "loading" });
  const [detailState, setDetailState] = useState<AdminOrderDetailState>({ status: "idle" });
  const [recoveryState, setRecoveryState] = useState<AdminRecoveryState>({ status: "idle" });
  const [cancellationState, setCancellationState] = useState<AdminCancellationState>({ status: "idle" });
  const [status, setStatus] = useState("");
  const [fulfillmentStatus, setFulfillmentStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const controllerRef = useRef<AdminOrdersRequestController | null>(null);
  const query = useMemo<AdminOrdersQuery>(() => {
    const next: {
      status?: NonNullable<AdminOrdersQuery["status"]>;
      fulfillmentStatus?: NonNullable<AdminOrdersQuery["fulfillmentStatus"]>;
      paymentStatus?: NonNullable<AdminOrdersQuery["paymentStatus"]>;
      search?: string;
      from?: string;
      to?: string;
      limit: number;
      offset: number;
    } = { limit: 25, offset };
    if (status !== "") next.status = status as NonNullable<AdminOrdersQuery["status"]>;
    if (fulfillmentStatus !== "") next.fulfillmentStatus = fulfillmentStatus as NonNullable<AdminOrdersQuery["fulfillmentStatus"]>;
    if (paymentStatus !== "") next.paymentStatus = paymentStatus as NonNullable<AdminOrdersQuery["paymentStatus"]>;
    if (search.trim() !== "") next.search = search.trim();
    if (fromDate !== "") next.from = `${fromDate}T00:00:00.000Z`;
    if (toDate !== "") next.to = `${toDate}T23:59:59.999Z`;
    return next;
  }, [fromDate, fulfillmentStatus, offset, paymentStatus, search, status, toDate]);
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    const controller = createAdminOrdersRequestController(client, setListState, setDetailState, setRecoveryState, setCancellationState);
    controllerRef.current = controller;
    controller.loadOrders(query);
    return () => { controller.dispose(); if (controllerRef.current === controller) controllerRef.current = null; };
  }, [client]);
  useEffect(() => { if (controllerRef.current !== null) controllerRef.current.loadOrders(query); }, [queryKey]);
  const openOrder = useCallback((id: number): void => { setSelectedOrderId(id); setRecoveryState({ status: "idle" }); setCancellationState({ status: "idle" }); controllerRef.current?.loadOrder(id); }, []);
  const listContent = listState.status === "loading" ? <div className="catalog-state" role="status">Загружаем заказы…</div> : listState.status === "error" ? <div className="catalog-state catalog-state-error" role="alert"><strong>Не удалось загрузить заказы</strong><span>{listState.message}</span><button className="btn btn-outline" onClick={() => controllerRef.current?.retryOrders()} type="button">Повторить</button></div> : listState.status === "success" && listState.response.orders.length === 0 ? <div className="table-empty">Заказов по выбранным условиям нет</div> : listState.status === "success" ? <div className="table-scroll"><table><thead><tr><th>Заказ</th><th>Клиент</th><th>Сумма</th><th>Статус</th><th>Оплата</th><th>Исполнение</th><th>Создан</th></tr></thead><tbody>{listState.response.orders.map((order) => <OrderRow key={order.id} order={order} onOpen={() => openOrder(order.id)} />)}</tbody></table></div> : null;
  const pageBack = (): void => { setOffset((current) => Math.max(0, current - 25)); setSelectedOrderId(null); };
  const pageNext = (): void => { setOffset((current) => current + 25); setSelectedOrderId(null); };
  return <section className="orders-page" aria-labelledby="orders-title"><div className="page-header"><div><h1 className="page-title" id="orders-title">Заказы</h1><p className="page-subtitle">Оплата, исполнение и история подтверждённых операций</p></div><div className="header-actions"><button className="btn btn-outline" onClick={() => controllerRef.current?.retryOrders()} type="button">↻ Обновить</button></div></div><div className="orders-filters"><input aria-label="Поиск заказа или телефона" className="table-search" onChange={(event) => { setOffset(0); setSearch(event.target.value); }} placeholder="Номер заказа или телефона" value={search} /><select aria-label="Фильтр по статусу заказа" className="table-search" onChange={(event) => { setOffset(0); setStatus(event.target.value); }} value={status}><option value="">Все статусы</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Фильтр по исполнению" className="table-search" onChange={(event) => { setOffset(0); setFulfillmentStatus(event.target.value); }} value={fulfillmentStatus}><option value="">Любое исполнение</option>{Object.entries(fulfillmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Фильтр по оплате" className="table-search" onChange={(event) => { setOffset(0); setPaymentStatus(event.target.value); }} value={paymentStatus}><option value="">Любая оплата</option><option value="succeeded">succeeded</option><option value="pending">pending</option><option value="canceled">canceled</option><option value="none">Без платежа</option></select><label className="date-filter"><span>От</span><input aria-label="Дата от" className="table-search" onChange={(event) => { setOffset(0); setFromDate(event.target.value); }} type="date" value={fromDate} /></label><label className="date-filter"><span>До</span><input aria-label="Дата до" className="table-search" onChange={(event) => { setOffset(0); setToDate(event.target.value); }} type="date" value={toDate} /></label></div><div className="table-card orders-table-card"><div className="table-header"><h2>{listState.status === "success" ? `Все заказы (${listState.response.pagination.total})` : "Все заказы"}</h2></div>{listContent}<div className="pagination-actions">{listState.status === "success" && listState.response.orders.length > 0 ? <span>Показаны {listState.response.pagination.offset + 1}–{listState.response.pagination.offset + listState.response.orders.length} из {listState.response.pagination.total}</span> : null}<button aria-label="Предыдущая страница" className="btn btn-sm btn-outline" disabled={listState.status !== "success" || listState.response.pagination.offset === 0} onClick={pageBack} type="button">Назад</button><button aria-label="Следующая страница" className="btn btn-sm btn-outline" disabled={listState.status !== "success" || !listState.response.pagination.hasNext} onClick={pageNext} type="button">Вперёд</button></div></div>{selectedOrderId !== null ? <Detail cancellation={cancellationState} controller={controllerRef.current as AdminOrdersRequestController} recovery={recoveryState} state={detailState} /> : null}</section>;
}
