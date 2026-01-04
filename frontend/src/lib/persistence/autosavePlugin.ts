import { Plugin } from "prosemirror-state";
import { scheduleAutosave } from "./autosave";

/**
 * ProseMirror plugin that triggers autosave on document changes
 */
export function autosavePlugin() {
  return new Plugin({
    appendTransaction(transactions, oldState, newState) {
      // Only trigger autosave if the document actually changed
      if (transactions.some((tr) => tr.docChanged)) {
        scheduleAutosave(newState);
      }
      return null;
    },
  });
}

