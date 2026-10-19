import React, { useState, useEffect, useMemo, useRef } from "react";
import { EmbellishmentRow, isRowSent, colorApprovalByCombo } from "../lib/db";
import { rowFilterPlants } from "../lib/plantUtils";

interface FilterControlsProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedGraphicFilter: string;
  setSelectedGraphicFilter: (filter: string) => void;
  selectedCategoryFilter?: string;
  setSelectedCategoryFilter?: (category: string) => void;
  selectedSeasonFilter?: string;
  setSelectedSeasonFilter?: (season: string) => void;
  selectedTriggerFilter?: string;
  setSelectedTriggerFilter?: (trigger: string) => void;
  selectedPlantFilter?: string;
  setSelectedPlantFilter?: (plant: string) => void;
  selectedGroundFilter?: string;
  setSelectedGroundFilter?: (ground: string) => void;
  dhlFilter?: "all" | "withDhl" | "noDhl";
  setDhlFilter?: (dhlFilter: "all" | "withDhl" | "noDhl") => void;
  colorFilter?: "all" | "colorApproved" | "missingColor";
  setColorFilter?: (colorFilter: "all" | "colorApproved" | "missingColor") => void;
  rows: EmbellishmentRow[];
  onOpenConfig: () => void;
  onResetDatabase: () => void;
  onOpenExcelImporter?: () => void;
  currentRole?: string;
  selectedTeamFilter?: string;
  setSelectedTeamFilter?: (team: string) => void;
  selectedStatusFilter?: "All" | "Active" | "Dropped" | "Hold" | "Approved" | "C+P" | "Pending" | "Resubmit";
  setSelectedStatusFilter?: (status: "All" | "Active" | "Dropped" | "Hold" | "Approved" | "C+P" | "Pending" | "Resubmit") => void;
  selectedPlanStatusFilter?: "All" | "Active" | "Dropped" | "Unplanned";
  setSelectedPlanStatusFilter?: (status: "All" | "Active" | "Dropped" | "Unplanned") => void;
  onBulkPlanApproved?: () => void;
}

export default function FilterControls({
  searchQuery,
  setSearchQuery,
  selectedGraphicFilter,
  setSelectedGraphicFilter,
  selectedCategoryFilter,
  setSelectedCategoryFilter,
  selectedSeasonFilter,
  setSelectedSeasonFilter,
  selectedTriggerFilter,
  setSelectedTriggerFilter,
  selectedPlantFilter,
  setSelectedPlantFilter,
  selectedGroundFilter,
  setSelectedGroundFilter,
  dhlFilter,
  setDhlFilter,
  colorFilter,
  setColorFilter,
  rows,
  onOpenConfig,
  onResetDatabase,
  currentRole,
  selectedTeamFilter,
  setSelectedTeamFilter,
  selectedStatusFilter,
  setSelectedStatusFilter,
  selectedPlanStatusFilter,
  setSelectedPlanStatusFilter,
  onBulkPlanApproved,
}: FilterControlsProps) {
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Close search suggestions on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Unique categories for Category Filter Dropdown
  const uniqueCategories = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.col3 && String(String(String(String(r.col3 || "")))).trim()) set.add(String(String(String(String(r.col3 || "")))).trim());
    });
    return Array.from(set).sort();
  }, [rows]);

  // Unique seasons for Season Filter Dropdown
  const uniqueSeasons = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.col4 && String(String(String(String(r.col4 || "")))).trim()) set.add(String(String(String(String(r.col4 || "")))).trim());
    });
    return Array.from(set).sort();
  }, [rows]);

  // Dependent trigger filter: only shows triggers for selected category and season
  const availableTriggers = useMemo(() => {
    let filtered = rows;
    if (selectedCategoryFilter && selectedCategoryFilter !== "") {
      filtered = filtered.filter(r => String(String(String(String(r.col3 || "")))).trim() === selectedCategoryFilter);
    }
    if (selectedSeasonFilter && selectedSeasonFilter !== "") {
      filtered = filtered.filter(r => String(String(String(String(r.col4 || "")))).trim() === selectedSeasonFilter);
    }
    const set = new Set<string>();
    filtered.forEach(r => {
      const t = String(String(String(String(r.col2 || "")))).trim();
      if (t && t !== "N/A" && t !== "-") {
        set.add(t);
      }
    });
    return Array.from(set).sort();
  }, [rows, selectedCategoryFilter, selectedSeasonFilter]);

  // Plants for the Plant Filter Dropdown, with row counts — canonical names (aliases merged),
  // each plant of a cross-dev "/" split counted on its own.
  const plantCounts = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((r) => {
      rowFilterPlants(r).forEach((p) => counts.set(p, (counts.get(p) || 0) + 1));
    });
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  // Ground colours (col8) for the Ground Filter Dropdown, with row counts. Keyed upper-cased so
  // casing variants collapse onto one entry; the label keeps the first spelling seen.
  const groundCounts = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    rows.forEach((r) => {
      const label = String(r.col8 || "").trim();
      if (!label || label === "-" || label === "N/A") return;
      const key = label.toUpperCase();
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { label, count: 1 });
    });
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const [groundOpen, setGroundOpen] = useState<boolean>(false);
  const [groundSearch, setGroundSearch] = useState<string>("");
  const groundContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!groundOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (groundContainerRef.current && !groundContainerRef.current.contains(event.target as Node)) {
        setGroundOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [groundOpen]);

  const filteredGrounds = useMemo(() => {
    const q = groundSearch.trim().toUpperCase();
    return q ? groundCounts.filter(([key]) => key.includes(q)) : groundCounts;
  }, [groundCounts, groundSearch]);

  const selectedGroundLabel = selectedGroundFilter
    ? groundCounts.find(([key]) => key === selectedGroundFilter)?.[1].label || selectedGroundFilter
    : "All Grounds";

  // Count of rows with DHL tracking and without
  const dhlRowCount = useMemo(() => {
    return rows.filter((r) => (String(String(String(String(r.col24 || ""))))).trim() !== "").length;
  }, [rows]);

  const noDhlRowCount = useMemo(() => {
    return rows.filter((r) => !isRowSent(r)).length;
  }, [rows]);

  // Combo counts for the Color Approval filter (Approved combos only, like the Advanced card).
  const colorCounts = useMemo(() => {
    let colorApproved = 0, missingColor = 0;
    colorApprovalByCombo(rows).forEach((s) => {
      if (s === "colorApproved") colorApproved++;
      else missingColor++;
    });
    return { colorApproved, missingColor };
  }, [rows]);

  const hasActiveFilters = Boolean(
    searchQuery ||
    selectedGraphicFilter ||
    (dhlFilter && dhlFilter !== "all") ||
    (colorFilter && colorFilter !== "all") ||
    (selectedCategoryFilter && selectedCategoryFilter !== "") ||
    (selectedSeasonFilter && selectedSeasonFilter !== "") ||
    (selectedTriggerFilter && selectedTriggerFilter !== "") ||
    (selectedPlantFilter && selectedPlantFilter !== "") ||
    (selectedGroundFilter && selectedGroundFilter !== "") ||
    (selectedTeamFilter && selectedTeamFilter !== "All Teams")
  );

  const clearAllFilters = () => {
    setSearchQuery("");
    setSelectedGraphicFilter("");
    if (setDhlFilter) setDhlFilter("all");
    if (setColorFilter) setColorFilter("all");
    if (setSelectedCategoryFilter) setSelectedCategoryFilter("");
    if (setSelectedSeasonFilter) setSelectedSeasonFilter("");
    if (setSelectedTriggerFilter) setSelectedTriggerFilter("");
    if (setSelectedPlantFilter) setSelectedPlantFilter("");
    if (setSelectedGroundFilter) setSelectedGroundFilter("");
    if (setSelectedTeamFilter) setSelectedTeamFilter("All Teams");
    if (setSelectedStatusFilter) setSelectedStatusFilter("Active");
  };

  // Get autocomplete suggestions based on search query
  const autocompleteSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase().trim();
    
    // Pre-calculate how many unique styles & combos belong to each graphic code
    const graphicStyleCounts = new Map<string, Set<string>>();
    const graphicComboCounts = new Map<string, Set<string>>();
    const comboStyleCounts = new Map<string, Set<string>>();
    
    rows.forEach((r) => {
      const col7Str = r.col7 ? String(r.col7) : "";
      const col5Str = r.col5 ? String(r.col5) : "";
      const col6Str = r.col6 ? String(r.col6) : "";

      if (col7Str) {
        if (col5Str) {
          if (!graphicStyleCounts.has(col7Str)) graphicStyleCounts.set(col7Str, new Set());
          graphicStyleCounts.get(col7Str)!.add(col5Str);
        }
        if (col6Str) {
          if (!graphicComboCounts.has(col7Str)) graphicComboCounts.set(col7Str, new Set());
          graphicComboCounts.get(col7Str)!.add(col6Str);
        }
      }
      
      if (col6Str && col5Str) {
        if (!comboStyleCounts.has(col6Str)) comboStyleCounts.set(col6Str, new Set());
        comboStyleCounts.get(col6Str)!.add(col5Str);
      }
    });
    
    // Find matching graphic codes, style codes, and combos
    const matching: { label: string; value: string }[] = [];
    rows.forEach((r) => {
      const col7Str = r.col7 ? String(r.col7) : "";
      const col5Str = r.col5 ? String(r.col5) : "";
      const col6Str = r.col6 ? String(r.col6) : "";

      // 1. Match Graphic Code (col7)
      if (col7Str && col7Str.toLowerCase().includes(query)) {
        if (!matching.some(m => m.value === col7Str)) {
          const stylesCount = graphicStyleCounts.get(col7Str)?.size || 0;
          const combosCount = graphicComboCounts.get(col7Str)?.size || 0;
          
          const suffixParts = [];
          if (stylesCount > 0) suffixParts.push(`${stylesCount} Style${stylesCount !== 1 ? 's' : ''}`);
          if (combosCount > 0) suffixParts.push(`${combosCount} Combo${combosCount !== 1 ? 's' : ''}`);
          
          const suffix = suffixParts.length > 0 ? ` • Linked to ${suffixParts.join(', ')}` : '';

          matching.push({ 
            label: `${col7Str} (Graphic${suffix})`, 
            value: col7Str 
          });
        }
      }
      // 2. Match Style Code (col5)
      if (col5Str && col5Str.toLowerCase().includes(query)) {
        if (!matching.some(m => m.value === col5Str)) {
          matching.push({ 
            label: `${col5Str} (Style Code)`, 
            value: col5Str 
          });
        }
      }
      // 3. Match Graphic Combo (col6)
      if (col6Str && col6Str.toLowerCase().includes(query)) {
        if (!matching.some(m => m.value === col6Str)) {
          const sCount = comboStyleCounts.get(col6Str)?.size || 0;
          const suffix = sCount > 0 ? ` • Linked to ${sCount} Style${sCount > 1 ? 's' : ''}` : '';
          
          matching.push({ 
            label: `${col6Str} (Combo${suffix})`, 
            value: col6Str 
          });
        }
      }
    });
      
    // Deduplicate and limit to top 15 so children can be seen
    return matching.slice(0, 15);
  }, [rows, searchQuery]);

  // Handle autocomplete click
  const selectSuggestion = (code: string) => {
    setSelectedGraphicFilter(code);
    setSearchQuery(code);
    setShowSuggestions(false);
  };

  return (
    <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 mb-6 relative">
      {/* Autocomplete Graphic Code Search Container */}
      {/* min-w keeps the field usable — without it flex-1 collapses to just the icons once the
          filter dropdowns fill the row (regressed when the Plan Status dropdown was added). */}
      <div className="relative w-full md:flex-1 md:max-w-md md:min-w-[240px]" ref={searchContainerRef}>
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        
        <input
          type="text"
          placeholder="Search Style or Graphic Code..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setSelectedGraphicFilter(""); // clear strict filter as we are typing custom query
            setShowSuggestions(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (autocompleteSuggestions.length > 0) {
                // If there's an exact match in suggestions or just one suggestion, use it
                const exactMatch = autocompleteSuggestions.find(
                  s => s.value.toLowerCase() === searchQuery.toLowerCase().trim()
                );
                if (exactMatch) {
                  selectSuggestion(exactMatch.value);
                } else {
                  selectSuggestion(autocompleteSuggestions[0].value);
                }
              }
              setShowSuggestions(false);
            }
          }}
          onFocus={() => setShowSuggestions(true)}
          className="w-full pl-10 pr-10 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-zinc-850 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 transition-all"
        />

        {/* Clear query button */}
        {searchQuery && (
          <button
            onClick={() => {
              setSearchQuery("");
              setShowSuggestions(false);
            }}
            className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Suggestions Overlay Dropdown */}
        {showSuggestions && autocompleteSuggestions.length > 0 && (
          <div className="absolute w-full mt-1.5 bg-white dark:bg-zinc-900 border border-zinc-250 dark:border-zinc-800 rounded-xl shadow-xl z-30 py-1.5 animate-fade-in text-xs">
            <div className="px-3 py-1 border-b border-zinc-100 dark:border-zinc-800 font-semibold text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Matching Codes
            </div>
            {autocompleteSuggestions.map((suggestion) => (
              <button
                key={suggestion.value}
                onClick={() => selectSuggestion(suggestion.value)}
                className="w-full text-left px-3.5 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-300 font-mono transition-colors border-none cursor-pointer flex items-center justify-between group"
              >
                <span>{suggestion.label}</span>
                <span className="text-[9px] uppercase tracking-wider text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">Select</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Filters & Customization Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status Filter Dropdown */}
        {selectedStatusFilter !== undefined && setSelectedStatusFilter && (
          <div className="relative">
            <select
              suppressHydrationWarning
              value={selectedStatusFilter}
              onChange={(e) => setSelectedStatusFilter(e.target.value as "All" | "Active" | "Dropped" | "Hold" | "Approved" | "C+P" | "Pending" | "Resubmit")}
              className="appearance-none flex items-center gap-1.5 pl-3.5 pr-8 py-2 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-850 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-zinc-700 dark:text-zinc-300 cursor-pointer max-w-[140px] truncate"
              title="Filter by Status"
            >
              <option value="Active" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Active Items</option>
              <option value="Approved" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Approved Items</option>
              <option value="C+P" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">C+P Items</option>
              <option value="Pending" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Submission Pending</option>
              <option value="Resubmit" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Resubmit Items</option>
              <option value="Hold" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Hold (Cross Dev)</option>
              <option value="Dropped" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Dropped Items</option>
              <option value="All" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">All Items</option>
            </select>
            <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-zinc-500 dark:text-zinc-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        )}

        {/* Plan Status Filter Dropdown (col47 — planning lifecycle, separate from S/off Status) */}
        {selectedPlanStatusFilter !== undefined && setSelectedPlanStatusFilter && (
          <div className="relative">
            <select
              suppressHydrationWarning
              value={selectedPlanStatusFilter}
              onChange={(e) =>
                setSelectedPlanStatusFilter(
                  e.target.value as "All" | "Active" | "Dropped" | "Unplanned",
                )
              }
              className="appearance-none flex items-center gap-1.5 pl-3.5 pr-8 py-2 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-850 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-zinc-700 dark:text-zinc-300 cursor-pointer max-w-[150px] truncate"
              title="Filter by Plan Status"
            >
              <option value="All" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Plan: All</option>
              <option value="Active" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Plan: Active</option>
              <option value="Dropped" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Plan: Dropped</option>
              <option value="Unplanned" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Plan: Unplanned</option>
            </select>
            <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-zinc-500 dark:text-zinc-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        )}

        {/* Category Filter Dropdown */}
        {selectedCategoryFilter !== undefined && setSelectedCategoryFilter && (
          <div className="relative">
            <select
              suppressHydrationWarning
              value={selectedCategoryFilter}
              onChange={(e) => setSelectedCategoryFilter(e.target.value)}
              className="appearance-none flex items-center gap-1.5 pl-3.5 pr-8 py-2 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-850 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-zinc-700 dark:text-zinc-300 cursor-pointer max-w-[180px] truncate"
              title="Filter by Category"
            >
              <option value="" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">All Categories ({rows.length})</option>
              {uniqueCategories.map((cat) => (
                <option key={cat} value={cat} className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">
                  {cat}
                </option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-zinc-500 dark:text-zinc-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        )}

        {/* Season Filter Dropdown */}
        {selectedSeasonFilter !== undefined && setSelectedSeasonFilter && (
          <div className="relative">
            <select
              suppressHydrationWarning
              value={selectedSeasonFilter}
              onChange={(e) => setSelectedSeasonFilter(e.target.value)}
              className="appearance-none flex items-center gap-1.5 pl-3.5 pr-8 py-2 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-850 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-zinc-700 dark:text-zinc-300 cursor-pointer max-w-[140px] truncate"
              title="Filter by Season"
            >
              <option value="" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">All Seasons</option>
              {uniqueSeasons.map((season) => (
                <option key={season} value={season} className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">
                  {season}
                </option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-zinc-500 dark:text-zinc-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        )}

        {/* Trigger Filter Dropdown */}
        {selectedTriggerFilter !== undefined && setSelectedTriggerFilter && (
          <div className="relative">
            <select
              suppressHydrationWarning
              value={selectedTriggerFilter}
              onChange={(e) => setSelectedTriggerFilter(e.target.value)}
              className="appearance-none flex items-center gap-1.5 pl-3.5 pr-8 py-2 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-850 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-zinc-700 dark:text-zinc-300 cursor-pointer max-w-[140px] truncate"
              title="Filter by Trigger"
            >
              <option value="" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">All Triggers</option>
              {availableTriggers.map((trigger) => (
                <option key={trigger} value={trigger} className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">
                  {trigger}
                </option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-zinc-500 dark:text-zinc-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        )}

        {/* Plant Filter Dropdown */}
        {selectedPlantFilter !== undefined && setSelectedPlantFilter && (
          <div className="relative">
            <select
              suppressHydrationWarning
              value={selectedPlantFilter}
              onChange={(e) => setSelectedPlantFilter(e.target.value)}
              className="appearance-none flex items-center gap-1.5 pl-3.5 pr-8 py-2 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-850 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-zinc-700 dark:text-zinc-300 cursor-pointer max-w-[160px] truncate"
              title="Filter by Plant"
            >
              <option value="" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">All Plants</option>
              {plantCounts.map(([plant, count]) => (
                <option key={plant} value={plant} className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">
                  {plant} ({count})
                </option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-zinc-500 dark:text-zinc-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        )}

        {/* Ground Colour Filter Dropdown (col8) */}
        {selectedGroundFilter !== undefined && setSelectedGroundFilter && (
          <div className="relative" ref={groundContainerRef}>
            <button
              type="button"
              onClick={() => {
                setGroundOpen((o) => !o);
                setGroundSearch("");
              }}
              className={`flex items-center gap-1.5 pl-3.5 pr-8 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all border cursor-pointer max-w-[200px] ${
                selectedGroundFilter
                  ? "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30"
                  : "bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-850 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300"
              }`}
              title="Filter by Ground colour"
            >
              <span className="truncate">{selectedGroundLabel}</span>
            </button>
            {groundOpen && (
              <div className="absolute left-0 mt-1.5 w-72 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl z-30 text-xs">
                <div className="p-2 border-b border-zinc-100 dark:border-zinc-800">
                  <input
                    autoFocus
                    type="text"
                    value={groundSearch}
                    onChange={(e) => setGroundSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setGroundOpen(false);
                      if (e.key === "Enter" && filteredGrounds.length > 0) {
                        setSelectedGroundFilter(filteredGrounds[0][0]);
                        setGroundOpen(false);
                      }
                    }}
                    placeholder="Search ground colour..."
                    className="w-full px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-zinc-800 dark:text-zinc-100 placeholder-zinc-400"
                  />
                </div>
                <div className="max-h-72 overflow-y-auto py-1">
                  {!groundSearch.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGroundFilter("");
                        setGroundOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                        !selectedGroundFilter ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      All Grounds
                    </button>
                  )}
                  {filteredGrounds.map(([key, { label, count }]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setSelectedGroundFilter(key);
                        setGroundOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                        selectedGroundFilter === key ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      {label} <span className="text-zinc-400">({count})</span>
                    </button>
                  ))}
                  {filteredGrounds.length === 0 && (
                    <div className="px-3 py-2 text-zinc-400">No matching ground colours</div>
                  )}
                </div>
              </div>
            )}
            <div className="absolute top-0 bottom-0 h-[34px] right-0 pr-2.5 flex items-center pointer-events-none text-zinc-500 dark:text-zinc-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        )}

        {/* DHL Tracking Filter Dropdown */}
        {dhlFilter !== undefined && setDhlFilter && (
          <div className="relative">
            <select
              suppressHydrationWarning
              value={dhlFilter}
              onChange={(e) => setDhlFilter(e.target.value as "all" | "withDhl" | "noDhl")}
              className={`appearance-none flex items-center gap-1.5 pl-3.5 pr-8 py-2 rounded-xl text-xs font-semibold transition-all border cursor-pointer ${
                dhlFilter !== "all"
                  ? dhlFilter === "noDhl"
                    ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30 shadow-xs"
                    : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 shadow-xs"
                  : "bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800"
              }`}
              title="Filter by DHL tracking status"
            >
              <option value="all" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">• DHL Tracking ({dhlRowCount})</option>
              <option value="withDhl" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">With DHL ({dhlRowCount})</option>
              <option value="noDhl" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Not Dispatched — No DHL ({noDhlRowCount})</option>
            </select>
            <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-zinc-500 dark:text-zinc-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        )}

        {/* Color Approval Filter Dropdown — Approved combos with / without a colour sign-off */}
        {colorFilter !== undefined && setColorFilter && (
          <div className="relative">
            <select
              suppressHydrationWarning
              value={colorFilter}
              onChange={(e) => setColorFilter(e.target.value as "all" | "colorApproved" | "missingColor")}
              className={`appearance-none flex items-center gap-1.5 pl-3.5 pr-8 py-2 rounded-xl text-xs font-semibold transition-all border cursor-pointer ${
                colorFilter !== "all"
                  ? colorFilter === "missingColor"
                    ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30 shadow-xs"
                    : "bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30 shadow-xs"
                  : "bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800"
              }`}
              title="Approved combos (Style + Graphic + Combo + Ground): with vs. without a colour sign-off in the Strike-Off Comments"
            >
              <option value="all" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">• Color Approval (All)</option>
              <option value="colorApproved" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Color Approved ({colorCounts.colorApproved})</option>
              <option value="missingColor" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Approved — Missing Color ({colorCounts.missingColor})</option>
            </select>
            <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-zinc-500 dark:text-zinc-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        )}

        {currentRole === "Planner" && selectedTeamFilter !== undefined && setSelectedTeamFilter && (
          <div className="relative">
            <select
              suppressHydrationWarning
              value={selectedTeamFilter}
              onChange={(e) => setSelectedTeamFilter(e.target.value)}
              className="appearance-none flex items-center gap-1.5 pl-8 pr-8 py-2 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-850 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-zinc-700 dark:text-zinc-300 cursor-pointer"
            >
              <option value="All Teams" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">All Teams</option>
              <option value="Team VS" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Team VS</option>
              <option value="Team CK" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Team CK</option>
              <option value="Team Pink" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">Team Pink</option>
            </select>
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500 dark:text-zinc-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </div>
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-zinc-500 dark:text-zinc-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        )}




        {selectedStatusFilter === "Approved" && onBulkPlanApproved && (
          <button
            onClick={onBulkPlanApproved}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all border border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 shadow-sm"
            title="Automatically mark pending REAP/FCHP and MAST events as passed for all approved graphics"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Bulk Plan Approved
          </button>
        )}

        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="text-xs font-semibold text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-3.5 py-2 rounded-xl transition-all"
          >
            Clear Filters
          </button>
        )}

      </div>
    </div>
  );
}
