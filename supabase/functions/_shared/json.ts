import { corsHeaders } from './cors.ts';

export interface JsonBody {
  [key: string]: unknown;
}

/** Safe JSON response — never include tokens or raw upstream payloads. */
export function jsonResponse(body: JsonBody, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(message: string, status: number): Response {
  return jsonResponse({ ok: false, error: sanitizeClientError(message) }, status);
}

/** Strip patterns that might leak secrets from error text shown to clients. */
export function sanitizeClientError(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/authorization[:\s]+\S+/gi, 'authorization [redacted]')
    .replace(/token[:\s=]+\S{8,}/gi, 'token [redacted]')
    .trim();
}

export async function readJsonBody(req: Request): Promise<JsonBody> {
  try {
    const text = await req.text();
    if (!text) {
      return {};
    }
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as JsonBody) : {};
  } catch {
    return {};
  }
}
