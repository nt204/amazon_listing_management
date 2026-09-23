import "server-only";
import crypto from "node:crypto";
import type postgres from "postgres";
import { getDatabaseClient, type DataScope } from "@/lib/db";

export interface PpcIngestionJob {
  id: string; team_id: string; actor_id: string; batch_id: string; batch_date: string; store_names: string[];
  crawler_job_id?: string|null;
  status: "QUEUED"|"RUNNING"|"RETRY_WAIT"|"COMPLETED"|"FAILED"|"CANCELLED";
  stage: string; progress_pct: number; attempt_count: number; max_attempts: number;
  lease_token?: string|null; result?: unknown; error_message?: string|null;
}

export async function enqueueCrawlerPpcIngestion(
  scope: DataScope,
  target: {
    crawlerJobId: string;
    crawlerLeaseToken: string;
    batchId: string;
    batchDate: string;
    storeNames: string[];
    taskStates: postgres.JSONValue[];
    processedFiles: number;
  },
) {
  const sql = await getDatabaseClient();
  return sql.begin(async (tx) => {
    const crawlerRows = await tx<Array<{ id: string; status: string }>>`
      SELECT id,status FROM ppc_sync_jobs
      WHERE id = ${target.crawlerJobId} AND team_id = ${scope.teamId}
        AND batch_id = ${target.batchId}
        AND (
          store_name = 'ALL'
          OR (${target.storeNames.length === 1} AND lower(store_name) = lower(${target.storeNames[0] || ""}))
        )
        AND (
          (status = 'RUNNING' AND lease_token = ${target.crawlerLeaseToken})
          OR status IN ('INGESTING','COMPLETED')
        )
      FOR UPDATE
    `;
    if (!crawlerRows.length) {
      throw new Error("CRAWLER_HANDOFF_MISMATCH: job, lease, batch hoặc store không khớp.");
    }

    const jobs = await tx<PpcIngestionJob[]>`
      INSERT INTO ppc_ingestion_jobs(
        team_id, actor_id, batch_id, batch_date, store_names, crawler_job_id
      ) VALUES(
        ${scope.teamId}, ${scope.actorId}, ${target.batchId}, ${target.batchDate},
        ${tx.json(target.storeNames)}, ${target.crawlerJobId}
      )
      ON CONFLICT(team_id, batch_id) DO UPDATE SET
        actor_id = EXCLUDED.actor_id,
        batch_date = EXCLUDED.batch_date,
        store_names = EXCLUDED.store_names,
        crawler_job_id = COALESCE(ppc_ingestion_jobs.crawler_job_id, EXCLUDED.crawler_job_id),
        status = CASE
          WHEN ppc_ingestion_jobs.status IN ('FAILED', 'CANCELLED') THEN 'RETRY_WAIT'
          ELSE ppc_ingestion_jobs.status
        END,
        stage = CASE
          WHEN ppc_ingestion_jobs.status IN ('FAILED', 'CANCELLED') THEN 'RETRY_WAIT'
          ELSE ppc_ingestion_jobs.stage
        END,
        next_attempt_at = CASE
          WHEN ppc_ingestion_jobs.status IN ('FAILED', 'CANCELLED') THEN NOW()
          ELSE ppc_ingestion_jobs.next_attempt_at
        END,
        error_message = CASE
          WHEN ppc_ingestion_jobs.status IN ('FAILED', 'CANCELLED') THEN NULL
          ELSE ppc_ingestion_jobs.error_message
        END,
        updated_at = NOW()
      RETURNING *
    `;
    const ingestion = jobs[0];
    if (ingestion.crawler_job_id !== target.crawlerJobId) {
      throw new Error("CRAWLER_HANDOFF_MISMATCH: batch đã thuộc crawler job khác.");
    }

    const handedOff = await tx<Array<{ id: string }>>`
      UPDATE ppc_sync_jobs
      SET status = ${ingestion.status === "COMPLETED" ? "COMPLETED" : "INGESTING"},
          stage = ${ingestion.status === "COMPLETED" ? "COMPLETED" : "INGESTING"},
          progress_pct = ${ingestion.status === "COMPLETED" ? 100 : 90},
          current_step = ${ingestion.status === "COMPLETED"
            ? "Batch đã được đồng bộ vào database trước đó."
            : "Đã bàn giao batch cho ingestion worker trên server; Mac tiếp tục store kế tiếp."},
          processed_files = total_files,
          task_states = ${tx.json(target.taskStates)},
          error_message = NULL,
          heartbeat_at = NOW(),
          lease_token = NULL,
          lease_expires_at = NULL,
          completed_at = CASE WHEN ${ingestion.status === "COMPLETED"} THEN NOW() ELSE completed_at END,
          updated_at = NOW()
      WHERE id = ${target.crawlerJobId} AND team_id = ${scope.teamId}
        AND status IN ('RUNNING','INGESTING','COMPLETED')
      RETURNING id
    `;
    if (!handedOff.length) throw new Error("CRAWLER_HANDOFF_MISMATCH: không thể chuyển job sang INGESTING.");
    return ingestion;
  });
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
export async function claimPpcIngestion(workerId:string,leaseSeconds=120){const sql=await getDatabaseClient();const expired=await sql<Array<{crawler_job_id:string|null;team_id:string;batch_id:string}>>`
  UPDATE ppc_ingestion_jobs SET status='FAILED',stage='FAILED',error_message=COALESCE(error_message,'Ingestion worker đã dừng quá số lần retry.'),
  lease_token=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
  WHERE status='RUNNING' AND lease_expires_at<NOW() AND attempt_count>=max_attempts
  RETURNING crawler_job_id,team_id,batch_id`;
  for(const linked of expired){if(linked.crawler_job_id) await sql`UPDATE ppc_sync_jobs SET status='FAILED',stage='FAILED',
    current_step='Ingestion worker mất lease sau giới hạn retry.',error_message='Ingestion worker mất lease sau giới hạn retry.',
    completed_at=NOW(),updated_at=NOW() WHERE id=${linked.crawler_job_id} AND team_id=${linked.team_id}
    AND batch_id=${linked.batch_id} AND status='INGESTING'`;}
  await sql`UPDATE ppc_ingestion_jobs SET status='RETRY_WAIT',stage='RETRY_WAIT',lease_token=NULL,lease_expires_at=NULL,
  next_attempt_at=NOW(),updated_at=NOW() WHERE status='RUNNING' AND lease_expires_at<NOW() AND attempt_count<max_attempts`;
  const token=crypto.randomUUID();const rows=await sql.begin(tx=>tx<PpcIngestionJob[]>`
  UPDATE ppc_ingestion_jobs SET status='RUNNING',stage='INGESTING',progress_pct=GREATEST(progress_pct,10),worker_id=${workerId},lease_token=${token},
  heartbeat_at=NOW(),lease_expires_at=NOW()+${leaseSeconds}*INTERVAL '1 second',attempt_count=attempt_count+1,
  started_at=COALESCE(started_at,NOW()),error_message=NULL,updated_at=NOW()
  WHERE id=(SELECT id FROM ppc_ingestion_jobs WHERE attempt_count<max_attempts
  AND NOT EXISTS (SELECT 1 FROM ppc_ingestion_jobs active WHERE active.status='RUNNING')
  AND ((status IN ('QUEUED','RETRY_WAIT') AND next_attempt_at<=NOW()) OR
  (status='RUNNING' AND lease_expires_at<NOW())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);return rows[0]||null;}
export async function heartbeatPpcIngestion(id:string,token:string,seconds=120){const sql=await getDatabaseClient();await sql`
  UPDATE ppc_ingestion_jobs SET heartbeat_at=NOW(),lease_expires_at=NOW()+${seconds}*INTERVAL '1 second',updated_at=NOW()
  WHERE id=${id} AND status='RUNNING' AND lease_token=${token}::uuid`;}
export async function completePpcIngestion(id:string,token:string,result:unknown){
  const sql=await getDatabaseClient();
  await sql.begin(async(tx)=>{
    const rows=await tx<Array<{crawler_job_id:string|null;team_id:string;batch_id:string}>>`
      UPDATE ppc_ingestion_jobs SET status='COMPLETED',stage='COMPLETED',progress_pct=100,
      result=${tx.json(result as postgres.JSONValue)},error_message=NULL,lease_token=NULL,lease_expires_at=NULL,
      completed_at=NOW(),updated_at=NOW() WHERE id=${id} AND status='RUNNING' AND lease_token=${token}::uuid
      RETURNING crawler_job_id,team_id,batch_id`;
    if(!rows.length) throw new Error("Ingestion lease không hợp lệ khi hoàn tất job.");
    const linked=rows[0];
    if(linked.crawler_job_id){
      const crawlerRows=await tx<Array<{id:string}>>`UPDATE ppc_sync_jobs SET status='COMPLETED',stage='COMPLETED',progress_pct=100,
        current_step='Server đã đồng bộ R2 vào database thành công.',error_message=NULL,
        processed_files=total_files,completed_at=NOW(),updated_at=NOW()
        WHERE id=${linked.crawler_job_id} AND team_id=${linked.team_id} AND batch_id=${linked.batch_id}
          AND status='INGESTING' RETURNING id`;
      if(!crawlerRows.length) throw new Error("Crawler job liên kết không còn ở trạng thái INGESTING.");
    }
  });
}
export async function failPpcIngestion(id:string,token:string,message:string){
  const sql=await getDatabaseClient();
  const safeMessage=message.slice(0,4000);
  await sql.begin(async(tx)=>{
    const rows=await tx<Array<{crawler_job_id:string|null;team_id:string;batch_id:string;status:string}>>`
      UPDATE ppc_ingestion_jobs SET status=CASE WHEN attempt_count>=max_attempts THEN 'FAILED' ELSE 'RETRY_WAIT' END,
      stage=CASE WHEN attempt_count>=max_attempts THEN 'FAILED' ELSE 'RETRY_WAIT' END,
      next_attempt_at=NOW()+LEAST(900,30*POWER(2,GREATEST(0,attempt_count-1)))*INTERVAL '1 second',
      error_message=${safeMessage},lease_token=NULL,lease_expires_at=NULL,updated_at=NOW(),
      completed_at=CASE WHEN attempt_count>=max_attempts THEN NOW() ELSE completed_at END
      WHERE id=${id} AND status='RUNNING' AND lease_token=${token}::uuid
      RETURNING crawler_job_id,team_id,batch_id,status`;
    if(!rows.length) throw new Error("Ingestion lease không hợp lệ khi ghi nhận lỗi.");
    const linked=rows[0];
    if(linked.crawler_job_id){
      const terminal=linked.status==='FAILED';
      const crawlerRows=await tx<Array<{id:string}>>`UPDATE ppc_sync_jobs SET status=${terminal?'FAILED':'INGESTING'},stage=${terminal?'FAILED':'INGESTING'},
        current_step=${terminal?'Server ingest thất bại sau giới hạn retry.':'Server ingest tạm lỗi và đang chờ retry.'},
        error_message=${safeMessage},completed_at=CASE WHEN ${terminal} THEN NOW() ELSE completed_at END,updated_at=NOW()
        WHERE id=${linked.crawler_job_id} AND team_id=${linked.team_id} AND batch_id=${linked.batch_id}
          AND status='INGESTING' RETURNING id`;
      if(!crawlerRows.length) throw new Error("Crawler job liên kết không còn ở trạng thái INGESTING.");
    }
  });
}
