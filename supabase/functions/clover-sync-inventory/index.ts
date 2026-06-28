import { authErrorStatus, AuthError, requireSyncAuth, toAuthErrorMessage } from '../_shared/auth.ts';
import { handleOptions } from '../_shared/cors.ts';
import {
  clientErrorFromUnknown,
  getCloverConfig,
  listCloverItemStocks,
} from '../_shared/cloverClient.ts';
import { errorResponse, jsonResponse } from '../_shared/json.ts';
import {
  createServiceClient,
  finishSyncRun,
  startSyncRun,
} from '../_shared/supabaseAdmin.ts';
import { syncInventoryMirror } from '../_shared/syncMapping.ts';

/**
 * clover-sync-inventory — read-only Clover stock → Supabase inventory mirror.
 * Matches products by clover_item_id. Writes inventory_logs with source=clover_sync.
 * GET-only Clover API. No raw Clover payloads returned to clients.
 */
Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) {
    return options;
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const admin = createServiceClient();
  let runId: string | null = null;

  try {
    const auth = await requireSyncAuth(req, admin);
    const clover = getCloverConfig();

    const run = await startSyncRun(admin, {
      runType: 'inventory',
      merchantId: clover.merchantId,
      triggeredBy: auth.triggeredBy,
    });
    runId = run.id;

    const stocks = await listCloverItemStocks(clover);
    const summary = await syncInventoryMirror(admin, stocks, run.id);

    const recordsUpserted = summary.stocksUpserted;
    const recordsFailed = summary.stocksFailed;
    const status =
      recordsFailed > 0 ? (recordsUpserted > 0 ? 'partial' : 'failed') : 'succeeded';

    await finishSyncRun(admin, run.id, {
      status,
      recordsUpserted,
      recordsFailed,
      errorSummary: summary.errors.length > 0 ? summary.errors.slice(0, 5).join('; ') : null,
    });

    return jsonResponse({
      ok: status !== 'failed',
      run_id: run.id,
      run_type: 'inventory',
      status,
      records_upserted: recordsUpserted,
      records_failed: recordsFailed,
      stocks_skipped: summary.stocksSkipped,
      message:
        'Read-only inventory sync completed. Unmatched Clover items are skipped until catalog sync runs.',
    });
  } catch (error) {
    const message = error instanceof AuthError ? toAuthErrorMessage(error) : clientErrorFromUnknown(error).message;
    const status = error instanceof AuthError ? authErrorStatus(error) : clientErrorFromUnknown(error).status;

    if (runId) {
      try {
        await finishSyncRun(admin, runId, {
          status: 'failed',
          recordsUpserted: 0,
          recordsFailed: 1,
          errorSummary: message.slice(0, 500),
        });
      } catch {
        // Best-effort run finalization only.
      }
    }

    return errorResponse(message, status >= 400 ? status : 500);
  }
});
