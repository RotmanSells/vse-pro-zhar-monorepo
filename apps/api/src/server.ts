import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createCatalogRepository,
  createCustomerRepository,
  createCustomerProfileRepository,
  createDatabaseClient,
  createAdminOrderRepository,
  createAdminAnalyticsRepository,
  createAdminCustomerRepository,
  createAdminSegmentRepository,
  createAdminPromoRepository,
  createAdminCommunicationRepository,
  createCancellationRefundRepository,
  createIikoDispatchRepository,
  createLoyaltyRepository,
  createWheelQuestRepository,
  createOrderRepository,
  createPaymentRepository,
  createStaffRepository,
  createCustomerNotificationRepository,
  createCustomerPushRepository,
  type DatabaseClient
} from "@vse-pro-zhar/database";

import { buildApp } from "./app.js";
import { loadConfig, type ApiConfig } from "./config/env.js";
import { formatApiStartupError } from "./config/diagnostics.js";
import { createAvailabilityProviderFromEnvironment } from "./iiko/availability.js";
import {
  createIikoFulfillmentProviderFromEnvironment,
  type IikoFulfillmentProvider
} from "./iiko/fulfillment.js";
import { IikoDispatchProcessor } from "./iiko/processor.js";
import { LoyaltyProcessor } from "./loyalty/processor.js";
import { LoyaltyService } from "./loyalty/service.js";
import { QuestProcessor } from "./loyalty/quest-processor.js";
import { rankForXp } from "./loyalty/service.js";
import { RefundProcessor } from "./cancellation-refund/processor.js";
import { CancellationRefundService } from "./cancellation-refund/service.js";
import { createMediaStorage } from "./media/storage.js";
import { createYooKassaProviderFromEnvironment } from "./payments/provider.js";
import { createExpoPushProviderFromEnvironment } from "./notifications/expo-provider.js";

function loadLocalServerEnvironment(): void {
  // Node's process.loadEnvFile keeps the first value it loads. Read local
  // overrides before base files so a newly issued local credential wins over
  // a stale development value from .env.
  const environmentFiles = [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), "../../.env.local"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env")
  ];

  for (const environmentFile of environmentFiles) {
    if (existsSync(environmentFile)) {
      process.loadEnvFile(environmentFile);
    }
  }
}

export function installGracefulShutdown(
  app: FastifyInstance,
  closeResources: () => Promise<void> = async () => undefined
): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    app.log.info({ signal }, "Shutting down API");

    try {
      await app.close();
      await closeResources();
    } catch (error: unknown) {
      app.log.error({ err: error }, "API shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

export async function startServer(config: ApiConfig): Promise<FastifyInstance> {
  let database: DatabaseClient | undefined;
  let dispatchProcessor: IikoDispatchProcessor | undefined;
  let refundProcessor: RefundProcessor | undefined;
  let loyaltyProcessor: LoyaltyProcessor | undefined;
  let questProcessor: QuestProcessor | undefined;
  const availabilityProvider = createAvailabilityProviderFromEnvironment();
  const paymentProvider = createYooKassaProviderFromEnvironment();
  const pushProvider = createExpoPushProviderFromEnvironment();

  const databaseUrl = process.env["DATABASE_URL"];

  if (databaseUrl !== undefined && databaseUrl.trim() !== "") {
    database = createDatabaseClient();
  }

  const fulfillmentProvider: IikoFulfillmentProvider =
    createIikoFulfillmentProviderFromEnvironment();
  const fulfillmentRepository =
    database === undefined ? undefined : createIikoDispatchRepository(database);
  const staffRepository = database === undefined ? undefined : createStaffRepository(database);
  const adminOrderRepository = database === undefined ? undefined : createAdminOrderRepository(database);
  const analyticsRepository = database === undefined ? undefined : createAdminAnalyticsRepository(database);
  const adminCustomerRepository = database === undefined ? undefined : createAdminCustomerRepository(database);
  const adminSegmentRepository = database === undefined ? undefined : createAdminSegmentRepository(database);
  const adminPromoRepository = database === undefined ? undefined : createAdminPromoRepository(database);
  const adminCommunicationRepository = database === undefined ? undefined : createAdminCommunicationRepository(database);
  const cancellationRefundRepository = database === undefined
    ? undefined
    : createCancellationRefundRepository(database);
  const loyaltyRepository = database === undefined ? undefined : createLoyaltyRepository(database);
  const wheelQuestRepository = database === undefined ? undefined : createWheelQuestRepository(database, { nextRankCode: rankForXp });
  const notificationRepository = database === undefined ? undefined : createCustomerNotificationRepository(database);
  const pushRepository = database === undefined ? undefined : createCustomerPushRepository(database);

  const mediaDirectory = process.env["MEDIA_DIR"]?.trim();
  const mediaPublicUrl = process.env["MEDIA_PUBLIC_URL"]?.trim();
  const mediaStorage = createMediaStorage({
    directory:
      mediaDirectory === undefined || mediaDirectory === ""
        ? resolve(process.cwd(), "data/media")
        : mediaDirectory,
    publicUrl:
      mediaPublicUrl === undefined || mediaPublicUrl === ""
        ? `http://127.0.0.1:${config.port}`
        : mediaPublicUrl
  });

  const app =
    database === undefined
      ? buildApp(config, { mediaStorage })
      : buildApp(config, {
          catalogRepository: createCatalogRepository(database),
          customerRepository: createCustomerRepository(database),
          profileRepository: createCustomerProfileRepository(database),
          orderRepository: createOrderRepository(database),
          paymentRepository: createPaymentRepository(database),
          paymentProvider,
          availabilityProvider,
          ...(fulfillmentRepository === undefined ? {} : { fulfillmentRepository }),
          ...(staffRepository === undefined ? {} : { staffRepository }),
          ...(adminOrderRepository === undefined ? {} : { adminOrderRepository }),
          ...(cancellationRefundRepository === undefined ? {} : { cancellationRefundRepository }),
          ...(loyaltyRepository === undefined ? {} : { loyaltyRepository }),
          ...(wheelQuestRepository === undefined ? {} : { wheelQuestRepository }),
          ...(analyticsRepository === undefined ? {} : { analyticsRepository }),
          ...(adminCustomerRepository === undefined ? {} : { adminCustomerRepository }),
          ...(adminSegmentRepository === undefined ? {} : { adminSegmentRepository }),
          ...(adminPromoRepository === undefined ? {} : { adminPromoRepository }),
          ...(adminCommunicationRepository === undefined ? {} : { adminCommunicationRepository }),
          ...(notificationRepository === undefined ? {} : { notificationRepository }),
          ...(pushRepository === undefined ? {} : { pushRepository }),
          pushProvider,
          refundProvider: paymentProvider,
          mediaStorage
        });
  installGracefulShutdown(app, async () => {
    await dispatchProcessor?.stop();
    await refundProcessor?.stop();
    await loyaltyProcessor?.stop();
    await questProcessor?.stop();
    await database?.close();
  });

  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info({ host: config.host, port: config.port }, "API listening");
    if (fulfillmentRepository !== undefined) {
      dispatchProcessor = new IikoDispatchProcessor(
        fulfillmentRepository,
        fulfillmentProvider,
        { onError: (error) => app.log.error({ err: error }, "iiko dispatch processor failed") }
      );
      dispatchProcessor.start();
    }
    if (cancellationRefundRepository !== undefined) {
      refundProcessor = new RefundProcessor(
        cancellationRefundRepository,
        new CancellationRefundService({
          repository: cancellationRefundRepository,
          refundProvider: paymentProvider,
          now: () => new Date()
        }),
        { onError: (error) => app.log.error({ err: error }, "refund processor failed") }
      );
      refundProcessor.start();
    }
    if (loyaltyRepository !== undefined) {
      loyaltyProcessor = new LoyaltyProcessor(
        loyaltyRepository,
        new LoyaltyService(loyaltyRepository),
        { onError: (error) => app.log.error({ err: error }, "loyalty processor failed") }
      );
      loyaltyProcessor.start();
    }
    if (wheelQuestRepository !== undefined) {
      questProcessor = new QuestProcessor(wheelQuestRepository, { onError: (error) => app.log.error({ err: error }, "quest processor failed") });
      questProcessor.start();
    }
    return app;
  } catch (error: unknown) {
    await app.close();
    await database?.close();
    throw error;
  }
}

async function main(): Promise<void> {
  loadLocalServerEnvironment();
  await startServer(loadConfig());
}

void main().catch((error: unknown) => {
  console.error(formatApiStartupError(error));
  process.exitCode = 1;
});
