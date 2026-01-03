/**
 * Notes storage as metadata (not in document)
 * Notes are stored separately and rendered outside ProseMirror
 */

import { writable, type Writable } from "svelte/store";

export interface Note {
  noteId: string;
  content: string;
  number: number;
  // Track the first reference position for navigation
  // Position is stored as a stable identifier that can be resolved
  firstRefPos?: number;
}

// Store notes as metadata
export const notesStore: Writable<Map<string, Note>> = writable(new Map());

// Backup store for deleted notes (for undo support)
const deletedNotesBackup: Map<string, Note> = new Map();

/**
 * Generate a unique note ID
 */
export function generateNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get all notes sorted by number
 */
export function getNotesSorted(): Note[] {
  let notes: Note[] = [];
  notesStore.subscribe((store) => {
    notes = Array.from(store.values()).sort((a, b) => a.number - b.number);
  })();
  return notes;
}

/**
 * Get a note by ID
 */
export function getNote(noteId: string): Note | null {
  let note: Note | null = null;
  notesStore.subscribe((store) => {
    note = store.get(noteId) || null;
  })();
  return note;
}

/**
 * Set a note
 */
export function setNote(note: Note): void {
  notesStore.update((store) => {
    const newStore = new Map(store);
    newStore.set(note.noteId, note);
    return newStore;
  });
}

/**
 * Remove a note (but keep backup for undo)
 */
export function removeNoteFromStore(noteId: string): void {
  notesStore.update((store) => {
    const note = store.get(noteId);
    if (note) {
      // Backup the note before deleting
      deletedNotesBackup.set(noteId, note);
    }
    const newStore = new Map(store);
    newStore.delete(noteId);
    return newStore;
  });
}

/**
 * Restore a note from backup (for undo)
 */
export function restoreNoteFromBackup(noteId: string): void {
  const backup = deletedNotesBackup.get(noteId);
  if (backup) {
    notesStore.update((store) => {
      const newStore = new Map(store);
      newStore.set(noteId, backup);
      return newStore;
    });
    // Keep in backup in case of redo
  }
}

/**
 * Clear backup for a note (when it's truly deleted, not just undone)
 */
export function clearNoteBackup(noteId: string): void {
  deletedNotesBackup.delete(noteId);
}

/**
 * Clear all notes
 */
export function clearNotes(): void {
  notesStore.set(new Map());
}

/**
 * Renumber all notes based on reference order
 */
export function renumberNotesStore(noteIdsInOrder: string[]): void {
  notesStore.update((store) => {
    const newStore = new Map();
    let number = 1;
    
    for (const noteId of noteIdsInOrder) {
      const note = store.get(noteId);
      if (note) {
        newStore.set(noteId, { ...note, number });
        number++;
      }
    }
    
    return newStore;
  });
}

