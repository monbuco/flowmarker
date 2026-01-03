import { Schema } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { tableNodes } from "prosemirror-tables";

const tableNodesSpec = tableNodes({
  tableGroup: "block",
  cellContent: "block+",
  cellAttributes: {},
});

// Add code_block node if it doesn't exist in basicSchema
const codeBlockSpec = basicSchema.spec.nodes.get("code_block") || {
  content: "text*",
  marks: "",
  group: "block",
  code: true,
  defining: true,
  attrs: {
    language: { default: null },
  },
  parseDOM: [
    {
      tag: "pre",
      preserveWhitespace: "full",
      getAttrs: (node: any) => {
        const code = node.querySelector("code");
        return {
          language: code?.getAttribute("class")?.replace(/^language-/, "") || null,
        };
      },
    },
  ],
  toDOM: (node: any) => {
    const attrs: any = {};
    if (node.attrs.language) {
      attrs.class = `language-${node.attrs.language}`;
    }
    return ["pre", attrs, ["code", attrs, 0]];
  },
};

// Note reference (inline node) - superscript reference to a note
const noteRefSpec = {
  inline: true,
  group: "inline",
  atom: true,
  attrs: {
    noteId: { default: null },
    number: { default: 1 },
  },
  parseDOM: [
    {
      tag: "sup[data-note-ref]",
      getAttrs: (node: any) => {
        return {
          noteId: node.getAttribute("data-note-id") || null,
          number: parseInt(node.getAttribute("data-note-number") || "1", 10),
        };
      },
    },
  ],
  toDOM: (node: any) => {
    return [
      "sup",
      {
        "data-note-ref": "true",
        "data-note-id": node.attrs.noteId,
        "data-note-number": node.attrs.number.toString(),
        class: "note-ref",
      },
      node.attrs.number.toString(),
    ];
  },
};

// Note content (block node) - stores the actual note content
const noteContentSpec = {
  content: "block+",
  group: "block",
  defining: true,
  attrs: {
    noteId: { default: null },
    number: { default: 1 },
  },
  parseDOM: [
    {
      tag: "div[data-note-content]",
      getAttrs: (node: any) => {
        return {
          noteId: node.getAttribute("data-note-id") || null,
          number: parseInt(node.getAttribute("data-note-number") || "1", 10),
        };
      },
    },
  ],
  toDOM: (node: any) => {
    return [
      "div",
      {
        "data-note-content": "true",
        "data-note-id": node.attrs.noteId,
        "data-note-number": node.attrs.number.toString(),
        class: "note-content",
      },
      ["span", { class: "note-number" }, `${node.attrs.number}. `],
      ["span", { class: "note-text" }, 0],
    ];
  },
};

// Combine all nodes
const allNodes = addListNodes(
  basicSchema.spec.nodes
    .append(tableNodesSpec)
    .addToEnd("code_block", codeBlockSpec)
    .addToEnd("note_content", noteContentSpec),
  "paragraph block*",
  "block"
);

// Add inline nodes (note_ref)
const allNodesWithInline = allNodes.addToEnd("note_ref", noteRefSpec);

export const schema = new Schema({
  nodes: allNodesWithInline,
  marks: basicSchema.spec.marks,
});
