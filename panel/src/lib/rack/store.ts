import { create } from "zustand";
import type { ViewId } from "./types";

/** View-switch state only. Every number on screen comes from api.ts, fetched fresh from the Rack API. */
type ShellState = {
  view: ViewId;
  setView: (v: ViewId) => void;
};

export const useRackStore = create<ShellState>()((set) => ({
  view: "jobs",
  setView: (view) => set({ view }),
}));
