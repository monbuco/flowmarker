/**
 * Command system for FlowMarker editor
 * 
 * Commands are triggered by typing @command in the editor.
 * This provides a unified way to insert complex structures while
 * maintaining Markdown-first philosophy.
 * 
 * Architecture:
 * - Commands are detected via input rules
 * - Each command opens a dialog for configuration
 * - Commands are extensible for future additions (@image, @link, etc.)
 */

import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { InputRule } from "prosemirror-inputrules";
import { Schema, Fragment } from "prosemirror-model";
import { dialogStore } from "./dialogStore";
import { generateNoteId, insertOrUpdateNote, findNoteReferences, renumberNotes, getNoteContent } from "./notes";

export interface CommandHandler {
  name: string;
  trigger: string; // e.g., "@table"
  handler: (view: EditorView, match: RegExpMatchArray, start: number, end: number) => Promise<boolean>;
}

/**
 * Table command handler
 * Opens table insertion dialog and inserts table on confirm
 */
async function handleTableCommand(
  view: EditorView,
  match: RegExpMatchArray,
  start: number,
  end: number
): Promise<boolean> {
  const { state, dispatch } = view;
  const schema = state.schema;
  
  if (!schema.nodes.table) {
    return false;
  }

  // Get the paragraph that contains @table and replace the entire paragraph
  const { $from } = state.selection;
  const paragraphStart = $from.before($from.depth);
  const paragraphEnd = $from.after($from.depth);
  
  // Start with a transaction that will replace the paragraph
  const tr = state.tr;
  
  // Show dialog for rows
  const rowsInput = await dialogStore.show({
    title: "table",
    placeholder: "Number of rows (1-20)",
    defaultValue: "3",
    type: "number",
    min: 1,
    max: 20,
  });
  
  if (!rowsInput) {
    return false;
  }
  
  const rows = parseInt(rowsInput, 10);
  if (isNaN(rows) || rows < 1 || rows > 20) {
    return false;
  }
  
  // Show dialog for columns
  const colsInput = await dialogStore.show({
    title: "table",
    placeholder: "Number of columns (1-20)",
    defaultValue: "3",
    type: "number",
    min: 1,
    max: 20,
  });
  
  if (!colsInput) {
    return false;
  }
  
  const cols = parseInt(colsInput, 10);
  if (isNaN(cols) || cols < 1 || cols > 20) {
    return false;
  }

  // Create table structure - use regular cells for all rows (no header row)
  const tableRows: any[] = [];
  
  // Create all rows as regular data rows (not header rows)
  for (let i = 0; i < rows; i++) {
    const dataRowCells: any[] = [];
    for (let j = 0; j < cols; j++) {
      const paragraph = schema.nodes.paragraph.create();
      const dataCell = schema.nodes.table_cell.create({}, Fragment.fromArray([paragraph]));
      dataRowCells.push(dataCell);
    }
    const dataRow = schema.nodes.table_row.create({}, dataRowCells);
    tableRows.push(dataRow);
  }
  
  const table = schema.nodes.table.create({}, tableRows);
  const newParagraph = schema.nodes.paragraph.create();
  const fragment = Fragment.fromArray([table, newParagraph]);
  
  // Replace the entire paragraph with table + new paragraph
  const updatedTr = tr.replaceWith(paragraphStart, paragraphEnd, fragment);
  
  // Position cursor in the first cell of the first row
  const tablePos = paragraphStart;
  const tableNode = updatedTr.doc.nodeAt(tablePos);
  if (tableNode && tableNode.type === schema.nodes.table) {
    const firstRowPos = tablePos + 1;
    const firstRowNode = updatedTr.doc.nodeAt(firstRowPos);
    if (firstRowNode && firstRowNode.type === schema.nodes.table_row) {
      const firstCellPos = firstRowPos + 1;
      const firstCellNode = updatedTr.doc.nodeAt(firstCellPos);
      if (firstCellNode) {
        const cellContentPos = firstCellPos + 1;
        updatedTr.setSelection(TextSelection.near(updatedTr.doc.resolve(cellContentPos)));
      }
    }
  }
  
  if (dispatch) {
    dispatch(updatedTr);
    view.focus();
  }
  
  return true;
}

/**
 * Table command handler with pre-filled column count
 */
async function handleTableCommandWithColumns(
  view: EditorView,
  columnCount: number,
  paragraphStart: number,
  paragraphEnd: number
): Promise<boolean> {
  const { state, dispatch } = view;
  const schema = state.schema;
  
  if (!schema.nodes.table) {
    return false;
  }

  // Show dialog for rows
  const rowsInput = await dialogStore.show({
    title: "table",
    placeholder: "Number of rows (1-20)",
    defaultValue: "3",
    type: "number",
    min: 1,
    max: 20,
  });
  
  if (!rowsInput) {
    return false;
  }
  
  const rows = parseInt(rowsInput, 10);
  if (isNaN(rows) || rows < 1 || rows > 20) {
    return false;
  }

  // Create table structure - use regular cells for all rows (no header row)
  const tableRows: any[] = [];
  
  // Create all rows as regular data rows (not header rows)
  for (let i = 0; i < rows; i++) {
    const dataRowCells: any[] = [];
    for (let j = 0; j < columnCount; j++) {
      const paragraph = schema.nodes.paragraph.create();
      const dataCell = schema.nodes.table_cell.create({}, Fragment.fromArray([paragraph]));
      dataRowCells.push(dataCell);
    }
    const dataRow = schema.nodes.table_row.create({}, dataRowCells);
    tableRows.push(dataRow);
  }
  
  const table = schema.nodes.table.create({}, tableRows);
  const newParagraph = schema.nodes.paragraph.create();
  const fragment = Fragment.fromArray([table, newParagraph]);
  
  // Replace the entire paragraph with table + new paragraph
  const tr = state.tr.replaceWith(paragraphStart, paragraphEnd, fragment);
  
  // Position cursor in the first cell of the first row
  const tablePos = paragraphStart;
  const tableNode = tr.doc.nodeAt(tablePos);
  if (tableNode && tableNode.type === schema.nodes.table) {
    const firstRowPos = tablePos + 1;
    const firstRowNode = tr.doc.nodeAt(firstRowPos);
    if (firstRowNode && firstRowNode.type === schema.nodes.table_row) {
      const firstCellPos = firstRowPos + 1;
      const firstCellNode = tr.doc.nodeAt(firstCellPos);
      if (firstCellNode) {
        const cellContentPos = firstCellPos + 1;
        tr.setSelection(TextSelection.near(tr.doc.resolve(cellContentPos)));
      }
    }
  }
  
  if (dispatch) {
    dispatch(tr);
    view.focus();
  }
  
  return true;
}

/**
 * Builds input rules for command system
 * Note: Commands are handled via Enter key handler, not input rules,
 * because they require async dialog interaction
 */
export function buildCommandInputRules(schema: Schema): InputRule[] {
  // Commands are handled in the Enter key handler for async support
  return [];
}

/**
 * Process command at current cursor position
 */
export async function processCommand(view: EditorView, commandName: string): Promise<boolean> {
  const { state } = view;
  const { $from } = state.selection;
  const paragraphStart = $from.before($from.depth);
  const paragraphEnd = $from.after($from.depth);
  const lineText = state.doc.textBetween(paragraphStart, paragraphEnd).trim();
  
  // Check for @table command
  if (commandName === "table" || lineText === "@table") {
    const match = lineText.match(/@table\s*$/);
    if (match) {
      // Find the position of @table in the paragraph
      const textBeforeMatch = lineText.substring(0, match.index!);
      const matchStart = paragraphStart + textBeforeMatch.length;
      const matchEnd = paragraphStart + match.index! + match[0].length;
      return await handleTableCommand(view, match, matchStart, matchEnd);
    }
  }
  
  // Check for @note command anywhere in the line
  // Note: This is now handled directly in Editor.svelte Enter handler
  // This function is kept for compatibility but may not be called
  if (commandName === "note") {
    return await insertNote(view);
  }
  
  return false;
}

/**
 * Handle table insertion with column count from header row
 * Replaces the entire paragraph containing the header row with the table
 */
export async function insertTableFromHeaderRow(
  view: EditorView, 
  columnCount: number,
  paragraphStart: number,
  paragraphEnd: number
): Promise<boolean> {
  return await handleTableCommandWithColumns(view, columnCount, paragraphStart, paragraphEnd);
}

/**
 * Insert a new note reference at the cursor position
 */
export async function insertNote(view: EditorView): Promise<boolean> {
  if (!view) {
    console.error("insertNote: view is null");
    return false;
  }
  
  try {
    // Get fresh state
    const { state, dispatch } = view;
    const { schema } = state;
    
    if (!schema.nodes.note_ref) {
      console.error("insertNote: note_ref node type not found in schema");
      return false;
    }
    
    // Get cursor position before showing dialog
    const { $from } = state.selection;
    const insertPos = $from.pos;
    
    // Show dialog for note content
    console.log("insertNote: About to show dialog...");
    console.log("insertNote: dialogStore:", dialogStore);
    console.log("insertNote: dialogStore.show:", typeof dialogStore.show);
    
    let noteContent: string | null = null;
    try {
      console.log("insertNote: Calling dialogStore.show...");
      noteContent = await dialogStore.show({
        title: "note",
        placeholder: "Enter note content...",
        defaultValue: "",
        type: "textarea",
        multiline: true,
      });
      console.log("insertNote: Dialog closed, content:", noteContent);
    } catch (error) {
      console.error("insertNote: Error showing dialog:", error);
      if (error instanceof Error) {
        console.error("insertNote: Error message:", error.message);
        console.error("insertNote: Error stack:", error.stack);
      }
      view.focus();
      return false;
    }
    
    if (noteContent === null || noteContent === "") {
      // User cancelled or entered empty content - restore focus
      view.focus();
      return false;
    }
    
    // Get fresh state after dialog (in case document changed)
    const currentState = view.state;
    const currentSchema = currentState.schema;
    
    // Try to find the position where we want to insert
    // If the document changed, try to find a position near where we were
    let finalInsertPos = insertPos;
    try {
      // Check if the position is still valid
      currentState.doc.resolve(insertPos);
    } catch {
      // Position is invalid, use current cursor position
      finalInsertPos = currentState.selection.$from.pos;
    }
    
    // Generate unique note ID
    const noteId = generateNoteId();
    
    // Count existing notes to determine number
    const existingRefs = findNoteReferences(currentState.doc, currentSchema);
    const nextNumber = existingRefs.length + 1;
    
    // Create note reference node
    const noteRef = currentSchema.nodes.note_ref.create({ noteId, number: nextNumber });
    
    // Insert reference at cursor position
    const tr = currentState.tr.insert(finalInsertPos, noteRef);
    
    if (dispatch) {
      dispatch(tr);
      
      // Insert note content in notes section (async to avoid transaction conflicts)
      setTimeout(() => {
        insertOrUpdateNote(view, noteId, noteContent, nextNumber);
      }, 10);
      
      view.focus();
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("insertNote: Error:", error);
    return false;
  }
}

/**
 * Edit an existing note by noteId
 */
export async function editNote(view: EditorView, noteId: string): Promise<boolean> {
  const { state } = view;
  const { schema } = state;
  
  if (!schema.nodes.note_ref) {
    return false;
  }
  
  // Get current note content
  const currentContent = getNoteContent(state.doc, schema, noteId) || "";
  
  // Show dialog with current content
  const newContent = await dialogStore.show({
    title: "note",
    placeholder: "Enter note content...",
    defaultValue: currentContent,
    type: "textarea",
    multiline: true,
  });
  
  if (newContent === null) {
    // User cancelled
    return false;
  }
  
  // Find the note reference to get its number
  const refs = findNoteReferences(state.doc, schema);
  const ref = refs.find(r => r.noteId === noteId);
  const number = ref ? ref.number : 1;
  
  // Update note content
  insertOrUpdateNote(view, noteId, newContent, number);
  
  return true;
}

