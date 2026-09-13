-- ============================================================================
-- Fix: PINK "U27 GRAPHIC TRACKING CHART" re-import created a full DUPLICATE set
-- of rows whose SEASON column held the product line ("LOUNGE" / "KNIT") instead
-- of the real season "SU27". Because "LOUNGE" != "SU27", the importer could not
-- match the existing rows and inserted new ones. The freshly-imported DHL /
-- Strike-Off AWB tracking numbers landed on those new orphan rows, so the real
-- SU27 rows shown in the app still read "NO DHL".
--
-- This script:
--   1. copies the DHL/AWB value from the duplicate onto the real SU27 row
--      (only where the SU27 row has none - no real value is ever overwritten),
--   2. deletes the 77 duplicate LOUNGE/KNIT rows.
--
-- Verified against a full DB snapshot on 2026-09-01:
--   - all 77 duplicates have exactly one real "SU27" twin (style+combo+graphic+ground),
--   - 0 cases where the duplicate and the twin hold DIFFERENT non-empty col24 values,
--   - 5 twins are blank and get a DHL value copied over.
--
-- Run it in the Supabase SQL editor. It is wrapped in a transaction - check the
-- NOTICE row counts, then COMMIT (or ROLLBACK).
-- ============================================================================

-- ---- pre-flight: expect 77 ------------------------------------------------
-- SELECT count(*) FROM rows WHERE id LIKE 'row_17878543924%' AND upper(btrim(col4)) IN ('LOUNGE','KNIT');

BEGIN;

-- 1) Copy DHL / Strike-Off AWB tracking (col24) from the duplicate onto the
--    real SU27 row, ONLY where the SU27 row currently has nothing.  (5 rows)
UPDATE rows SET col24 = 'Victoria - 8/31 - 3871620502'
  WHERE id = 'row_1787130446030_ldfye' AND coalesce(btrim(col24),'') IN ('','-');  -- from row_1787854392487_a2vnv
UPDATE rows SET col24 = 'Victoria - 8/24 - 6325853225'
  WHERE id = 'row_1787130446032_qee7s' AND coalesce(btrim(col24),'') IN ('','-');  -- from row_1787854392490_2pspu
UPDATE rows SET col24 = 'Victoria - 8/24 - 6325853225'
  WHERE id = 'row_1787130446033_n2n9d' AND coalesce(btrim(col24),'') IN ('','-');  -- from row_1787854392490_c7cu5
UPDATE rows SET col24 = 'Victoria - 8/24 - 6325853225'
  WHERE id = 'row_1787130446032_q9ikj' AND coalesce(btrim(col24),'') IN ('','-');  -- from row_1787854392490_lx0hi
UPDATE rows SET col24 = 'DHL# 1573665671'
  WHERE id = 'row_1787130446033_avtnp' AND coalesce(btrim(col24),'') IN ('','-');  -- from row_1787854392491_tky0w

-- 2) Delete the 77 duplicate LOUNGE / KNIT rows.
--    The extra col4 guard makes this a no-op if the data has since changed.
DELETE FROM rows
WHERE upper(btrim(col4)) IN ('LOUNGE','KNIT')
  AND id IN (
  'row_1787854392485_cbsec','row_1787854392486_339fn','row_1787854392486_x6qqt',
  'row_1787854392487_8ouom','row_1787854392487_a2vnv','row_1787854392487_fut58',
  'row_1787854392487_nim96','row_1787854392487_p5yit','row_1787854392487_ptcv1',
  'row_1787854392487_s9sol','row_1787854392488_4yerw','row_1787854392488_5kgxd',
  'row_1787854392488_bb4xh','row_1787854392488_bmtff','row_1787854392488_ga5ld',
  'row_1787854392488_l6ea5','row_1787854392488_pz0ke','row_1787854392488_sycf2',
  'row_1787854392488_tppb2','row_1787854392488_x7ky9','row_1787854392489_02kgk',
  'row_1787854392489_1anma','row_1787854392489_33evw','row_1787854392489_42tmd',
  'row_1787854392489_5xrdk','row_1787854392489_6h7su','row_1787854392489_7dj7b',
  'row_1787854392489_c11s2','row_1787854392489_dpm77','row_1787854392489_fr7fe',
  'row_1787854392489_golo9','row_1787854392489_ia7ir','row_1787854392489_kk00x',
  'row_1787854392489_ku7dq','row_1787854392489_mo1bh','row_1787854392489_q2l08',
  'row_1787854392489_qphkt','row_1787854392489_rbggs','row_1787854392489_sob6o',
  'row_1787854392489_tozbv','row_1787854392489_vs4em','row_1787854392489_x5thq',
  'row_1787854392490_0dapq','row_1787854392490_2knft','row_1787854392490_2pspu',
  'row_1787854392490_4ipvl','row_1787854392490_4leqr','row_1787854392490_60vh9',
  'row_1787854392490_8d4e1','row_1787854392490_at0lf','row_1787854392490_c7cu5',
  'row_1787854392490_d3fi3','row_1787854392490_d6w4y','row_1787854392490_d9itr',
  'row_1787854392490_db1g7','row_1787854392490_e7k1q','row_1787854392490_g7dey',
  'row_1787854392490_g7qwr','row_1787854392490_iwk4o','row_1787854392490_jlnad',
  'row_1787854392490_k1crd','row_1787854392490_kivqm','row_1787854392490_l4hcl',
  'row_1787854392490_ltqyw','row_1787854392490_lx0hi','row_1787854392490_mg896',
  'row_1787854392490_ru1fv','row_1787854392490_tsa9r','row_1787854392490_w2dns',
  'row_1787854392490_xhn07','row_1787854392490_z99yq','row_1787854392490_zoi2u',
  'row_1787854392490_zs5fc','row_1787854392490_zzdrg','row_1787854392491_3t0bz',
  'row_1787854392491_4dwjh','row_1787854392491_tky0w'
);

-- ---- expected NOTICE output: UPDATE 1 (x5), DELETE 77 -------------------
COMMIT;
-- ROLLBACK;   -- run this instead of COMMIT if the counts look wrong

-- ---- post-flight verification ------------------------------------------
-- SELECT id, col24 FROM rows WHERE id IN
--   ('row_1787130446030_ldfye','row_1787130446032_qee7s','row_1787130446033_n2n9d',
--    'row_1787130446032_q9ikj','row_1787130446033_avtnp');
-- SELECT count(*) FROM rows WHERE upper(btrim(col4)) IN ('LOUNGE','KNIT');  -- expect 0
