# Implement Excel Data Importer

This plan outlines the approach to parse the provided Excel file, extract the new planning data (including colors and reasons), and inject it into the application's database.

## User Review Required

> [!WARNING]
> **Data Merging Strategy**: The script will upsert data. This means existing rows with the same exact composite keys (Style + Graphic + Combo) or IDs will be updated with the new July+ dates, colors, and reasons. If they don't exist, they will be created. Is this acceptable?

> [!IMPORTANT]
> **Date Filtering**: The script will only process date columns that represent a date from July 2026 onwards, as requested.

## Open Questions

Just to confirm, should this be a one-time Node.js script that I run for you now, or did you want me to build a permanent "Upload Excel" UI button in the web app that does this? I assume a one-time script is best for this specific file, but please let me know if you need the UI feature.

## Proposed Changes

### server
#### [NEW] [import_excel_plan.js](file:///d:/Brandix/embellishmentplan/server/import_excel_plan.js)
- Create a standalone Node.js script using `exceljs`.
- **Parsing Logic**:
  - Load `d:\Brandix\embellishmentplan\app\Embellishment development plan (2).xlsm`.
  - Read standard columns up to column 33 and map them to their respective `colX` fields using a flexible header matching logic.
  - Identify date columns (e.g., `7/30/2026`) and `Reason` columns.
  - Filter and only process date columns starting from July.
  - For each date cell, check its text (e.g. `NY`, `NYC`).
  - Read the cell's background color (checking ARGB values for green/red hues).
  - If Green -> Format as `Code|P` (Pass).
  - If Red -> Find the value in the nearest `Reason` column to the right. Extract the code (e.g., `14`). Format as `Code|F|14` (Fail).
  - If neither -> Format as `Code` (Planned).
- **Database Injection**:
  - Import `server/db.js`.
  - Execute `db.upsertMultipleRows(parsedRows)` to bulk-insert the extracted data securely into your Supabase / Local database.

## Verification Plan

### Automated Tests
- We will run the script and monitor its console output for successful parsing of the red/green cells and the extracted reasons.

### Manual Verification
- After the script runs, you will be able to refresh your web application's dashboard.
- You can check the Table view to verify that the rows are present, the dates from July are populated, and the statuses (Green for Pass, Red for Fail with Reason) are accurately reflected.
