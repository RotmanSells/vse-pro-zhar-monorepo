#!/usr/bin/env node
/* global Buffer, URL, console, fetch, setTimeout */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";

const canonicalDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev";
const apiRoot = new URL("../apps/api", import.meta.url).pathname.replace(/\/$/u, "");
const apiPort = Number(process.env["TEST_PAYMENT_API_PORT"] ?? "3301");
const productId = Number(process.env["TEST_PAYMENT_PRODUCT_ID"] ?? "11");
const iikoBaseUrl = process.env["IIKO_BASE_URL"] ?? "http://127.0.0.1:4010";
const iikoProductId = "10000000-0000-4000-8000-000000000001";
const organizationId = "3e41b6b4-9f43-4f65-8e5d-0c1c4c2f9a10";
const terminalGroupId = "4c6d5f37-bda2-4ed1-b48e-1b4fa7028f21";
const orderTypeId = "5c4d5e86-5f6c-46ae-8dd7-8e27b4ab1f31";
const paymentTypeId = "6a0d7c48-8f9e-4a12-9b33-4c5d6e7f8a41";
const simulatorControlToken = process.env["SIMULATOR_CONTROL_TOKEN"] ?? "";
const mockRunId = randomUUID();

if (process.env["DATABASE_URL"] !== undefined && process.env["DATABASE_URL"] !== canonicalDatabaseUrl) {
  throw new Error("test:payment refuses a non-canonical DATABASE_URL");
}
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65_535) {
  throw new Error("TEST_PAYMENT_API_PORT must be a valid port");
}
if (!Number.isInteger(productId) || productId < 1) {
  throw new Error("TEST_PAYMENT_PRODUCT_ID must be a positive integer");
}

const payments = new Map();
const idempotencyKeys = new Map();
let lastPaymentId = null;

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function paymentObject(record) {
  const succeeded = record.status === "succeeded";
  return {
    id: record.id,
    status: record.status,
    paid: succeeded,
    amount: record.amount,
    created_at: record.createdAt,
    metadata: record.metadata,
    confirmation: {
      type: "redirect",
      confirmation_url: `http://127.0.0.1:${record.mockPort}/confirm/${record.id}`
    },
    test: true,
    ...(succeeded ? { captured_at: new Date().toISOString() } : {})
  };
}

const mockServer = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/v3/payments") {
      const body = await readBody(request);
      const idempotencyKey = request.headers["idempotence-key"];
      if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
        json(response, 400, { type: "error", code: "invalid_request" });
        return;
      }
      const existingId = idempotencyKeys.get(idempotencyKey);
      if (existingId !== undefined) {
        const existing = payments.get(existingId);
        if (existing !== undefined) json(response, 200, paymentObject(existing));
        return;
      }
      const amount = body?.amount;
      const metadata = body?.metadata;
      if (
        typeof amount?.value !== "string" ||
        typeof amount?.currency !== "string" ||
        typeof metadata?.order_id !== "string"
      ) {
        json(response, 400, { type: "error", code: "invalid_request" });
        return;
      }
      // Provider payment IDs are globally unique in the canonical database;
      // the in-process mock must not reuse an ID on a later harness run.
      const id = `test-payment-${mockRunId}-${payments.size + 1}`;
      const record = {
        id,
        status: "pending",
        amount: { value: amount.value, currency: amount.currency },
        metadata: { order_id: metadata.order_id },
        createdAt: new Date().toISOString(),
        mockPort: mockServer.address().port
      };
      payments.set(id, record);
      idempotencyKeys.set(idempotencyKey, id);
      lastPaymentId = id;
      json(response, 201, paymentObject(record));
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/v3/payments/")) {
      const id = decodeURIComponent(url.pathname.slice("/v3/payments/".length));
      const record = payments.get(id);
      if (record === undefined) {
        json(response, 404, { type: "error", code: "not_found" });
        return;
      }
      json(response, 200, paymentObject(record));
      return;
    }

    json(response, 404, { type: "error", code: "not_found" });
  } catch {
    json(response, 400, { type: "error", code: "invalid_request" });
  }
});

function waitFor(predicate, label, timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const result = await predicate();
        if (result) {
          resolve(result);
          return;
        }
      } catch {
        // The dependency may still be starting or processing the previous state.
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(() => void tick(), 250);
    };
    void tick();
  });
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function assertStatus(actual, expected, path, body) {
  if (actual !== expected) {
    throw new Error(`${path} returned HTTP ${actual}, expected ${expected}: ${JSON.stringify(body)}`);
  }
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await readJson(response);
  return { response, body };
}

async function startMockServer() {
  await new Promise((resolve, reject) => {
    mockServer.once("error", reject);
    mockServer.listen(0, "127.0.0.1", resolve);
  });
  const address = mockServer.address();
  if (address === null || typeof address === "string") throw new Error("Payment mock did not expose a port");
  return `http://127.0.0.1:${address.port}`;
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000))
  ]);
  if (exited === false && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}

function startApi(paymentMockUrl) {
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: apiRoot,
    env: {
      ...process.env,
      APP_ENV: "development",
      API_HOST: "127.0.0.1",
      API_PORT: String(apiPort),
      DATABASE_URL: canonicalDatabaseUrl,
      CORS_ALLOWED_ORIGINS: "http://localhost:8082,http://127.0.0.1:5173",
      YOOKASSA_SHOP_ID: "999999",
      YOOKASSA_SECRET_KEY: "local-test-secret-key",
      YOOKASSA_API_URL: paymentMockUrl,
      YOOKASSA_RETURN_URL: "http://localhost:8082/payment/return",
      YOOKASSA_TEST_MODE: "true",
      IIKO_BASE_URL: iikoBaseUrl,
      IIKO_API_KEY: "vpzh-test-api-key",
      IIKO_APP_ID: "00000000-0000-4000-8000-000000000001",
      IIKO_CLIENT_SECRET: "vpzh-test-client-secret",
      IIKO_ORGANIZATION_ID: organizationId,
      IIKO_TERMINAL_GROUP_ID: terminalGroupId,
      IIKO_PRODUCT_MAPPING: JSON.stringify({ [productId]: iikoProductId }),
      IIKO_ORDER_TYPE_ID: orderTypeId,
      IIKO_PAYMENT_TYPE_ID: paymentTypeId
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  return { child, output };
}

async function simulatorRequest(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers ?? {}) };
  if (simulatorControlToken !== "") headers["x-simulator-control-token"] = simulatorControlToken;
  return requestJson(iikoBaseUrl, path, { ...options, headers });
}

async function main() {
  const simulatorHealth = await requestJson(iikoBaseUrl, "/__simulator/health");
  assertStatus(simulatorHealth.response.status, 200, "iiko health", simulatorHealth.body);
  // The simulator is an in-memory test dependency. Start from a known
  // provider state so a previous run cannot be mistaken for this order.
  const simulatorReset = await simulatorRequest("/__simulator/control/reset", { method: "POST" });
  assertStatus(simulatorReset.response.status, 200, "iiko reset", simulatorReset.body);

  const paymentMockUrl = await startMockServer();
  const apiProcess = startApi(paymentMockUrl);
  const api = apiProcess.child;
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  let cookie = "";

  try {
    await waitFor(async () => {
      if (api.exitCode !== null) {
        throw new Error(`test API exited with code ${api.exitCode}: ${apiProcess.output.join("").slice(-4_000)}`);
      }
      const health = await requestJson(apiBaseUrl, "/health");
      return health.response.status === 200;
    }, "test API health");

    const apiCall = async (path, options = {}, expectedStatus = 200) => {
      const headers = {
        Origin: "http://localhost:8082",
        "content-type": "application/json",
        ...(cookie === "" ? {} : { cookie }),
        ...(options.headers ?? {})
      };
      const result = await requestJson(apiBaseUrl, path, { ...options, headers });
      const setCookie = result.response.headers.get("set-cookie");
      if (setCookie !== null) cookie = setCookie.split(";", 1)[0];
      assertStatus(result.response.status, expectedStatus, path, result.body);
      return result.body;
    };

    const catalog = await apiCall("/catalog");
    const product = catalog.categories.flatMap((category) => category.products).find((entry) => entry.id === productId);
    if (product === undefined) throw new Error(`Product ${productId} is not visible in Backend catalog; set TEST_PAYMENT_PRODUCT_ID to an existing product`);

    await apiCall("/auth/identify", {
      method: "POST",
      body: JSON.stringify({ phone: "+79999000002", name: "Local payment test" })
    }, 201);
    const options = await apiCall("/checkout/options");
    const location = options.locations[0];
    const slot = location?.slots[0];
    if (location === undefined || slot === undefined) throw new Error("Backend returned no pickup slot");
    const checkoutPayload = {
      items: [{ productId, quantity: 1 }],
      pickup: { locationId: location.id, slotId: slot.id }
    };
    const quote = await apiCall("/checkout/quote", { method: "POST", body: JSON.stringify(checkoutPayload) });
    const order = await apiCall("/orders", {
      method: "POST",
      headers: { "Idempotency-Key": `local-test-payment-${randomUUID()}` },
      body: JSON.stringify(checkoutPayload)
    }, 201);
    const orderId = order.id;

    await apiCall(`/orders/${orderId}/payments`, {
      method: "POST",
      headers: { "Idempotency-Key": `local-test-payment-create-${orderId}` },
      body: "{}"
    }, 201);
    if (lastPaymentId === null) throw new Error("Payment mock did not receive a create request");
    const payment = payments.get(lastPaymentId);
    if (payment === undefined) throw new Error("Payment mock lost the created payment");
    payment.status = "succeeded";
    const succeededPayment = paymentObject(payment);
    const webhook = {
      type: "notification",
      event: "payment.succeeded",
      object: succeededPayment
    };
    await apiCall("/webhooks/yookassa", { method: "POST", body: JSON.stringify(webhook) });
    await apiCall("/webhooks/yookassa", { method: "POST", body: JSON.stringify(webhook) });
    await waitFor(async () => (await apiCall(`/orders/${orderId}`)).status === "payment_confirmed", "server-confirmed payment");

    const simulatorStatus = await waitFor(async () => {
      const status = await simulatorRequest("/__simulator/control/status");
      return status.body.orders.find((entry) => entry.creationStatus === "Success") ?? null;
    }, "iiko order submission");
    const iikoOrderId = simulatorStatus.id;
    const transitions = [
      ["accepted", "kitchen_accepted"],
      ["cooking", "preparing"],
      ["ready", "ready_for_pickup"],
      ["completed", "completed"]
    ];
    for (const [simulatorState, backendState] of transitions) {
      const transition = await simulatorRequest("/__simulator/control/order-status", {
        method: "POST",
        body: JSON.stringify({ orderId: iikoOrderId, status: simulatorState })
      });
      assertStatus(transition.response.status, 200, `iiko ${simulatorState}`, transition.body);
      await waitFor(async () => (await apiCall(`/orders/${orderId}`)).status === backendState, `Backend ${backendState}`);
    }

    const finalOrder = await apiCall(`/orders/${orderId}`);
    if (finalOrder.payment?.status !== "succeeded" || finalOrder.fulfillment === null || finalOrder.status !== "completed") {
      throw new Error(`Final persisted state is not successful: ${JSON.stringify(finalOrder)}`);
    }
    console.log(JSON.stringify({
      mode: "local-test-only",
      paymentProvider: "local-yookassa-compatible-mock",
      iikoProvider: "vse-pro-zhar-iiko-simulator",
      orderId,
      totalMinor: quote.totalMinor,
      paymentId: lastPaymentId,
      iikoOrderId,
      finalStatus: finalOrder.status,
      paymentStatus: finalOrder.payment.status,
      fulfillmentStatus: finalOrder.fulfillment.status
    }, null, 2));
  } catch (error) {
    const output = apiProcess.output.join("").slice(-4_000);
    if (output !== "") console.error(output);
    throw error;
  } finally {
    await stopChild(api);
    mockServer.closeAllConnections?.();
    await new Promise((resolve) => mockServer.close(resolve));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
