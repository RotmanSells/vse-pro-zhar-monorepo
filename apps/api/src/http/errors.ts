import {
  ApiErrorSchema,
  type ApiError,
  type ApiErrorCode
} from "@vse-pro-zhar/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const SAFE_ERROR_MESSAGES: Readonly<Record<ApiErrorCode, string>> = {
  NOT_FOUND: "Ресурс не найден",
  VALIDATION_ERROR: "Проверьте данные запроса",
  SERVICE_UNAVAILABLE: "Сервис временно недоступен",
  PAYLOAD_TOO_LARGE: "Файл слишком большой",
  INTERNAL_ERROR: "Внутренняя ошибка сервера"
};

export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;

  constructor(code: ApiErrorCode, statusCode: number, message: string = code) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.statusCode = statusCode;
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
      request.log.error({ err: error }, "Unhandled error after response was sent");
      return;
    }

    request.log.error({ err: error }, "Unhandled request error");

    if (error instanceof ApiRequestError) {
      return sendApiError(reply, request, error.code, error.statusCode);
    }

    return sendApiError(reply, request, "INTERNAL_ERROR", 500);
  });
}
