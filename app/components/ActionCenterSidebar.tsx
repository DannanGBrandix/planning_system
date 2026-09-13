import React from 'react';
import { EmbellishmentRow } from '../lib/db';
import { isCkFamilyCategory } from '../lib/ckCategories';

interface ActionCenterSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  rows: EmbellishmentRow[];
  selectedTeamFilter: string;
  onItemClick: (row: EmbellishmentRow) => void;
}

export default function ActionCenterSidebar({
  isOpen,
  onClose,
  rows,
  selectedTeamFilter,
  onItemClick,
}: ActionCenterSidebarProps) {
  // Determine if a row needs action based on critical manual fields
  const isActionable = (row: EmbellishmentRow) => {
    // Only target active rows (not Dropped, not Done)
    if (row.col1 === 'D' || row.col1 === 'Dropped' || row.col1 === 'Done' || row.col1 === 'DONE') return false;

    // A row is actionable if it's missing any of these key manual planning fields
    const missingRiskFactor = !row.col17 || String(String(String(String(row.col17 || "")))).trim() === '';
    const missingGraphicType = !row.col19 || String(String(String(String(row.col19 || "")))).trim() === '';
    const missingApplicationForm = !row.col10 || String(String(String(String(row.col10 || "")))).trim() === '';
    
    // You can adjust these criteria based on what the planners consider "incomplete"
    return missingRiskFactor || missingGraphicType || missingApplicationForm;
  };

  // Filter for the active team
  const belongsToTeam = (row: EmbellishmentRow, team: string) => {
    if (!team || team === 'All Teams') return true;
    const cat = (String(String(String(String(row.col3 || ''))))).toUpperCase();
    if (team === 'Team VS') return cat.includes('VS') || cat.includes('ANGEL');
    if (team === 'Team Pink') return cat.includes('PINK');
    if (team === 'Team CK') return cat.includes('CK') || isCkFamilyCategory(cat);
    return true;
  };

  const actionableRows = rows.filter(
    (row) => isActionable(row) && belongsToTeam(row, selectedTeamFilter)
  );

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop overlay */}
      <div 
        className="fixed inset-0 bg-black/40 z-[60] backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Sidebar Panel */}
      <div className="fixed inset-y-0 right-0 w-[400px] bg-zinc-950 border-l border-zinc-800 z-[70] shadow-2xl flex flex-col animate-slide-in-right">
        <div className="p-5 border-b border-zinc-800 bg-zinc-900 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              New Items Action Center
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              {selectedTeamFilter} • {actionableRows.length} items need data
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-full text-zinc-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {actionableRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-4">
              <svg className="w-16 h-16 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="font-medium">All caught up! No missing data.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {actionableRows.map((row) => (
                <div 
                  key={row.id}
                  onClick={() => onItemClick(row)}
                  className="bg-zinc-900 border border-zinc-800 hover:border-emerald-500/50 p-4 rounded-xl cursor-pointer transition-all hover:shadow-lg group flex items-start gap-4"
                >
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0 border border-emerald-500/20 group-hover:bg-emerald-500 group-hover:text-white transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <h3 className="text-zinc-100 font-bold truncate text-sm" title={String(row.col7 || "")}>
                        {row.col7 || 'Unknown Graphic'}
                      </h3>
                      <span className="text-[10px] bg-zinc-800 px-2 py-0.5 rounded text-zinc-300 font-mono">
                        {row.col5 || 'No Style'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mb-2 font-mono">
                      Combo: <span className="text-zinc-300 font-bold">{row.col6 || 'N/A'}</span>
                    </p>
                    
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(!row.col17 || String(String(String(String(row.col17 || "")))).trim() === '') && (
                        <span className="text-[9px] bg-rose-500/10 text-rose-400 px-1.5 py-0.5 rounded border border-rose-500/20">Risk Factor</span>
                      )}
                      {(!row.col19 || String(String(String(String(row.col19 || "")))).trim() === '') && (
                        <span className="text-[9px] bg-rose-500/10 text-rose-400 px-1.5 py-0.5 rounded border border-rose-500/20">Graphic Type</span>
                      )}
                      {(!row.col10 || String(String(String(String(row.col10 || "")))).trim() === '') && (
                        <span className="text-[9px] bg-rose-500/10 text-rose-400 px-1.5 py-0.5 rounded border border-rose-500/20">App Form</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
