import { InputRule } from "prosemirror-inputrules";
import {
  wrappingInputRule,
  textblockTypeInputRule,
} from "prosemirror-inputrules";
import { Schema, Fragment } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";

/**
 * Builds Markdown input rules for standard Markdown syntax.
 * 
 * IMPORTANT: These rules are ONLY for direct typing in the editor.
 * For paste operations, use the Markdown parser in clipboard/markdownParser.ts instead.
 * 
 * This separation is critical for performance:
 * - Input rules: Fast, lightweight, triggered on each keystroke during typing
 * - Markdown parser: More robust, handles complex structures, used only on paste
 * 
 * Block-level rules:
 * - Headings: #, ##, ###
 * - Bullet lists: -, *
 * - Ordered lists: 1.
 * - Blockquote: >
 * - Code blocks: ```language (handled by Enter key in Editor.svelte)
 * 
 * Inline rules:
 * - Bold: **text**
 * - Italic: *text*
 * - Inline code: `code`
 * - Links: [text](url)
 * - Images: ![alt](src)
 * 
 * Note: 
 * - Divider (---) is handled by Enter key handler in Editor.svelte,
 *   not as an input rule, to allow typing --- without space, then pressing Enter.
 * - Code blocks (```language) are handled by Enter key handler in Editor.svelte.
 * - Tables are complex and best handled via paste (using markdownParser) or toolbar insertion.
 */
export function buildMarkdownInputRules(schema: Schema): InputRule[] {
  const rules: InputRule[] = [];

  // Block-level rules

  // Headings: #, ##, ###, etc.
  if (schema.nodes.heading) {
    rules.push(
      textblockTypeInputRule(
        /^(#{1,6})\s$/,
        schema.nodes.heading,
        (match) => ({ level: match[1].length })
      )
    );
  }

  // Bullet lists: - or *
  if (schema.nodes.bullet_list) {
    rules.push(
      wrappingInputRule(
        /^([-*])\s$/,
        schema.nodes.bullet_list
      )
    );
  }

  // Ordered lists: 1., 2., etc.
  if (schema.nodes.ordered_list) {
    rules.push(
      wrappingInputRule(
        /^(\d+)\.\s$/,
        schema.nodes.ordered_list
      )
    );
  }

  // Blockquote: >
  if (schema.nodes.blockquote) {
    rules.push(
      wrappingInputRule(
        /^>\s$/,
        schema.nodes.blockquote
      )
    );
  }

  // Inline rules

  // Bold: **text**
  // This rule triggers when you type the closing **
  if (schema.marks.strong) {
    rules.push(
      new InputRule(/\*\*([^*]+)\*\*$/, (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
        const { tr } = state;
        const mark = schema.marks.strong.create();
        const textContent = match[1]; // The text without markers
        
        // Replace the entire match (including markers) with just the text, then apply mark
        // Delete everything from start to end
        tr.delete(start, end);
        // Insert the text content
        tr.insertText(textContent, start);
        // Apply bold mark to the inserted text
        tr.addMark(start, start + textContent.length, mark);
        return tr;
      })
    );
  }

  // Italic: *text* (but not **text** which is bold)
  // This rule triggers when you type the closing * (but not **)
  if (schema.marks.em) {
    rules.push(
      new InputRule(/(?<!\*)\*([^*\n]+)\*(?!\*)$/, (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
        const { tr } = state;
        const mark = schema.marks.em.create();
        const textContent = match[1]; // The text without markers
        
        // Replace the entire match (including markers) with just the text, then apply mark
        // Delete everything from start to end
        tr.delete(start, end);
        // Insert the text content
        tr.insertText(textContent, start);
        // Apply italic mark to the inserted text
        tr.addMark(start, start + textContent.length, mark);
        return tr;
      })
    );
  }

  // Inline code: `code`
  // This rule triggers when you type the closing `
  if (schema.marks.code) {
    rules.push(
      new InputRule(/`([^`]+)`$/, (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
        const { tr } = state;
        const mark = schema.marks.code.create();
        const textContent = match[1];
        
        // Replace the entire match with just the text, then apply mark
        tr.delete(start, end);
        tr.insertText(textContent, start);
        tr.addMark(start, start + textContent.length, mark);
        return tr;
      })
    );
  }

  // Image: ![alt](src)
  // This rule MUST come before the link rule because it's more specific (starts with !)
  // This rule triggers when you type the closing )
  if (schema.nodes.image) {
    rules.push(
      new InputRule(/!\[([^\]]*)\]\(([^)]+)\)$/, (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
        const { tr } = state;
        const alt = match[1] || "";
        const src = match[2];
        
        if (!src || !src.trim()) {
          return null; // Invalid image, don't transform
        }
        
        // Check if we're in a paragraph - if so, we need to replace the paragraph with the image
        const { $from } = state.selection;
        const paragraphNode = $from.node($from.depth);
        
        if (paragraphNode.type === schema.nodes.paragraph) {
          // Get the paragraph boundaries
          const paragraphStart = $from.before($from.depth);
          const paragraphEnd = $from.after($from.depth);
          const paragraphText = state.doc.textBetween(paragraphStart, paragraphEnd).trim();
          
          // Check if the paragraph contains only the image markdown (allowing for whitespace)
          const imageMarkdown = `![${alt}](${src})`;
          if (paragraphText === imageMarkdown || paragraphText.includes(imageMarkdown)) {
            // Replace the entire paragraph with the image node
            const imageNode = schema.nodes.image.create({ src: src.trim(), alt });
            // Also create a new paragraph after the image for continued typing
            const newParagraph = schema.nodes.paragraph.create();
            const fragment = Fragment.fromArray([imageNode, newParagraph]);
            tr.replaceWith(paragraphStart, paragraphEnd, fragment);
            // Position cursor after the image in the new paragraph
            const imagePos = paragraphStart;
            const imageEnd = imagePos + imageNode.nodeSize;
            tr.setSelection(TextSelection.near(tr.doc.resolve(imageEnd + 1)));
            return tr;
          }
        }
        
        // If we're inline or paragraph doesn't match exactly, try to replace just the markdown
        // Delete the markdown and insert image node if possible
        tr.delete(start, end);
        const imageNode = schema.nodes.image.create({ src: src.trim(), alt });
        // Try to insert the image - this might fail if we're in an invalid position
        try {
          tr.replaceWith(start, start, imageNode);
        } catch {
          // If insertion fails, just leave it deleted
        }
        return tr;
      })
    );
  }

  // Link: [text](url)
  // This rule triggers when you type the closing )
  // Must come AFTER image rule to avoid conflicts
  if (schema.marks.link) {
    rules.push(
      new InputRule(/\[([^\]]+)\]\(([^)]+)\)$/, (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
        const { tr } = state;
        const linkText = match[1];
        const url = match[2];
        
        if (!url || !url.trim()) {
          return null; // Invalid link, don't transform
        }
        
        // Replace the entire match with just the text, then apply link mark
        tr.delete(start, end);
        tr.insertText(linkText, start);
        const linkMark = schema.marks.link.create({ href: url.trim() });
        tr.addMark(start, start + linkText.length, linkMark);
        return tr;
      })
    );
  }

  // Footnote reference: [^] or [^1]
  // Note: This is handled via Enter key handler, not as an input rule
  // because it requires async dialog interaction

  // Tables are now handled via command system (@table) or header row shortcut
  // No auto-conversion of markdown table syntax while typing
  // Tables are still parsed from paste operations via markdownParser

  return rules;
}

