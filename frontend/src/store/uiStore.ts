import { create } from 'zustand'

/**
 * Shell-level UI state.
 *
 * Deliberately tiny: only state that more than one component needs to agree
 * on lives here. The sidebar's collapsed flag is *not* here — nothing outside
 * `AppShell` reads it, so it stays local.
 */
interface UiState {
  isCommandPaletteOpen: boolean
  /** For the ⌘K / Ctrl+K shortcut. */
  toggleCommandPalette: () => void
  /** For deterministic close — Escape, backdrop click, after navigating. */
  setCommandPaletteOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  isCommandPaletteOpen: false,
  toggleCommandPalette: () =>
    set((state) => ({ isCommandPaletteOpen: !state.isCommandPaletteOpen })),
  setCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),
}))
