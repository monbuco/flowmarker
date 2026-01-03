import { Schema, Node as ProseMirrorNode, Fragment } from "prosemirror-model";
import { Slice } from "prosemirror-model";
import MarkdownIt from "markdown-it";
// @ts-ignore - markdown-it-table may not have types
import { markdownItTable } from "markdown-it-table";

/**
 * Markdown → ProseMirror converter using markdown-it.
 * 
 * IMPORTANT: This parser is ONLY for paste operations and file imports.
 * For direct typing in the editor, use input rules (inputRules/markdown.ts) instead.
 * 
 * This separation is critical for performance:
 * - Input rules: Fast, lightweight, triggered on each keystroke during typing
 * - Markdown parser: More robust, handles complex structures, used only on paste/import
 * 
 * This module provides a robust Markdown parser that converts Markdown text
 * into ProseMirror document structure. It uses markdown-it to parse Markdown
 * into an AST (tokens), then maps those tokens to ProseMirror nodes.
 * 
 * Supported Markdown features:
 * - Block-level: paragraphs, headings, lists, blockquotes, horizontal rules, code blocks, tables
 * - Inline: bold, italic, inline code, links, images
 * 
 * This is designed to be reusable for:
 * - Paste operations (primary use case)
 * - Opening .md files
 * - Importing FlowMark documents
 * - CMS integrations
 */

// Initialize markdown-it parser with table support
const md = new MarkdownIt({
  html: false, // Don't parse HTML
  breaks: false, // Don't convert line breaks to <br>
  linkify: false, // Don't auto-link URLs
}).use(markdownItTable);

/**
 * Parses Markdown text and converts it to a ProseMirror slice.
 * 
 * @param text - The Markdown text to parse
 * @param schema - The ProseMirror schema
 * @returns A ProseMirror slice containing the parsed content, or null if parsing fails
 */
export function parseMarkdown(text: string, schema: Schema): Slice | null {
  try {
    // Parse Markdown into tokens (AST)
    const tokens = md.parse(text, {});
    
    // Convert tokens to ProseMirror nodes
    const nodes = tokensToNodes(tokens, schema);
    
    // If no nodes were created, create an empty paragraph
    if (nodes.length === 0) {
      nodes.push(schema.nodes.paragraph.create());
    }
    
    // Create a fragment and return as slice
    const fragment = Fragment.fromArray(nodes);
    return new Slice(fragment, 0, 0);
  } catch (error) {
    console.error("Error parsing Markdown:", error);
    // Fallback: return plain text as paragraph
    try {
      const paragraph = schema.nodes.paragraph.create({}, schema.text(text));
      return new Slice(Fragment.fromArray([paragraph]), 0, 0);
    } catch {
      return null;
    }
  }
}

/**
 * Converts markdown-it tokens to ProseMirror nodes.
 * 
 * @param tokens - Array of markdown-it tokens
 * @param schema - The ProseMirror schema
 * @returns Array of ProseMirror nodes
 */
function tokensToNodes(tokens: any[], schema: Schema): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    
    // Check for footnote definition: [^number]: content
    // This appears as a paragraph with specific text pattern
    if (token.type === "paragraph_open") {
      // Look ahead to see if this paragraph contains a footnote definition
      let j = i + 1;
      let foundFootnoteDef = false;
      let footnoteNumber = 0;
      let footnoteContent = "";
      
      while (j < tokens.length && tokens[j].type !== "paragraph_close") {
        if (tokens[j].type === "inline") {
          const inlineText = tokens[j].content || "";
          const footnoteDefMatch = inlineText.match(/^\[\^(\d+)\]:\s*(.+)$/);
          if (footnoteDefMatch) {
            foundFootnoteDef = true;
            footnoteNumber = parseInt(footnoteDefMatch[1], 10);
            footnoteContent = footnoteDefMatch[2].trim();
            break;
          }
        }
        j++;
      }
      
      if (foundFootnoteDef && schema.nodes.note_content) {
        // Create note content node
        const noteId = `note-${footnoteNumber}`;
        const paragraph = schema.nodes.paragraph.create({}, schema.text(footnoteContent));
        const noteContent = schema.nodes.note_content.create(
          { noteId, number: footnoteNumber },
          Fragment.fromArray([paragraph])
        );
        nodes.push(noteContent);
        
        // Skip to paragraph_close
        while (i < tokens.length && tokens[i].type !== "paragraph_close") {
          i++;
        }
        i++; // Skip paragraph_close
        continue;
      }
    }
    
    // Skip non-block tokens (they're handled inline)
    if (token.type !== "heading_open" && 
        token.type !== "paragraph_open" &&
        token.type !== "bullet_list_open" &&
        token.type !== "ordered_list_open" &&
        token.type !== "blockquote_open" &&
        token.type !== "hr" &&
        token.type !== "fence" &&
        token.type !== "code_block" &&
        token.type !== "table_open") {
      i++;
      continue;
    }

    switch (token.type) {
      case "heading_open": {
        // Heading: #, ##, ###, etc.
        if (schema.nodes.heading) {
          const level = parseInt(token.tag.substring(1), 10); // h1 -> 1, h2 -> 2, etc.
          // Find the closing tag and get content
          const content = getInlineContent(tokens, i + 1, "heading_close", schema);
          nodes.push(
            schema.nodes.heading.create(
              { level: Math.min(Math.max(level, 1), 6) },
              content
            )
          );
          // Skip to after the closing tag
          i = findClosingToken(tokens, i, "heading_close") + 1;
        } else {
          i++;
        }
        break;
      }

      case "paragraph_open": {
        // Regular paragraph
        // Check if paragraph contains only an image
        const inlineTokens = getInlineTokensBetween(tokens, i + 1, "paragraph_close");
        const hasOnlyImage = inlineTokens.length === 1 && inlineTokens[0]?.type === "image";
        
        if (hasOnlyImage && schema.nodes.image) {
          // Paragraph with only an image -> convert to image node
          const imageToken = inlineTokens[0];
          const src = imageToken.attrs?.find((attr: any[]) => attr[0] === "src")?.[1] || "";
          const alt = imageToken.content || imageToken.attrs?.find((attr: any[]) => attr[0] === "alt")?.[1] || "";
          if (src) {
            nodes.push(schema.nodes.image.create({ src, alt }));
          }
        } else {
          // Regular paragraph with text/content
          const content = getInlineContent(tokens, i + 1, "paragraph_close", schema);
          nodes.push(schema.nodes.paragraph.create({}, content));
        }
        i = findClosingToken(tokens, i, "paragraph_close") + 1;
        break;
      }

      case "bullet_list_open": {
        // Bullet list
        if (schema.nodes.bullet_list) {
          const items = parseListItems(tokens, i, "bullet_list", schema);
          if (items.length > 0) {
            nodes.push(schema.nodes.bullet_list.create({}, items));
          }
          i = findClosingToken(tokens, i, "bullet_list_close") + 1;
        } else {
          i++;
        }
        break;
      }

      case "ordered_list_open": {
        // Ordered list
        if (schema.nodes.ordered_list) {
          const items = parseListItems(tokens, i, "ordered_list", schema);
          if (items.length > 0) {
            nodes.push(schema.nodes.ordered_list.create({}, items));
          }
          i = findClosingToken(tokens, i, "ordered_list_close") + 1;
        } else {
          i++;
        }
        break;
      }

      case "blockquote_open": {
        // Blockquote
        if (schema.nodes.blockquote) {
          const content = parseBlockContent(tokens, i + 1, "blockquote_close", schema);
          if (content.size > 0) {
            nodes.push(schema.nodes.blockquote.create({}, content));
          }
          i = findClosingToken(tokens, i, "blockquote_close") + 1;
        } else {
          i++;
        }
        break;
      }

      case "hr": {
        // Horizontal rule
        if (schema.nodes.horizontal_rule) {
          nodes.push(schema.nodes.horizontal_rule.create());
        }
        i++;
        break;
      }

      case "fence":
      case "code_block": {
        // Fenced code block (```language) or indented code block
        const code = token.content || "";
        const language = token.info ? token.info.trim().split(/\s+/)[0] : null;
        
        // If schema has code_block node, use it
        if (schema.nodes.code_block) {
          const attrs: any = {};
          if (language) {
            attrs.language = language;
          }
          // Code blocks contain plain text, not formatted content
          nodes.push(schema.nodes.code_block.create(attrs, schema.text(code)));
        } else {
          // Fallback: convert to paragraph with code text
          // This preserves the content even if code_block node doesn't exist
          nodes.push(schema.nodes.paragraph.create({}, schema.text(code)));
        }
        i++;
        break;
      }

      case "table_open": {
        // Table: parse table structure
        if (schema.nodes.table) {
          const tableRows = parseTable(tokens, i, schema);
          if (tableRows.length > 0) {
            nodes.push(schema.nodes.table.create({}, tableRows));
          }
          i = findClosingToken(tokens, i, "table_close") + 1;
        } else {
          i++;
        }
        break;
      }

      default:
        i++;
        break;
    }
  }

  return nodes;
}

/**
 * Gets inline tokens between an opening and closing token.
 * 
 * @param tokens - Array of tokens
 * @param start - Start index (after opening token)
 * @param closeType - Type of closing token
 * @returns Array of inline tokens
 */
function getInlineTokensBetween(tokens: any[], start: number, closeType: string): any[] {
  const inlineTokens: any[] = [];
  let i = start;

  while (i < tokens.length && tokens[i].type !== closeType) {
    const token = tokens[i];
    
    if (token.type === "inline") {
      // Flatten inline token children
      inlineTokens.push(...(token.children || []));
    } else if (token.type === "image" || token.type === "text") {
      inlineTokens.push(token);
    }
    
    i++;
  }

  return inlineTokens;
}

/**
 * Parses a table from markdown-it tokens.
 * 
 * @param tokens - Array of tokens
 * @param start - Start index (at table_open token)
 * @param schema - The ProseMirror schema
 * @returns Array of table_row nodes
 */
function parseTable(tokens: any[], start: number, schema: Schema): ProseMirrorNode[] {
  const rows: ProseMirrorNode[] = [];
  let i = start + 1; // Skip table_open
  
  while (i < tokens.length && tokens[i].type !== "table_close") {
    const token = tokens[i];
    
    if (token.type === "tr_open") {
      // Parse table row
      const cells: ProseMirrorNode[] = [];
      let j = i + 1;
      
      while (j < tokens.length && tokens[j].type !== "tr_close") {
        const cellToken = tokens[j];
        
        if (cellToken.type === "th_open" || cellToken.type === "td_open") {
          // Parse table cell (treat all cells as regular cells, not headers)
          const isHeader = cellToken.type === "th_open";
          const closeType = isHeader ? "th_close" : "td_close";
          
          // Get inline content from the cell
          // Table cells in markdown-it-table typically contain inline tokens
          const inlineContent = getInlineContent(tokens, j + 1, closeType, schema);
          
          // Table cells must contain block nodes, so wrap inline content in a paragraph
          const paragraph = schema.nodes.paragraph.create({}, inlineContent);
          
          // Always use table_cell instead of table_header to avoid grey background
          const cellNode = schema.nodes.table_cell.create({}, Fragment.fromArray([paragraph]));
          cells.push(cellNode);
          
          j = findClosingToken(tokens, j, closeType) + 1;
        } else {
          j++;
        }
      }
      
      if (cells.length > 0) {
        rows.push(schema.nodes.table_row.create({}, cells));
      }
      
      i = findClosingToken(tokens, i, "tr_close") + 1;
    } else {
      i++;
    }
  }
  
  return rows;
}

/**
 * Parses inline content (text with marks) from tokens.
 * 
 * @param tokens - Array of tokens
 * @param start - Start index
 * @param closeType - Type of closing token to look for
 * @param schema - The ProseMirror schema
 * @returns Fragment containing inline nodes
 */
function getInlineContent(
  tokens: any[],
  start: number,
  closeType: string,
  schema: Schema
): Fragment {
  const nodes: ProseMirrorNode[] = [];
  let i = start;
  let text = "";

  while (i < tokens.length && tokens[i].type !== closeType) {
    const token = tokens[i];
    
    if (token.type === "inline") {
      // Parse inline tokens
      const inlineNodes = parseInlineTokens(token.children || [], schema);
      nodes.push(...inlineNodes);
    } else if (token.type === "text") {
      text += token.content;
    }
    
    i++;
  }

  // Add any remaining text
  if (text) {
    nodes.push(schema.text(text));
  }

  return Fragment.fromArray(nodes);
}

/**
 * Parses inline tokens (bold, italic, code, links, images) into ProseMirror nodes.
 * 
 * @param tokens - Array of inline tokens
 * @param schema - The ProseMirror schema
 * @returns Array of ProseMirror text nodes with marks
 */
function parseInlineTokens(tokens: any[], schema: Schema): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];
  let currentText = "";
  const marks: any[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "text":
        // Check for footnote reference syntax [^number] in text
        if (schema.nodes.note_ref) {
          const text = token.content;
          const footnoteRefRegex = /\[\^(\d+)\]/g;
          let lastIndex = 0;
          let match;
          
          while ((match = footnoteRefRegex.exec(text)) !== null) {
            // Add text before the footnote reference
            if (match.index > lastIndex) {
              const beforeText = text.substring(lastIndex, match.index);
              if (beforeText) {
                currentText += beforeText;
              }
            }
            
            // Flush current text if any
            if (currentText) {
              nodes.push(schema.text(currentText, marks.slice()));
              currentText = "";
            }
            
            // Create note reference node
            const noteNumber = parseInt(match[1], 10);
            const noteId = `note-${noteNumber}`; // Generate ID based on number
            const noteRef = schema.nodes.note_ref.create({ noteId, number: noteNumber });
            nodes.push(noteRef);
            
            lastIndex = match.index + match[0].length;
          }
          
          // Add remaining text after last footnote reference
          if (lastIndex < text.length) {
            currentText += text.substring(lastIndex);
          } else if (lastIndex === 0) {
            // No footnote references found, add entire text
            currentText += text;
          }
        } else {
          // No note_ref node type, just add text
          currentText += token.content;
        }
        break;

      case "strong_open":
        // Start bold
        if (currentText && schema.marks.strong) {
          nodes.push(schema.text(currentText, marks.slice()));
          currentText = "";
        }
        if (schema.marks.strong) {
          marks.push(schema.marks.strong.create());
        }
        break;

      case "strong_close":
        // End bold
        if (currentText && schema.marks.strong) {
          nodes.push(schema.text(currentText, marks.slice()));
          currentText = "";
        }
        if (schema.marks.strong) {
          marks.pop();
        }
        break;

      case "em_open":
        // Start italic
        if (currentText && schema.marks.em) {
          nodes.push(schema.text(currentText, marks.slice()));
          currentText = "";
        }
        if (schema.marks.em) {
          marks.push(schema.marks.em.create());
        }
        break;

      case "em_close":
        // End italic
        if (currentText && schema.marks.em) {
          nodes.push(schema.text(currentText, marks.slice()));
          currentText = "";
        }
        if (schema.marks.em) {
          marks.pop();
        }
        break;

      case "code_inline":
        // Inline code
        if (currentText && schema.marks.code) {
          nodes.push(schema.text(currentText, marks.slice()));
          currentText = "";
        }
        if (schema.marks.code) {
          nodes.push(schema.text(token.content, [...marks, schema.marks.code.create()]));
        } else {
          currentText += token.content;
        }
        break;

      case "link_open": {
        // Start link
        if (currentText) {
          nodes.push(schema.text(currentText, marks.slice()));
          currentText = "";
        }
        const href = token.attrs?.find((attr: any[]) => attr[0] === "href")?.[1] || "";
        if (schema.marks.link && href) {
          marks.push(schema.marks.link.create({ href }));
        }
        break;
      }

      case "link_close":
        // End link
        if (currentText && schema.marks.link) {
          nodes.push(schema.text(currentText, marks.slice()));
          currentText = "";
        }
        if (schema.marks.link) {
          marks.pop();
        }
        break;

      case "text":
        // Check for footnote reference syntax [^number] in text
        if (schema.nodes.note_ref) {
          const text = token.content;
          const footnoteRefRegex = /\[\^(\d+)\]/g;
          let lastIndex = 0;
          let match;
          
          while ((match = footnoteRefRegex.exec(text)) !== null) {
            // Add text before the footnote reference
            if (match.index > lastIndex) {
              const beforeText = text.substring(lastIndex, match.index);
              if (beforeText) {
                currentText += beforeText;
              }
            }
            
            // Flush current text if any
            if (currentText) {
              nodes.push(schema.text(currentText, marks.slice()));
              currentText = "";
            }
            
            // Create note reference node
            const noteNumber = parseInt(match[1], 10);
            const noteId = `note-${noteNumber}`; // Generate ID based on number
            const noteRef = schema.nodes.note_ref.create({ noteId, number: noteNumber });
            nodes.push(noteRef);
            
            lastIndex = match.index + match[0].length;
          }
          
          // Add remaining text after last footnote reference
          if (lastIndex < text.length) {
            currentText += text.substring(lastIndex);
          } else if (lastIndex === 0) {
            // No footnote references found, add entire text
            currentText += text;
          }
        } else {
          // No note_ref node type, just add text
          currentText += token.content;
        }
        break;

      case "image": {
        // Image: ![alt](src)
        // Images in markdown-it are inline tokens, but we'll insert them as block nodes
        if (currentText) {
          nodes.push(schema.text(currentText, marks.slice()));
          currentText = "";
        }
        if (schema.nodes.image) {
          const src = token.attrs?.find((attr: any[]) => attr[0] === "src")?.[1] || "";
          const alt = token.content || token.attrs?.find((attr: any[]) => attr[0] === "alt")?.[1] || "";
          
          if (src) {
            // Images are block-level nodes in ProseMirror
            // We'll need to handle this specially - for now, we'll skip inline images
            // and handle them at the paragraph level
            // TODO: Handle images properly - they should break out of inline context
          }
        }
        break;
      }

      default:
        // Unknown token type - just add text if available
        if (token.content) {
          currentText += token.content;
        }
        break;
    }
  }

  // Add any remaining text
  if (currentText) {
    nodes.push(schema.text(currentText, marks.slice()));
  }

  return nodes;
}

/**
 * Parses list items from tokens.
 * 
 * @param tokens - Array of tokens
 * @param start - Start index (at list_open token)
 * @param listType - Type of list ("bullet_list" or "ordered_list")
 * @param schema - The ProseMirror schema
 * @returns Array of list_item nodes
 */
function parseListItems(
  tokens: any[],
  start: number,
  listType: string,
  schema: Schema
): ProseMirrorNode[] {
  const items: ProseMirrorNode[] = [];
  let i = start + 1; // Skip list_open token
  const closeType = listType + "_close";

  while (i < tokens.length && tokens[i].type !== closeType) {
    if (tokens[i].type === "list_item_open") {
      // Parse list item content
      const content = parseBlockContent(tokens, i + 1, "list_item_close", schema);
      if (content.size > 0) {
        items.push(schema.nodes.list_item.create({}, content));
      }
      i = findClosingToken(tokens, i, "list_item_close") + 1;
    } else {
      i++;
    }
  }

  return items;
}

/**
 * Parses block content (paragraphs, headings, etc.) from tokens.
 * 
 * @param tokens - Array of tokens
 * @param start - Start index
 * @param closeType - Type of closing token
 * @param schema - The ProseMirror schema
 * @returns Fragment containing block nodes
 */
function parseBlockContent(
  tokens: any[],
  start: number,
  closeType: string,
  schema: Schema
): Fragment {
  const nodes: ProseMirrorNode[] = [];
  let i = start;

  while (i < tokens.length && tokens[i].type !== closeType) {
    const token = tokens[i];

    if (token.type === "paragraph_open") {
      const content = getInlineContent(tokens, i + 1, "paragraph_close", schema);
      nodes.push(schema.nodes.paragraph.create({}, content));
      i = findClosingToken(tokens, i, "paragraph_close") + 1;
    } else if (token.type === "heading_open") {
      const level = parseInt(token.tag.substring(1), 10);
      const content = getInlineContent(tokens, i + 1, "heading_close", schema);
      if (schema.nodes.heading) {
        nodes.push(
          schema.nodes.heading.create(
            { level: Math.min(Math.max(level, 1), 6) },
            content
          )
        );
      }
      i = findClosingToken(tokens, i, "heading_close") + 1;
    } else {
      i++;
    }
  }

  return Fragment.fromArray(nodes);
}

/**
 * Finds the closing token for an opening token.
 * 
 * @param tokens - Array of tokens
 * @param start - Index of opening token
 * @param closeType - Type of closing token to find
 * @returns Index of closing token, or tokens.length if not found
 */
function findClosingToken(tokens: any[], start: number, closeType: string): number {
  let depth = 1;
  let i = start + 1;

  while (i < tokens.length && depth > 0) {
    const token = tokens[i];
    const openType = closeType.replace("_close", "_open");
    
    if (token.type === openType) {
      depth++;
    } else if (token.type === closeType) {
      depth--;
    }
    
    if (depth === 0) {
      return i;
    }
    
    i++;
  }

  return tokens.length;
}
