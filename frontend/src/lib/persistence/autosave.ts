import type { EditorState } from "prosemirror-state";
import { fileStore } from "./fileStore";
import { saveToFile } from "./fileIO";
import { get } from "svelte/store";

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTOSAVE_DELAY = 2000; // 2 seconds

/**
 * Schedule autosave (debounced)
 */
export function scheduleAutosave(state: EditorState): void {
  // Only autosave if file path exists
  const currentState = get(fileStore);
  const currentPath = currentState.path;
  if (!currentPath) {
    return;
  }

  // Clear existing timer
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }

  // Mark as dirty
  fileStore.setDirty(true);

  // Schedule save
  autosaveTimer = setTimeout(async () => {
    try {
      await saveToFile(currentPath, state);
      console.log("Autosave completed");
    } catch (error) {
      console.error("Autosave failed:", error);
      // Don't throw - autosave failures should be silent
    }
  }, AUTOSAVE_DELAY);
}

/**
 * Cancel pending autosave
 */
export function cancelAutosave(): void {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

/**
 * Force immediate autosave (if file exists)
 */
export async function forceAutosave(state: EditorState): Promise<void> {
  const currentState = get(fileStore);
  const currentPath = currentState.path;
  if (!currentPath) {
    return;
  }

  cancelAutosave();
  try {
    await saveToFile(currentPath, state);
  } catch (error) {
    console.error("Force autosave failed:", error);
  }
}

