INSERT OR IGNORE INTO "workflow_statuses" (
  "status_id",
  "project_id",
  "key",
  "label",
  "category",
  "color_json",
  "order_index",
  "is_fixed",
  "is_default",
  "created_at",
  "updated_at"
)
SELECT
  "project_id" || ':workflow-status:' || taxonomy."key",
  "project_id",
  taxonomy."key",
  taxonomy."label",
  taxonomy."category",
  taxonomy."color_json",
  taxonomy."order_index",
  true,
  CASE
    WHEN taxonomy."is_default" = true AND NOT EXISTS (
      SELECT 1
      FROM "workflow_statuses" AS existing_status
      WHERE existing_status."project_id" = "projects"."project_id"
        AND existing_status."is_default" = true
    ) THEN true
    ELSE false
  END,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "projects"
CROSS JOIN (
  SELECT 'ready' AS "key", 'Ready' AS "label", 'open' AS "category", '{"dark":"#60A5FA","light":"#2563EB"}' AS "color_json", 0 AS "order_index", true AS "is_default"
  UNION ALL SELECT 'running', 'Running', 'open', '{"dark":"#2DD4BF","light":"#0F766E"}', 1, false
  UNION ALL SELECT 'blocked', 'Blocked', 'open', '{"dark":"#F87171","light":"#DC2626"}', 2, false
  UNION ALL SELECT 'review', 'Review', 'open', '{"dark":"#A78BFA","light":"#7C3AED"}', 3, false
  UNION ALL SELECT 'done', 'Done', 'closed', '{"dark":"#4ADE80","light":"#15803D"}', 4, false
  UNION ALL SELECT 'cancelled', 'Cancelled', 'closed', '{"dark":"#94A3B8","light":"#64748B"}', 5, false
) AS taxonomy;

UPDATE "workflow_statuses"
SET
  "is_default" = true,
  "updated_at" = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE "key" = 'ready'
  AND NOT EXISTS (
    SELECT 1
    FROM "workflow_statuses" AS existing_status
    WHERE existing_status."project_id" = "workflow_statuses"."project_id"
      AND existing_status."is_default" = true
  );

INSERT OR IGNORE INTO "workflow_labels" (
  "label_id",
  "project_id",
  "key",
  "name",
  "value_type",
  "order_index",
  "created_at",
  "updated_at"
)
SELECT
  "project_id" || ':workflow-label:' || taxonomy."key",
  "project_id",
  taxonomy."key",
  taxonomy."name",
  'string',
  taxonomy."order_index",
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "projects"
CROSS JOIN (
  SELECT 'source' AS "key", 'Source' AS "name", 0 AS "order_index"
  UNION ALL SELECT 'repo', 'Repository', 1
  UNION ALL SELECT 'kind', 'Kind', 2
) AS taxonomy;
