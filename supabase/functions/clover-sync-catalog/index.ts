import { authErrorStatus, AuthError, requireSyncAuth, toAuthErrorMessage } from '../_shared/auth.ts';
import { handleOptions } from '../_shared/cors.ts';
import {
  clientErrorFromUnknown,
  getCloverConfig,
  listCloverCategories,
  listCloverItems,
} from '../_shared/cloverClient.ts';
import { errorResponse, jsonResponse } from '../_shared/json.ts';
import {
  createServiceClient,
  finishSyncRun,
  startSyncRun,
} from '../_shared/supabaseAdmin.ts';
import { syncCatalogMirror } from '../_shared/syncMapping.ts';

/**
 * clover-sync-catalog — read-only Clover → Supabase mirror for categories, items, barcodes.
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
      runType: 'catalog',
      merchantId: clover.merchantId,
      triggeredBy: auth.triggeredBy,
    });
    runId = run.id;

    const [categories, items] = await Promise.all([
      listCloverCategories(clover),
      listCloverItems(clover),
    ]);

    const summary = await syncCatalogMirror(admin, categories, items);
    const recordsUpserted =
      summary.categoriesUpserted + summary.productsUpserted + summary.barcodesUpserted;
    const recordsFailed =
      summary.categoriesFailed + summary.productsFailed + summary.barcodesFailed;
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
      run_type: 'catalog',
      status,
      records_upserted: recordsUpserted,
      records_failed: recordsFailed,
      categories_upserted: summary.categoriesUpserted,
      products_upserted: summary.productsUpserted,
      barcodes_upserted: summary.barcodesUpserted,
      message: 'Read-only catalog sync completed. Validate field mapping with Clover sandbox.',
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
