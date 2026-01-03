/**
 * ProseMirror → Markdown serializer
 * 
 * Converts ProseMirror document nodes to Markdown text.
 * Used for explicit "Copy as Markdown" action.
 */

import { Node as ProseMirrorNode, Fragment } from "prosemirror-model";
import { Schema } from "prosemirror-model";
import { EditorView } from "prosemirror-view";
import { notesStore } from "../notesStore";
import { findNoteReferences } from "../notes";

/**
 * Find all note references in a Fragment
 */
function findNoteReferencesInFragment(fragment: Fragment, schema: Schema): Array<{ node: ProseMirrorNode; pos: number; noteId: string; number: number }> {
  const refs: Array<{ node: ProseMirrorNode; pos: number; noteId: string; number: number }> = [];
  
  // Iterate through all nodes in the fragment
  fragment.forEach((node) => {
    // Check if the node itself is a note reference
    if (node.type === schema.nodes.note_ref) {
      refs.push({
        node,
        pos: 0, // Position doesn't matter for fragment search
        noteId: node.attrs.noteId,
        number: node.attrs.number,
      });
    }
    
    // Recursively search in node content
    if (node.content && node.content.size > 0) {
      node.descendants((childNode, pos) => {
        if (childNode.type === schema.nodes.note_ref) {
          refs.push({
            node: childNode,
            pos,
            noteId: childNode.attrs.noteId,
            number: childNode.attrs.number,
          });
        }
      });
    }
  });
  
  return refs;
}

/**
 * Serializes a ProseMirror node or fragment to Markdown
 */
export function serializeToMarkdown(node: ProseMirrorNode | Fragment, schema: Schema, view?: EditorView | null): string {
  let mainContent: string;
  let doc: ProseMirrorNode | null = null;
  let fragmentToCheck: Fragment | null = null;
  
  if (node instanceof Fragment) {
    // For fragments (selected content), check notes within the fragment itself
    fragmentToCheck = node;
    // Serialize the fragment
    try {
      mainContent = serializeFragment(node, schema);
      // If serialization returned empty, there might be an issue
      if (!mainContent || mainContent.trim() === "") {
        console.warn("Fragment serialization returned empty content");
      }
    } catch (error) {
      console.error("Error serializing fragment:", error, node);
      return "";
    }
    // Also get the full document for note lookup if we have a view
    if (view) {
      doc = view.state.doc;
    } else {
      // No view, just return fragment content without notes
      return mainContent;
    }
  } else {
    mainContent = serializeNode(node, schema);
    if (node.type.name === "doc") {
      doc = node;
    } else if (view) {
      // If we have a view, use its document to get all notes
      doc = view.state.doc;
    }
  }
  
  // Get notes from store (not from document)
  let notesMap: Map<string, any> = new Map();
  const unsubscribe = notesStore.subscribe((store) => {
    notesMap = store;
  });
  
  // Get note references - from fragment if it's a selection, otherwise from full doc
  let refs: Array<{ node: ProseMirrorNode; pos: number; noteId: string; number: number }> = [];
  if (fragmentToCheck) {
    // For selected content, find notes within the fragment
    try {
      refs = findNoteReferencesInFragment(fragmentToCheck, schema);
    } catch (error) {
      console.error("Error finding note references in fragment:", error);
      refs = [];
    }
  } else if (doc) {
    // For full document, get all note references
    refs = findNoteReferences(doc, schema);
  }
  
  if (refs.length > 0) {
    const notes: string[] = [];
    
    // Get unique note IDs in order
    const seen = new Set<string>();
    for (const ref of refs) {
      if (!seen.has(ref.noteId)) {
        seen.add(ref.noteId);
        const note = notesMap.get(ref.noteId);
        if (note) {
          notes.push(`[^${note.number}]: ${note.content}`);
        }
      }
    }
    
    unsubscribe();
    
    if (notes.length > 0) {
      return mainContent + "\n\n---\n\n" + notes.join("\n");
    }
  }
  
  unsubscribe();
  return mainContent;
}

// Note: collectNotes removed - notes are now stored in notesStore, not in document

/**
 * Serializes a ProseMirror node to Markdown
 */
function serializeNode(node: ProseMirrorNode, schema: Schema): string {
  const nodeType = node.type.name;
  
  switch (nodeType) {
    case "doc":
      return serializeFragment(node.content, schema);
    
    case "paragraph":
      return serializeInline(node.content, schema) + "\n\n";
    
    case "heading":
      const level = node.attrs.level || 1;
      const headingText = serializeInline(node.content, schema);
      return "#".repeat(level) + " " + headingText + "\n\n";
    
    case "code_block":
      const code = node.textContent;
      const language = node.attrs.language || "";
      return "```" + language + "\n" + code + "\n```\n\n";
    
    case "blockquote":
      const quoteContent = serializeFragment(node.content, schema);
      return quoteContent
        .split("\n")
        .filter(line => line.trim())
        .map(line => "> " + line)
        .join("\n") + "\n\n";
    
    case "horizontal_rule":
      return "---\n\n";
    
    case "bullet_list":
      return serializeList(node.content, schema, false) + "\n";
    
    case "ordered_list":
      return serializeList(node.content, schema, true) + "\n";
    
    case "list_item":
      return serializeFragment(node.content, schema);
    
    case "table":
      return serializeTable(node, schema) + "\n\n";
    
    // Note: note_content removed - notes are stored in notesStore
    
    default:
      // Fallback: serialize content
      return serializeFragment(node.content, schema);
  }
}

/**
 * Serializes a fragment (collection of nodes)
 */
function serializeFragment(fragment: Fragment, schema: Schema): string {
  let result = "";
  
  // Check if fragment contains only text nodes (partial selection)
  let hasOnlyTextNodes = true;
  let hasBlockNodes = false;
  fragment.forEach((node) => {
    if (!node.isText) {
      hasOnlyTextNodes = false;
      if (node.isBlock) {
        hasBlockNodes = true;
      }
    }
  });
  
  // If fragment has only text nodes (partial selection), wrap in paragraph structure
  if (hasOnlyTextNodes && !hasBlockNodes) {
    // Serialize as inline content (preserves formatting like bold, italic)
    result = serializeInline(fragment, schema);
  } else {
    // Fragment contains block nodes, serialize normally
    fragment.forEach((node) => {
      if (node.isText) {
        // Text node at top level - serialize as inline
        result += serializeInline(Fragment.fromArray([node]), schema);
      } else {
        // Block node - serialize normally
        result += serializeNode(node, schema);
      }
    });
  }
  
  return result;
}

/**
 * Serializes inline content (text with marks)
 */
function serializeInline(fragment: Fragment, schema: Schema): string {
  let result = "";
  let currentMarks: any[] = [];
  
  fragment.forEach((node, offset, index) => {
    if (node.isText) {
      let text = node.text || "";
      
      // Apply marks in order
      const marks = node.marks || [];
      
      // Handle code mark (inline code)
      if (marks.find(m => m.type.name === "code")) {
        text = "`" + text + "`";
      }
      
      // Handle strong (bold)
      if (marks.find(m => m.type.name === "strong")) {
        text = "**" + text + "**";
      }
      
      // Handle em (italic) - must come after strong to avoid conflicts
      if (marks.find(m => m.type.name === "em")) {
        // Check if already wrapped in **
        if (!text.startsWith("**")) {
          text = "*" + text + "*";
        }
      }
      
      // Handle link
      const linkMark = marks.find(m => m.type.name === "link");
      if (linkMark) {
        const url = linkMark.attrs.href || "";
        text = "[" + text + "](" + url + ")";
      }
      
      result += text;
    } else {
      // Handle inline nodes like images and note references
      if (node.type.name === "image") {
        const src = node.attrs.src || "";
        const alt = node.attrs.alt || "";
        result += "![" + alt + "](" + src + ")";
      } else if (node.type.name === "note_ref") {
        // Serialize note reference as [^number]
        const number = node.attrs.number || 1;
        result += `[^${number}]`;
      } else {
        // Fallback: serialize content
        result += serializeFragment(node.content, schema);
      }
    }
  });
  
  return result;
}

/**
 * Serializes a list (bullet or ordered)
 */
function serializeList(fragment: Fragment, schema: Schema, ordered: boolean): string {
  let result = "";
  let itemNumber = 1;
  
  fragment.forEach((node) => {
    if (node.type.name === "list_item") {
      const prefix = ordered ? `${itemNumber}. ` : "- ";
      const content = serializeFragment(node.content, schema).trim();
      // Split into lines and indent continuation lines
      const lines = content.split("\n");
      result += prefix + lines[0] + "\n";
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
          // Indent continuation lines
          result += "  " + lines[i] + "\n";
        } else {
          result += "\n";
        }
      }
      if (ordered) itemNumber++;
    } else {
      // Handle nested lists
      result += serializeNode(node, schema);
    }
  });
  
  return result;
}

/**
 * Serializes a table to Markdown
 */
function serializeTable(node: ProseMirrorNode, schema: Schema): string {
  let result = "";
  const rows: string[][] = [];
  
  // Collect all rows
  node.content.forEach((rowNode) => {
    if (rowNode.type.name === "table_row") {
      const cells: string[] = [];
      rowNode.content.forEach((cellNode) => {
        const cellText = serializeFragment(cellNode.content, schema).trim();
        cells.push(cellText);
      });
      rows.push(cells);
    }
  });
  
  if (rows.length === 0) return "";
  
  // First row is header (if using table_header)
  // For now, treat first row as header
  const headerRow = rows[0];
  result += "| " + headerRow.join(" | ") + " |\n";
  
  // Separator
  result += "| " + headerRow.map(() => "---").join(" | ") + " |\n";
  
  // Data rows
  for (let i = 1; i < rows.length; i++) {
    result += "| " + rows[i].join(" | ") + " |\n";
  }
  
  return result.trim();
}

