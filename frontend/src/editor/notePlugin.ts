/**
 * Plugin for handling note reference interactions
 * Makes note references clickable for editing
 * Automatically removes note content when all references are deleted
 */

import { Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { editNote } from "./commands";
import { findNoteReferences, removeNote, renumberNotes } from "./notes";
import { removeNoteFromStore, renumberNotesStore, restoreNoteFromBackup } from "./notesStore";
import { scrollToNote } from "./noteNavigation";

export function notePlugin() {
  return new Plugin({
    props: {
      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        try {
          const { state } = view;
          const { schema } = state;
          
          if (!schema || !schema.nodes || !schema.nodes.note_ref) {
            return false;
          }
          
          const { selection } = state;
          const { $from } = selection;
          
          // Handle Backspace and Delete keys to delete note references
          if (event.key === "Backspace" || event.key === "Delete") {
            // Check if cursor is right before or after a note reference
            const nodeBefore = $from.nodeBefore;
            const nodeAfter = $from.nodeAfter;
            
            // Check node before cursor (for Backspace)
            if (event.key === "Backspace" && nodeBefore && nodeBefore.type === schema.nodes.note_ref) {
              const noteId = nodeBefore.attrs.noteId;
              if (noteId) {
                event.preventDefault();
                const pos = $from.pos - nodeBefore.nodeSize;
                const tr = state.tr.delete(pos, pos + nodeBefore.nodeSize);
                view.dispatch(tr);
                return true;
              }
            }
            
            // Check node after cursor (for Delete)
            if (event.key === "Delete" && nodeAfter && nodeAfter.type === schema.nodes.note_ref) {
              const noteId = nodeAfter.attrs.noteId;
              if (noteId) {
                event.preventDefault();
                const pos = $from.pos;
                const tr = state.tr.delete(pos, pos + nodeAfter.nodeSize);
                view.dispatch(tr);
                return true;
              }
            }
            
            // Also check if we're inside a note reference (atom nodes can't have cursor inside)
            // Try to find note reference at current position
            for (let d = $from.depth; d > 0; d--) {
              const node = $from.node(d);
              const pos = $from.before(d);
              if (node && node.type === schema.nodes.note_ref) {
                const noteId = node.attrs.noteId;
                if (noteId) {
                  event.preventDefault();
                  const tr = state.tr.delete(pos, pos + node.nodeSize);
                  view.dispatch(tr);
                  return true;
                }
              }
            }
          }
        } catch (error) {
          console.error("Error in notePlugin handleKeyDown:", error);
        }
        
        return false;
      },
      handleClick(view: EditorView, pos: number, event: MouseEvent) {
        try {
          const { state, schema } = view;
          if (!schema || !schema.nodes) {
            return false;
          }
          
          const { doc } = state;
          
          // Find the node at the click position
          const $pos = doc.resolve(pos);
          const node = $pos.nodeAfter || $pos.nodeBefore;
          
          // Check if we clicked on a note reference
          if (node && schema.nodes.note_ref && node.type === schema.nodes.note_ref) {
            const noteId = node.attrs.noteId;
            if (noteId) {
              // Single click: open edit dialog (primary action)
              // Users can also scroll to notes via toolbar "View Notes"
              (async () => {
                await editNote(view, noteId);
              })();
              return true; // Prevent default behavior
            }
          }
          
          // Also check if we clicked inside a note reference (the superscript element)
          const domNode = event.target as HTMLElement;
          if (domNode && domNode.closest('[data-note-ref]')) {
            const noteRefElement = domNode.closest('[data-note-ref]') as HTMLElement;
            const noteId = noteRefElement.getAttribute('data-note-id');
            if (noteId) {
              // Single click: open edit dialog (primary action)
              // Users can also scroll to notes via toolbar "View Notes"
              (async () => {
                await editNote(view, noteId);
              })();
              return true; // Prevent default behavior
            }
          }
        } catch (error) {
          console.error("Error in notePlugin handleClick:", error);
        }
        
        return false;
      },
    },
    appendTransaction(transactions, oldState, newState) {
      // Check if any note references were deleted or restored
      const oldRefs = findNoteReferences(oldState.doc, oldState.schema);
      const newRefs = findNoteReferences(newState.doc, newState.schema);
      
      // Find note IDs that existed before but don't exist now (deleted)
      const oldNoteIds = new Set(oldRefs.map(ref => ref.noteId));
      const newNoteIds = new Set(newRefs.map(ref => ref.noteId));
      
      const deletedNoteIds: string[] = [];
      for (const noteId of oldNoteIds) {
        if (!newNoteIds.has(noteId)) {
          deletedNoteIds.push(noteId);
        }
      }
      
      // Find note IDs that exist now but didn't exist before (restored via undo)
      const restoredNoteIds: string[] = [];
      for (const noteId of newNoteIds) {
        if (!oldNoteIds.has(noteId)) {
          restoredNoteIds.push(noteId);
        }
      }
      
      // If any note references were deleted, remove them from the store (but keep backup)
      if (deletedNoteIds.length > 0) {
        for (const noteId of deletedNoteIds) {
          removeNoteFromStore(noteId);
        }
      }
      
      // If any note references were restored (via undo), restore their content from backup
      if (restoredNoteIds.length > 0) {
        for (const noteId of restoredNoteIds) {
          restoreNoteFromBackup(noteId);
        }
      }
      
      // Renumber notes based on current document state
      const noteIdsInOrder = newRefs.map(ref => ref.noteId);
      renumberNotesStore(noteIdsInOrder);
      
      // Update note positions - we'll do this via a view update hook
      // since we don't have view access in appendTransaction
      return null;
    },
  });
}

