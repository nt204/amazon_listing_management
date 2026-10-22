-- Prevent duplicate active inbound rows for the same store, SKU, and shipment.
-- Shipment ID is the primary identity. Before Amazon assigns one, the lot name
-- is used as a stable fallback. Rows without either value cannot be identified
-- safely and are intentionally excluded from the constraint.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        store_id,
        LOWER(BTRIM(sku)),
        LOWER(COALESCE(
          NULLIF(BTRIM(shipment_id), ''),
          'lot:' || NULLIF(BTRIM(ten_lo_hang), '')
        ))
      ORDER BY
        (sku_id IS NOT NULL) DESC,
        updated_at DESC,
        created_at DESC,
        id DESC
    ) AS duplicate_rank
  FROM accounting_inbound_shipments
  WHERE deleted_at IS NULL
    AND (
      NULLIF(BTRIM(shipment_id), '') IS NOT NULL
      OR NULLIF(BTRIM(ten_lo_hang), '') IS NOT NULL
    )
)
UPDATE accounting_inbound_shipments AS inbound
SET
  deleted_at = NOW(),
  last_changed_by = 'system_deduplicate',
  updated_at = NOW()
FROM ranked
WHERE inbound.id = ranked.id
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_inbound_active_identity
  ON accounting_inbound_shipments (
    store_id,
    LOWER(BTRIM(sku)),
    LOWER(COALESCE(
      NULLIF(BTRIM(shipment_id), ''),
      'lot:' || NULLIF(BTRIM(ten_lo_hang), '')
    ))
  )
  WHERE deleted_at IS NULL
    AND (
      NULLIF(BTRIM(shipment_id), '') IS NOT NULL
      OR NULLIF(BTRIM(ten_lo_hang), '') IS NOT NULL
    );
