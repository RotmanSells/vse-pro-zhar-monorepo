import {
  AdminCustomersResponseSchema,
  type AdminCustomersQuery,
  type AdminCustomersResponse
} from "@vse-pro-zhar/contracts";
import type { AdminCustomerRepository } from "@vse-pro-zhar/database";

function rankFromRepository(value: string | null) {
  if (value === null) return null;
  if (value === "spark" || value === "heat" || value === "flame" || value === "volcano") return value;
  throw new Error("Customer rank is unknown");
}

export async function getAdminCustomers(
  repository: AdminCustomerRepository,
  query: AdminCustomersQuery
): Promise<AdminCustomersResponse> {
  const result = await repository.list(query);
  const response = {
    status: "confirmed" as const,
    customers: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      phoneMasked: row.phone,
      orderCount: row.orderCount,
      spentMinor: row.spentMinor,
      coalBalance: row.coalBalance,
      xp: row.xp,
      rank: rankFromRepository(row.rank),
      lastActivityAt: row.lastActivityAt?.toISOString() ?? null
    })),
    pagination: {
      limit: query.limit,
      offset: query.offset,
      total: result.total,
      hasNext: query.offset + result.rows.length < result.total
    }
  } satisfies AdminCustomersResponse;
  return AdminCustomersResponseSchema.parse(response);
}
