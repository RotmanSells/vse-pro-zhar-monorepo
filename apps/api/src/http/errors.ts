import {
  ApiErrorSchema,
  type ApiError,
  type ApiErrorCode
} from "@vse-pro-zhar/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const SAFE_ERROR_MESSAGES: Readonly<Record<ApiErrorCode, string>> = {
  NOT_FOUND: "Ресурс не найден",
  INTERNAL_ERROR: "Внутренняя ошибка сервера"
};

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
    return sendApiError(reply, request, "INTERNAL_ERROR", 500);
  });
}
