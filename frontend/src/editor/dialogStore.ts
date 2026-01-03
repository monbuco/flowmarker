import { writable } from "svelte/store";

export interface DialogConfig {
  title: string;
  placeholder: string;
  defaultValue: string;
  label?: string;
  type?: "text" | "number" | "textarea";
  min?: number;
  max?: number;
  multiline?: boolean; // For textarea support
}

export interface DialogState {
  visible: boolean;
  config: DialogConfig | null;
  resolve: ((value: string | null) => void) | null;
}

function createDialogStore() {
  const { subscribe, set, update } = writable<DialogState>({
    visible: false,
    config: null,
    resolve: null,
  });

  return {
    subscribe,
    show: (config: DialogConfig): Promise<string | null> => {
      return new Promise((resolve) => {
        set({
          visible: true,
          config,
          resolve: (value: string | null) => {
            set({ visible: false, config: null, resolve: null });
            resolve(value);
          },
        });
      });
    },
    hide: (value: string | null = null) => {
      update((state) => {
        if (state.resolve) {
          state.resolve(value);
        }
        return { visible: false, config: null, resolve: null };
      });
    },
  };
}

export const dialogStore = createDialogStore();

