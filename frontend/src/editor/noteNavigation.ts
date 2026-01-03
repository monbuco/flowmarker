/**
 * Navigation utilities for bidirectional note navigation
 * Handles scrolling and highlighting between inline references and notes section
 */

import { EditorView } from "prosemirror-view";
import { findNoteReferences } from "./notes";
import { schema } from "./schema";

/**
 * Scroll to a note in the notes section and highlight it briefly
 */
export function scrollToNote(noteId: string, view: EditorView | null): void {
  if (!view) return;
  
  // Find the note element in the DOM
  const noteElement = document.querySelector(`[data-note-id="${noteId}"]`);
  if (!noteElement) {
    console.warn(`Note element not found for noteId: ${noteId}`);
    return;
  }
  
  // Scroll to the note with smooth behavior
  noteElement.scrollIntoView({ behavior: "smooth", block: "center" });
  
  // Highlight the note briefly
  highlightElement(noteElement as HTMLElement);
}

/**
 * Scroll to an inline note reference and highlight it briefly
 */
export function scrollToNoteReference(noteId: string, view: EditorView | null): void {
  if (!view) return;
  
  const { doc } = view.state;
  const refs = findNoteReferences(doc, schema);
  const ref = refs.find(r => r.noteId === noteId);
  
  if (!ref) {
    console.warn(`Note reference not found for noteId: ${noteId}`);
    return;
  }
  
  // Get the DOM node for the reference
  const domNode = view.nodeDOM(ref.pos);
  if (!domNode || !(domNode instanceof HTMLElement)) {
    console.warn(`DOM node not found for note reference at position ${ref.pos}`);
    return;
  }
  
  // Scroll to the reference with smooth behavior
  // Center the paragraph containing the reference
  const paragraph = domNode.closest('p');
  if (paragraph) {
    paragraph.scrollIntoView({ behavior: "smooth", block: "center" });
    // Highlight the paragraph briefly to show context
    highlightElement(paragraph as HTMLElement);
  } else {
    // Fallback: scroll to the reference itself
    domNode.scrollIntoView({ behavior: "smooth", block: "center" });
    highlightElement(domNode);
  }
}

/**
 * Highlight an element briefly with a fade-in/fade-out effect
 */
function highlightElement(element: HTMLElement): void {
  // Add highlight class
  element.classList.add("note-highlight");
  
  // Remove highlight after animation completes
  setTimeout(() => {
    element.classList.remove("note-highlight");
  }, 2000); // 2 seconds total (1s fade in + 1s fade out)
}

/**
 * Update note positions when document changes
 * This ensures positions stay accurate after edits
 */
export function updateNotePositions(view: EditorView | null): void {
  if (!view) return;
  
  const { doc } = view.state;
  const refs = findNoteReferences(doc, schema);
  
  // Update positions in notes store
  import("./notesStore").then(({ notesStore }) => {
    notesStore.update((store) => {
      const newStore = new Map(store);
      
      // Update first reference position for each note
      // Track the first occurrence of each noteId
      const firstRefPositions = new Map<string, number>();
      for (const ref of refs) {
        if (!firstRefPositions.has(ref.noteId)) {
          firstRefPositions.set(ref.noteId, ref.pos);
        }
      }
      
      // Update notes with their first reference positions
      for (const [noteId, pos] of firstRefPositions) {
        const note = newStore.get(noteId);
        if (note) {
          newStore.set(noteId, {
            ...note,
            firstRefPos: pos,
          });
        }
      }
      
      return newStore;
    });
  });
}

