-- Proof of delivery is the receiver's name only: drop the receiver signature from every stored workflow version,
-- so running jobs (which keep the version they started on) stop asking for it too.
UPDATE workflow_definition wd
SET definition = jsonb_set(wd.definition, '{stages}', (
  SELECT jsonb_agg(
    CASE WHEN st->>'key' <> 'DELIVERY' THEN st ELSE
      jsonb_set(
        jsonb_set(st, '{fields}', COALESCE((SELECT jsonb_agg(f) FROM jsonb_array_elements(st->'fields') f WHERE f->>'key' <> 'podSignature'), '[]'::jsonb)),
        '{transitions}', (SELECT jsonb_agg(
          CASE WHEN tr ? 'requiredFields'
            THEN jsonb_set(tr, '{requiredFields}', COALESCE((SELECT jsonb_agg(r) FROM jsonb_array_elements(tr->'requiredFields') r WHERE r #>> '{}' <> 'podSignature'), '[]'::jsonb))
            ELSE tr END ORDER BY tn) FROM jsonb_array_elements(st->'transitions') WITH ORDINALITY AS x(tr, tn))
      )
    END ORDER BY sn)
  FROM jsonb_array_elements(wd.definition->'stages') WITH ORDINALITY AS s(st, sn)
));
