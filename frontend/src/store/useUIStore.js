import { create } from 'zustand';

export const useUIStore = create((set) => ({
  // Filter and search states
  searchTerm: '',
  scoreFilter: 'all',
  statusFilter: 'all',
  dateRange: { startDate: '', endDate: '' },
  
  // Selection states
  selectedLeadId: null,

  // CSV Import States
  isCSVModalOpen: false,
  csvHeaders: [],
  csvRows: [],
  csvPreviewRows: [],
  csvColumnMapping: {},

  // Actions
  setSearchTerm: (term) => set({ searchTerm: term }),
  setScoreFilter: (filter) => set({ scoreFilter: filter }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),
  setDateRange: (range) => set((state) => ({ dateRange: { ...state.dateRange, ...range } })),
  setSelectedLeadId: (id) => set({ selectedLeadId: id }),
  
  setCSVModalOpen: (isOpen) => set({ isCSVModalOpen: isOpen }),
  setCSVData: (headers, rows) => set({ csvHeaders: headers, csvRows: rows, csvPreviewRows: rows.slice(0, 5), csvColumnMapping: {} }),
  setCSVColumnMapping: (dbField, csvIndex) => set((state) => ({
    csvColumnMapping: { ...state.csvColumnMapping, [dbField]: csvIndex }
  })),
  resetCSVData: () => set({ csvHeaders: [], csvRows: [], csvPreviewRows: [], csvColumnMapping: {} })
}));
