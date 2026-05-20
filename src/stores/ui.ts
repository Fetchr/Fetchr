import { create } from "zustand";

interface UIState {
  paletteOpen: boolean;
  addDialogOpen: boolean;
  newsOpen: boolean;
  presetPanelCollapsed: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  openAddDialog: () => void;
  closeAddDialog: () => void;
  openNews: () => void;
  closeNews: () => void;
  toggleNews: () => void;
  togglePresetPanel: () => void;
}

export const useUI = create<UIState>((set) => ({
  paletteOpen: false,
  addDialogOpen: false,
  newsOpen: false,
  presetPanelCollapsed: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  openAddDialog: () => set({ addDialogOpen: true }),
  closeAddDialog: () => set({ addDialogOpen: false }),
  openNews: () => set({ newsOpen: true }),
  closeNews: () => set({ newsOpen: false }),
  toggleNews: () => set((s) => ({ newsOpen: !s.newsOpen })),
  togglePresetPanel: () => set((s) => ({ presetPanelCollapsed: !s.presetPanelCollapsed })),
}));
