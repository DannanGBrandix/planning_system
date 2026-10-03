-- OPTIONAL — run AFTER server/supabase_named.sql. Read-only convenience view for browsing data in the
-- Supabase Table Editor: it shows the fields that are stored inside the `schedule` JSON column
-- (col34 and above) as normal, readable columns next to the real ones.
-- The app does not use this view; dropping it (DROP VIEW rows_readable) changes nothing.
-- security_invoker makes it obey the same row-level-security policy as the `rows` table.

CREATE OR REPLACE VIEW rows_readable WITH (security_invoker = true) AS
SELECT
    id, status, trigger_name, category, season, style, graphic_combo, graphic, ground, techniques,
    process, plant, plant_flow, fabric_reference, fabric_in_date, application_form,
    alternative_fabric, risk_factor, technique_category, graphic_type, aoq, technique_type, comments,
    dispatch_deadline, dhl_stickoff_tracking, embellishment_apply_parts, awr, soff_requirement,
    ready_date_advance_plan, placement_sample, dev_trial_requirement, tc3010_ltd92_required,
    fabric_ih, approved_status,
    schedule->>'col34' AS strike_off_comment,
    schedule->>'col35' AS strike_off_submission_no,
    schedule->>'col36' AS artwork_date,
    schedule->>'col37' AS submission_status,
    schedule->>'col38' AS final_edit_meeting,
    schedule->>'col39' AS approve_date,
    schedule->>'col40' AS layout_approval,
    schedule->>'col41' AS color_approval,
    schedule->>'col42' AS placement_approval,
    schedule->>'col43' AS category_line,
    schedule->>'col44' AS dispatch_to,
    schedule->>'col45' AS est_1st_soff_ready_date,
    schedule->>'col46' AS est_2nd_soff_ready_date,
    schedule->>'col47' AS plan_status,
    schedule->>'col48' AS buy,
    schedule->>'col49' AS second_submission_fabric,
    schedule->>'col50' AS fabric_dispatch_comment,
    team_owner, shared_id, version_number, is_current, change_reason, changed_date,
    schedule, created_at
FROM rows;

GRANT SELECT ON rows_readable TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
