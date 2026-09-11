import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createAdminCommunicationDraftMutationController,
  createAdminCommunicationPreviewRequestController,
  createAdminCommunicationsListRequestController,
  type AdminCommunicationDraftMutationController,
  type AdminCommunicationDraftMutationState,
  type AdminCommunicationPreviewRequestController,
  type AdminCommunicationPreviewState,
  type AdminCommunicationsClient,
  type AdminCommunicationsListRequestController,
  type AdminCommunicationsListState
} from "@vse-pro-zhar/api-client";
import type {
  AdminCommunicationChannel,
  AdminCommunicationDraft,
  AdminCommunicationDraftDetailResponse,
  AdminCommunicationTemplate,
  AdminCommunicationTemplateCode,
  AdminSegmentCode
} from "@vse-pro-zhar/contracts";

import { useModalBehavior } from "./modal-behavior";

const DEFAULT_CHANNEL: AdminCommunicationChannel = "push";

function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  return typeof cryptoApi?.randomUUID === "function" ? cryptoApi.randomUUID() : `admin-draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function statusLabel(status: AdminCommunicationDraft["status"]): string {
  return status === "draft" ? "Черновик" : status === "previewed" ? "Превью создано" : "Архив";
}

function MessageTemplates({ templates, selected, onSelect }: { readonly templates: readonly AdminCommunicationTemplate[]; readonly selected: AdminCommunicationTemplateCode | null; readonly onSelect: (template: AdminCommunicationTemplate) => void }): React.JSX.Element {
  return <div className="msg-templates">{templates.map((template) => <button aria-pressed={selected === template.code} className={`msg-tpl ${selected === template.code ? "active" : ""}`} key={template.code} onClick={() => onSelect(template)} type="button"><span aria-hidden="true" className="tpl-icon">{template.icon}</span><span className="tpl-text">{template.title}</span></button>)}</div>;
}

function MessageModal({
  channels,
  draftId,
  draftVersion,
  initialSegmentCode,
  onClose,
  onPreview,
  onSave,
  onTextChange,
  onTemplateSelect,
  onChannelChange,
  onDelayChange,
  onPromoChange,
  promoOptions,
  selectedPromo,
  selectedTemplate,
  templates,
  text,
  channel,
  delay,
  mutationState,
  previewState,
  previewStale,
  previewError
}: {
  readonly channels: readonly { readonly channel: AdminCommunicationChannel; readonly status: "unavailable"; readonly reason: "provider_not_connected" }[];
  readonly draftId: number | null;
  readonly draftVersion: number | null;
  readonly initialSegmentCode: AdminSegmentCode;
  readonly onClose: () => void;
  readonly onPreview: () => void;
  readonly onSave: () => void;
  readonly onTextChange: (value: string) => void;
  readonly onTemplateSelect: (template: AdminCommunicationTemplate) => void;
  readonly onChannelChange: (value: AdminCommunicationChannel) => void;
  readonly onDelayChange: (value: string) => void;
  readonly onPromoChange: (value: number | null) => void;
  readonly promoOptions: readonly { readonly id: number; readonly code: string; readonly version: number; readonly type: "percent" | "fixed"; readonly value: number }[];
  readonly selectedPromo: number | null;
  readonly selectedTemplate: AdminCommunicationTemplateCode | null;
  readonly templates: readonly AdminCommunicationTemplate[];
  readonly text: string;
  readonly channel: AdminCommunicationChannel;
  readonly delay: string;
  readonly mutationState: AdminCommunicationDraftMutationState;
  readonly previewState: AdminCommunicationPreviewState;
  readonly previewStale: boolean;
  readonly previewError: string | null;
}): React.JSX.Element {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const preview = previewState.status === "success" ? previewState.response : null;
  const recipientCount = preview?.status === "confirmed" ? preview.recipientCount.toLocaleString("ru-RU") : previewState.status === "loading" ? "…" : "—";
  const previewUnavailable = preview?.status === "unavailable" ? preview.message : null;
  const channelUnavailable = channels.find((item) => item.channel === channel)?.status === "unavailable";
  const saving = mutationState.status === "loading";
  const conflict = mutationState.status === "conflict" ? mutationState.message : null;
  const saveDisabled = saving || initialSegmentCode === undefined || selectedTemplate === null || text.trim() === "";

  useModalBehavior(modalRef, onClose, closeButtonRef);

  return <div className="modal-overlay message-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
    <div aria-describedby="message-modal-description" aria-labelledby="message-modal-title" aria-modal="true" className="modal-box message-modal-box" ref={modalRef} role="dialog" tabIndex={-1}>
      <h2 id="message-modal-title">📨 Написать сегменту</h2>
      <p className="sr-only" id="message-modal-description">Подготовка и сохранение черновика сообщения для выбранного live-сегмента. Отправка остаётся недоступной до подключения Push/SMS.</p>
      <div className="message-recipients-preview">Получатели: <b>{recipientCount}</b> клиентов<span className="message-segment-code">Сегмент: {initialSegmentCode}</span>{draftId !== null ? <span className="message-segment-code">Draft #{draftId} · v{draftVersion}</span> : null}</div>

      <div className="form-group"><span>Шаблон сообщения</span><MessageTemplates onSelect={onTemplateSelect} selected={selectedTemplate} templates={templates} /></div>
      <label className="form-group"><span>Текст сообщения</span><textarea aria-label="Текст сообщения" maxLength={2000} onChange={(event) => onTextChange(event.target.value)} placeholder="Здравствуйте! У нас для вас специальное предложение..." rows={5} value={text} /></label>

      <div className="form-row">
        <label className="form-group"><span>Канал доставки</span><select aria-label="Канал доставки" disabled={channels.length === 0} onChange={(event) => onChannelChange(event.target.value as AdminCommunicationChannel)} value={channel}>{channels.map((item) => <option key={item.channel} value={item.channel}>{item.channel === "push" ? "🔔 Push-уведомление" : "✉ SMS"} — недоступно</option>)}</select></label>
        <label className="form-group"><span>Задержка (сек)</span><select aria-label="Задержка сообщения" onChange={(event) => onDelayChange(event.target.value)} value={delay}><option value="0">Отправить сразу</option><option value="60">Через 1 мин</option><option value="300">Через 5 мин</option><option value="3600">Через 1 час</option></select></label>
      </div>

      <div className="message-attachment"><div className="message-attachment-row"><label><input aria-label="Прикрепить промокод" checked={selectedPromo !== null} disabled={promoOptions.length === 0} onChange={(event) => onPromoChange(event.target.checked ? promoOptions[0]?.id ?? null : null)} type="checkbox" /> 🎫 Прикрепить промокод</label><select aria-label="Промокод" disabled={promoOptions.length === 0 || selectedPromo === null} onChange={(event) => onPromoChange(event.target.value === "" ? null : Number(event.target.value))} value={selectedPromo ?? ""}><option value="">{promoOptions.length === 0 ? "Недоступно: нет approved промокодов" : "Выберите промокод"}</option>{promoOptions.map((promo) => <option key={promo.id} value={promo.id}>{promo.code} · v{promo.version}</option>)}</select></div><span>{promoOptions.length === 0 ? "Прикрепление доступно только для активных approved Promo definitions." : "Сохраняется только server-owned promo definition и его version snapshot; скидка не рассчитывается."}</span></div>

      {preview !== null && preview.status === "confirmed" ? <div className="msg-preview-box"><div className="msg-preview-label">📱 Превью сообщения:</div><div className="msg-preview-content">{preview.renderedBody}</div><div className="msg-preview-meta">Preview создан {new Date(preview.generatedAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" })}. Показано получателей: {preview.recipientsPreview.length} из {preview.recipientCount}.</div></div> : null}
      {previewUnavailable !== null ? <div className="message-preview-unavailable" role="status">{previewUnavailable}</div> : null}
      {previewError !== null ? <div className="promo-form-error" role="alert">{previewError}</div> : null}
      {conflict !== null ? <div className="message-conflict" role="alert">{conflict} Обновите draft перед сохранением.</div> : null}
      {mutationState.status === "error" ? <div className="promo-form-error" role="alert">{mutationState.message}</div> : null}
      {mutationState.status === "success" ? <div className="message-save-success" role="status">Черновик сохранён в Backend.</div> : null}
      {channelUnavailable ? <div className="message-unavailable-note" role="status">Отправка недоступна до подключения Push/SMS. Preview и сохранение не отправляют сообщение.</div> : null}
      <div className="message-store-note">Задержка сохраняется как metadata и не запускает отправку.</div>

      <div className="modal-actions"><button className="btn btn-outline" onClick={onClose} ref={closeButtonRef} type="button">Отмена</button><button className="btn btn-outline" disabled={previewState.status === "loading" || text.trim() === "" || selectedTemplate === null || (previewStale === false && previewState.status !== "error")} onClick={onPreview} type="button">◉ Превью</button><button className="btn btn-outline" disabled={saveDisabled} onClick={onSave} type="button">{saving ? "Сохраняем…" : draftId === null ? "Сохранить черновик" : "Сохранить изменения"}</button><button aria-disabled="true" className="btn btn-primary" disabled title="Отправка недоступна до подключения Push/SMS и утверждения M15">✈ Отправить</button></div>
    </div>
  </div>;
}

function DraftHistoryTable({ drafts, selectedId, onSelect, onEdit, onArchive, onRestore }: { readonly drafts: readonly AdminCommunicationDraft[]; readonly selectedId: number | null; readonly onSelect: (draft: AdminCommunicationDraft) => void; readonly onEdit: (draft: AdminCommunicationDraft) => void; readonly onArchive: (draft: AdminCommunicationDraft) => void; readonly onRestore: (draft: AdminCommunicationDraft) => void }): React.JSX.Element {
  return <div className="table-scroll communications-table-scroll"><table className="communications-table"><thead><tr><th>ID</th><th>Сегмент</th><th>Канал</th><th>Текст</th><th>Получателей</th><th>Статус</th><th>Дата</th><th>Действия</th></tr></thead><tbody>{drafts.length === 0 ? <tr><td className="table-empty" colSpan={8}>Сохранённых черновиков пока нет</td></tr> : drafts.map((draft) => <tr className={selectedId === draft.id ? "selected" : ""} key={draft.id} onClick={() => onSelect(draft)}><td>#{draft.id}</td><td>{draft.segmentCode}<small>v{draft.segmentDefinitionVersion}</small></td><td>{draft.channel.toUpperCase()}</td><td className="communications-message-cell">{draft.body}</td><td>{draft.preview?.recipientCount ?? "—"}</td><td><span className={`communication-status ${draft.status}`}>{statusLabel(draft.status)}</span></td><td>{new Date(draft.updatedAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" })}</td><td><div className="communication-row-actions"><button aria-label={`Открыть черновик ${draft.id}`} className="promo-action-button" onClick={(event) => { event.stopPropagation(); onEdit(draft); }} type="button">✎</button>{draft.status === "archived" ? <button aria-label={`Восстановить черновик ${draft.id}`} className="promo-action-button" onClick={(event) => { event.stopPropagation(); onRestore(draft); }} type="button">↩</button> : <button aria-label={`Архивировать черновик ${draft.id}`} className="promo-action-button" onClick={(event) => { event.stopPropagation(); onArchive(draft); }} type="button">⌫</button>}</div></td></tr>)}</tbody></table></div>;
}

function DraftDetail({ detail, onClose }: { readonly detail: AdminCommunicationDraftDetailResponse; readonly onClose: () => void }): React.JSX.Element {
  const { draft } = detail;
  return <aside aria-label={`Детали черновика ${draft.id}`} className="communications-detail-panel"><div className="communications-detail-header"><div><p className="eyebrow">DRAFT #{draft.id}</p><h2>{draft.templateTitle}</h2></div><button aria-label="Закрыть детали черновика" className="promo-action-button" onClick={onClose} type="button">×</button></div><p className="communications-detail-body">{draft.body}</p><dl className="communications-detail-meta"><div><dt>Статус</dt><dd>{statusLabel(draft.status)}</dd></div><div><dt>Сегмент</dt><dd>{draft.segmentCode} · definition v{draft.segmentDefinitionVersion}</dd></div><div><dt>Канал</dt><dd>{draft.channel.toUpperCase()}</dd></div><div><dt>Preview</dt><dd>{draft.preview === null ? "Не создано" : `${draft.preview.recipientCount} получателей · ${new Date(draft.preview.generatedAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" })}`}</dd></div><div><dt>Промокод</dt><dd>{draft.promo === null ? "Не прикреплён" : `${draft.promo.code} · v${draft.promo.version}`}</dd></div></dl><div className="communications-audit"><strong>История изменений</strong>{detail.audit.length === 0 ? <span>Нет записей</span> : <ol>{detail.audit.map((entry) => <li key={entry.id}><span>{entry.action}</span><time>{new Date(entry.createdAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" })}</time></li>)}</ol>}</div><p className="communications-detail-note">Отправка, delivery statuses и экспорт получателей недоступны до M15.</p></aside>;
}

export interface CommunicationsScreenProps {
  readonly client: AdminCommunicationsClient;
  readonly initialSegmentCode?: AdminSegmentCode | null;
  readonly onComposerClosed?: () => void;
}

export function CommunicationsScreen({ client, initialSegmentCode = null, onComposerClosed }: CommunicationsScreenProps): React.JSX.Element {
  const [listState, setListState] = useState<AdminCommunicationsListState>({ status: "loading" });
  const [previewState, setPreviewState] = useState<AdminCommunicationPreviewState>({ status: "idle", request: null });
  const [mutationState, setMutationState] = useState<AdminCommunicationDraftMutationState>({ status: "idle", operation: null });
  const [composerOpen, setComposerOpen] = useState(initialSegmentCode !== null);
  const [segmentCode, setSegmentCode] = useState<AdminSegmentCode | null>(initialSegmentCode);
  const [selectedTemplate, setSelectedTemplate] = useState<AdminCommunicationTemplateCode | null>(null);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<AdminCommunicationChannel>(DEFAULT_CHANNEL);
  const [delay, setDelay] = useState("0");
  const [selectedPromo, setSelectedPromo] = useState<number | null>(null);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [previewStale, setPreviewStale] = useState(true);
  const [autoPreviewPending, setAutoPreviewPending] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState<"all" | AdminCommunicationDraft["status"]>("all");
  const [selectedDraft, setSelectedDraft] = useState<AdminCommunicationDraft | null>(null);
  const [selectedDraftDetail, setSelectedDraftDetail] = useState<AdminCommunicationDraftDetailResponse | null>(null);
  const listControllerRef = useRef<AdminCommunicationsListRequestController | null>(null);
  const previewControllerRef = useRef<AdminCommunicationPreviewRequestController | null>(null);
  const mutationControllerRef = useRef<AdminCommunicationDraftMutationController | null>(null);

  useEffect(() => {
    const controller = createAdminCommunicationsListRequestController(client, setListState);
    listControllerRef.current = controller;
    controller.load();
    return () => { controller.dispose(); if (listControllerRef.current === controller) listControllerRef.current = null; };
  }, [client]);

  useEffect(() => {
    const controller = createAdminCommunicationPreviewRequestController(client, setPreviewState);
    previewControllerRef.current = controller;
    return () => { controller.dispose(); if (previewControllerRef.current === controller) previewControllerRef.current = null; };
  }, [client]);

  useEffect(() => {
    const controller = createAdminCommunicationDraftMutationController(client, setMutationState);
    mutationControllerRef.current = controller;
    return () => { controller.dispose(); if (mutationControllerRef.current === controller) mutationControllerRef.current = null; };
  }, [client]);

  useEffect(() => {
    if (initialSegmentCode !== null) { setSegmentCode(initialSegmentCode); setComposerOpen(true); }
  }, [initialSegmentCode]);

  const response = listState.status === "success" ? listState.response : null;
  const templates = response?.templates ?? [];
  const drafts = useMemo(() => {
    const source = response?.history.drafts ?? [];
    const search = historySearch.trim().toLowerCase();
    return source.filter((draft) => (historyStatus === "all" || draft.status === historyStatus) && (search === "" || draft.body.toLowerCase().includes(search) || draft.segmentCode.toLowerCase().includes(search) || String(draft.id).includes(search)));
  }, [historySearch, historyStatus, response]);
  const closeComposer = useCallback((): void => { setComposerOpen(false); setSegmentCode(null); setSelectedTemplate(null); setText(""); setSelectedPromo(null); setDraftId(null); setDraftVersion(null); setIdempotencyKey(newIdempotencyKey()); setPreviewState({ status: "idle", request: null }); setPreviewStale(true); setAutoPreviewPending(false); setMutationState({ status: "idle", operation: null }); onComposerClosed?.(); }, [onComposerClosed]);
  const selectTemplate = useCallback((template: AdminCommunicationTemplate): void => { setSelectedTemplate(template.code); setText(template.body); setPreviewStale(true); setAutoPreviewPending(true); setPreviewError(null); setPreviewState({ status: "idle", request: null }); }, []);
  const updateText = useCallback((value: string): void => { setText(value); setPreviewStale(true); setPreviewError(null); }, []);
  useEffect(() => {
    if (!composerOpen || segmentCode === null || selectedTemplate !== null || templates[0] === undefined) return;
    selectTemplate(templates[0]);
  }, [composerOpen, segmentCode, selectTemplate, selectedTemplate, templates]);
  const runPreview = useCallback((): void => {
    if (segmentCode === null || selectedTemplate === null || text.trim() === "") { setPreviewError("Выберите шаблон и введите текст сообщения."); return; }
    setPreviewError(null);
    setPreviewStale(false);
    previewControllerRef.current?.load({ segmentCode, templateCode: selectedTemplate, body: text, channel, ...(draftId === null || draftVersion === null ? {} : { draftId, expectedVersion: draftVersion }), promoDefinitionId: selectedPromo });
  }, [channel, draftId, draftVersion, segmentCode, selectedPromo, selectedTemplate, text]);
  useEffect(() => {
    if (!composerOpen || !autoPreviewPending || segmentCode === null || selectedTemplate === null || text.trim() === "") return;
    previewControllerRef.current?.load({ segmentCode, templateCode: selectedTemplate, body: text, channel, ...(draftId === null || draftVersion === null ? {} : { draftId, expectedVersion: draftVersion }), promoDefinitionId: selectedPromo });
    setAutoPreviewPending(false);
    setPreviewStale(false);
  }, [autoPreviewPending, channel, composerOpen, draftId, draftVersion, segmentCode, selectedPromo, selectedTemplate, text]);
  const saveDraft = useCallback((): void => {
    if (segmentCode === null || selectedTemplate === null || text.trim() === "") { setPreviewError("Выберите сегмент, шаблон и введите текст сообщения."); return; }
    const input = { templateCode: selectedTemplate, body: text, channel, delaySeconds: Number(delay), segmentCode, promoDefinitionId: selectedPromo } as const;
    if (draftId === null) mutationControllerRef.current?.create({ ...input, idempotencyKey });
    else if (draftVersion !== null) mutationControllerRef.current?.update(draftId, { ...input, expectedVersion: draftVersion });
  }, [channel, delay, draftId, draftVersion, idempotencyKey, segmentCode, selectedPromo, selectedTemplate, text]);
  const openDraft = useCallback((draft: AdminCommunicationDraft): void => { setDraftId(draft.id); setDraftVersion(draft.version); setSegmentCode(draft.segmentCode as AdminSegmentCode); setSelectedTemplate(draft.templateCode); setText(draft.body); setChannel(draft.channel); setDelay(String(draft.delaySeconds)); setSelectedPromo(draft.promo?.definitionId ?? null); setIdempotencyKey(draft.idempotencyKey); setComposerOpen(true); setPreviewStale(draft.preview === null); setPreviewState({ status: "idle", request: null }); }, []);
  const selectDraft = useCallback((draft: AdminCommunicationDraft): void => { setSelectedDraft(draft); setSelectedDraftDetail(null); void client.getDraft(draft.id).then(setSelectedDraftDetail).catch(() => undefined); }, [client]);
  const archiveDraft = useCallback((draft: AdminCommunicationDraft): void => { mutationControllerRef.current?.archive(draft.id, { expectedVersion: draft.version }); }, []);
  const restoreDraft = useCallback((draft: AdminCommunicationDraft): void => { mutationControllerRef.current?.restore(draft.id, { expectedVersion: draft.version }); }, []);

  useEffect(() => {
    if (mutationState.status === "success") { setDraftId(mutationState.response.draft.id); setDraftVersion(mutationState.response.draft.version); setIdempotencyKey(mutationState.response.draft.idempotencyKey); if (mutationState.operation === "archive" || mutationState.operation === "restore") { setSelectedDraft(null); setSelectedDraftDetail(null); } listControllerRef.current?.retry(); }
  }, [mutationState]);
  useEffect(() => {
    if (previewState.status === "success" && previewState.response.status === "confirmed" && previewState.response.draft !== undefined) { setDraftId(previewState.response.draft.id); setDraftVersion(previewState.response.draft.version); setPreviewStale(false); listControllerRef.current?.retry(); }
  }, [previewState]);

  return <section aria-labelledby="communications-title" className="communications-screen">
    <div className="page-header"><div><h1 className="page-title" id="communications-title">История рассылок</h1><p className="page-subtitle">Все отправленные сообщения клиентам</p></div><div className="header-actions"><button aria-disabled="true" className="btn btn-outline" disabled title="Экспорт персональных данных пока недоступен">⇩ Экспорт</button></div></div>
    {listState.status === "loading" ? <div aria-label="Загрузка коммуникаций" className="catalog-state communications-loading" role="status"><span className="promo-skeleton-line" /><span className="promo-skeleton-line" /><span className="promo-skeleton-line" /></div> : null}
    {listState.status === "error" ? <div className="catalog-state catalog-state-error" role="alert"><strong>Коммуникации временно недоступны</strong><span>{listState.message}</span><button className="btn btn-outline" onClick={() => listControllerRef.current?.retry()} type="button">Повторить</button></div> : null}
    {response !== null ? <>
      <div className="table-card communications-table-card"><div className="table-header"><h2>Черновики и история</h2><div className="communications-filters"><select aria-label="Фильтр статуса" className="table-search" onChange={(event) => setHistoryStatus(event.target.value as "all" | AdminCommunicationDraft["status"])} value={historyStatus}><option value="all">Все статусы</option><option value="draft">Черновики</option><option value="previewed">С preview</option><option value="archived">Архив</option></select><input aria-label="Поиск рассылки" className="table-search" onChange={(event) => setHistorySearch(event.target.value)} placeholder="Поиск..." type="search" value={historySearch} /></div></div><DraftHistoryTable drafts={drafts} onArchive={archiveDraft} onEdit={openDraft} onRestore={restoreDraft} onSelect={selectDraft} selectedId={selectedDraft?.id ?? null} /></div>
      {selectedDraftDetail !== null ? <DraftDetail detail={selectedDraftDetail} onClose={() => { setSelectedDraft(null); setSelectedDraftDetail(null); }} /> : null}
      <div className="loyalty-safe-note communications-safe-note"><strong>Безопасная подготовка</strong><span>Drafts, template/segment/promo versions и bounded preview metadata сохраняются Backend. Отправка Push/SMS, delivery statuses и PII export остаются недоступны.</span></div>
    </> : null}
    {segmentCode === null ? <div className="communications-selection-note" role="status"><strong>Выберите сегмент для preview</strong><span>Откройте раздел «Сегменты» и выберите built-in сегмент. Получатели и их количество будут рассчитаны Backend в live preview.</span></div> : null}
    {composerOpen && segmentCode !== null && response !== null ? <MessageModal channels={response.channels} delay={delay} draftId={draftId} draftVersion={draftVersion} initialSegmentCode={segmentCode} mutationState={mutationState} onChannelChange={(value) => { setChannel(value); setPreviewStale(true); }} onClose={closeComposer} onDelayChange={setDelay} onPreview={runPreview} onPromoChange={setSelectedPromo} onSave={saveDraft} onTemplateSelect={selectTemplate} onTextChange={updateText} previewError={previewError} previewStale={previewStale} previewState={previewState} promoOptions={response.promoOptions} selectedPromo={selectedPromo} selectedTemplate={selectedTemplate} templates={templates} text={text} channel={channel} /> : null}
  </section>;
}
