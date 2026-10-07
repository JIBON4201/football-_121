import { config } from '../config';
import type { PaginationMeta } from './respond';

export interface PageParams {
  page: number;
  limit: number;
  from: number;
  to: number;
}

/** Clamp client pagination to server maximums. Never allow unbounded queries. */
export function paginateInput(pageRaw: number, limitRaw: number): PageParams {
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const requested = Number.isInteger(limitRaw) && limitRaw >= 1 ? limitRaw : config.pagination.defaultLimit;
  const limit = Math.min(requested, config.pagination.maxLimit);
  const from = (page - 1) * limit;
  return { page, limit, from, to: from + limit - 1 };
}

export function buildPagination(total: number, params: PageParams): PaginationMeta {
  return {
    page: params.page,
    limit: params.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / params.limit),
  };
}
