/**
 * Notes management system for FlowMarker
 * 
 * Notes are stored as metadata (not in document) and rendered separately
 */

import { EditorState, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Schema, Node as ProseMirrorNode } from "prosemirror-model";
import { generateNoteId, setNote, removeNoteFromStore, getNote } from "./notesStore";

/**
 * Find all note references in the document
 */
export function findNoteReferences(doc: ProseMirrorNode, schema: Schema): Array<{ node: ProseMirrorNode; pos: number; noteId: string; number: number }> {
  const refs: Array<{ node: ProseMirrorNode; pos: number; noteId: string; number: number }> = [];
  
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.note_ref) {
      refs.push({
        node,
        pos,
        noteId: node.attrs.noteId,
        number: node.attrs.number,
      });
    }
  });
  
  return refs;
}

/**
 * Re-number all notes in the document based on their order of appearance
 */
export function renumberNotes(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { schema, doc } = state;
  const tr = state.tr;
  
  // Find all note references in document order
  const refs = findNoteReferences(doc, schema);
  
  // Create a map of noteId -> new number
  const noteIdToNumber = new Map<string, number>();
  let currentNumber = 1;
  
  for (const ref of refs) {
    if (!noteIdToNumber.has(ref.noteId)) {
      noteIdToNumber.set(ref.noteId, currentNumber++);
    }
  }
  
  // Update all note references
  for (const ref of refs) {
    const newNumber = noteIdToNumber.get(ref.noteId) || 1;
    if (ref.node.attrs.number !== newNumber) {
      tr.setNodeMarkup(ref.pos, undefined, {
        ...ref.node.attrs,
        number: newNumber,
      });
    }
  }
  
  // Update notes in store - get unique note IDs in document order
  const noteIdsInOrder: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!seen.has(ref.noteId)) {
      seen.add(ref.noteId);
      noteIdsInOrder.push(ref.noteId);
    }
  }
  
  // Update numbers in store (import dynamically to avoid circular dependency)
  import("./notesStore").then(({ renumberNotesStore }) => {
    renumberNotesStore(noteIdsInOrder);
  });
  
  if (dispatch && tr.docChanged) {
    dispatch(tr);
    return true;
  }
  
  return false;
}

/**
 * Insert or update a note in the notes store
 */
export function insertOrUpdateNote(
  view: EditorView,
  noteId: string,
  content: string,
  number: number
): boolean {
  // Find the first reference position for this note
  const { state } = view;
  const refs = findNoteReferences(state.doc, state.schema);
  const firstRef = refs.find(ref => ref.noteId === noteId);
  const firstRefPos = firstRef ? firstRef.pos : undefined;
  
  // Store note in metadata store with position
  setNote({
    noteId,
    content,
    number,
    firstRefPos,
  });
  
  // Renumber notes based on document order
  const noteIdsInOrder: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!seen.has(ref.noteId)) {
      seen.add(ref.noteId);
      noteIdsInOrder.push(ref.noteId);
    }
  }
  
  // Update numbers in store
  import("./notesStore").then(({ renumberNotesStore }) => {
    renumberNotesStore(noteIdsInOrder);
  });
  
  return true;
}

/**
 * Remove a note from the store
 */
export function removeNote(view: EditorView, noteId: string): boolean {
  const { state, dispatch } = view;
  const { schema, doc } = state;
  
  const tr = state.tr;
  let hasChanges = false;
  
  // Find and remove all references (in reverse order to maintain positions)
  const refs = findNoteReferences(doc, schema).filter(ref => ref.noteId === noteId);
  refs.sort((a, b) => b.pos - a.pos); // Sort descending by position
  for (const ref of refs) {
    tr.delete(ref.pos, ref.pos + ref.node.nodeSize);
    hasChanges = true;
  }
  
  // Remove from store
  removeNoteFromStore(noteId);
  
  if (dispatch && hasChanges) {
    dispatch(tr);
    // Renumber after dispatch
    setTimeout(() => {
      renumberNotes(view.state, (renumberTr) => {
        if (renumberTr.docChanged) {
          view.dispatch(renumberTr);
        }
      });
    }, 50);
    return true;
  }
  
  return false;
}

/**
 * Get note content by ID
 */
export function getNoteContent(doc: ProseMirrorNode, schema: Schema, noteId: string): string | null {
  const note = getNote(noteId);
  return note ? note.content : null;
}

// Re-export generateNoteId for convenience
export { generateNoteId };
