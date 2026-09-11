import {
  ApiErrorSchema,
  type ApiError,
  type ApiErrorCode
} from "@vse-pro-zhar/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const SAFE_ERROR_MESSAGES: Readonly<Record<ApiErrorCode, string>> = {
  NOT_FOUND: "Ресурс не найден",
  VALIDATION_ERROR: "Проверьте данные запроса",
  CART_ITEM_UNAVAILABLE: "Некоторые блюда больше недоступны",
  SERVICE_UNAVAILABLE: "Сервис временно недоступен",
  PAYLOAD_TOO_LARGE: "Файл слишком большой",
  AUTHENTICATION_ERROR: "Сессия недействительна или истекла",
  FORBIDDEN: "Недостаточно прав для этой операции",
  RATE_LIMITED: "Слишком много запросов. Повторите позже",
  CHECKOUT_UNAVAILABLE: "Самовывоз временно недоступен",
  CHECKOUT_STALE: "Данные оформления устарели. Обновите расчёт",
  PICKUP_OPTION_UNAVAILABLE: "Выбранное время самовывоза больше недоступно",
  IDEMPOTENCY_CONFLICT: "Этот ключ уже использован для другого заказа",
  PAYMENT_NOT_ALLOWED: "Для этого заказа оплата сейчас недоступна",
  PAYMENT_UNAVAILABLE: "Оплата временно недоступна. Повторите попытку позже",
  PAYMENT_INVALID: "Платёж не удалось безопасно подтвердить",
  FULFILLMENT_RECOVERY_NOT_ALLOWED: "Повторная отправка заказа сейчас недоступна",
  CANCELLATION_NOT_ALLOWED: "Отмена этого заказа сейчас недоступна",
  ORDER_ALREADY_CANCELED: "Заказ уже отменён",
  REFUND_PENDING: "Возврат ещё обрабатывается",
  REFUND_RECONCILIATION_REQUIRED: "Нужно проверить статус возврата",
  LOYALTY_UNAVAILABLE: "Программа лояльности временно недоступна",
  LOYALTY_RECONCILIATION_REQUIRED: "Баланс лояльности нужно проверить",
  LOYALTY_REDEMPTION_UNAVAILABLE: "Списание угольков пока недоступно",
  LOYALTY_INSUFFICIENT_BALANCE: "Недостаточно угольков",
  LOYALTY_IDEMPOTENCY_CONFLICT: "Этот ключ уже использован для другой операции лояльности",
  LOYALTY_INVALID_TRANSITION: "Операция лояльности сейчас недоступна",
  LOYALTY_REWARD_CONFLICT: "Награда изменена в другой сессии. Обновите данные",
  LOYALTY_REWARD_CODE_CONFLICT: "Награда с таким кодом уже существует",
  LOYALTY_REWARD_IDEMPOTENCY_CONFLICT: "Этот ключ уже использован для другой награды",
  LOYALTY_WHEEL_UNAVAILABLE: "Рулетка временно недоступна",
  LOYALTY_WHEEL_PRIZE_LIMIT: "Достигнут лимит в 6 призов рулетки",
  LOYALTY_WHEEL_PRIZE_CONFLICT: "Приз с таким кодом уже существует",
  LOYALTY_WHEEL_PRIZE_IDEMPOTENCY_CONFLICT: "Этот ключ уже использован для другого изменения приза",
  LOYALTY_WHEEL_COOLDOWN: "Рулетка будет доступна позже",
  LOYALTY_WHEEL_LIMIT_REACHED: "Лимит вращений рулетки исчерпан",
  LOYALTY_WHEEL_NOT_ELIGIBLE: "Для рулетки нужен завершённый оплаченный заказ от 1 500 ₽",
  LOYALTY_WHEEL_SETTINGS_CONFLICT: "Настройки рулетки изменены в другой сессии. Обновите данные",
  LOYALTY_WHEEL_SETTINGS_IDEMPOTENCY_CONFLICT: "Этот ключ уже использован для другого изменения настроек рулетки",
  LOYALTY_QUEST_UNAVAILABLE: "Квесты временно недоступны",
  LOYALTY_QUEST_CONFLICT: "Квест изменён в другой сессии или это изменение недоступно",
  LOYALTY_QUEST_CODE_CONFLICT: "Квест с таким кодом уже существует",
  LOYALTY_QUEST_IDEMPOTENCY_CONFLICT: "Этот ключ уже использован для другого квеста",
  COMMUNICATION_DRAFT_CONFLICT: "Черновик изменён в другой сессии. Обновите данные",
  COMMUNICATION_IDEMPOTENCY_CONFLICT: "Этот ключ уже использован для другого черновика",
  COMMUNICATION_UNAVAILABLE: "Коммуникации временно недоступны",
  NOTIFICATION_UNAVAILABLE: "Уведомления временно недоступны",
  NOTIFICATION_DEVICE_CONFLICT: "Это устройство уже зарегистрировано в другой сессии",
  CATALOG_CATEGORY_CONFLICT: "Категория изменена в другой сессии. Обновите данные",
  CATALOG_CATEGORY_IDEMPOTENCY_CONFLICT: "Этот ключ уже использован для другого изменения категории",
  INTERNAL_ERROR: "Внутренняя ошибка сервера"
};

export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly logContext: Readonly<Record<string, unknown>> | null;

  constructor(
    code: ApiErrorCode,
    statusCode: number,
    message: string = code,
    logContext: Readonly<Record<string, unknown>> | null = null
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.statusCode = statusCode;
    this.logContext = logContext;
  }
}

function sendApiError(
  reply: FastifyReply,
  request: FastifyRequest,
  code: ApiErrorCode,
  statusCode: number
): FastifyReply {
  const response: ApiError = ApiErrorSchema.parse({
    error: {
      code,
      message: SAFE_ERROR_MESSAGES[code],
      requestId: request.id
    }
  });

  return reply.code(statusCode).send(response);
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    sendApiError(reply, request, "NOT_FOUND", 404)
  );

  app.setErrorHandler((error, request, reply) => {
    if (reply.sent) {
      request.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Unhandled error after response was sent"
      );
      return;
    }

    request.log.error(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        ...(error instanceof ApiRequestError && error.logContext !== null
          ? { context: error.logContext }
          : {})
      },
      "Unhandled request error"
    );

    if (error instanceof ApiRequestError) {
      return sendApiError(reply, request, error.code, error.statusCode);
    }

    return sendApiError(reply, request, "INTERNAL_ERROR", 500);
  });
}
