import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

/** Service-role Supabase client — Edge Functions only; never import in client apps. */
export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in Edge Function env');
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface SyncRunRecord {
  id: string;
}

export async function startSyncRun(
  admin: SupabaseClient,
  input: {
    runType: 'catalog' | 'inventory';
    merchantId: string | null;
    triggeredBy: string;
  },
): Promise<SyncRunRecord> {
  const { data, error } = await admin
    .from('clover_sync_runs')
    .insert({
      run_type: input.runType,
      status: 'running',
      merchant_id: input.merchantId,
      triggered_by: input.triggeredBy,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create clover_sync_runs row: ${error?.message ?? 'unknown'}`);
  }

  return { id: String(data.id) };
}

export async function finishSyncRun(
  admin: SupabaseClient,
  runId: string,
  input: {
    status: 'succeeded' | 'failed' | 'partial';
    recordsUpserted: number;
    recordsFailed: number;
    errorSummary?: string | null;
  },
): Promise<void> {
  const { error } = await admin
    .from('clover_sync_runs')
    .update({
      status: input.status,
      finished_at: new Date().toISOString(),
      records_upserted: input.recordsUpserted,
      records_failed: input.recordsFailed,
      error_summary: input.errorSummary ?? null,
    })
    .eq('id', runId);

  if (error) {
    throw new Error(`Failed to finalize clover_sync_runs row: ${error.message}`);
  }
}
