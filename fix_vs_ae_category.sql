-- Collapse every "VS Angel Essential(s)" spelling in storage to the single
-- canonical "VS AE" (the app already does this on load/save via cleanCategory();
-- this just normalises the rows already sitting in the DB so they're clean at rest).
-- Snapshot 2026-09-01: 33 rows "VS-ANGEL ESSENTIALS" + 1 row "VS Angel Essential".

UPDATE rows
SET col3 = 'VS AE'
WHERE col3 IS NOT NULL
  AND col3 <> 'VS AE'
  AND upper(regexp_replace(col3, '[^A-Za-z]', '', 'g'))
      IN ('VSANGELESSENTIAL', 'VSANGELESSENTIALS', 'ANGELESSENTIAL', 'ANGELESSENTIALS');

-- verify: expect only 'VS AE' (and 0 of the long forms)
-- SELECT col3, count(*) FROM rows WHERE col3 ILIKE '%angel%' OR col3 = 'VS AE' GROUP BY col3;
