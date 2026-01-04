import type { EditorState } from "prosemirror-state";
import { getNotesSorted } from "../../editor/notesStore";

export interface FlowmarkDocument {
  format: "flowmark";
  version: string;
  createdAt: string;
  updatedAt: string;
  content: {
    type: "prosemirror";
    schemaVersion: string;
    doc: any; // ProseMirror JSON
  };
  notes?: Array<{
    noteId: string;
    content: string;
    number: number;
  }>;
}

/**
 * Serialize ProseMirror state to Flowmark document format
 */
export function serializeDocument(
  state: EditorState,
  createdAt?: string,
  updatedAt?: string
): FlowmarkDocument {
  const now = new Date().toISOString();
  
  // Get notes from store
  const notes = getNotesSorted().map((note) => ({
    noteId: note.noteId,
    content: note.content,
    number: note.number,
  }));

  return {
    format: "flowmark",
    version: "0.1",
    createdAt: createdAt || now,
    updatedAt: updatedAt || now,
    content: {
      type: "prosemirror",
      schemaVersion: "1",
      doc: state.doc.toJSON(),
    },
    notes: notes.length > 0 ? notes : undefined,
  };
}

/**
 * Deserialize Flowmark document to ProseMirror state
 */
export function deserializeDocument(
  doc: FlowmarkDocument
): { doc: any; notes?: Array<{ noteId: string; content: string; number: number }> } {
  if (doc.format !== "flowmark") {
    throw new Error("Invalid format: expected 'flowmark'");
  }

  return {
    doc: doc.content.doc,
    notes: doc.notes,
  };
}

