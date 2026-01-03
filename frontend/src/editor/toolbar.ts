import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { toggleMark, setBlockType, lift } from "prosemirror-commands";
import { undo, redo } from "prosemirror-history";
import { wrapInList } from "prosemirror-schema-list";
import { Fragment, Node as ProseMirrorNode } from "prosemirror-model";
import {
  addRowBefore,
  addRowAfter,
  deleteRow,
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
} from "prosemirror-tables";
import { schema } from "./schema";
import { dialogStore } from "./dialogStore";
import { insertNote } from "./commands";
import { scrollToNote } from "./noteNavigation";
import { findNoteReferences } from "./notes";

// Text formatting commands
export function toggleBold(view: EditorView) {
  const { state, dispatch } = view;
  if (!schema.marks.strong) {
    console.warn("Strong mark not available in schema");
    return false;
  }
  const command = toggleMark(schema.marks.strong);
  const result = command(state, dispatch);
  if (result) {
    view.focus();
  }
  return result;
}

export function toggleItalic(view: EditorView) {
  const { state, dispatch } = view;
  if (!schema.marks.em) {
    console.warn("Em mark not available in schema");
    return false;
  }
  const command = toggleMark(schema.marks.em);
  const result = command(state, dispatch);
  if (result) {
    view.focus();
  }
  return result;
}

export function toggleCode(view: EditorView) {
  const { state, dispatch } = view;
  if (!schema.marks.code) {
    console.warn("Code mark not available in schema");
    return false;
  }
  const command = toggleMark(schema.marks.code);
  const result = command(state, dispatch);
  if (result) {
    view.focus();
  }
  return result;
}

// Insert code block (like ``` in markdown)
export function insertCodeBlock(view: EditorView) {
  const { state, dispatch } = view;
  if (!schema.nodes.code_block) {
    console.warn("Code block node not available in schema");
    return false;
  }
  
  const { $from } = state.selection;
  const { from, to } = state.selection;
  
  // Check if we're in a paragraph
  const paragraphNode = $from.node($from.depth);
  if (paragraphNode.type === schema.nodes.paragraph) {
    const paragraphStart = $from.before($from.depth);
    const paragraphEnd = $from.after($from.depth);
    
    // Create code block
    const codeBlock = schema.nodes.code_block.create({});
    const newParagraph = schema.nodes.paragraph.create();
    const fragment = Fragment.fromArray([codeBlock, newParagraph]);
    const tr = state.tr.replaceWith(paragraphStart, paragraphEnd, fragment);
    const updatedDoc = tr.doc;
    const codeBlockNode = updatedDoc.nodeAt(paragraphStart);
    
    if (codeBlockNode && codeBlockNode.type === schema.nodes.code_block) {
      // Position cursor INSIDE the code block
      const codeBlockPos = paragraphStart;
      const insidePos = codeBlockPos + 1;
      tr.setSelection(TextSelection.create(updatedDoc, insidePos));
    }
    
    if (dispatch) {
      dispatch(tr);
      view.focus();
    }
    return true;
  }
  
  // If not in a paragraph, try to insert code block at current position
  const codeBlock = schema.nodes.code_block.create({});
  const tr = state.tr.replaceWith(from, to, codeBlock);
  const updatedDoc = tr.doc;
  const codeBlockNode = updatedDoc.nodeAt(from);
  
  if (codeBlockNode && codeBlockNode.type === schema.nodes.code_block) {
    const insidePos = from + 1;
    tr.setSelection(TextSelection.create(updatedDoc, insidePos));
  }
  
  if (dispatch) {
    dispatch(tr);
    view.focus();
  }
  return true;
}

// Block structure commands
export function setParagraph(view: EditorView) {
  const { state, dispatch } = view;
  return setBlockType(schema.nodes.paragraph)(state, dispatch);
}

export function setHeading(view: EditorView, level: number) {
  const { state, dispatch } = view;
  return setBlockType(schema.nodes.heading, { level })(state, dispatch);
}

// List commands - toggle if already in list, otherwise wrap
export function toggleBulletList(view: EditorView) {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  
  // Check if we're already in a bullet list
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === schema.nodes.bullet_list) {
      // Lift out of list
      return lift(state, dispatch);
    }
  }
  
  // Wrap in list
  return wrapInList(schema.nodes.bullet_list)(state, dispatch);
}

export function toggleOrderedList(view: EditorView) {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  
  // Check if we're already in an ordered list
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === schema.nodes.ordered_list) {
      // Lift out of list
      return lift(state, dispatch);
    }
  }
  
  // Wrap in list
  return wrapInList(schema.nodes.ordered_list)(state, dispatch);
}

// Link command - improved to handle editing existing links
export async function insertLink(view: EditorView): Promise<boolean> {
  const { state, dispatch } = view;
  
  // Check if link mark exists
  if (!schema.marks.link) {
    console.warn("Link mark not available in schema");
    return false;
  }

  const { from, to } = state.selection;
  const { $from } = state.selection;
  
  // Check if we're already in a link
  const linkMark = schema.marks.link;
  const existingLink = linkMark.isInSet($from.marks());
  
  let url = "";
  if (existingLink) {
    // Editing existing link - get current URL
    url = existingLink.attrs.href || "";
  }
  
  // Get selected text
  const selectedText = state.doc.textBetween(from, to, " ");
  
  // Show dialog for URL
  const newUrl = await dialogStore.show({
    title: "link",
    placeholder: "Enter URL",
    defaultValue: url || "https://",
  });
  
  if (!newUrl || newUrl.trim() === "") {
    // If empty URL and we have a link, remove it
    if (existingLink && from !== to) {
      const tr = state.tr.removeMark(from, to, linkMark);
      if (dispatch) dispatch(tr);
      return true;
    }
    return false;
  }

  // If no text is selected and we're not editing, insert link text
  if (from === to && !existingLink) {
    const linkText = await dialogStore.show({
      title: "link",
      placeholder: "Enter link text",
      defaultValue: "link",
    });
    if (!linkText) return false;
    
    const tr = state.tr
      .insertText(linkText, from)
      .addMark(from, from + linkText.length, linkMark.create({ href: newUrl }));
    if (dispatch) dispatch(tr);
    return true;
  }

  // Apply or update link mark
  const mark = linkMark.create({ href: newUrl });
  const tr = state.tr.addMark(from, to, mark);
  
  if (dispatch) {
    dispatch(tr);
  }
  return true;
}

// Image command
export async function insertImage(view: EditorView): Promise<boolean> {
  const { state, dispatch } = view;
  
  const url = await dialogStore.show({
    title: "image",
    placeholder: "Enter image URL",
    defaultValue: "https://",
  });
  
  if (!url) return false;

  // Check if image node exists in schema
  if (!schema.nodes.image) {
    console.warn("Image node not available in schema");
    return false;
  }

  const { from } = state.selection;
  const image = schema.nodes.image.create({ src: url, alt: "" });
  const tr = state.tr.replaceSelectionWith(image);
  
  if (dispatch) {
    dispatch(tr);
  }
  return true;
}

// Table command - prompt for rows and columns
export async function insertTable(view: EditorView): Promise<boolean> {
  const { state, dispatch } = view;
  
  // Check if table nodes exist in schema
  if (!schema.nodes.table || !schema.nodes.table_row || !schema.nodes.table_cell) {
    console.warn("Table nodes not available in schema");
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
  
  if (!rowsInput) return false;
  
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
  
  if (!colsInput) return false;
  
  const cols = parseInt(colsInput, 10);
  if (isNaN(cols) || cols < 1 || cols > 20) {
    return false;
  }

  const { from } = state.selection;

  // Create table structure
  const cells: any[] = [];
  for (let i = 0; i < rows; i++) {
    const rowCells: any[] = [];
    for (let j = 0; j < cols; j++) {
      const cell = schema.nodes.table_cell.create(
        {},
        schema.nodes.paragraph.create()
      );
      rowCells.push(cell);
    }
    const row = schema.nodes.table_row.create(null, rowCells);
    cells.push(row);
  }

  const table = schema.nodes.table.create(null, cells);
  const tr = state.tr.replaceSelectionWith(table);
  
  // Ensure there's a paragraph after the table for navigation
  const tableStart = tr.selection.from;
  const tableNode = tr.doc.nodeAt(tableStart);
  if (tableNode) {
    const tableEnd = tableStart + tableNode.nodeSize;
    const nextNode = tr.doc.nodeAt(tableEnd);
    if (!nextNode || nextNode.type !== schema.nodes.paragraph) {
      // Insert a paragraph after the table
      const paragraph = schema.nodes.paragraph.create();
      tr.insert(tableEnd, paragraph);
    }
  }
  
  if (dispatch) {
    dispatch(tr);
  }
  return true;
}

// Table editing commands
export function addRowBeforeCommand(view: EditorView) {
  const { state, dispatch } = view;
  return addRowBefore(state, dispatch);
}

export function addRowAfterCommand(view: EditorView) {
  const { state, dispatch } = view;
  return addRowAfter(state, dispatch);
}

export function deleteRowCommand(view: EditorView) {
  const { state, dispatch } = view;
  return deleteRow(state, dispatch);
}

export function addColumnBeforeCommand(view: EditorView) {
  const { state, dispatch } = view;
  return addColumnBefore(state, dispatch);
}

export function addColumnAfterCommand(view: EditorView) {
  const { state, dispatch } = view;
  return addColumnAfter(state, dispatch);
}

export function deleteColumnCommand(view: EditorView) {
  const { state, dispatch } = view;
  return deleteColumn(state, dispatch);
}

// Check if cursor is in a table
export function isInTable(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === schema.nodes.table) {
      return true;
    }
  }
  return false;
}

// Delete table command
export function deleteTableCommand(view: EditorView) {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  
  // Find the table node
  let tablePos = -1;
  let tableNode = null;
  
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === schema.nodes.table) {
      tablePos = $from.before(d);
      tableNode = node;
      break;
    }
  }
  
  if (!tableNode || tablePos === -1) {
    return false;
  }
  
  // Replace table with a paragraph
  const paragraph = schema.nodes.paragraph.create();
  const tr = state.tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, paragraph);
  
  // Set cursor at the start of the new paragraph
  tr.setSelection(TextSelection.near(tr.doc.resolve(tablePos + 1)));
  
  if (dispatch) {
    dispatch(tr);
  }
  return true;
}

// Check if mark is active
export function isMarkActive(state: EditorState, markType: any): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) {
    return !!markType.isInSet(state.storedMarks || $from.marks());
  }
  return state.doc.rangeHasMark(from, to, markType);
}

// Check if block type is active
export function isBlockActive(state: EditorState, nodeType: any, attrs: Record<string, any> = {}): boolean {
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 0) {
    const node = $from.node(depth);
    if (node.type === nodeType) {
      for (const key in attrs) {
        if (node.attrs[key] !== attrs[key]) {
          return false;
        }
      }
      return true;
    }
    depth--;
  }
  return false;
}

// Check if list is active
export function isListActive(state: EditorState, listType: any): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === listType) {
      return true;
    }
  }
  return false;
}

// Get link URL if link is active
export function getLinkUrl(state: EditorState): string | null {
  const { $from } = state.selection;
  const linkMark = schema.marks.link;
  if (!linkMark) return null;
  
  const link = linkMark.isInSet($from.marks());
  if (link) {
    return link.attrs.href || null;
  }
  return null;
}

// Undo command
export function undoCommand(view: EditorView) {
  const { state, dispatch } = view;
  return undo(state, dispatch);
}

// Redo command
export function redoCommand(view: EditorView) {
  const { state, dispatch } = view;
  return redo(state, dispatch);
}

// Check if undo is available
export function canUndo(state: EditorState): boolean {
  return undo(state) !== false;
}

// Check if redo is available
export function canRedo(state: EditorState): boolean {
  return redo(state) !== false;
}

// Paste from Markdown
export async function pasteFromMarkdown(view: EditorView): Promise<boolean> {
  try {
    // Read from clipboard
    const text = await navigator.clipboard.readText();
    if (!text) return false;
    
    // Import parser dynamically
    const { parseMarkdown } = await import("./clipboard/markdownParser");
    const { state, dispatch } = view;
    const { from, to } = state.selection;
    
    // Parse Markdown to ProseMirror slice
    const slice = parseMarkdown(text, schema);
    if (slice) {
      const tr = state.tr.replaceRange(from, to, slice);
      if (dispatch) {
        dispatch(tr);
        view.focus();
      }
      return true;
    }
  } catch (error) {
    console.error("Error pasting from Markdown:", error);
  }
  return false;
}

// Copy as Markdown
export async function copyAsMarkdown(view: EditorView): Promise<boolean> {
  try {
    const { state } = view;
    const { from, to, $from } = state.selection;
    
    // Get selected content
    let content: ProseMirrorNode | Fragment;
    
    if (from !== to) {
      // Has selection - copy selected content
      const slice = state.doc.slice(from, to);
      content = slice.content;
      
      // Debug: Check if fragment has content
      if (content instanceof Fragment && content.size === 0) {
        console.warn("Copy MD: Fragment is empty");
        return false;
      }
    } else {
      // No selection - copy the current block (paragraph, heading, etc.)
      // Find the innermost block node (not doc, not text)
      let depth = $from.depth;
      let blockNode: ProseMirrorNode | null = null;
      
      // Start from current depth and go up to find a block node
      for (let d = depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.isBlock && node.type.name !== "doc") {
          blockNode = node;
          break;
        }
      }
      
      if (blockNode) {
        // Serialize the block node directly
        content = blockNode;
      } else {
        // Fallback: get paragraph at current position
        const blockStart = $from.start($from.depth);
        const blockEnd = $from.end($from.depth);
        const slice = state.doc.slice(blockStart, blockEnd);
        content = slice.content;
      }
    }
    
    // Check if content is empty
    if (!content) {
      return false;
    }
    
    // Check size for Fragment
    if (content instanceof Fragment) {
      if (content.size === 0) {
        return false;
      }
    } else if (content.content.size === 0) {
      // Node has no content
      return false;
    }
    
    // Import serializer dynamically
    const { serializeToMarkdown } = await import("./clipboard/markdownSerializer");
    const markdown = serializeToMarkdown(content, schema, view);
    
    if (!markdown || markdown.trim() === "") {
      return false;
    }
    
    // Copy to clipboard
    await navigator.clipboard.writeText(markdown.trim());
    return true;
  } catch (error) {
    console.error("Error copying as Markdown:", error);
    return false;
  }
}

// Insert a new note
export async function insertNoteCommand(view: EditorView): Promise<boolean> {
  try {
    return await insertNote(view);
  } catch (error) {
    console.error("Error inserting note:", error);
    return false;
  }
}

// View notes - scroll to notes section
export function viewNotes(view: EditorView): boolean {
  try {
    console.log("viewNotes: Starting...", view);
    
    if (!view) {
      console.warn("viewNotes: view is null");
      return false;
    }
    
    // Check if notes exist in the document
    const { doc } = view.state;
    const refs = findNoteReferences(doc, schema);
    console.log("viewNotes: Found", refs.length, "note references");
    
    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      const notesSection = document.querySelector('.notes-section');
      console.log("viewNotes: Notes section found:", notesSection);
      
      if (notesSection) {
        console.log("viewNotes: Scrolling to notes section...");
        notesSection.scrollIntoView({ behavior: "smooth", block: "center" });
        // Highlight briefly
        notesSection.classList.add("note-highlight");
        setTimeout(() => {
          notesSection.classList.remove("note-highlight");
        }, 2000);
        return;
      }
      
      // If notes section not found but we have notes, try scrolling to first note
      if (refs.length > 0) {
        const firstNoteId = refs[0].noteId;
        console.log("viewNotes: Notes section not in DOM, scrolling to first note:", firstNoteId);
        scrollToNote(firstNoteId, view);
        return;
      }
      
      // No notes at all - scroll to bottom of editor
      console.log("viewNotes: No notes found, scrolling to bottom of editor");
      const editorContainer = view.dom.closest('.editor-container');
      const editorWrapper = view.dom.closest('.editor');
      if (editorWrapper) {
        editorWrapper.scrollIntoView({ behavior: "smooth", block: "end" });
      } else if (editorContainer) {
        editorContainer.scrollIntoView({ behavior: "smooth", block: "end" });
      } else {
        // Fallback: scroll window to bottom
        window.scrollTo({ behavior: "smooth", top: document.body.scrollHeight });
      }
    });
    
    return true;
  } catch (error) {
    console.error("Error viewing notes:", error);
    return false;
  }
}

