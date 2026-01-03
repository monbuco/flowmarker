/**
 * Plugin for handling note reference interactions
 * Makes note references clickable for editing
 */

import { Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { editNote } from "./commands";

export function notePlugin() {
  return new Plugin({
    props: {
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
              // Open edit dialog
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
              // Open edit dialog
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
  });
}

