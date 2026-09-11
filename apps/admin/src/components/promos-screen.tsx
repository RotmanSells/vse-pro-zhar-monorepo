import { useCallback, useEffect, useRef, useState } from "react";

import {
  createAdminPromosRequestController,
  type AdminPromosClient,
  type AdminPromosRequestController,
  type AdminPromosState
} from "@vse-pro-zhar/api-client";
import type { AdminPromo, AdminPromoType } from "@vse-pro-zhar/contracts";

import { useModalBehavior } from "./modal-behavior";

function money(minor: number): string {
  return `${(minor / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₽`;
}

function moneyInput(minor: number): string {
  const rubles = minor / 100;
  return Number.isInteger(rubles) ? String(rubles) : rubles.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
}

function parseMinor(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/u.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

function discount(promo: AdminPromo): string {
  return promo.type === "percent" ? `${promo.value}%` : money(promo.value);
}

function statusLabel(status: AdminPromo["status"]): string {
  return status === "active" ? "Активен" : status === "inactive" ? "Выкл" : "Архив";
}

function Icon({ name }: { readonly name: "power" | "edit" | "archive" }): React.JSX.Element {
  if (name === "power") return <svg aria-hidden="true" className="promo-action-icon" viewBox="0 0 24 24"><path d="M12 3v8m5.66-5.66a8 8 0 1 1-11.32 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>;
  if (name === "edit") return <svg aria-hidden="true" className="promo-action-icon" viewBox="0 0 24 24"><path d="m4 16.5-.8 3.3 3.3-.8L17.8 7.7a2.1 2.1 0 0 0-3-3L4 16.5Zm9.7-9.7 3.5 3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  return <svg aria-hidden="true" className="promo-action-icon" viewBox="0 0 24 24"><path d="M5 7h14m-9 4v6m4-6v6M8 7l.7 12h6.6L16 7m-6 0V4h4v3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

interface PromoDraft {
  readonly id: number | null;
  readonly code: string;
  readonly description: string;
  readonly type: AdminPromoType;
  readonly value: string;
  readonly minimumOrder: string;
}

const emptyDraft: PromoDraft = { id: null, code: "", description: "", type: "percent", value: "", minimumOrder: "0" };

function draftFromPromo(promo: AdminPromo): PromoDraft {
  return { id: promo.id, code: promo.code, description: promo.description, type: promo.type, value: promo.type === "percent" ? String(promo.value) : moneyInput(promo.value), minimumOrder: moneyInput(promo.minimumOrderMinor) };
}

function PromoModal({ draft, error, busy, onChange, onClose, onSubmit }: { readonly draft: PromoDraft; readonly error: string | null; readonly busy: boolean; readonly onChange: (next: PromoDraft) => void; readonly onClose: () => void; readonly onSubmit: () => void }): React.JSX.Element {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  useModalBehavior(modalRef, onClose, closeButtonRef);
  const editing = draft.id !== null;
  return <div className="modal-overlay promo-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
    <div aria-describedby="promo-modal-description" aria-labelledby="promo-modal-title" aria-modal="true" className="modal-box" ref={modalRef} role="dialog" tabIndex={-1}>
      <h2 id="promo-modal-title">{editing ? "Редактировать промокод" : "Новый промокод"}</h2>
      <p className="sr-only" id="promo-modal-description">Поля определения промокода. Скидка сохраняется на Backend в целых копейках.</p>
      <div className="form-row">
        <label className="form-group"><span>Код</span><input aria-label="Код" autoCapitalize="characters" disabled={editing} maxLength={32} onChange={(event) => onChange({ ...draft, code: event.target.value.toUpperCase() })} placeholder="SPARK10" style={{ textTransform: "uppercase" }} value={draft.code} /></label>
        <label className="form-group"><span>Тип скидки</span><select aria-label="Тип скидки" onChange={(event) => onChange({ ...draft, type: event.target.value as AdminPromoType, value: "" })} value={draft.type}><option value="percent">Процент (%)</option><option value="fixed">Фиксированная сумма (₽)</option></select></label>
      </div>
      <div className="form-row">
        <label className="form-group"><span>Значение</span><input aria-label="Значение" inputMode="decimal" min="0.01" onChange={(event) => onChange({ ...draft, value: event.target.value })} placeholder={draft.type === "percent" ? "10" : "500"} step={draft.type === "percent" ? "1" : "0.01"} type="number" value={draft.value} /></label>
        <label className="form-group"><span>Минимальный заказ (₽)</span><input aria-label="Минимальный заказ" inputMode="decimal" min="0" onChange={(event) => onChange({ ...draft, minimumOrder: event.target.value })} placeholder="0" step="0.01" type="number" value={draft.minimumOrder} /></label>
      </div>
      <label className="form-group"><span>Описание</span><input aria-label="Описание" maxLength={240} onChange={(event) => onChange({ ...draft, description: event.target.value })} placeholder="Скидка 10% на весь заказ" value={draft.description} /></label>
      {error === null ? null : <div className="promo-form-error" role="alert">{error}</div>}
      <div className="modal-actions"><button className="btn btn-outline" disabled={busy} onClick={onClose} ref={closeButtonRef} type="button">Отмена</button><button className="btn btn-primary" disabled={busy} onClick={onSubmit} type="button">{busy ? "Сохраняем…" : "Сохранить"}</button></div>
    </div>
  </div>;
}

function PromoTable({ promos, busyKey, onEdit, onToggle, onArchive }: { readonly promos: readonly AdminPromo[]; readonly busyKey: string | null; readonly onEdit: (promo: AdminPromo) => void; readonly onToggle: (promo: AdminPromo) => void; readonly onArchive: (promo: AdminPromo) => void }): React.JSX.Element {
  return <div className="table-scroll promos-table-scroll"><table className="promos-table"><thead><tr><th>Код</th><th>Описание</th><th>Скидка</th><th>Активен</th><th>Использований</th><th>Действия</th></tr></thead><tbody>{promos.map((promo) => {
    const busy = busyKey === String(promo.id);
    return <tr key={promo.id}>
      <td data-label="Код"><strong className="promo-code">{promo.code}</strong></td>
      <td data-label="Описание">{promo.description || "—"}</td>
      <td data-label="Скидка"><strong>{discount(promo)}</strong>{promo.minimumOrderMinor > 0 ? <span className="promo-minimum">от {money(promo.minimumOrderMinor)}</span> : null}</td>
      <td data-label="Активен"><span className={`status-badge ${promo.status === "active" ? "status-visible" : promo.status === "inactive" ? "status-hidden" : "status-problem"}`}>{statusLabel(promo.status)}</span></td>
      <td data-label="Использований">{promo.usageCount.toLocaleString("ru-RU")} раз</td>
      <td data-label="Действия"><div className="row-actions promo-row-actions"><button aria-label={`${promo.status === "active" ? "Выключить" : "Включить"} промокод ${promo.code}`} className="btn btn-sm btn-outline promo-action-button" disabled={busy || promo.status === "archived"} onClick={() => onToggle(promo)} title={promo.status === "active" ? "Выключить" : "Включить"} type="button"><Icon name="power" /></button><button aria-label={`Редактировать промокод ${promo.code}`} className="btn btn-sm btn-outline promo-action-button" disabled={busy || promo.status === "archived"} onClick={() => onEdit(promo)} title="Редактировать" type="button"><Icon name="edit" /></button><button aria-label={`Архивировать промокод ${promo.code}`} className="btn btn-sm btn-danger promo-action-button" disabled={busy || promo.status === "archived"} onClick={() => onArchive(promo)} title="Архивировать" type="button"><Icon name="archive" /></button></div></td>
    </tr>;
  })}</tbody></table></div>;
}

export interface PromosScreenProps { readonly client: AdminPromosClient }

export function PromosScreen({ client }: PromosScreenProps): React.JSX.Element {
  const [state, setState] = useState<AdminPromosState>({ status: "loading", query: { limit: 50, offset: 0, search: "" } });
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<PromoDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const controllerRef = useRef<AdminPromosRequestController | null>(null);

  useEffect(() => {
    const controller = createAdminPromosRequestController(client, setState);
    controllerRef.current = controller;
    return () => { controller.dispose(); if (controllerRef.current === controller) controllerRef.current = null; };
  }, [client]);

  useEffect(() => {
    controllerRef.current?.load({ limit: 50, offset: 0, search });
  }, [search]);

  const reload = useCallback((): void => { controllerRef.current?.load({ limit: 50, offset: 0, search }); }, [search]);
  const openNew = useCallback((): void => { setFormError(null); setDraft(emptyDraft); }, []);
  const openEdit = useCallback((promo: AdminPromo): void => { setFormError(null); setDraft(draftFromPromo(promo)); }, []);
  const closeModal = useCallback((): void => { if (busyKey === null) setDraft(null); }, [busyKey]);

  const save = useCallback((): void => {
    if (draft === null) return;
    const code = draft.code.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/u.test(code)) { setFormError("Код: латинские буквы, цифры, _ или -, от 1 до 32 символов."); return; }
    const value = draft.type === "percent" ? Number(draft.value) : parseMinor(draft.value);
    const minimumOrderMinor = parseMinor(draft.minimumOrder);
    if (value === null || !Number.isInteger(value) || value < 1 || (draft.type === "percent" && value > 100)) { setFormError(draft.type === "percent" ? "Процент должен быть целым числом от 1 до 100." : "Значение скидки должно быть положительной суммой в рублях."); return; }
    if (minimumOrderMinor === null) { setFormError("Минимальный заказ должен быть суммой в рублях с максимумом двумя знаками после запятой."); return; }
    setFormError(null);
    setBusyKey(draft.id === null ? "new" : String(draft.id));
    const operation = draft.id === null
      ? client.create({ code, description: draft.description.trim(), type: draft.type, value, minimumOrderMinor, currency: "RUB", activeFrom: null, activeUntil: null, globalUsageLimit: null, perCustomerUsageLimit: null })
      : client.update(draft.id, { description: draft.description.trim(), type: draft.type, value, minimumOrderMinor, activeUntil: undefined });
    void operation.then(() => { setDraft(null); reload(); }, (error: unknown) => { setFormError(error instanceof Error ? error.message : "Не удалось сохранить промокод"); }).finally(() => setBusyKey(null));
  }, [client, draft, reload]);

  const mutate = useCallback((promo: AdminPromo, operation: () => Promise<unknown>): void => {
    setBusyKey(String(promo.id));
    void operation().then(() => reload(), (error: unknown) => setFormError(error instanceof Error ? error.message : "Операция с промокодом не выполнена")).finally(() => setBusyKey(null));
  }, [reload]);

  const response = state.status === "success" ? state.response : null;
  return <section aria-labelledby="promos-title" className="promos-screen">
    <div className="page-header"><div><h1 className="page-title" id="promos-title">Промокоды</h1><p className="page-subtitle">Создание и управление промокодами</p></div><div className="header-actions"><button className="btn btn-primary" onClick={openNew} type="button"><span aria-hidden="true">＋</span> Создать промокод</button></div></div>
    <div className="table-card promos-table-card">
      <div className="table-header"><h2>Промокоды</h2><input aria-label="Поиск промокода" className="table-search" onChange={(event) => { setSearch(event.target.value); }} placeholder="Поиск по коду или описанию" type="search" value={search} /></div>
      {state.status === "loading" ? <div aria-label="Загрузка промокодов" className="catalog-state promos-loading" role="status"><span className="promo-skeleton-line" /><span className="promo-skeleton-line" /><span className="promo-skeleton-line" /></div> : null}
      {state.status === "error" ? <div className="catalog-state catalog-state-error" role="alert"><strong>Не удалось загрузить промокоды</strong><span>{state.message}</span><button className="btn btn-outline" onClick={() => controllerRef.current?.retry()} type="button">Повторить</button></div> : null}
      {response?.promos.length === 0 ? <div className="table-empty">{search.trim() === "" ? "Промокодов пока нет" : "Промокоды не найдены"}</div> : null}
      {response !== null && response.promos.length > 0 ? <PromoTable busyKey={busyKey} onArchive={(promo) => mutate(promo, () => client.archive(promo.id))} onEdit={openEdit} onToggle={(promo) => mutate(promo, () => client.setActive(promo.id, promo.status !== "active"))} promos={response.promos} /> : null}
      {response !== null && response.pagination.total > response.promos.length ? <div className="pagination-actions"><span>Показаны {response.pagination.offset + 1}–{response.pagination.offset + response.promos.length} из {response.pagination.total}</span></div> : null}
    </div>
    <div className="loyalty-safe-note promo-safe-note"><strong>Безопасная модель</strong><span>Определения и использования промокодов принадлежат Backend. Customer checkout и скидки в заказах пока недоступны до отдельного решения владельца.</span></div>
    {draft === null ? null : <PromoModal busy={busyKey !== null} draft={draft} error={formError} onChange={setDraft} onClose={closeModal} onSubmit={save} />}
  </section>;
}
