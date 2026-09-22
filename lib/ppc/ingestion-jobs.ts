import "server-only";
import crypto from "node:crypto";
import type postgres from "postgres";
import { getDatabaseClient, type DataScope } from "@/lib/db";

export interface PpcIngestionJob {
  id: string; team_id: string; actor_id: string; batch_id: string; batch_date: string; store_names: string[];
  status: "QUEUED"|"RUNNING"|"RETRY_WAIT"|"COMPLETED"|"FAILED"|"CANCELLED";
  stage: string; progress_pct: number; attempt_count: number; max_attempts: number;
  lease_token?: string|null; result?: unknown; error_message?: string|null;
}

export async function enqueuePpcIngestion(
  scope: DataScope,
  target: { batchId: string; batchDate: string; storeNames: string[] },
  options?: { force?: boolean }
) {
  const sql = await getDatabaseClient();
  const stores = [...new Set(target.storeNames.map((v) => v.trim()).filter(Boolean))];
  const force = Boolean(options?.force);
  const rows = await sql<PpcIngestionJob[]>`
    INSERT INTO ppc_ingestion_jobs(team_id, actor_id, batch_id, batch_date, store_names)
    VALUES(${scope.teamId}, ${scope.actorId}, ${target.batchId}, ${target.batchDate}, ${sql.json(stores)})
    ON CONFLICT(team_id, batch_id) DO UPDATE SET
      actor_id = EXCLUDED.actor_id,
      batch_date = EXCLUDED.batch_date,
      store_names = EXCLUDED.store_names,
      status = CASE 
        WHEN ${force} THEN 'QUEUED'
        WHEN ppc_ingestion_jobs.status IN ('FAILED', 'CANCELLED') THEN 'RETRY_WAIT' 
        ELSE ppc_ingestion_jobs.status 
      END,
      stage = CASE WHEN ${force} THEN 'QUEUED' ELSE ppc_ingestion_jobs.stage END,
      progress_pct = CASE WHEN ${force} THEN 0 ELSE ppc_ingestion_jobs.progress_pct END,
      attempt_count = CASE WHEN ${force} THEN 0 ELSE ppc_ingestion_jobs.attempt_count END,
      next_attempt_at = CASE 
        WHEN ${force} THEN NOW()
        WHEN ppc_ingestion_jobs.status IN ('FAILED', 'CANCELLED') THEN NOW() 
        ELSE ppc_ingestion_jobs.next_attempt_at 
      END,
      error_message = CASE 
        WHEN ${force} THEN NULL
        WHEN ppc_ingestion_jobs.status IN ('FAILED', 'CANCELLED') THEN NULL 
        ELSE ppc_ingestion_jobs.error_message 
      END,
      lease_token = CASE WHEN ${force} THEN NULL ELSE ppc_ingestion_jobs.lease_token END,
      lease_expires_at = CASE WHEN ${force} THEN NULL ELSE ppc_ingestion_jobs.lease_expires_at END,
      updated_at = NOW()
    RETURNING *`;
  return rows[0];
}
export async function getPpcIngestion(scope:DataScope,id:string){const sql=await getDatabaseClient();const rows=await sql<PpcIngestionJob[]>`
  SELECT id,team_id,actor_id,batch_id,batch_date,store_names,status,stage,progress_pct,attempt_count,max_attempts,result,error_message
  FROM ppc_ingestion_jobs WHERE id=${id} AND team_id=${scope.teamId} LIMIT 1`;return rows[0]||null;}
export async function claimPpcIngestion(workerId:string,leaseSeconds=120){const sql=await getDatabaseClient();await sql`
  UPDATE ppc_ingestion_jobs SET status='FAILED',stage='FAILED',error_message=COALESCE(error_message,'Ingestion worker đã dừng quá số lần retry.'),
  lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW() WHERE status='RUNNING' AND lease_expires_at<NOW() AND attempt_count>=max_attempts`;
  const token=crypto.randomUUID();const rows=await sql.begin(tx=>tx<PpcIngestionJob[]>`
  UPDATE ppc_ingestion_jobs SET status='RUNNING',stage='INGESTING',progress_pct=GREATEST(progress_pct,10),worker_id=${workerId},lease_token=${token},
  heartbeat_at=NOW(),lease_expires_at=NOW()+${leaseSeconds}*INTERVAL '1 second',attempt_count=attempt_count+1,
  started_at=COALESCE(started_at,NOW()),error_message=NULL,updated_at=NOW()
  WHERE id=(SELECT id FROM ppc_ingestion_jobs WHERE attempt_count<max_attempts AND ((status IN ('QUEUED','RETRY_WAIT') AND next_attempt_at<=NOW()) OR
  (status='RUNNING' AND lease_expires_at<NOW())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);return rows[0]||null;}
export async function heartbeatPpcIngestion(id:string,token:string,seconds=120){const sql=await getDatabaseClient();await sql`
  UPDATE ppc_ingestion_jobs SET heartbeat_at=NOW(),lease_expires_at=NOW()+${seconds}*INTERVAL '1 second',updated_at=NOW()
  WHERE id=${id} AND status='RUNNING' AND lease_token=${token}::uuid`;}
export async function completePpcIngestion(id:string,token:string,result:unknown){const sql=await getDatabaseClient();await sql`
  UPDATE ppc_ingestion_jobs SET status='COMPLETED',stage='COMPLETED',progress_pct=100,result=${sql.json(result as postgres.JSONValue)},
  error_message=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW() WHERE id=${id} AND status='RUNNING' AND lease_token=${token}::uuid`;}
export async function failPpcIngestion(id:string,token:string,message:string){const sql=await getDatabaseClient();await sql`
  UPDATE ppc_ingestion_jobs SET status=CASE WHEN attempt_count>=max_attempts THEN 'FAILED' ELSE 'RETRY_WAIT' END,
  stage=CASE WHEN attempt_count>=max_attempts THEN 'FAILED' ELSE 'RETRY_WAIT' END,
  next_attempt_at=NOW()+LEAST(900,30*POWER(2,GREATEST(0,attempt_count-1)))*INTERVAL '1 second',error_message=${message.slice(0,4000)},
  lease_expires_at=NULL,updated_at=NOW(),completed_at=CASE WHEN attempt_count>=max_attempts THEN NOW() ELSE completed_at END
  WHERE id=${id} AND status='RUNNING' AND lease_token=${token}::uuid`;}
