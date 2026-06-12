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
  csvPreviewRows: [],
  csvColumnMapping: {},

  // Actions
  setSearchTerm: (term) => set({ searchTerm: term }),
  setScoreFilter: (filter) => set({ scoreFilter: filter }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),
  setDateRange: (range) => set((state) => ({ dateRange: { ...state.dateRange, ...range } })),
  setSelectedLeadId: (id) => set({ selectedLeadId: id }),
  
  setCSVModalOpen: (isOpen) => set({ isCSVModalOpen: isOpen }),
  setCSVData: (headers, rows) => set({ csvHeaders: headers, csvPreviewRows: rows, csvColumnMapping: {} }),
  setCSVColumnMapping: (dbField, csvIndex) => set((state) => ({
    csvColumnMapping: { ...state.csvColumnMapping, [dbField]: csvIndex }
  })),
  resetCSVData: () => set({ csvHeaders: [], csvPreviewRows: [], csvColumnMapping: {} })
}));
