import { useEffect, useRef, useState } from "react";

import {
  createAdminLoyaltyRequestController,
  AdminLoyaltyClientError,
  type AdminLoyaltyClient,
  type AdminLoyaltyLedgerState,
  type AdminLoyaltyRequestController
} from "@vse-pro-zhar/api-client";
import type { AdminQuestsResponse, AdminWheelResponse, LoyaltyRewardCreateRequest, LoyaltyRewardUpdateRequest, RewardDefinition, QuestDefinition, QuestDefinitionCreateRequest, QuestDefinitionUpdateRequest, QuestRewardType, QuestUnit, WheelPrize, WheelPrizeCreateRequest, WheelPrizeType, WheelPrizeUpdateRequest } from "@vse-pro-zhar/contracts";

import { useModalBehavior } from "./modal-behavior";

interface LoyaltyScreenProps {
  readonly client: AdminLoyaltyClient;
  readonly section?: "overview" | "wheel" | "quests" | "rewards";
}

function date(value: string): string {
  return new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function delta(value: number, suffix: string): string {
  return value === 0 ? "—" : `${value > 0 ? "+" : ""}${value.toLocaleString("ru-RU")} ${suffix}`;
}

function entryType(value: string): string {
  if (value === "earned") return "Начисление";
  if (value === "spent") return "Списание";
  return "Корректировка";
}

function AdminState({ children, error, onRetry }: { readonly children: string; readonly error?: boolean; readonly onRetry?: () => void }): React.JSX.Element {
  return <div className={`catalog-state ${error ? "catalog-state-error" : ""}`} role={error ? "alert" : "status"}><strong>{children}</strong>{error && onRetry !== undefined ? <button className="btn btn-outline" onClick={onRetry} type="button">Повторить</button> : null}</div>;
}

interface PrizeDraft {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly type: WheelPrizeType;
  readonly value: string;
  readonly weight: string;
  readonly sortOrder: string;
}

function emptyPrizeDraft(sortOrder: number): PrizeDraft {
  return { code: "", name: "", description: "", type: "coal", value: "10", weight: "10", sortOrder: String(sortOrder) };
}

interface WheelSettingsDraft {
  readonly enabled: boolean;
  readonly minOrderAmountRubles: string;
  readonly cooldownSeconds: string;
  readonly maxSpins: string;
  readonly limitPeriodSeconds: string;
  readonly activeFrom: string;
  readonly activeUntil: string;
}

function wheelSettingsDraft(settings: AdminWheelResponse["settings"]): WheelSettingsDraft {
  return {
    enabled: settings.enabled,
    minOrderAmountRubles: String(settings.minOrderAmountMinor / 100),
    cooldownSeconds: String(settings.cooldownSeconds),
    maxSpins: String(settings.maxSpins),
    limitPeriodSeconds: String(settings.limitPeriodSeconds),
    activeFrom: moscowDateTimeInput(settings.activeFrom),
    activeUntil: moscowDateTimeInput(settings.activeUntil)
  };
}

function formatMinorRubles(value: number): string {
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: value % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(value / 100)} ₽`;
}

function formatDuration(seconds: number): string {
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    const suffix = hours % 10 === 1 && hours % 100 !== 11 ? "час" : hours % 10 >= 2 && hours % 10 <= 4 && (hours % 100 < 10 || hours % 100 >= 20) ? "часа" : "часов";
    return `${hours} ${suffix}`;
  }
  if (seconds % 60 === 0) return `${seconds / 60} мин.`;
  return `${seconds} сек.`;
}

function wheelSettingsDateValue(value: string): string | null {
  return value === "" ? null : `${value}:00+03:00`;
}

function wheelSettingsErrorMessage(error: unknown): string {
  if (!(error instanceof AdminLoyaltyClientError)) return "Не удалось сохранить настройки рулетки. Попробуйте ещё раз.";
  if (error.kind === "conflict" && error.code === "LOYALTY_WHEEL_SETTINGS_IDEMPOTENCY_CONFLICT") return "Этот ключ уже использован для другого изменения. Обновите страницу и повторите.";
  if (error.kind === "conflict") return "Настройки уже изменены в другой сессии. Обновите данные и повторите сохранение.";
  if (error.kind === "validation") return "Backend отклонил настройки. Проверьте целые числа, даты и границы периода.";
  if (error.kind === "unavailable" || error.kind === "timeout" || error.kind === "network") return "Настройки рулетки временно недоступны. Проверьте соединение и повторите.";
  return error.message || "Не удалось сохранить настройки рулетки.";
}

function draftFromPrize(prize: WheelPrize): PrizeDraft {
  return { code: prize.code, name: prize.name, description: prize.description, type: prize.type, value: String(prize.value), weight: String(prize.weight), sortOrder: String(prize.sortOrder) };
}

function PrizeEditor({ prize, busy, onSave, onToggle }: { readonly prize: WheelPrize; readonly busy: boolean; readonly onSave: (id: number, input: WheelPrizeUpdateRequest) => void; readonly onToggle: (prize: WheelPrize) => void }): React.JSX.Element {
  const [draft, setDraft] = useState<PrizeDraft>(() => draftFromPrize(prize));
  useEffect(() => { setDraft(draftFromPrize(prize)); }, [prize]);
  const save = (): void => {
    const value = Number(draft.value);
    const weight = Number(draft.weight);
    const sortOrder = Number(draft.sortOrder);
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(weight) || weight < 0 || !Number.isSafeInteger(sortOrder) || sortOrder < 0 || draft.name.trim() === "") return;
    onSave(prize.id, { expectedVersion: prize.version, name: draft.name.trim(), description: draft.description, type: draft.type, value, weight, sortOrder });
  };
  return <tr>
    <td><code>{prize.code}</code></td>
    <td><input aria-label={`Название ${prize.code}`} className="m14-text-input" disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} /><textarea aria-label={`Описание ${prize.code}`} className="m14-textarea" disabled={busy} onChange={(event) => setDraft({ ...draft, description: event.target.value })} value={draft.description} /></td>
    <td><select aria-label={`Тип ${prize.code}`} className="m14-select" disabled={busy} onChange={(event) => setDraft({ ...draft, type: event.target.value as WheelPrizeType })} value={draft.type}><option value="no_prize">no-prize</option><option value="coal">coal</option><option value="xp">XP</option></select></td>
    <td><input aria-label={`Значение ${prize.code}`} className="m14-number-input" disabled={busy} min="0" onChange={(event) => setDraft({ ...draft, value: event.target.value })} type="number" value={draft.value} /></td>
    <td><input aria-label={`Вес ${prize.code}`} className="m14-number-input" disabled={busy} min="0" onChange={(event) => setDraft({ ...draft, weight: event.target.value })} type="number" value={draft.weight} /><input aria-label={`Порядок ${prize.code}`} className="m14-number-input" disabled={busy} min="0" onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} type="number" value={draft.sortOrder} /></td>
    <td><button className="btn btn-sm btn-outline" disabled={busy} onClick={() => onToggle(prize)} type="button">{prize.isVisible ? "Скрыть" : "Показать"}</button></td>
    <td><button className="btn btn-sm" disabled={busy} onClick={save} type="button">Сохранить</button></td>
  </tr>;
}

function WheelManagement({ client }: { readonly client: AdminLoyaltyClient }): React.JSX.Element {
  const [state, setState] = useState<{ status: "loading" | "success" | "error"; response?: AdminWheelResponse; error?: unknown }>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<WheelSettingsDraft | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const settingsIdempotencyKey = useRef<string | null>(null);
  const [newPrize, setNewPrize] = useState<PrizeDraft>(() => emptyPrizeDraft(4));
  const load = (): void => { setState({ status: "loading" }); setSettingsError(null); setSettingsNotice(null); void client.getWheel().then((response) => { setNewPrize(emptyPrizeDraft(response.prizes.length)); setSettingsDraft(wheelSettingsDraft(response.settings)); setState({ status: "success", response }); }).catch((error: unknown) => setState({ status: "error", error })); };
  useEffect(() => { load(); }, [client]);
  if (state.status === "loading") return <AdminState>Загружаем настройки рулетки…</AdminState>;
  if (state.status === "error" || state.response === undefined) return <AdminState error onRetry={load}>{state.error instanceof AdminLoyaltyClientError && state.error.kind === "conflict" ? "Приз уже изменён в другой сессии. Обновите данные и повторите." : state.error instanceof AdminLoyaltyClientError && state.error.kind === "unavailable" ? "Настройки рулетки временно недоступны" : "Рулетка временно недоступна"}</AdminState>;
  const response = state.response;
  const updateSettingsDraft = (next: WheelSettingsDraft): void => { settingsIdempotencyKey.current = null; setSettingsDraft(next); setSettingsError(null); setSettingsNotice(null); };
  const saveSettings = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (settingsDraft === null) return;
    const minOrderAmountRubles = Number(settingsDraft.minOrderAmountRubles);
    const cooldownSeconds = Number(settingsDraft.cooldownSeconds);
    const maxSpins = Number(settingsDraft.maxSpins);
    const limitPeriodSeconds = Number(settingsDraft.limitPeriodSeconds);
    const values = [minOrderAmountRubles, cooldownSeconds, maxSpins, limitPeriodSeconds];
    if (!Number.isSafeInteger(minOrderAmountRubles) || minOrderAmountRubles < 0 || !Number.isSafeInteger(cooldownSeconds) || cooldownSeconds < 1 || !Number.isSafeInteger(maxSpins) || maxSpins < 1 || !Number.isSafeInteger(limitPeriodSeconds) || limitPeriodSeconds < 1 || minOrderAmountRubles > 21_474_836 || values.some((value) => value > 2_147_483_647)) {
      setSettingsError("Введите целые значения в допустимых границах. Минимальная сумма указана в целых рублях.");
      return;
    }
    const activeFrom = wheelSettingsDateValue(settingsDraft.activeFrom);
    const activeUntil = wheelSettingsDateValue(settingsDraft.activeUntil);
    if (activeFrom !== null && activeUntil !== null && activeUntil <= activeFrom) {
      setSettingsError("Окончание периода должно быть позже начала.");
      return;
    }
    const idempotencyKey = settingsIdempotencyKey.current ?? createIdempotencyKey();
    settingsIdempotencyKey.current = idempotencyKey;
    setBusy(true);
    setSettingsError(null);
    setSettingsNotice(null);
    void client.updateWheelSettings({ expectedVersion: response.settings.version, enabled: settingsDraft.enabled, minOrderAmountMinor: minOrderAmountRubles * 100, cooldownSeconds, maxSpins, limitPeriodSeconds, activeFrom, activeUntil }, { idempotencyKey }).then((next) => { settingsIdempotencyKey.current = null; setSettingsDraft(wheelSettingsDraft(next.settings)); setState({ status: "success", response: next }); setSettingsNotice("Настройки сохранены. История spins, claims и ledger не изменена."); }).catch((error: unknown) => setSettingsError(wheelSettingsErrorMessage(error))).finally(() => setBusy(false));
  };
  const togglePrize = (prize: WheelPrize): void => { setBusy(true); void client.updateWheelPrize(prize.id, { expectedVersion: prize.version, isVisible: !prize.isVisible }, { idempotencyKey: createIdempotencyKey() }).then((next) => setState({ status: "success", response: next })).catch(() => setState({ status: "error" })).finally(() => setBusy(false)); };
  const savePrize = (id: number, input: WheelPrizeUpdateRequest): void => { setBusy(true); void client.updateWheelPrize(id, input, { idempotencyKey: createIdempotencyKey() }).then((next) => setState({ status: "success", response: next })).catch(() => setState({ status: "error" })).finally(() => setBusy(false)); };
  const createPrize = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = Number(newPrize.value);
    const weight = Number(newPrize.weight);
    const sortOrder = Number(newPrize.sortOrder);
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(weight) || weight < 0 || !Number.isSafeInteger(sortOrder) || sortOrder < 0 || newPrize.code.trim() === "" || newPrize.name.trim() === "") return;
    const input: WheelPrizeCreateRequest = { code: newPrize.code.trim(), name: newPrize.name.trim(), description: newPrize.description, type: newPrize.type, value, weight, isVisible: true, activeFrom: null, activeUntil: null, sortOrder };
    setBusy(true); void client.createWheelPrize(input).then((next) => { setNewPrize(emptyPrizeDraft(next.prizes.length)); setState({ status: "success", response: next }); }).catch(() => setState({ status: "error" })).finally(() => setBusy(false));
  };
  if (settingsDraft === null) return <AdminState error onRetry={load}>Настройки рулетки временно недоступны</AdminState>;
  return <section aria-labelledby="wheel-management-title">
    <div className="page-header"><div><p className="eyebrow">M14 · SERVER-OWNED</p><h1 className="page-title" id="wheel-management-title">Колесо фортуны</h1><p className="page-subtitle">Награды и веса настраивает Admin. Backend принимает максимум 6 definitions.</p></div><button className="btn btn-outline" onClick={load} type="button">↻ Обновить</button></div>
    <div className="loyalty-rule-grid"><div className="loyalty-rule-card"><span>Статус</span><strong>{response.settings.enabled ? "Включено" : "Отключено"}</strong></div><div className="loyalty-rule-card"><span>Призы</span><strong>{response.prizes.length} / 6</strong></div><div className="loyalty-rule-card"><span>Лимит</span><strong>{response.settings.maxSpins} spin / {formatDuration(response.settings.limitPeriodSeconds)}</strong></div><div className="loyalty-rule-card"><span>Минимум</span><strong>{formatMinorRubles(response.settings.minOrderAmountMinor)}</strong></div></div>
    <div className="chart-card wheel-settings-card"><div className="wheel-settings-heading"><div><h2>⚙️ Глобальные настройки</h2><p>Изменения применяются только к будущим проверкам доступности.</p></div><span className="wheel-settings-version">v{response.settings.version}</span></div><form onSubmit={saveSettings}><div className="wheel-settings-grid"><div className="wheel-settings-field"><span>Статус</span><span className="wheel-toggle"><button aria-checked={settingsDraft.enabled} aria-label="Статус колеса" className={`wheel-switch-control${settingsDraft.enabled ? " is-on" : ""}`} disabled={busy} onClick={() => updateSettingsDraft({ ...settingsDraft, enabled: !settingsDraft.enabled })} role="switch" type="button" /><strong>{settingsDraft.enabled ? "Включено" : "Отключено"}</strong></span></div><div className="wheel-settings-field"><span>Условие</span><output aria-label="Условие доступности" className="wheel-settings-readonly">Завершённый оплаченный заказ</output><small>Режим зафиксирован бизнес-правилом M14.</small></div><label className="wheel-settings-field"><span>Минимальная сумма заказа, ₽</span><input aria-label="Минимальная сумма заказа" disabled={busy} inputMode="numeric" min="0" onChange={(event) => updateSettingsDraft({ ...settingsDraft, minOrderAmountRubles: event.target.value })} step="1" type="number" value={settingsDraft.minOrderAmountRubles} /><small>Целые рубли · Backend хранит minor units.</small></label><label className="wheel-settings-field"><span>Cooldown, секунд</span><input aria-label="Cooldown" disabled={busy} inputMode="numeric" min="1" onChange={(event) => updateSettingsDraft({ ...settingsDraft, cooldownSeconds: event.target.value })} step="1" type="number" value={settingsDraft.cooldownSeconds} /><small>{formatDuration(Number(settingsDraft.cooldownSeconds) || 0)}</small></label><label className="wheel-settings-field"><span>Лимит вращений</span><input aria-label="Лимит вращений" disabled={busy} inputMode="numeric" min="1" onChange={(event) => updateSettingsDraft({ ...settingsDraft, maxSpins: event.target.value })} step="1" type="number" value={settingsDraft.maxSpins} /><small>На одного клиента за rolling period.</small></label><label className="wheel-settings-field"><span>Период лимита, секунд</span><input aria-label="Период лимита" disabled={busy} inputMode="numeric" min="1" onChange={(event) => updateSettingsDraft({ ...settingsDraft, limitPeriodSeconds: event.target.value })} step="1" type="number" value={settingsDraft.limitPeriodSeconds} /><small>{formatDuration(Number(settingsDraft.limitPeriodSeconds) || 0)}</small></label><label className="wheel-settings-field"><span>Активен с, МСК</span><input aria-label="Активен с" disabled={busy} onChange={(event) => updateSettingsDraft({ ...settingsDraft, activeFrom: event.target.value })} type="datetime-local" value={settingsDraft.activeFrom} /></label><label className="wheel-settings-field"><span>Активен до, МСК</span><input aria-label="Активен до" disabled={busy} onChange={(event) => updateSettingsDraft({ ...settingsDraft, activeUntil: event.target.value })} type="datetime-local" value={settingsDraft.activeUntil} /></label></div>{settingsError !== null ? <div className="wheel-settings-message wheel-settings-message-error" role="alert"><span>{settingsError}</span>{settingsError.includes("другой сессии") ? <button className="btn btn-outline btn-sm" disabled={busy} onClick={load} type="button">Обновить данные</button> : null}</div> : null}{settingsNotice !== null ? <div className="wheel-settings-message wheel-settings-message-success" role="status">{settingsNotice}</div> : null}<div className="wheel-settings-footer"><span>Последнее изменение: {date(response.settings.updatedAt)} · версия {response.settings.version}</span><button className="btn btn-primary" disabled={busy} type="submit">{busy ? "Сохраняем…" : "Сохранить настройки"}</button></div></form></div>
    <div className="table-card m14-management-card"><div className="table-header"><h2>Сектора</h2></div><div className="table-scroll"><table><thead><tr><th>Код</th><th>Приз</th><th>Тип</th><th>Значение</th><th>Вес / порядок</th><th>Видимость</th><th>Действие</th></tr></thead><tbody>{response.prizes.map((prize) => <PrizeEditor busy={busy} key={prize.id} onSave={savePrize} onToggle={togglePrize} prize={prize} />)}</tbody></table></div></div>
    {response.prizes.length < 6 ? <form className="table-card m14-prize-form" onSubmit={createPrize}><div className="table-header"><h2>Добавить приз ({response.prizes.length} / 6)</h2><button className="btn" disabled={busy} type="submit">Добавить</button></div><div className="m14-form-grid"><label>Code<input aria-label="Код нового приза" className="m14-text-input" disabled={busy} onChange={(event) => setNewPrize({ ...newPrize, code: event.target.value })} pattern="[a-z0-9][a-z0-9_-]{0,79}" required value={newPrize.code} /></label><label>Название<input aria-label="Название нового приза" className="m14-text-input" disabled={busy} onChange={(event) => setNewPrize({ ...newPrize, name: event.target.value })} required value={newPrize.name} /></label><label>Тип<select aria-label="Тип нового приза" className="m14-select" disabled={busy} onChange={(event) => setNewPrize({ ...newPrize, type: event.target.value as WheelPrizeType, value: event.target.value === "no_prize" ? "0" : newPrize.value })} value={newPrize.type}><option value="no_prize">no-prize</option><option value="coal">coal</option><option value="xp">XP</option></select></label><label>Значение<input aria-label="Значение нового приза" className="m14-number-input" disabled={busy} min="0" onChange={(event) => setNewPrize({ ...newPrize, value: event.target.value })} required type="number" value={newPrize.value} /></label><label>Вес<input aria-label="Вес нового приза" className="m14-number-input" disabled={busy} min="0" onChange={(event) => setNewPrize({ ...newPrize, weight: event.target.value })} required type="number" value={newPrize.weight} /></label><label>Порядок<input aria-label="Порядок нового приза" className="m14-number-input" disabled={busy} min="0" onChange={(event) => setNewPrize({ ...newPrize, sortOrder: event.target.value })} required type="number" value={newPrize.sortOrder} /></label><label className="m14-form-wide">Описание<textarea aria-label="Описание нового приза" className="m14-textarea" disabled={busy} onChange={(event) => setNewPrize({ ...newPrize, description: event.target.value })} value={newPrize.description} /></label></div></form> : null}
    <div className="loyalty-safe-note"><strong>Граница Admin</strong><span>Admin управляет definitions и настройками. Нельзя вручную создавать spin, выдавать XP/угольки или менять immutable history. Допустимые reward types: no-prize, coal, xp.</span></div>
  </section>;
}

interface QuestDraft {
  readonly id: number | null;
  readonly version: number | null;
  readonly idempotencyKey: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly goal: string;
  readonly unit: QuestUnit;
  readonly rewardType: QuestRewardType;
  readonly rewardValue: string;
  readonly isVisible: boolean;
  readonly activeFrom: string;
  readonly activeUntil: string;
  readonly sortOrder: string;
}

function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `quest-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyQuestDraft(sortOrder: number): QuestDraft {
  return { id: null, version: null, idempotencyKey: createIdempotencyKey(), code: "", title: "", description: "", goal: "1", unit: "order", rewardType: "xp", rewardValue: "100", isVisible: true, activeFrom: "", activeUntil: "", sortOrder: String(sortOrder) };
}

function moscowDateTimeInput(value: string | null): string {
  if (value === null) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"] ?? ""}-${values["month"] ?? ""}-${values["day"] ?? ""}T${values["hour"] ?? ""}:${values["minute"] ?? ""}`;
}

function questDraftFromDefinition(quest: QuestDefinition): QuestDraft {
  return { id: quest.id, version: quest.version, idempotencyKey: "", code: quest.code, title: quest.title, description: quest.description, goal: String(quest.goal), unit: quest.unit, rewardType: quest.rewardType, rewardValue: String(quest.rewardValue), isVisible: quest.isVisible, activeFrom: moscowDateTimeInput(quest.activeFrom), activeUntil: moscowDateTimeInput(quest.activeUntil), sortOrder: String(quest.sortOrder) };
}

function questDateValue(value: string): string | null {
  return value === "" ? null : `${value}:00+03:00`;
}

function questPeriod(quest: QuestDefinition): string {
  if (quest.activeFrom === null && quest.activeUntil === null) return "Постоянный";
  if (quest.activeFrom === null) return `до ${date(quest.activeUntil as string)}`;
  if (quest.activeUntil === null) return `с ${date(quest.activeFrom)}`;
  return `${date(quest.activeFrom)} — ${date(quest.activeUntil)}`;
}

function questErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof AdminLoyaltyClientError)) return fallback;
  if (error.kind === "conflict" && error.code === "LOYALTY_QUEST_CODE_CONFLICT") return "Квест с таким кодом уже существует. Выберите другой код.";
  if (error.kind === "conflict" && error.code === "LOYALTY_QUEST_IDEMPOTENCY_CONFLICT") return "Этот ключ уже использован с другими данными. Начните создание заново.";
  if (error.kind === "conflict") return "Квест уже изменён в другой сессии или это изменение запрещено текущей историей. Обновите список и повторите.";
  if (error.kind === "unavailable" || error.kind === "timeout" || error.kind === "network") return "Backend квестов временно недоступен. Проверьте соединение и повторите.";
  if (error.kind === "validation") return "Backend отклонил данные квеста. Проверьте поля формы.";
  return error.message || fallback;
}

function QuestModal({ draft, error, busy, onChange, onClose, onSubmit }: { readonly draft: QuestDraft; readonly error: string | null; readonly busy: boolean; readonly onChange: (next: QuestDraft) => void; readonly onClose: () => void; readonly onSubmit: () => void }): React.JSX.Element {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  useModalBehavior(modalRef, onClose, closeButtonRef);
  const editing = draft.id !== null;
  return <div className="modal-overlay quest-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
    <div aria-describedby="quest-modal-description" aria-labelledby="quest-modal-title" aria-modal="true" className="modal-box quest-modal-box" ref={modalRef} role="dialog" tabIndex={-1}>
      <h2 id="quest-modal-title">{editing ? "Редактировать квест" : "Новый квест"}</h2>
      <p className="quest-modal-description" id="quest-modal-description">Definition хранится на Backend. Прогресс и награды изменяются только processor-ом.</p>
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div className="form-row">
          <label className="form-group"><span>Код</span><input aria-label="Код" autoCapitalize="none" disabled={busy} maxLength={80} onChange={(event) => onChange({ ...draft, code: event.target.value.toLowerCase() })} readOnly={editing} value={draft.code} /></label>
          <label className="form-group"><span>Порядок</span><input aria-label="Порядок" disabled={busy} min="0" onChange={(event) => onChange({ ...draft, sortOrder: event.target.value })} type="number" value={draft.sortOrder} /></label>
        </div>
        <label className="form-group"><span>Название</span><input aria-label="Название" disabled={busy} maxLength={160} onChange={(event) => onChange({ ...draft, title: event.target.value })} value={draft.title} /></label>
        <label className="form-group quest-description-field"><span>Описание</span><textarea aria-label="Описание" disabled={busy} maxLength={2048} onChange={(event) => onChange({ ...draft, description: event.target.value })} value={draft.description} /></label>
        <div className="form-row">
          <label className="form-group"><span>Цель</span><input aria-label="Цель" disabled={busy} min="1" onChange={(event) => onChange({ ...draft, goal: event.target.value })} type="number" value={draft.goal} /></label>
          <label className="form-group"><span>Единица</span><select aria-label="Единица" disabled={busy} onChange={(event) => onChange({ ...draft, unit: event.target.value as QuestUnit })} value={draft.unit}><option value="order">Заказы</option><option value="minor_units">Копейки (minor units)</option></select></label>
        </div>
        <div className="form-row">
          <label className="form-group"><span>Тип награды</span><select aria-label="Тип награды" disabled={busy} onChange={(event) => onChange({ ...draft, rewardType: event.target.value as QuestRewardType })} value={draft.rewardType}><option value="xp">XP</option><option value="coal">Угольки</option></select></label>
          <label className="form-group"><span>Значение награды</span><input aria-label="Значение награды" disabled={busy} min="1" onChange={(event) => onChange({ ...draft, rewardValue: event.target.value })} type="number" value={draft.rewardValue} /></label>
        </div>
        <div className="form-row">
          <label className="form-group"><span>Начало периода (МСК)</span><input aria-label="Начало периода" disabled={busy} onChange={(event) => onChange({ ...draft, activeFrom: event.target.value })} type="datetime-local" value={draft.activeFrom} /></label>
          <label className="form-group"><span>Окончание периода (МСК)</span><input aria-label="Окончание периода" disabled={busy} onChange={(event) => onChange({ ...draft, activeUntil: event.target.value })} type="datetime-local" value={draft.activeUntil} /></label>
        </div>
        <label className="m14-switch quest-visibility-toggle"><input aria-label="Активен" checked={draft.isVisible} disabled={busy} onChange={(event) => onChange({ ...draft, isVisible: event.target.checked })} type="checkbox" /><span>Активен для Customer</span></label>
        {error === null ? null : <div className="quest-form-error" role="alert">{error}</div>}
        <div className="modal-actions"><button className="btn btn-outline" disabled={busy} onClick={onClose} ref={closeButtonRef} type="button">Отмена</button><button className="btn btn-primary" disabled={busy} type="submit">{busy ? "Сохраняем…" : "Сохранить"}</button></div>
      </form>
    </div>
  </div>;
}

export function QuestManagement({ client }: { readonly client: AdminLoyaltyClient }): React.JSX.Element {
  const [state, setState] = useState<{ status: "loading" | "success" | "error"; response?: AdminQuestsResponse; message?: string }>({ status: "loading" });
  const [draft, setDraft] = useState<QuestDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const load = (): void => { setState({ status: "loading" }); void client.getQuests().then((response) => setState({ status: "success", response })).catch((error: unknown) => setState({ status: "error", message: questErrorMessage(error, "Не удалось загрузить definitions квестов") })); };
  useEffect(() => { load(); }, [client]);
  const response = state.status === "success" ? state.response : undefined;
  const openNew = (): void => { const nextOrder = response === undefined ? 0 : response.quests.reduce((max, quest) => Math.max(max, quest.sortOrder), 0) + 1000; setActionError(null); setFormError(null); setDraft(emptyQuestDraft(nextOrder)); };
  const openEdit = (quest: QuestDefinition): void => { setActionError(null); setFormError(null); setDraft(questDraftFromDefinition(quest)); };
  const closeModal = (): void => { if (!saving) setDraft(null); };
  const save = (): void => {
    if (draft === null) return;
    const code = draft.code.trim();
    const title = draft.title.trim();
    const goal = Number(draft.goal);
    const rewardValue = Number(draft.rewardValue);
    const sortOrder = Number(draft.sortOrder);
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/u.test(code)) { setFormError("Код: строчные латинские буквы, цифры, _ или -, от 1 до 80 символов."); return; }
    if (title === "") { setFormError("Название не может быть пустым."); return; }
    if (!Number.isSafeInteger(goal) || goal < 1 || !Number.isSafeInteger(rewardValue) || rewardValue < 1 || !Number.isSafeInteger(sortOrder) || sortOrder < 0) { setFormError("Цель, награда и порядок должны быть целыми числами в допустимом диапазоне."); return; }
    const activeFrom = questDateValue(draft.activeFrom);
    const activeUntil = questDateValue(draft.activeUntil);
    if (activeFrom !== null && activeUntil !== null && new Date(activeUntil).getTime() <= new Date(activeFrom).getTime()) { setFormError("Окончание периода должно быть позже начала."); return; }
    setFormError(null);
    setSaving(true);
    const createInput: QuestDefinitionCreateRequest = { code, title, description: draft.description.trim(), goal, unit: draft.unit, rewardType: draft.rewardType, rewardValue, isVisible: draft.isVisible, activeFrom, activeUntil, sortOrder };
    const operation = draft.id === null
      ? client.createQuest(createInput, { idempotencyKey: draft.idempotencyKey })
      : client.updateQuest(draft.id, { expectedVersion: draft.version as number, title, description: createInput.description, goal, unit: draft.unit, rewardType: draft.rewardType, rewardValue, isVisible: draft.isVisible, activeFrom, activeUntil, sortOrder } satisfies QuestDefinitionUpdateRequest);
    void operation.then((next) => { setState({ status: "success", response: next }); setDraft(null); setActionError(null); }, (error: unknown) => setFormError(questErrorMessage(error, "Не удалось сохранить квест"))).finally(() => setSaving(false));
  };
  const toggleVisibility = (quest: QuestDefinition): void => { setActionError(null); setBusyId(quest.id); void client.updateQuest(quest.id, { expectedVersion: quest.version, isVisible: !quest.isVisible }).then((next) => setState({ status: "success", response: next }), (error: unknown) => setActionError(questErrorMessage(error, "Не удалось изменить видимость квеста"))).finally(() => setBusyId(null)); };
  return <section aria-labelledby="quests-management-title" className="quests-screen">
    <div className="page-header"><div><p className="eyebrow">M14 · DEFINITIONS</p><h1 className="page-title" id="quests-management-title">Квесты</h1><p className="page-subtitle">Прогресс и claims создаются только processor-ом из completed + succeeded order events. История не переписывается.</p></div><div className="header-actions"><button className="btn btn-primary" disabled={response === undefined} onClick={openNew} type="button"><span aria-hidden="true">＋</span> Добавить квест</button><button className="btn btn-outline" onClick={load} type="button">↻ Обновить</button></div></div>
    {state.status === "loading" ? <AdminState>Загружаем definitions квестов…</AdminState> : null}
    {state.status === "error" ? <AdminState error onRetry={load}>{state.message ?? "Квесты временно недоступны"}</AdminState> : null}
    {response === undefined ? null : <>
      {actionError === null ? null : <div className="quest-action-error" role="alert"><span>{actionError}</span><button className="btn btn-sm btn-outline" onClick={load} type="button">Обновить список</button></div>}
      <div className="table-card m14-management-card quests-management-card"><div className="table-header"><h2>Production definitions ({response.quests.length})</h2></div>{response.quests.length === 0 ? <div className="table-empty">Квестов пока нет. Добавьте первую definition.</div> : <div className="table-scroll"><table className="quests-table"><thead><tr><th>Код</th><th>Квест</th><th>Цель</th><th>Награда</th><th>Статус</th><th>Период</th><th>Версия</th><th>Действия</th></tr></thead><tbody>{response.quests.map((quest) => <tr key={quest.id}><td data-label="Код"><code>{quest.code}</code></td><td data-label="Квест"><strong>{quest.title}</strong><span className="product-description">{quest.description || "Без описания"}</span></td><td data-label="Цель">{quest.goal.toLocaleString("ru-RU")} {quest.unit === "minor_units" ? "коп." : "заказов"}</td><td data-label="Награда"><strong>+{quest.rewardValue.toLocaleString("ru-RU")}</strong> {quest.rewardType.toUpperCase()}</td><td data-label="Статус"><span className={`status-badge ${quest.isVisible ? "status-visible" : "status-hidden"}`}>{quest.isVisible ? "Активен" : "Скрыт"}</span></td><td data-label="Период">{questPeriod(quest)}</td><td data-label="Версия"><span className="quest-version">v{quest.version}</span></td><td data-label="Действия"><div className="row-actions quest-row-actions"><button aria-label={`Изменить квест ${quest.code}`} className="btn btn-sm btn-outline" disabled={busyId === quest.id || saving} onClick={() => openEdit(quest)} type="button">Изменить</button><button aria-label={`${quest.isVisible ? "Скрыть" : "Показать"} квест ${quest.code}`} className={`btn btn-sm ${quest.isVisible ? "btn-outline" : "btn-primary"}`} disabled={busyId === quest.id || saving} onClick={() => toggleVisibility(quest)} type="button">{quest.isVisible ? "Скрыть" : "Показать"}</button></div></td></tr>)}</tbody></table></div>}</div>
      <div className="loyalty-safe-note"><strong>Безопасная модель</strong><span>Скрытие definition — это архивирование без DELETE: прошлые progress, events, claims и ledger сохраняются. Admin не может менять progress, баланс или выдавать reward вручную.</span></div>
    </>}
    {draft === null ? null : <QuestModal busy={saving} draft={draft} error={formError} onChange={setDraft} onClose={closeModal} onSubmit={save} />}
  </section>;
}

interface RewardDraft {
  readonly id: number | null;
  readonly version: number | null;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly costCoal: string;
  readonly discountRubles: string;
  readonly isVisible: boolean;
  readonly activeFrom: string;
  readonly activeUntil: string;
  readonly sortOrder: string;
  readonly perCustomerUsageLimit: string;
}

function emptyRewardDraft(sortOrder: number): RewardDraft {
  return { id: null, version: null, code: "", name: "", description: "", costCoal: "1", discountRubles: "100", isVisible: true, activeFrom: "", activeUntil: "", sortOrder: String(sortOrder), perCustomerUsageLimit: "1" };
}

function rewardDraftFromDefinition(reward: RewardDefinition): RewardDraft {
  return { id: reward.id, version: reward.version, code: reward.code, name: reward.name, description: reward.description, costCoal: String(reward.costCoal), discountRubles: String(reward.fulfillmentTarget.discountMinor / 100), isVisible: reward.isVisible, activeFrom: moscowDateTimeInput(reward.activeFrom), activeUntil: moscowDateTimeInput(reward.activeUntil), sortOrder: String(reward.sortOrder), perCustomerUsageLimit: reward.perCustomerUsageLimit === null ? "" : String(reward.perCustomerUsageLimit) };
}

function rewardDateValue(value: string): string | null {
  return value === "" ? null : `${value}:00+03:00`;
}

function rewardErrorMessage(error: unknown): string {
  if (!(error instanceof AdminLoyaltyClientError)) return "Награды временно недоступны. Попробуйте ещё раз.";
  if (error.code === "LOYALTY_REWARD_CODE_CONFLICT") return "Награда с таким кодом уже существует.";
  if (error.code === "LOYALTY_REWARD_CONFLICT") return "Definition изменена в другой сессии. Обновите список.";
  if (error.code === "LOYALTY_REWARD_IDEMPOTENCY_CONFLICT") return "Ключ уже использован для другого изменения.";
  if (error.kind === "validation") return "Backend отклонил reward definition. Проверьте целые значения и период.";
  return error.message || "Не удалось сохранить reward definition.";
}

function RewardManagement({ client }: { readonly client: AdminLoyaltyClient }): React.JSX.Element {
  const [state, setState] = useState<{ readonly status: "loading" | "success" | "error"; readonly rewards?: readonly RewardDefinition[]; readonly message?: string }>({ status: "loading" });
  const [draft, setDraft] = useState<RewardDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const load = (): void => {
    if (client.listRewards === undefined) { setState({ status: "error", message: "Reward management API недоступен" }); return; }
    setState({ status: "loading" });
    void client.listRewards().then((response) => setState({ status: "success", rewards: response.rewards })).catch((error: unknown) => setState({ status: "error", message: rewardErrorMessage(error) }));
  };
  useEffect(() => { load(); }, [client]);
  const rewards = state.status === "success" ? state.rewards ?? [] : [];
  const save = (): void => {
    if (draft === null || client.createReward === undefined || client.updateReward === undefined) return;
    const costCoal = Number(draft.costCoal);
    const discountRubles = Number(draft.discountRubles);
    const sortOrder = Number(draft.sortOrder);
    const limit = draft.perCustomerUsageLimit === "" ? null : Number(draft.perCustomerUsageLimit);
    const activeFrom = rewardDateValue(draft.activeFrom);
    const activeUntil = rewardDateValue(draft.activeUntil);
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/u.test(draft.code.trim()) || draft.name.trim() === "" || !Number.isSafeInteger(costCoal) || costCoal < 1 || !Number.isSafeInteger(discountRubles) || discountRubles < 1 || !Number.isSafeInteger(sortOrder) || sortOrder < 0 || (limit !== null && (!Number.isSafeInteger(limit) || limit < 1))) { setActionError("Код, стоимость, скидка, лимит и порядок должны быть заполнены целыми значениями."); return; }
    if (activeFrom !== null && activeUntil !== null && new Date(activeUntil).getTime() <= new Date(activeFrom).getTime()) { setActionError("Окончание периода должно быть позже начала."); return; }
    setBusy(true); setActionError(null);
    const createInput: LoyaltyRewardCreateRequest = { code: draft.code.trim(), name: draft.name.trim(), description: draft.description, costCoal, rewardType: "fixed_discount", fulfillmentTarget: { type: "fixed_discount", discountMinor: discountRubles * 100 }, isVisible: draft.isVisible, activeFrom, activeUntil, sortOrder, perCustomerUsageLimit: limit };
    const operation = draft.id === null
      ? client.createReward(createInput, { idempotencyKey: createIdempotencyKey() })
      : client.updateReward(draft.id, { expectedVersion: draft.version as number, name: createInput.name, description: createInput.description, costCoal: createInput.costCoal, fulfillmentTarget: createInput.fulfillmentTarget, isVisible: createInput.isVisible, activeFrom, activeUntil, sortOrder, perCustomerUsageLimit: limit } satisfies LoyaltyRewardUpdateRequest, { idempotencyKey: createIdempotencyKey() });
    void operation.then((response) => { setState({ status: "success", rewards: response.rewards }); setDraft(null); }).catch((error: unknown) => setActionError(rewardErrorMessage(error))).finally(() => setBusy(false));
  };
  const toggleArchive = (reward: RewardDefinition): void => {
    if (client.updateReward === undefined) return;
    setBusy(true); setActionError(null);
    void client.updateReward(reward.id, { expectedVersion: reward.version, isArchived: true, isVisible: false }, { idempotencyKey: createIdempotencyKey() }).then((response) => setState({ status: "success", rewards: response.rewards })).catch((error: unknown) => setActionError(rewardErrorMessage(error))).finally(() => setBusy(false));
  };
  return <section aria-labelledby="rewards-management-title" className="quests-screen"><div className="page-header"><div><p className="eyebrow">M13.5 · BACKEND-OWNED</p><h1 className="page-title" id="rewards-management-title">Награды</h1><p className="page-subtitle">Только fixed discount на следующий pickup-заказ. Admin не меняет баланс, ledger или redemption.</p></div><div className="header-actions"><button className="btn btn-primary" disabled={busy || client.createReward === undefined} onClick={() => { setDraft(emptyRewardDraft(rewards.reduce((max, reward) => Math.max(max, reward.sortOrder), 0) + 1000)); setActionError(null); }} type="button">＋ Добавить награду</button><button className="btn btn-outline" onClick={load} type="button">↻ Обновить</button></div></div>{state.status === "loading" ? <AdminState>Загружаем reward definitions…</AdminState> : null}{state.status === "error" ? <AdminState error onRetry={load}>{state.message ?? "Награды временно недоступны"}</AdminState> : null}{actionError === null ? null : <div className="quest-action-error" role="alert">{actionError}</div>}{state.status === "success" ? <><div className="table-card m14-management-card quests-management-card"><div className="table-header"><h2>Production definitions ({rewards.length})</h2></div>{rewards.length === 0 ? <div className="table-empty">Наград пока нет. Создайте первую definition.</div> : <div className="table-scroll"><table><thead><tr><th>Код</th><th>Награда</th><th>Стоимость</th><th>Скидка</th><th>Статус</th><th>Версия</th><th>Действия</th></tr></thead><tbody>{rewards.map((reward) => <tr key={reward.id}><td><code>{reward.code}</code></td><td><strong>{reward.name}</strong><span className="product-description">{reward.description || "Без описания"}</span></td><td>{reward.costCoal.toLocaleString("ru-RU")} 🔥</td><td>{formatMinorRubles(reward.fulfillmentTarget.discountMinor)}</td><td><span className={`status-badge ${reward.isArchived ? "status-hidden" : reward.isVisible ? "status-visible" : "status-hidden"}`}>{reward.isArchived ? "Архив" : reward.isVisible ? "Активна" : "Скрыта"}</span></td><td>v{reward.version}</td><td><div className="row-actions"><button className="btn btn-sm btn-outline" disabled={busy || reward.isArchived} onClick={() => setDraft(rewardDraftFromDefinition(reward))} type="button">Изменить</button><button className="btn btn-sm btn-outline" disabled={busy || reward.isArchived} onClick={() => toggleArchive(reward)} type="button">Архивировать</button></div></td></tr>)}</tbody></table></div>}</div><div className="loyalty-safe-note"><strong>Безопасная модель</strong><span>Код и история redemption сохраняются. Архивирование не удаляет reward definition и не меняет прошлые snapshots.</span></div></> : null}{draft === null ? null : <div className="chart-card wheel-settings-card"><div className="wheel-settings-heading"><div><h2>{draft.id === null ? "Новая награда" : "Редактировать награду"}</h2><p>Скидка хранится в Backend в целых minor units.</p></div><span className="wheel-settings-version">{draft.id === null ? "v1" : `v${draft.version}`}</span></div><div className="wheel-settings-grid"><label className="wheel-settings-field"><span>Код</span><input aria-label="Код награды" disabled={busy || draft.id !== null} onChange={(event) => setDraft({ ...draft, code: event.target.value.toLowerCase() })} value={draft.code} /></label><label className="wheel-settings-field"><span>Название</span><input aria-label="Название награды" disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} /></label><label className="wheel-settings-field"><span>Стоимость, угольки</span><input aria-label="Стоимость награды" disabled={busy} min="1" onChange={(event) => setDraft({ ...draft, costCoal: event.target.value })} type="number" value={draft.costCoal} /></label><label className="wheel-settings-field"><span>Скидка, ₽</span><input aria-label="Размер скидки" disabled={busy} min="1" onChange={(event) => setDraft({ ...draft, discountRubles: event.target.value })} type="number" value={draft.discountRubles} /></label><label className="wheel-settings-field"><span>Порядок</span><input aria-label="Порядок награды" disabled={busy} min="0" onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} type="number" value={draft.sortOrder} /></label><label className="wheel-settings-field"><span>Лимит на Customer</span><input aria-label="Лимит награды" disabled={busy} min="1" placeholder="Без лимита" onChange={(event) => setDraft({ ...draft, perCustomerUsageLimit: event.target.value })} type="number" value={draft.perCustomerUsageLimit} /></label><label className="wheel-settings-field"><span>Активна с, МСК</span><input aria-label="Начало периода награды" disabled={busy} onChange={(event) => setDraft({ ...draft, activeFrom: event.target.value })} type="datetime-local" value={draft.activeFrom} /></label><label className="wheel-settings-field"><span>Активна до, МСК</span><input aria-label="Конец периода награды" disabled={busy} onChange={(event) => setDraft({ ...draft, activeUntil: event.target.value })} type="datetime-local" value={draft.activeUntil} /></label><label className="wheel-settings-field" style={{ gridColumn: "1 / -1" }}><span>Описание</span><textarea aria-label="Описание награды" disabled={busy} onChange={(event) => setDraft({ ...draft, description: event.target.value })} value={draft.description} /></label><label className="m14-switch quest-visibility-toggle"><input aria-label="Награда видима" checked={draft.isVisible} disabled={busy} onChange={(event) => setDraft({ ...draft, isVisible: event.target.checked })} type="checkbox" /><span>Показывать Customer</span></label></div><div className="modal-actions"><button className="btn btn-outline" disabled={busy} onClick={() => setDraft(null)} type="button">Отмена</button><button className="btn btn-primary" disabled={busy} onClick={save} type="button">{busy ? "Сохраняем…" : "Сохранить"}</button></div></div>}</section>;
}

function LoyaltyOverview({ client }: { readonly client: AdminLoyaltyClient }): React.JSX.Element {
  const [state, setState] = useState<AdminLoyaltyLedgerState>({ status: "loading" });
  const controllerRef = useRef<AdminLoyaltyRequestController | null>(null);
  useEffect(() => { const controller = createAdminLoyaltyRequestController(client, setState); controllerRef.current = controller; controller.load({ limit: 50, offset: 0 }); return () => { controller.dispose(); if (controllerRef.current === controller) controllerRef.current = null; }; }, [client]);
  const retry = (): void => controllerRef.current?.retry();
  return <section className="loyalty-page" aria-labelledby="loyalty-title"><div className="page-header"><div><p className="eyebrow">M13 · SERVER-OWNED</p><h1 className="page-title" id="loyalty-title">Лояльность</h1><p className="page-subtitle">Только подтверждённые начисления. Баланс нельзя менять вручную.</p></div><div className="header-actions"><button className="btn btn-outline" onClick={retry} type="button">↻ Обновить</button></div></div>{state.status === "loading" ? <div className="catalog-state" role="status">Загружаем историю лояльности…</div> : null}{state.status === "error" ? <div className="catalog-state catalog-state-error" role="alert"><strong>История временно недоступна</strong><span>{state.message}</span><button className="btn btn-outline" onClick={retry} type="button">Повторить</button></div> : null}{state.status === "success" && state.response.status === "unavailable" ? <div className="catalog-state catalog-state-error" role="alert"><strong>Нужна сверка балансов</strong><span>Backend не показывает неподтверждённые данные. Сначала нужно устранить расхождение в ledger.</span></div> : null}{state.status === "success" && state.response.status === "confirmed" ? <><div className="loyalty-rule-grid"><div className="loyalty-rule-card"><span>XP</span><strong>{state.response.rule.xpPerRuble} за 1 ₽</strong></div><div className="loyalty-rule-card"><span>Угольки</span><strong>1 за {state.response.rule.rublesPerCoal} ₽</strong></div><div className="loyalty-rule-card"><span>Сгорание</span><strong>Нет</strong></div><div className="loyalty-rule-card"><span>Redemption</span><strong>Доступен</strong></div></div>{state.response.entries.length === 0 ? <div className="table-card"><div className="table-empty">Подтверждённых операций пока нет</div></div> : <div className="table-card"><div className="table-header"><h2>История операций ({state.response.pagination.total})</h2></div><div className="table-scroll"><table><thead><tr><th>Клиент</th><th>Тип</th><th>Источник</th><th>XP</th><th>Угольки</th><th>Баланс после</th><th>Причина</th><th>Дата</th></tr></thead><tbody>{state.response.entries.map((entry) => <tr key={entry.id}><td><strong>{entry.customer.name}</strong><span className="product-description">{entry.customer.phoneMasked}</span></td><td>{entryType(entry.entryType)}</td><td>{entry.sourceOrderId === null ? entry.sourceType : `Заказ #${entry.sourceOrderId}`}</td><td>{delta(entry.xpDelta, "XP")}</td><td>{delta(entry.coalDelta, "угольков")}</td><td>{entry.xpBalance.toLocaleString("ru-RU")} XP<br />{entry.coalBalance.toLocaleString("ru-RU")} угольков</td><td>{entry.reason}</td><td><span className="product-description">{date(entry.createdAt)}</span></td></tr>)}</tbody></table></div></div>}<div className="loyalty-safe-note"><strong>Безопасная модель</strong><span>Admin видит источник, delta, snapshot баланса и время. Кнопок «задать баланс», «задать XP» и «задать rank» нет.</span></div></> : null}</section>;
}

export function LoyaltyScreen({ client, section = "overview" }: LoyaltyScreenProps): React.JSX.Element {
  if (section === "rewards") return <RewardManagement client={client} />;
  if (section === "wheel") return <WheelManagement client={client} />;
  if (section === "quests") return <QuestManagement client={client} />;
  return <LoyaltyOverview client={client} />;
}
