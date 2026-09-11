import { createHash } from "node:crypto";

import type {
  AdminPushDelivery,
  AdminPushSendRequest,
  AdminPushSendResponse
} from "@vse-pro-zhar/contracts";
import type {
  CustomerNotificationDeliveryRecord,
  CustomerPushRepository
} from "@vse-pro-zhar/database";

import { normalizePhone } from "../auth/service.js";
import {
  ExpoPushProviderError,
  type ExpoPushProvider
} from "./expo-provider.js";

export class PushCustomerNotFoundError extends Error {
  constructor() {
    super("Push customer was not found");
    this.name = "PushCustomerNotFoundError";
  }
}

export class PushDisabledError extends Error {
  constructor() {
    super("Customer push notifications are disabled");
    this.name = "PushDisabledError";
  }
}

export class PushDeviceNotFoundError extends Error {
  constructor() {
    super("Customer has no registered push device");
    this.name = "PushDeviceNotFoundError";
  }
}

export interface PushSendInput extends AdminPushSendRequest {
  readonly requestKey: string;
  readonly now: Date;
}

function payloadFingerprint(input: Pick<AdminPushSendRequest, "phone" | "title" | "body">): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function deliveryStatus(record: CustomerNotificationDeliveryRecord): AdminPushDelivery {
  if (
    record.status !== "accepted" &&
    record.status !== "delivered" &&
    record.status !== "failed" &&
    record.status !== "reconciliation_required"
  ) {
    throw new Error("Push delivery is still pending");
  }
  return {
    id: record.id,
    deviceId: record.deviceId,
    provider: "expo",
    status: record.status,
    providerTicketId: record.providerTicketId,
    errorCode: record.errorCode,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

export async function sendAdminPush(
  repository: CustomerPushRepository,
  provider: ExpoPushProvider,
  input: PushSendInput
): Promise<AdminPushSendResponse> {
  const phone = normalizePhone(input.phone);
  if (phone === null) throw new PushCustomerNotFoundError();
  const customerId = await repository.findCustomerIdByPhone(phone);
  if (customerId === null) throw new PushCustomerNotFoundError();
  if (!(await repository.isPushEnabled(customerId))) throw new PushDisabledError();

  const devices = await repository.listEnabledPushDevices(customerId);
  if (devices.length === 0) throw new PushDeviceNotFoundError();

  const fingerprint = payloadFingerprint({ phone, title: input.title, body: input.body });
  const prepared = await Promise.all(devices.map((device) => repository.prepareDelivery({
    customerId,
    deviceId: device.id,
    requestKey: input.requestKey,
    payloadFingerprint: fingerprint,
    now: input.now
  })));

  const pendingNew = prepared.filter((item) => item.created);
  for (const item of pendingNew) {
    const device = devices.find((candidate) => candidate.id === item.delivery.deviceId);
    if (device === undefined) continue;
    try {
      const ticket = await provider.send({ token: device.token, title: input.title, body: input.body });
      if (ticket.status === "ok") {
        await repository.updateDelivery(item.delivery.id, {
          status: "accepted",
          providerTicketId: ticket.id,
          errorCode: null,
          updatedAt: input.now
        });
      } else {
        await repository.updateDelivery(item.delivery.id, {
          status: "failed",
          providerTicketId: null,
          errorCode: ticket.errorCode,
          updatedAt: input.now
        });
        if (ticket.errorCode === "DeviceNotRegistered") await repository.disableDevice(device.id, input.now);
      }
    } catch (error: unknown) {
      const providerError = error instanceof ExpoPushProviderError ? error : null;
      await repository.updateDelivery(item.delivery.id, {
        status: providerError?.kind === "failed" ? "failed" : "reconciliation_required",
        providerTicketId: null,
        errorCode: providerError?.errorCode ?? "provider_unknown_error",
        updatedAt: input.now
      });
    }
  }

  const deliveries = await repository.listDeliveries(input.requestKey);
  const responseDeliveries = deliveries.map(deliveryStatus);
  return {
    status: "confirmed",
    customerId,
    deliveries: responseDeliveries,
    replayed: pendingNew.length === 0
  };
}
