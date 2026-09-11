import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import type {
  AdminOrderRepository,
  CatalogRepository,
  CustomerRepository,
  IikoDispatchRepository,
  CancellationRefundRepository,
  LoyaltyRepository,
  CustomerProfileRepository,
  WheelQuestRepository,
  CustomerPushRepository
} from "@vse-pro-zhar/database";
import type { CustomerNotificationRepository } from "@vse-pro-zhar/database";
import type { AdminPromoRepository } from "@vse-pro-zhar/database";
import type { AdminAnalyticsRepository } from "@vse-pro-zhar/database";
import type { AdminCustomerRepository } from "@vse-pro-zhar/database";
import type { AdminSegmentRepository } from "@vse-pro-zhar/database";
import type { AdminCommunicationDraftRepository } from "@vse-pro-zhar/database";
import type { StaffRepository } from "@vse-pro-zhar/database";

import { registerCatalogRoutes } from "./catalog/route.js";
import type { ApiConfig } from "./config/env.js";
import { registerHealthRoute } from "./health/route.js";
import { registerErrorHandlers } from "./http/errors.js";
import { registerMediaRoutes } from "./media/route.js";
import { registerAuthRoutes } from "./auth/route.js";
import { createStaffGuard, registerStaffAuthRoutes } from "./auth/staff-route.js";
import {
  registerCheckoutRoutes,
  type CheckoutRouteOptions
} from "./checkout/route.js";
import type { OperationalAvailabilityProvider } from "./checkout/availability.js";
import type { PickupConfiguration } from "./checkout/pickup.js";
import { registerOrderRoutes } from "./orders/route.js";
import { registerAdminOrderRoutes } from "./orders/admin-route.js";
import { registerCancellationRefundRoutes } from "./cancellation-refund/route.js";
import { registerLoyaltyRoutes } from "./loyalty/route.js";
import { registerProfileRoutes } from "./profile/route.js";
import { registerAdminAnalyticsRoutes } from "./analytics/route.js";
import { registerAdminCustomerRoutes } from "./customers/admin-route.js";
import { registerAdminSegmentRoutes } from "./segments/route.js";
import { registerAdminPromoRoutes } from "./promos/route.js";
import { registerAdminCommunicationRoutes } from "./communications/route.js";
import { registerNotificationRoutes } from "./notifications/route.js";
import { registerAdminPushRoutes } from "./notifications/admin-push-route.js";
import type { ExpoPushProvider } from "./notifications/expo-provider.js";
import { CancellationRefundService } from "./cancellation-refund/service.js";
import { CancellationUnavailableError } from "./cancellation-refund/errors.js";
import type { OrderRouteOptions } from "./orders/route.js";
import { registerPaymentRoutes, type PaymentRouteOptions } from "./payments/route.js";
import type { PaymentProvider, RefundProvider } from "./payments/provider.js";
import { PaymentInvalidError, PaymentUnavailableError } from "./payments/errors.js";
import {
  MAX_MEDIA_UPLOAD_BYTES,
  type MediaStorage
} from "./media/storage.js";

export interface BuildAppOptions {
  readonly logger?: boolean;
  readonly now?: () => Date;
  readonly catalogRepository?: CatalogRepository;
  readonly customerRepository?: CustomerRepository;
  readonly availabilityProvider?: OperationalAvailabilityProvider;
  readonly pickupConfiguration?: PickupConfiguration;
  readonly orderRepository?: OrderRouteOptions["orderRepository"];
  readonly paymentRepository?: PaymentRouteOptions["paymentRepository"];
  readonly paymentProvider?: PaymentProvider;
  readonly fulfillmentRepository?: IikoDispatchRepository;
  readonly mediaStorage?: MediaStorage;
  readonly staffRepository?: StaffRepository;
  readonly adminOrderRepository?: AdminOrderRepository;
  readonly cancellationRefundRepository?: CancellationRefundRepository;
  readonly refundProvider?: RefundProvider;
  readonly loyaltyRepository?: LoyaltyRepository;
  readonly profileRepository?: CustomerProfileRepository;
  readonly wheelQuestRepository?: WheelQuestRepository;
  readonly analyticsRepository?: AdminAnalyticsRepository;
  readonly adminCustomerRepository?: AdminCustomerRepository;
  readonly adminSegmentRepository?: AdminSegmentRepository;
  readonly adminPromoRepository?: AdminPromoRepository;
  readonly adminCommunicationRepository?: AdminCommunicationDraftRepository;
  readonly notificationRepository?: CustomerNotificationRepository;
  readonly pushRepository?: CustomerPushRepository;
  readonly pushProvider?: ExpoPushProvider;
}

function isRefundProvider(value: PaymentProvider | RefundProvider | undefined): value is RefundProvider {
  return value !== undefined &&
    "createRefund" in value &&
    typeof value.createRefund === "function" &&
    "getRefund" in value &&
    typeof value.getRefund === "function";
}

export function buildApp(
  config: ApiConfig,
  options: BuildAppOptions = {}
): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? { level: "info" },
    requestIdHeader: false,
    genReqId: () => randomUUID()
  });
  const refundProvider = options.refundProvider ??
    (isRefundProvider(options.paymentProvider) ? options.paymentProvider : undefined);

  void app.register(cors, {
    origin: config.corsAllowedOrigins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"]
  });
  void app.register(multipart, {
    limits: {
      fields: 0,
      fileSize: MAX_MEDIA_UPLOAD_BYTES,
      files: 1,
      parts: 1
    },
    throwFileSizeLimit: true
  });
  registerErrorHandlers(app);
  registerAuthRoutes(app, config, options.customerRepository, options.now);
  registerNotificationRoutes(app, {
    config,
    ...(options.customerRepository === undefined ? {} : { customerRepository: options.customerRepository }),
    ...(options.notificationRepository === undefined ? {} : { repository: options.notificationRepository }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  registerStaffAuthRoutes(app, config, {
    ...(options.staffRepository === undefined ? {} : { repository: options.staffRepository }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const staffGuard = createStaffGuard(options.staffRepository, config, options.now);
  registerAdminPushRoutes(app, {
    config,
    staffGuard,
    ...(options.pushRepository === undefined ? {} : { repository: options.pushRepository }),
    ...(options.pushProvider === undefined ? {} : { provider: options.pushProvider }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  registerAdminAnalyticsRoutes(app, config, {
    staffGuard,
    ...(options.analyticsRepository === undefined ? {} : { analyticsRepository: options.analyticsRepository }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  registerAdminCustomerRoutes(app, {
    staffGuard,
    config,
    ...(options.adminCustomerRepository === undefined ? {} : { repository: options.adminCustomerRepository })
  });
  registerAdminSegmentRoutes(app, {
    staffGuard,
    config,
    ...(options.adminSegmentRepository === undefined ? {} : { repository: options.adminSegmentRepository }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  registerAdminPromoRoutes(app, {
    staffGuard,
    config,
    ...(options.adminPromoRepository === undefined ? {} : { repository: options.adminPromoRepository }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  registerAdminCommunicationRoutes(app, {
    staffGuard,
    config,
    ...(options.adminSegmentRepository === undefined ? {} : { segmentRepository: options.adminSegmentRepository }),
    ...(options.adminCommunicationRepository === undefined ? {} : { draftRepository: options.adminCommunicationRepository }),
    ...(options.adminPromoRepository === undefined ? {} : { promoRepository: options.adminPromoRepository }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  registerHealthRoute(app, config, options.now ?? (() => new Date()));
  const catalogRepository: CatalogRepository = options.catalogRepository ?? {
      getCatalog: async () => {
        throw new Error("Catalog storage is not configured");
      },
      getProductsForQuote: async () => {
        throw new Error("Catalog storage is not configured");
      },
      createCategory: async () => {
        throw new Error("Catalog storage is not configured");
      },
      updateCategory: async () => {
        throw new Error("Catalog storage is not configured");
      },
      createProduct: async () => {
        throw new Error("Catalog storage is not configured");
      },
      updateProduct: async () => {
        throw new Error("Catalog storage is not configured");
      }
    };
  registerCatalogRoutes(app, catalogRepository, config, staffGuard);
  const checkoutRouteOptions: CheckoutRouteOptions = {
    catalogRepository,
    ...(options.customerRepository === undefined
      ? {}
      : { customerRepository: options.customerRepository }),
    ...(options.availabilityProvider === undefined
      ? {}
      : { availabilityProvider: options.availabilityProvider }),
    ...(options.pickupConfiguration === undefined
      ? {}
      : { pickupConfiguration: options.pickupConfiguration }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.loyaltyRepository === undefined ? {} : { loyaltyRepository: options.loyaltyRepository })
  };
  registerCheckoutRoutes(app, config, checkoutRouteOptions);
  const refundWebhookService =
    options.cancellationRefundRepository === undefined || refundProvider === undefined
      ? null
      : new CancellationRefundService({
          repository: options.cancellationRefundRepository,
          refundProvider,
          now: options.now ?? (() => new Date())
        });
  const orderService = registerOrderRoutes(app, config, {
    catalogRepository,
    ...(options.customerRepository === undefined
      ? {}
      : { customerRepository: options.customerRepository }),
    ...(options.orderRepository === undefined
      ? {}
      : { orderRepository: options.orderRepository }),
    ...(options.paymentRepository === undefined
      ? {}
      : { paymentRepository: options.paymentRepository }),
    ...(options.fulfillmentRepository === undefined
      ? {}
      : { fulfillmentRepository: options.fulfillmentRepository }),
    ...(options.cancellationRefundRepository === undefined
      ? {}
      : { cancellationRefundRepository: options.cancellationRefundRepository }),
    ...(options.availabilityProvider === undefined
      ? {}
      : { availabilityProvider: options.availabilityProvider }),
    ...(options.pickupConfiguration === undefined
      ? {}
      : { pickupConfiguration: options.pickupConfiguration }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.loyaltyRepository === undefined ? {} : { loyaltyRepository: options.loyaltyRepository })
  });
  registerPaymentRoutes(app, config, {
    catalogRepository,
    ...(options.customerRepository === undefined
      ? {}
      : { customerRepository: options.customerRepository }),
    ...(options.orderRepository === undefined
      ? {}
      : { orderRepository: options.orderRepository }),
    ...(options.paymentRepository === undefined
      ? {}
      : { paymentRepository: options.paymentRepository }),
    ...(options.cancellationRefundRepository === undefined
      ? {}
      : { cancellationRefundRepository: options.cancellationRefundRepository }),
    ...(refundWebhookService === null
      ? {}
      : {
          refundWebhookHandler: async (input: unknown) => {
            try {
              return await refundWebhookService.handleRefundWebhook(input);
            } catch (error: unknown) {
              if (error instanceof CancellationUnavailableError) throw new PaymentUnavailableError();
              throw new PaymentInvalidError();
            }
          }
        }),
    ...(options.paymentProvider === undefined
      ? {}
      : { paymentProvider: options.paymentProvider }),
    ...(options.availabilityProvider === undefined
      ? {}
      : { availabilityProvider: options.availabilityProvider }),
    ...(options.pickupConfiguration === undefined
      ? {}
      : { pickupConfiguration: options.pickupConfiguration }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  registerMediaRoutes(
    app,
    options.mediaStorage ?? {
      readImage: async () => {
        throw new Error("Media storage is not configured");
      },
      saveImage: async () => {
        throw new Error("Media storage is not configured");
      }
    },
    config,
    staffGuard
  );
  const adminOrderService = registerAdminOrderRoutes(app, config, {
    staffGuard,
    ...(options.adminOrderRepository === undefined
      ? {}
      : { orderRepository: options.adminOrderRepository }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  registerCancellationRefundRoutes(app, config, {
    ...(options.cancellationRefundRepository === undefined
      ? {}
      : { repository: options.cancellationRefundRepository }),
    ...(options.customerRepository === undefined
      ? {}
      : { customerRepository: options.customerRepository }),
    ...(options.staffRepository === undefined ? {} : { staffRepository: options.staffRepository }),
    ...(refundProvider === undefined ? {} : { refundProvider }),
    orderService,
    adminOrderService,
    staffGuard,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const loyaltyService = registerLoyaltyRoutes(app, config, {
    ...(options.loyaltyRepository === undefined ? {} : { repository: options.loyaltyRepository }),
    ...(options.customerRepository === undefined ? {} : { customerRepository: options.customerRepository }),
    staffGuard,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.wheelQuestRepository === undefined ? {} : { wheelQuestRepository: options.wheelQuestRepository })
  });
  registerProfileRoutes(app, config, {
    ...(options.profileRepository === undefined ? {} : { repository: options.profileRepository }),
    ...(options.customerRepository === undefined ? {} : { customerRepository: options.customerRepository }),
    loyaltyService,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.notificationRepository === undefined ? {} : { notificationRepository: options.notificationRepository })
  });

  return app;
}
