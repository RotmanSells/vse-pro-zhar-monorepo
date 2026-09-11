import { useCallback, useEffect, useRef, useState } from "react";

import {
  createAdminSegmentPreviewRequestController,
  createAdminSegmentsListRequestController,
  type AdminSegmentPreviewRequestController,
  type AdminSegmentPreviewState,
  type AdminSegmentsClient,
  type AdminSegmentsListRequestController,
  type AdminSegmentsListState
} from "@vse-pro-zhar/api-client";
import type {
  AdminBuiltinSegmentDefinition,
  AdminSegmentCode,
  AdminSegmentCount,
  AdminSegmentPreviewResponse
} from "@vse-pro-zhar/contracts";

import { useModalBehavior } from "./modal-behavior";

function countLabel(count: AdminSegmentCount): string {
  return count.status === "confirmed" ? count.count.toLocaleString("ru-RU") : "—";
}

function countDescription(count: AdminSegmentCount): string {
  if (count.status === "confirmed") return "клиентов";
  return count.reason === "not_configured" ? "данные не настроены" : "нужна сверка";
}

function formatMoney(valueMinor: number): string {
  return `${(valueMinor / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₽`;
}

function formatDate(value: string | null): string {
  return value === null ? "—" : new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" });
}

function SegmentCard({ segment, onOpen }: { readonly segment: AdminBuiltinSegmentDefinition; readonly onOpen: (code: AdminSegmentCode) => void }): React.JSX.Element {
  return <button aria-label={`Открыть сегмент «${segment.title}»`} className="segment-card" onClick={() => onOpen(segment.code)} title={segment.count.status === "unavailable" ? "Подробности доступны после сверки данных" : undefined} type="button">
    <span className={`seg-badge ${segment.badge.tone}`}>{segment.badge.label}</span>
    <span aria-hidden="true" className="seg-icon">{segment.icon}</span>
    <span className="seg-name">{segment.title}</span>
    <span className="seg-count">{countLabel(segment.count)}</span>
    <span className="seg-label">{countDescription(segment.count)}</span>
    <span className="seg-desc">{segment.description}</span>
  </button>;
}

function SegmentsLoading(): React.JSX.Element {
  return <div aria-label="Загрузка сегментов" className="segment-grid segments-skeleton" role="status">{Array.from({ length: 9 }, (_, index) => <div className="segment-skeleton-card" key={index}><span /><span /><span /><span /></div>)}</div>;
}

function DisabledAction({ children, title }: { readonly children: React.ReactNode; readonly title: string }): React.JSX.Element {
  return <button aria-disabled="true" className="btn btn-sm btn-outline" disabled title={title} type="button">{children}</button>;
}

function DetailTable({ response }: { readonly response: Extract<AdminSegmentPreviewResponse, { status: "confirmed" }> }): React.JSX.Element {
  if (response.customers.length === 0) return <div className="table-empty">Нет клиентов в этом сегменте</div>;
  return <div className="table-scroll"><table><thead><tr><th>Имя</th><th>Телефон</th><th>Заказов</th><th>Потрачено</th><th>Последний визит</th></tr></thead><tbody>{response.customers.map((customer) => <tr key={customer.id}><td data-label="Имя"><strong>{customer.name}</strong></td><td data-label="Телефон">{customer.phoneMasked}</td><td data-label="Заказов">{customer.orderCount.toLocaleString("ru-RU")}</td><td data-label="Потрачено"><strong>{formatMoney(customer.spentMinor)}</strong></td><td data-label="Последний визит">{formatDate(customer.lastActivityAt)}</td></tr>)}</tbody></table></div>;
}

function CreateSegmentModal({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  useModalBehavior(modalRef, onClose, closeButtonRef);
  return <div aria-labelledby="new-segment-title" className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
    <div aria-describedby="segment-write-unavailable" aria-modal="true" className="modal-box" ref={modalRef} role="dialog" tabIndex={-1}>
      <h2 id="new-segment-title">Новый сегмент</h2>
      <div className="segments-unavailable-note" id="segment-write-unavailable" role="status"><strong>Создание пока недоступно</strong><span>Нужно утвердить production-критерии, часовой пояс и lifecycle пользовательских сегментов.</span></div>
      <fieldset className="segments-disabled-form" disabled>
        <div className="form-group"><span>Название</span><input placeholder="Мои VIP-клиенты" /></div>
        <div className="form-row"><div className="form-group"><span>Условие</span><select defaultValue="orders_gte"><option value="orders_gte">Заказов больше или равно</option><option value="orders_lte">Заказов меньше или равно</option><option value="spend_gte">Потратили больше или равно</option><option value="spend_lte">Потратили меньше или равно</option><option value="inactive_days_gte">Не заходили (дней) больше или равно</option><option value="active_days_lte">Заходили (дней) меньше или равно</option><option value="coal_gte">Угольков больше или равно</option><option value="average_check_gte">Средний чек больше или равно</option></select></div><div className="form-group"><span>Значение</span><input min="0" placeholder="3" type="number" /></div></div>
      </fieldset>
      <div className="modal-actions"><button className="btn btn-outline" onClick={onClose} ref={closeButtonRef} type="button">Отмена</button><button className="btn btn-primary" disabled title="Создание пользовательских сегментов требует owner decision gate" type="button">Создать</button></div>
    </div>
  </div>;
}

export interface SegmentsScreenProps { readonly client: AdminSegmentsClient; readonly onOpenCommunications?: (code: AdminSegmentCode) => void; }

export function SegmentsScreen({ client, onOpenCommunications }: SegmentsScreenProps): React.JSX.Element {
  const [listState, setListState] = useState<AdminSegmentsListState>({ status: "loading" });
  const [previewState, setPreviewState] = useState<AdminSegmentPreviewState>({ status: "idle", code: null, query: { limit: 25, offset: 0 } });
  const [selectedCode, setSelectedCode] = useState<AdminSegmentCode | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const listControllerRef = useRef<AdminSegmentsListRequestController | null>(null);
  const previewControllerRef = useRef<AdminSegmentPreviewRequestController | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = createAdminSegmentsListRequestController(client, setListState);
    listControllerRef.current = controller;
    controller.load();
    return () => { controller.dispose(); if (listControllerRef.current === controller) listControllerRef.current = null; };
  }, [client]);

  useEffect(() => {
    const controller = createAdminSegmentPreviewRequestController(client, setPreviewState);
    previewControllerRef.current = controller;
    return () => { controller.dispose(); if (previewControllerRef.current === controller) previewControllerRef.current = null; };
  }, [client]);

  const openSegment = useCallback((code: AdminSegmentCode): void => {
    setSelectedCode(code);
    previewControllerRef.current?.load(code, { limit: 25, offset: 0 });
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);
  const closeSegment = useCallback((): void => { setSelectedCode(null); }, []);
  const closeCreateModal = useCallback((): void => { setCreateModalOpen(false); }, []);
  const retryList = useCallback((): void => { listControllerRef.current?.retry(); }, []);
  const retryPreview = useCallback((): void => { previewControllerRef.current?.retry(); }, []);
  const response = listState.status === "success" ? listState.response : null;
  const detailVisible = selectedCode !== null;
  const detail = previewState.status === "success" && previewState.code === selectedCode ? previewState.response : null;
  const detailTitle = detail?.segment.title ?? "Клиенты сегмента";
  const detailCount = detail?.segment.count.status === "confirmed" ? detail.segment.count.count.toLocaleString("ru-RU") : "—";
  const messageActionEnabled = onOpenCommunications !== undefined && previewState.status === "success" && detail?.status === "confirmed";
  return <section aria-labelledby="segments-title" className="segments-screen">
    <div className="page-header"><div><h1 className="page-title" id="segments-title">Сегменты клиентов</h1><p className="page-subtitle">Группируйте клиентов и возвращайте их</p></div><div className="header-actions"><button className="btn btn-primary" onClick={() => setCreateModalOpen(true)} type="button">＋ Создать сегмент</button></div></div>
    {listState.status === "loading" ? <SegmentsLoading /> : null}
    {listState.status === "error" ? <div className="catalog-state catalog-state-error" role="alert"><strong>Сегменты временно недоступны</strong><span>{listState.message}</span><button className="btn btn-outline" onClick={retryList} type="button">Повторить</button></div> : null}
    {response !== null ? <>
      <div className="segments-builtin-section"><h2>📊 Готовые сегменты</h2><div className="segment-grid">{response.builtins.map((segment) => <SegmentCard key={segment.code} onOpen={openSegment} segment={segment} />)}</div></div>
      <div className="table-card segments-custom-card"><div className="table-header"><h2>Мои сегменты</h2></div><div className="table-scroll"><table><thead><tr><th>Название</th><th>Условие</th><th>Клиентов</th><th>Действия</th></tr></thead><tbody><tr><td className="table-empty" colSpan={4}>Пока нет пользовательских сегментов</td></tr></tbody></table></div></div>
      <div className="segments-unavailable-note"><strong>Пользовательские сегменты пока недоступны</strong><span>После утверждения production-критериев здесь появятся bounded create/update/deactivate операции. Данные built-in сегментов считаются только Backend.</span></div>
    </> : null}
    {detailVisible ? <div className="table-card segment-detail-card" ref={detailRef}><div className="table-header segment-detail-header"><h2>{detail?.segment.icon ?? "📋"} {detailTitle} ({detailCount})</h2><div className="row-actions"><button className="btn btn-sm btn-primary" disabled={!messageActionEnabled} onClick={() => { if (selectedCode !== null) onOpenCommunications?.(selectedCode); }} title={messageActionEnabled ? "Открыть безопасный preview сообщения" : "Сначала дождитесь live preview сегмента"} type="button">✈ Написать сегменту</button><DisabledAction title="Экспорт персональных данных пока недоступен">⇩ Экспорт CSV</DisabledAction><button className="btn btn-sm btn-outline" onClick={closeSegment} type="button">Закрыть</button></div></div>{previewState.status === "loading" && previewState.code === selectedCode ? <div className="catalog-state" role="status">Загружаем клиентов сегмента…</div> : null}{previewState.status === "error" && previewState.code === selectedCode ? <div className="catalog-state catalog-state-error" role="alert"><strong>Preview временно недоступен</strong><span>{previewState.message}</span><button className="btn btn-outline" onClick={retryPreview} type="button">Повторить</button></div> : null}{previewState.status === "success" && previewState.code === selectedCode && previewState.response.status === "unavailable" ? <div className="segments-unavailable-state" role="alert"><strong>Нужна сверка данных</strong><span>{previewState.response.reason === "not_configured" ? "Источник лояльности ещё не настроен." : "Backend не показывает неподтверждённое членство в сегменте."}</span></div> : null}{previewState.status === "success" && previewState.code === selectedCode && previewState.response.status === "confirmed" ? <DetailTable response={previewState.response} /> : null}</div> : null}
    {createModalOpen ? <CreateSegmentModal onClose={closeCreateModal} /> : null}
  </section>;
}
