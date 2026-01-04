import { writable } from "svelte/store";

export interface FileState {
  path: string | null;
  isDirty: boolean;
}

function createFileStore() {
  const { subscribe, set, update } = writable<FileState>({
    path: null,
    isDirty: false,
  });

  return {
    subscribe,
    setPath: (path: string | null) => {
      update((state) => ({ ...state, path }));
    },
    setDirty: (isDirty: boolean) => {
      update((state) => ({ ...state, isDirty }));
    },
    reset: () => {
      set({ path: null, isDirty: false });
    },
  };
}

export const fileStore = createFileStore();

