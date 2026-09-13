import React, { useMemo } from "react";
import { EmbellishmentRow, getRowStatus, cleanCategory } from "../lib/db";
import { ChevronDown, Check, FilterX } from "lucide-react";

export type FilterSelections = {
  category: string[];
  season: string[];
  subCategory: string[];
  plant: string[];
  graphicType: string[];
  trigger: string[];
  technique: string[];
  riskFactor: string[];
  style: string[];
  ground: string[];
  comment: string[];
  graphic: string[];
  combo: string[];
  approvalStatus: string[];
};

interface AdvancedSidebarFiltersProps {
  rows: EmbellishmentRow[];
  selections: FilterSelections;
  setSelections: React.Dispatch<React.SetStateAction<FilterSelections>>;
}

const FilterDropdown = ({ 
  title, 
  filterKey, 
  options,
  selected,
  onSelectAll,
  onToggle,
  activeCount,
}: { 
  title: string, 
  filterKey: keyof FilterSelections, 
  options: string[],
  selected: string[],
  onSelectAll: (key: keyof FilterSelections) => void,
  onToggle: (key: keyof FilterSelections, val: string) => void,
  activeCount?: number,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const isActive = selected.length > 0;

  // Filter options by search query
  const filteredOptions = React.useMemo(() => {
    if (!searchQuery.trim()) return options;
    return options.filter(opt =>
      opt.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [options, searchQuery]);

  // Auto-focus search when dropdown opens
  React.useEffect(() => {
    if (isOpen && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleToggle = () => {
    setIsOpen(prev => {
      if (prev) setSearchQuery("");
      return !prev;
    });
  };

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className="mb-3" ref={dropdownRef}>
      <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${isActive ? 'text-[#00ffd5]' : 'text-zinc-400'}`}>
        {title}
        {isActive && <span className="ml-1 text-[#00ffd5]">({selected.length})</span>}
      </label>
      <div className="relative">
        <div 
          className={`w-full border text-xs px-3 py-2 rounded-md outline-none flex justify-between items-center cursor-pointer transition-colors ${
            isActive 
              ? 'bg-[#0d2233] border-[#00ffd5]/50 text-[#00ffd5]' 
              : 'bg-zinc-900 border-zinc-800 text-zinc-300'
          }`}
          onClick={handleToggle}
        >
          <span>
            {selected.length === 0 
              ? <span className="text-zinc-500">All</span> 
              : `${selected.length} selected`
            }
          </span>
          <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''} ${isActive ? 'text-[#00ffd5]' : 'text-zinc-500'}`} />
        </div>
        
        {/* Dropdown Content */}
        {isOpen && (
          <div className="absolute top-full left-0 w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-xl z-50 flex flex-col">

            {/* Inline search — only shown when there are more than 5 options */}
            {options.length > 5 && (
              <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-zinc-700">
                <svg className="w-3 h-3 text-zinc-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={`Search ${title.toLowerCase()}...`}
                  className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-500 outline-none"
                  onClick={e => e.stopPropagation()}
                />
                {searchQuery && (
                  <span className="text-[10px] text-zinc-500 flex-shrink-0">{filteredOptions.length}/{options.length}</span>
                )}
                {searchQuery && (
                  <button
                    onClick={e => { e.stopPropagation(); setSearchQuery(""); }}
                    className="text-zinc-500 hover:text-zinc-300 flex-shrink-0"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            )}

            {/* Options list */}
            <div className="max-h-48 overflow-y-auto">
              {filteredOptions.length === 0 ? (
                <div className="px-3 py-3 text-xs text-zinc-500 text-center">No matches for &quot;{searchQuery}&quot;</div>
              ) : (
                <>
                  <label
                    className="flex items-center px-3 py-1.5 hover:bg-zinc-700 cursor-pointer border-b border-zinc-700 font-bold"
                    onClick={e => {
                      e.preventDefault();
                      if (searchQuery) {
                        // When searching, toggle only the visible filtered options
                        const allFilteredSelected = filteredOptions.every(o => selected.includes(o));
                        filteredOptions.forEach(o => {
                          if (allFilteredSelected && selected.includes(o)) onToggle(filterKey, o);
                          else if (!allFilteredSelected && !selected.includes(o)) onToggle(filterKey, o);
                        });
                      } else {
                        onSelectAll(filterKey);
                      }
                    }}
                  >
                    <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center mr-2 ${
                      filteredOptions.length > 0 && filteredOptions.every(o => selected.includes(o))
                        ? 'bg-emerald-500 border-emerald-500'
                        : filteredOptions.some(o => selected.includes(o))
                          ? 'bg-emerald-500/40 border-emerald-500/60'
                          : 'border-zinc-600'
                    }`}>
                      {filteredOptions.length > 0 && filteredOptions.every(o => selected.includes(o)) && <Check size={10} className="text-white" />}
                    </div>
                    <span className="text-xs text-zinc-300 truncate">
                      {searchQuery ? `Select all ${filteredOptions.length} matches` : 'Select all'}
                    </span>
                  </label>
                  {filteredOptions.map(opt => (
                    <label key={opt} className="flex items-center px-3 py-1.5 hover:bg-zinc-700 cursor-pointer" onClick={e => { e.preventDefault(); onToggle(filterKey, opt); }}>
                      <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center mr-2 flex-shrink-0 ${selected.includes(opt) ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-600'}`}>
                        {selected.includes(opt) && <Check size={10} className="text-white" />}
                      </div>
                      <span className="text-xs text-zinc-300 break-words whitespace-normal leading-tight" title={opt}>{opt}</span>
                    </label>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


export default function AdvancedSidebarFilters({
  rows,
  selections,
  setSelections,
}: AdvancedSidebarFiltersProps) {
  
  // Extract unique values for each filter category from ALL rows (unfiltered)
  const filterOptions = useMemo(() => {
    const opts = {
      category: new Set<string>(),       // col3
      season: new Set<string>(),         // col4
      subCategory: new Set<string>(),    // sub-category / drop from col4
      plant: new Set<string>(),          // col11
      graphicType: new Set<string>(),    // col19
      trigger: new Set<string>(),        // col2
      technique: new Set<string>(),      // col9
      riskFactor: new Set<string>(),     // col17
      style: new Set<string>(),          // col5
      ground: new Set<string>(),         // col8
      comment: new Set<string>(),        // col22
      graphic: new Set<string>(),        // col7 — graphic code e.g. GVS26-020
      combo: new Set<string>(),          // col6 — combo code e.g. GVS26-020-C01
      approvalStatus: new Set<string>(), // col20 — AOQ/Graphic Approval
    };

    rows.forEach(r => {
      // Evaluate pass conditions first
      let passesCategory = true;
      if (selections.category.length > 0 && r.col3) {
        passesCategory = selections.category.includes(cleanCategory(String(r.col3 || "")));
      } else if (selections.category.length > 0) {
        passesCategory = false; // Row has no category but we are filtering by one
      }

      let passesSeason = true;
      if (selections.season.length > 0 && r.col4) {
        const cleanSeason = String(String(String(String(r.col4 || "")))).replace(/[\r\n]+/g, " ").trim();
        const baseCode = cleanSeason.split(/\s+/)[0];
        passesSeason = selections.season.includes(cleanSeason) || selections.season.includes(baseCode);
      } else if (selections.season.length > 0) {
        passesSeason = false;
      }

      // 1. Primary Filters: Cross-filter each other to cascade
      if (passesSeason && r.col3) {
        // KNIT and LOUNGE merge into "PINK" here — see cleanCategory — so they show
        // as one filter option instead of three separate ones.
        opts.category.add(cleanCategory(String(r.col3 || "")));
      }
      
      if (passesCategory && r.col4) {
        const cleanSeason = String(String(String(String(r.col4 || "")))).replace(/[\r\n]+/g, " ").trim();
        opts.season.add(cleanSeason);
        const baseCode = cleanSeason.split(/\s+/)[0];
        if (baseCode && baseCode.length >= 3) {
          opts.season.add(baseCode);
        }
        // Extract sub-category / drop (e.g., "4.7/4.28 DROP" from "SU27 4.7/4.28 DROP")
        const parts = cleanSeason.split(/\s+/);
        if (parts.length > 1) {
          opts.subCategory.add(parts.slice(1).join(" "));
        }
        opts.subCategory.add(cleanSeason);
      }

      // 2. Secondary Filters: only extracted from rows that match ALL selected primary filters
      if (passesCategory && passesSeason) {
        if (r.col11) opts.plant.add(String(String(String(String(r.col11 || "")))).replace(/[\r\n]+/g, " ").trim());
        if (r.col19) opts.graphicType.add(String(String(String(String(r.col19 || "")))).replace(/[\r\n]+/g, " ").trim());
        if (r.col2) opts.trigger.add(String(String(String(String(r.col2 || "")))).replace(/[\r\n]+/g, " ").trim());
        if (r.col9) opts.technique.add(String(String(String(String(r.col9 || "")))).replace(/[\r\n]+/g, " ").trim());
        if (r.col17) opts.riskFactor.add(String(String(String(String(r.col17 || "")))).replace(/[\r\n]+/g, " ").trim());
        if (r.col5) opts.style.add(String(String(String(String(r.col5 || "")))).trim());
        if (r.col8) opts.ground.add(String(String(String(String(r.col8 || "")))).replace(/[\r\n]+/g, " ").trim());
        if (r.col22) opts.comment.add(String(String(String(String(r.col22 || "")))).replace(/[\r\n]+/g, " ").trim());
        if (r.col34) opts.comment.add(String(String(String(String(r.col34 || "")))).replace(/[\r\n]+/g, " ").trim());
        if (r.col7) opts.graphic.add(String(String(String(String(r.col7 || "")))).trim());
        
        if (r.col6) {
          const parts = String(String(String(String(r.col6 || "")))).trim().split(/\s+/);
          const comboNum = parts[parts.length - 1];
          if (comboNum && !comboNum.match(/^[A-Za-z]{2,5}\d{2}-\d{3,4}$/)) {
            opts.combo.add(comboNum);
          }
        }
        
        const status = getRowStatus(r);
        const statusCapitalized = status.charAt(0).toUpperCase() + status.slice(1);
        opts.approvalStatus.add(statusCapitalized);
      }
    });

    return {
      category: Array.from(opts.category).sort(),
      season: Array.from(opts.season).sort(),
      subCategory: Array.from(opts.subCategory).sort(),
      plant: Array.from(opts.plant).sort(),
      graphicType: Array.from(opts.graphicType).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
      trigger: Array.from(opts.trigger).sort(),
      technique: Array.from(opts.technique).sort(),
      riskFactor: Array.from(opts.riskFactor).sort(),
      style: Array.from(opts.style).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
      ground: Array.from(opts.ground).sort(),
      comment: Array.from(opts.comment).sort(),
      graphic: Array.from(opts.graphic).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
      combo: Array.from(opts.combo).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
      approvalStatus: Array.from(opts.approvalStatus).sort(),
    };
  }, [rows, selections.category, selections.season]);

  const handleToggle = (key: keyof FilterSelections, val: string) => {
    setSelections(prev => {
      const current = prev[key];
      if (current.includes(val)) {
        return { ...prev, [key]: current.filter(v => v !== val) };
      } else {
        return { ...prev, [key]: [...current, val] };
      }
    });
  };

  const handleSelectAll = (key: keyof FilterSelections) => {
    const opts = filterOptions[key];
    setSelections(prev => {
      if (prev[key].length === opts.length) {
        return { ...prev, [key]: [] };
      }
      return { ...prev, [key]: [...opts] };
    });
  };

  const clearAllFilters = () => {
    setSelections({
      category: [],
      season: [],
      subCategory: [],
      plant: [],
      graphicType: [],
      trigger: [],
      technique: [],
      riskFactor: [],
      style: [],
      ground: [],
      comment: [],
      graphic: [],
      combo: [],
      approvalStatus: [],
    });
  };

  // Count active filters
  const activeFilterCount = Object.values(selections).filter(v => v.length > 0).length;

  return (
    <div className="w-64 flex-shrink-0 bg-[#0f172a] border-r border-zinc-800 p-4 pb-24 overflow-y-auto custom-scrollbar flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-white uppercase tracking-widest">Filters</h3>
          {activeFilterCount > 0 && (
            <p className="text-[10px] text-[#00ffd5] mt-0.5">{activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active</p>
          )}
        </div>
        <button 
          onClick={clearAllFilters}
          className={`transition-colors p-1 rounded ${activeFilterCount > 0 ? 'text-[#00ffd5] hover:text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
          title="Clear all filters"
        >
          <FilterX size={16} />
        </button>
      </div>

      {/* Primary Filters */}
      <div className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest mb-2">Primary</div>
      <FilterDropdown title="Category" filterKey="category" options={filterOptions.category} selected={selections.category} onSelectAll={handleSelectAll} onToggle={handleToggle} />
      <FilterDropdown title="Season" filterKey="season" options={filterOptions.season} selected={selections.season} onSelectAll={handleSelectAll} onToggle={handleToggle} />
      <FilterDropdown title="Sub-Category / Drop" filterKey="subCategory" options={filterOptions.subCategory} selected={selections.subCategory} onSelectAll={handleSelectAll} onToggle={handleToggle} />
      <FilterDropdown title="Style" filterKey="style" options={filterOptions.style} selected={selections.style} onSelectAll={handleSelectAll} onToggle={handleToggle} />
      
      {/* Combo Filter */}
      <div className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest mb-2 mt-3">Combo</div>
      <FilterDropdown title="Combo Code" filterKey="combo" options={filterOptions.combo} selected={selections.combo} onSelectAll={handleSelectAll} onToggle={handleToggle} />

      {/* Technical Filters */}
      <div className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest mb-2 mt-3">Technical</div>
      <FilterDropdown title="Trigger" filterKey="trigger" options={filterOptions.trigger} selected={selections.trigger} onSelectAll={handleSelectAll} onToggle={handleToggle} />
      <FilterDropdown title="Technique" filterKey="technique" options={filterOptions.technique} selected={selections.technique} onSelectAll={handleSelectAll} onToggle={handleToggle} />
      <FilterDropdown title="Risk Factor" filterKey="riskFactor" options={filterOptions.riskFactor} selected={selections.riskFactor} onSelectAll={handleSelectAll} onToggle={handleToggle} />

      <button 
        onClick={clearAllFilters}
        className={`mt-4 w-full py-2 border rounded text-xs font-semibold transition-colors ${
          activeFilterCount > 0
            ? 'border-[#00ffd5] text-[#00ffd5] hover:bg-[#00ffd5]/10'
            : 'border-zinc-700 text-zinc-600 cursor-default'
        }`}
        disabled={activeFilterCount === 0}
      >
        Clear all filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
      </button>
    </div>
  );
}
