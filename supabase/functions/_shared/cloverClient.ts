import { sanitizeClientError } from './json.ts';

export type CloverEnvironment = 'sandbox' | 'production';

export interface CloverConfig {
  env: CloverEnvironment;
  merchantId: string;
  accessToken: string;
  baseUrl: string;
}

const USER_AGENT = 'DChill-Outpost-Edge/1.0';

/** Read Clover server secrets from Deno.env — never log or return the token. */
export function getCloverConfig(): CloverConfig {
  const envRaw = (Deno.env.get('CLOVER_ENV') ?? 'sandbox').toLowerCase();
  const env: CloverEnvironment = envRaw === 'production' ? 'production' : 'sandbox';
  const merchantId = Deno.env.get('CLOVER_MERCHANT_ID')?.trim();
  const accessToken = Deno.env.get('CLOVER_ACCESS_TOKEN')?.trim();

  if (!merchantId) {
    throw new Error('CLOVER_MERCHANT_ID is not configured for Edge Functions');
  }
  if (!accessToken) {
    throw new Error('CLOVER_ACCESS_TOKEN is not configured for Edge Functions');
  }

  const baseUrl =
    env === 'production' ? 'https://api.clover.com' : 'https://apisandbox.dev.clover.com';

  return { env, merchantId, accessToken, baseUrl };
}

export interface CloverListResponse<T> {
  elements?: T[];
}

/** Narrow optional Clover category shape — validate against sandbox merchant in Phase 2F. */
export interface CloverCategory {
  id?: string;
  name?: string;
  sortOrder?: number;
  modifiedTime?: number;
}

/**
 * Narrow optional Clover item shape.
 * TODO(Phase 2F.5): confirm `code` vs `alternateCodes` with sandbox payloads — see docs/CLOVER_SANDBOX_SYNC_TESTING.md §8.
 */
export interface CloverItem {
  id?: string;
  name?: string;
  sku?: string;
  price?: number;
  code?: string;
  modifiedTime?: number;
  hidden?: boolean;
  categories?: { elements?: Array<{ id?: string }> };
  alternateCodes?: { elements?: Array<{ id?: string; code?: string }> };
  itemStock?: { quantity?: number; stockCount?: number };
}

/**
 * Clover item stock row from GET /item_stocks.
 * Prefer `quantity`; `stockCount` is deprecated in Clover docs.
 */
export interface CloverItemStock {
  item?: { id?: string };
  quantity?: number;
  stockCount?: number;
  modifiedTime?: number;
}

export class CloverApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CloverApiError';
  }
}

function buildUrl(
  config: CloverConfig,
  path: string,
  params?: Record<string, string>,
): string {
  const url = new URL(`${config.baseUrl}/v3/merchants/${config.merchantId}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/** GET-only Clover client — Phase 2F read path; no write endpoints. */
export async function cloverGet<T>(
  config: CloverConfig,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const response = await fetch(buildUrl(config, path, params), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const safe = sanitizeClientError(body.slice(0, 240));
    throw new CloverApiError(
      `Clover API GET ${path} failed (${response.status})${safe ? `: ${safe}` : ''}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

async function cloverGetAllPages<T>(
  config: CloverConfig,
  path: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const limit = 100;
  let offset = 0;
  const all: T[] = [];

  for (;;) {
    const page = await cloverGet<CloverListResponse<T>>(config, path, {
      ...params,
      limit: String(limit),
      offset: String(offset),
    });
    const batch = page.elements ?? [];
    all.push(...batch);
    if (batch.length < limit) {
      break;
    }
    offset += limit;
  }

  return all;
}

export async function listCloverCategories(config: CloverConfig): Promise<CloverCategory[]> {
  return cloverGetAllPages<CloverCategory>(config, '/categories');
}

export async function listCloverItems(config: CloverConfig): Promise<CloverItem[]> {
  // Item catalog only — stock quantities synced separately via listCloverItemStocks.
  // TODO(Phase 2F.5): sandbox may require expand=categories,alternateCodes on GET /items — see docs/CLOVER_SANDBOX_SYNC_TESTING.md §8.
  return cloverGetAllPages<CloverItem>(config, '/items');
}

export async function listCloverItemStocks(config: CloverConfig): Promise<CloverItemStock[]> {
  return cloverGetAllPages<CloverItemStock>(config, '/item_stocks');
}

export function toCloverErrorMessage(error: unknown): string {
  if (error instanceof CloverApiError) {
    return sanitizeClientError(error.message);
  }
  if (error instanceof Error) {
    return sanitizeClientError(error.message);
  }
  return 'Clover API request failed';
}

export function clientErrorFromUnknown(error: unknown): { message: string; status: number } {
  if (error instanceof CloverApiError) {
    return { message: sanitizeClientError(error.message), status: error.status };
  }
  if (error instanceof Error) {
    return { message: sanitizeClientError(error.message), status: 500 };
  }
  return { message: 'Unexpected server error', status: 500 };
}
