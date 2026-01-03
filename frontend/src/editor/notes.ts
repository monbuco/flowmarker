/**
 * Notes management system for FlowMarker
 * 
 * Handles:
 * - Automatic numbering of notes
 * - Maintaining notes section at end of document
 * - Syncing note references with note content
 */

import { EditorState, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Schema, Node as ProseMirrorNode, Fragment } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";

/**
 * Generate a unique note ID
 */
export function generateNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

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
 * Find all note content nodes in the document
 */
export function findNoteContents(doc: ProseMirrorNode, schema: Schema): Array<{ node: ProseMirrorNode; pos: number; noteId: string; number: number }> {
  const notes: Array<{ node: ProseMirrorNode; pos: number; noteId: string; number: number }> = [];
  
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.note_content) {
      notes.push({
        node,
        pos,
        noteId: node.attrs.noteId,
        number: node.attrs.number,
      });
    }
  });
  
  return notes;
}

/**
 * Find the notes section at the end of the document
 * Returns the position where notes section starts, or -1 if not found
 */
export function findNotesSection(doc: ProseMirrorNode, schema: Schema): { start: number; end: number } | null {
  // Look for a heading "Notes" or similar
  let notesStart = -1;
  let notesEnd = doc.content.size;
  
  // Check all nodes for a "Notes" heading
  let pos = 1; // Start after doc node opening
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (child.type === schema.nodes.heading) {
      const headingText = child.textContent.trim().toLowerCase();
      if (headingText === "notes" || headingText === "footnotes") {
        notesStart = pos;
        // Find the end of the notes section (all content after this heading until end or next heading)
        let sectionEnd = pos + child.nodeSize;
        for (let j = i + 1; j < doc.childCount; j++) {
          const nextChild = doc.child(j);
          // If we hit another heading, stop
          if (nextChild.type === schema.nodes.heading) {
            break;
          }
          sectionEnd += nextChild.nodeSize;
        }
        notesEnd = sectionEnd;
        return { start: notesStart, end: notesEnd };
      }
    }
    pos += child.nodeSize;
  }
  
  return null;
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
  
  // Update all note content nodes
  const notes = findNoteContents(doc, schema);
  for (const note of notes) {
    const newNumber = noteIdToNumber.get(note.noteId) || 1;
    if (note.node.attrs.number !== newNumber) {
      tr.setNodeMarkup(note.pos, undefined, {
        ...note.node.attrs,
        number: newNumber,
      });
    }
  }
  
  if (dispatch && tr.docChanged) {
    dispatch(tr);
    return true;
  }
  
  return false;
}

/**
 * Ensure notes section exists at the end of the document
 * Returns the position where notes should be inserted
 */
export function ensureNotesSection(doc: ProseMirrorNode, schema: Schema): { sectionStart: number; insertPos: number } {
  const existingSection = findNotesSection(doc, schema);
  
  if (existingSection) {
    // Section exists, return position after the heading
    // Find the heading node
    let pos = existingSection.start;
    const headingNode = doc.nodeAt(pos);
    if (headingNode && headingNode.type === schema.nodes.heading) {
      return {
        sectionStart: existingSection.start,
        insertPos: pos + headingNode.nodeSize,
      };
    }
  }
  
  // Create new notes section
  // Add a heading "Notes" and return position after it
  const notesHeading = schema.nodes.heading.create({ level: 2 }, schema.text("Notes"));
  const notesSectionStart = doc.content.size;
  
  return {
    sectionStart: notesSectionStart,
    insertPos: notesSectionStart + notesHeading.nodeSize,
  };
}

/**
 * Insert or update a note in the notes section
 */
export function insertOrUpdateNote(
  view: EditorView,
  noteId: string,
  content: string,
  number: number
): boolean {
  const { state, dispatch } = view;
  const { schema, doc } = state;
  
  // Parse content into ProseMirror nodes - use paragraph for note content
  const paragraph = schema.nodes.paragraph.create({}, schema.text(content));
  
  // Create note content node
  const noteContent = schema.nodes.note_content.create(
    { noteId, number },
    Fragment.fromArray([paragraph])
  );
  
  // Get fresh state to ensure we have the latest document
  const currentState = view.state;
  const currentDoc = currentState.doc;
  const tr = currentState.tr;
  
  // Check if note with this ID already exists
  const existingNotes = findNoteContents(currentDoc, schema);
  const existingNote = existingNotes.find(n => n.noteId === noteId);
  
  if (existingNote) {
    // Update existing note
    tr.replaceWith(existingNote.pos, existingNote.pos + existingNote.node.nodeSize, noteContent);
  } else {
    // Insert new note at the end of notes section
    const section = findNotesSection(currentDoc, schema);
    if (!section) {
      // Create notes section - add heading and note content at the end
      const notesHeading = schema.nodes.heading.create({ level: 2 }, schema.text("Notes"));
      // Insert heading at the end of document (before closing tag)
      const endPos = currentDoc.content.size;
      tr.insert(endPos, notesHeading);
      // Insert note content right after heading
      tr.insert(endPos + notesHeading.nodeSize, noteContent);
    } else {
      // Find all notes in the section and insert after the last one
      const allNotes = findNoteContents(currentDoc, schema);
      const notesInSection = allNotes.filter(n => n.pos >= section.start && n.pos < section.end);
      
      if (notesInSection.length > 0) {
        // Find the last note in the section
        const lastNote = notesInSection.reduce((latest, current) => 
          current.pos > latest.pos ? current : latest
        );
        // Insert after the last note
        tr.insert(lastNote.pos + lastNote.node.nodeSize, noteContent);
      } else {
        // No notes yet, insert after the heading
        const headingNode = currentDoc.nodeAt(section.start);
        if (headingNode) {
          tr.insert(section.start + headingNode.nodeSize, noteContent);
        } else {
          // Fallback: insert at section end
          tr.insert(section.end, noteContent);
        }
      }
    }
  }
  
  if (dispatch) {
    dispatch(tr);
    // Renumber after dispatch to ensure correct numbering
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
 * Remove a note from the document
 */
export function removeNote(view: EditorView, noteId: string): boolean {
  const { state, dispatch } = view;
  const { schema, doc } = state;
  
  // Find and remove note content
  const notes = findNoteContents(doc, schema);
  const noteToRemove = notes.find(n => n.noteId === noteId);
  
  if (!noteToRemove) {
    return false;
  }
  
  const tr = state.tr;
  tr.delete(noteToRemove.pos, noteToRemove.pos + noteToRemove.node.nodeSize);
  
  // Find and remove all references (in reverse order to maintain positions)
  const refs = findNoteReferences(doc, schema).filter(ref => ref.noteId === noteId);
  refs.sort((a, b) => b.pos - a.pos); // Sort descending by position
  for (const ref of refs) {
    tr.delete(ref.pos, ref.pos + ref.node.nodeSize);
  }
  
  if (dispatch) {
    dispatch(tr);
    // Renumber after dispatch
    setTimeout(() => {
      renumberNotes(view.state, (renumberTr) => {
        view.dispatch(renumberTr);
      });
    }, 0);
    return true;
  }
  
  return false;
}

/**
 * Get note content by ID
 */
export function getNoteContent(doc: ProseMirrorNode, schema: Schema, noteId: string): string | null {
  const notes = findNoteContents(doc, schema);
  const note = notes.find(n => n.noteId === noteId);
  
  if (!note) {
    return null;
  }
  
  return note.node.textContent;
}

