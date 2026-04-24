import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ProjectStore = {
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;
};

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set) => ({
      currentProjectId: null,
      setCurrentProjectId: (id) => set({ currentProjectId: id }),
    }),
    { name: 'invenio.projectcontrols.project' },
  ),
);
