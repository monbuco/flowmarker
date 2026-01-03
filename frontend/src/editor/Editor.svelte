<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { EditorState } from "prosemirror-state";
    import { EditorView } from "prosemirror-view";
    import { keymap } from "prosemirror-keymap";
    import { baseKeymap, toggleMark } from "prosemirror-commands";
    import { history, undo, redo } from "prosemirror-history";
    import { columnResizing, tableEditing } from "prosemirror-tables";
    import { TextSelection } from "prosemirror-state";
    import { Fragment } from "prosemirror-model";
  
    import { schema } from "./schema";
    import { buildInputRules } from "./inputRules";
    import { parseMarkdown } from "./clipboard/markdownParser";
    import Toolbar from "./Toolbar.svelte";
    import LinkEditor from "./LinkEditor.svelte";
    import TableMenu from "./TableMenu.svelte";
    import InputDialog from "./InputDialog.svelte";
  
    let editorEl: HTMLDivElement;
    let view: EditorView | null = null;
  
    onMount(() => {
      if (!editorEl) {
        console.error("Editor element not found");
        return;
      }
      
      try {
        // Create initial document with empty paragraph
        const doc = schema.nodes.doc.create(
          {},
          schema.nodes.paragraph.create()
        );
        
        // Custom keyboard shortcuts for bold, italic, undo, and redo
        const customKeymap = {
          "Mod-b": (state: EditorState, dispatch: any) => {
            if (!schema.marks.strong) return false;
            return toggleMark(schema.marks.strong)(state, dispatch);
          },
          "Mod-i": (state: EditorState, dispatch: any) => {
            if (!schema.marks.em) return false;
            return toggleMark(schema.marks.em)(state, dispatch);
          },
          "Mod-z": undo,
          "Mod-y": redo,
          "Shift-Mod-z": redo,
          // Handle Enter key
          "Enter": (state: EditorState, dispatch: any) => {
            const { $from } = state.selection;
            
            // First, check if we're inside a code block
            let codeBlockPos = -1;
            let codeBlockNode = null;
            for (let d = $from.depth; d > 0; d--) {
              const node = $from.node(d);
              if (node.type === schema.nodes.code_block) {
                codeBlockPos = $from.before(d);
                codeBlockNode = node;
                break;
              }
            }
            
            // If we're inside a code block, handle exit logic
            if (codeBlockNode && codeBlockPos >= 0) {
              const codeBlockStart = codeBlockPos;
              const codeBlockEnd = codeBlockPos + codeBlockNode.nodeSize;
              const cursorPos = $from.pos;
              
              // Calculate position relative to code block end
              // The code block node structure: [nodeStart][content][nodeEnd]
              // content area is from codeBlockStart+1 to codeBlockEnd-1
              const contentStart = codeBlockStart + 1;
              const contentEnd = codeBlockEnd - 1;
              
              // Check if cursor is at or near the end of the code block content
              const distanceFromEnd = contentEnd - cursorPos;
              const isNearEnd = distanceFromEnd <= 1; // At the end or very close
              
              // Get the text from cursor to end of code block
              const textFromCursor = state.doc.textBetween(cursorPos, contentEnd);
              const isEmptyAtEnd = !textFromCursor.trim();
              
              // If cursor is at/near the end and there's no text after cursor, exit code block
              if (isNearEnd && isEmptyAtEnd) {
                // Check if there's already a paragraph after the code block
                const nextNode = state.doc.nodeAt(codeBlockEnd);
                if (!nextNode || nextNode.type !== schema.nodes.paragraph) {
                  // Create a new paragraph after the code block
                  const paragraph = schema.nodes.paragraph.create();
                  const tr = state.tr.insert(codeBlockEnd, paragraph);
                  tr.setSelection(TextSelection.near(tr.doc.resolve(codeBlockEnd + 1)));
                  if (dispatch) dispatch(tr);
                  return true;
                } else {
                  // Move to the existing paragraph after the code block
                  const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(codeBlockEnd + 1)));
                  if (dispatch) dispatch(tr);
                  return true;
                }
              }
              
              // If inside code block but not at end, allow normal newline (default behavior)
              // Don't return true, let the default Enter behavior create a newline inside code block
              return false;
            }
            
            // Check if current line is "---" and convert to horizontal rule
            let lineStart = $from.start($from.depth);
            let lineEnd = $from.end($from.depth);
            let lineText = state.doc.textBetween(lineStart, lineEnd).trim();
            
            // Check for fenced code block: ```language
            const codeBlockMatch = lineText.match(/^```(\w*)$/);
            if (codeBlockMatch) {
              const paragraphNode = $from.node($from.depth);
              if (paragraphNode.type === schema.nodes.paragraph) {
                const language = codeBlockMatch[1] || null;
                const paragraphStart = $from.before($from.depth);
                const paragraphEnd = $from.after($from.depth);
                
                // Create code_block - create it empty, cursor will be positioned inside
                const attrs: any = {};
                if (language) {
                  attrs.language = language;
                }
                // Create code block without initial content - user will type into it
                const codeBlock = schema.nodes.code_block.create(attrs);
                const newParagraph = schema.nodes.paragraph.create();
                const fragment = Fragment.fromArray([codeBlock, newParagraph]);
                const tr = state.tr.replaceWith(paragraphStart, paragraphEnd, fragment);
                const updatedDoc = tr.doc;
                const codeBlockNode = updatedDoc.nodeAt(paragraphStart);
                if (codeBlockNode && codeBlockNode.type === schema.nodes.code_block) {
                  // Position cursor INSIDE the code block
                  // The code block node is at paragraphStart
                  // We need to position at the start of the content area inside the code block
                  // For a node with content: "text*", the content area starts at nodePos + 1
                  const codeBlockPos = paragraphStart;
                  // Resolve to inside the code block - this gives us a position where we can insert text
                  const codeBlockResolved = updatedDoc.resolve(codeBlockPos);
                  // Find the position inside the code block where text can be inserted
                  // This is typically codeBlockPos + 1 (after the node start marker)
                  const insidePos = codeBlockPos + 1;
                  // Use TextSelection.create to position cursor at the start of the code block content
                  tr.setSelection(TextSelection.create(updatedDoc, insidePos));
                }
                if (dispatch) dispatch(tr);
                return true;
              }
            }
            
            if (lineText === "---" && schema.nodes.horizontal_rule) {
              // Find the paragraph node that contains "---"
              const paragraphNode = $from.node($from.depth);
              if (paragraphNode.type === schema.nodes.paragraph) {
                const hr = schema.nodes.horizontal_rule.create();
                const newParagraph = schema.nodes.paragraph.create();
                // Replace the entire paragraph node with horizontal rule and new paragraph
                // We need to replace from before the paragraph to after it
                const paragraphStart = $from.before($from.depth);
                const paragraphEnd = $from.after($from.depth);
                // Create fragment with horizontal rule and new paragraph
                const fragment = Fragment.fromArray([hr, newParagraph]);
                const tr = state.tr.replaceWith(paragraphStart, paragraphEnd, fragment);
                // Position cursor at the start of the new paragraph
                const updatedDoc = tr.doc;
                // Find where the horizontal rule ends
                const hrNode = updatedDoc.nodeAt(paragraphStart);
                if (hrNode && hrNode.type === schema.nodes.horizontal_rule) {
                  const hrEnd = paragraphStart + hrNode.nodeSize;
                  const cursorPos = hrEnd + 1;
                  tr.setSelection(TextSelection.near(updatedDoc.resolve(cursorPos)));
                }
                if (dispatch) dispatch(tr);
                return true;
              }
            }

            // Command-based table insertion
            // Check for @table command or header row shortcut
            if (!view) return false;
            
            // Check for @table command
            if (lineText === "@table" && schema.nodes.table) {
              // Handle async command - schedule it
              (async () => {
                const { processCommand } = await import("./commands");
                await processCommand(view, "table");
              })();
              // Return true to prevent default Enter behavior
              return true;
            }
            
            // Check for header row shortcut: | header | header | + Enter
            // This opens the table dialog with column count pre-filled
            const tableHeaderPattern = /^\|.+\|/;
            if (tableHeaderPattern.test(lineText) && schema.nodes.table) {
              // Count columns from the header row
              const cells = lineText.split('|').map(c => c.trim()).filter(c => c);
              if (cells.length >= 2) {
                const paragraphNode = $from.node($from.depth);
                if (paragraphNode.type === schema.nodes.paragraph) {
                  const paragraphStart = $from.before($from.depth);
                  const paragraphEnd = $from.after($from.depth);
                  // Handle async command - schedule it
                  (async () => {
                    const { insertTableFromHeaderRow } = await import("./commands");
                    await insertTableFromHeaderRow(view, cells.length, paragraphStart, paragraphEnd);
                  })();
                  // Return true to prevent default Enter behavior
                  return true;
                }
              }
            }
            
            // Find table node
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
            
            if (tableNode && tablePos >= 0) {
              const tableEnd = tablePos + tableNode.nodeSize;
              // Check if cursor is near the end of the table
              if ($from.pos >= tableEnd - 5) {
                // Check if there's already a paragraph after the table
                const nextNode = state.doc.nodeAt(tableEnd);
                if (!nextNode || nextNode.type !== schema.nodes.paragraph) {
                  // Create a new paragraph after the table
                  const paragraph = schema.nodes.paragraph.create();
                  const tr = state.tr.insert(tableEnd, paragraph);
                  tr.setSelection(TextSelection.near(tr.doc.resolve(tableEnd + 1)));
                  if (dispatch) dispatch(tr);
                  return true;
                } else {
                  // Move to the existing paragraph
                  const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(tableEnd + 1)));
                  if (dispatch) dispatch(tr);
                  return true;
                }
              }
            }
            return false; // Let default behavior handle it
          },
          // Handle ArrowDown at the end of a table
          "ArrowDown": (state: EditorState, dispatch: any) => {
            const { $from } = state.selection;
            // Find table node
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
            
            if (tableNode && tablePos >= 0) {
              const tableEnd = tablePos + tableNode.nodeSize;
              // Check if cursor is near the end of the table
              if ($from.pos >= tableEnd - 5) {
                // Check if there's a paragraph after the table
                const nextNode = state.doc.nodeAt(tableEnd);
                if (nextNode && nextNode.type === schema.nodes.paragraph) {
                  // Move to the paragraph after the table
                  const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(tableEnd + 1)));
                  if (dispatch) dispatch(tr);
                  return true;
                } else {
                  // Create a new paragraph after the table
                  const paragraph = schema.nodes.paragraph.create();
                  const tr = state.tr.insert(tableEnd, paragraph);
                  tr.setSelection(TextSelection.near(tr.doc.resolve(tableEnd + 1)));
                  if (dispatch) dispatch(tr);
                  return true;
                }
              }
            }
            return false; // Let default behavior handle it
          },
        };

        const state = EditorState.create({
          doc,
          schema,
          plugins: [
            buildInputRules(schema, { markdown: true, flowmark: false }),
            keymap(customKeymap),
            keymap(baseKeymap),
            history(),
            columnResizing(),
            tableEditing(),
          ],
        });
  
        view = new EditorView(editorEl, {
          state,
          handleDOMEvents: {
            click: (view, event) => {
              // Prevent default link navigation - allow editing instead
              const target = event.target as HTMLElement;
              if (target.tagName === 'A') {
                event.preventDefault();
                // Focus the editor to allow editing
                view.focus();
                return true;
              }
              return false;
            },
            mousemove: (view, event) => {
              // Update state on mouse move to detect link hover
              const target = event.target as HTMLElement;
              if (target.tagName === 'A') {
                // Trigger state update to show link editor
                return false;
              }
              return false;
            },
            paste: (view, event) => {
              // IMPORTANT: Separation of concerns for performance
              // - Input rules: Only for direct typing (handled by inputRules plugin)
              // - Markdown parser: Only for paste operations (handled here)
              // We prevent default paste behavior and manually insert parsed content
              // to ensure input rules are NOT triggered during paste operations.
              
              const clipboardData = event.clipboardData;
              if (!clipboardData) return false;

              const text = clipboardData.getData('text/plain');
              if (!text) return false;

              // Check if the text looks like Markdown
              const looksLikeMarkdown = /^[#*\-`\[\]>\d]/.test(text.trim()) || 
                                       /\*\*.*\*\*|`.*`|\[.*\]\(.*\)/.test(text);

              if (looksLikeMarkdown) {
                // Prevent default paste behavior to bypass input rules
                event.preventDefault();
                
                // Use the Markdown parser (NOT input rules) to convert markdown to ProseMirror nodes
                const slice = parseMarkdown(text, schema);
                if (slice) {
                  const { state, dispatch } = view;
                  const { from, to } = state.selection;
                  
                  // Directly insert the parsed slice using a manual transaction
                  // This bypasses input rules because input rules only trigger on actual text input events,
                  // not on programmatic transactions created via tr.replaceRange()
                  const tr = state.tr.replaceRange(from, to, slice);
                  dispatch(tr);
                  return true; // Indicate we handled the paste
                }
              }

              // For non-markdown content, let default paste behavior handle it
              // This will insert plain text, which may trigger input rules for direct typing patterns
              return false;
            },
          },
        });

        // Ensure the editor container is visible
        if (editorEl) {
          editorEl.style.display = "block";
          editorEl.style.visibility = "visible";
        }

        // Focus the editor after a short delay to ensure it's rendered
        setTimeout(() => {
          if (view) {
            view.focus();
          }
        }, 100);

        console.log("ProseMirror editor initialized successfully", {
          editorEl,
          view,
          dom: view?.dom,
        });
      } catch (error) {
        console.error("Error initializing ProseMirror editor:", error);
      }
    });

    onDestroy(() => {
      if (view) {
        view.destroy();
        view = null;
      }
    });
  </script>
  
  <div class="editor-wrapper">
    <Toolbar {view} />
    <div class="editor">
      <div bind:this={editorEl} class="editor-container">
        {#if view}
          <LinkEditor {view} />
          <TableMenu {view} />
          <InputDialog />
        {/if}
      </div>
    </div>
  </div>
  
  
<style>
.editor-wrapper {
  width: 100%;
  min-height: 100vh;
  background-color: #ffffff;
  color: #000000;
}

.editor {
  max-width: 816px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 96px 96px 96px 96px;
  padding-top: 120px; /* Add extra padding at top to account for fixed toolbar */
  background-color: #ffffff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
}

.editor-container {
  min-height: 400px;
  width: 100%;
  position: relative;
  display: block;
}

:global(.editor-container > .ProseMirror) {
  min-height: 400px;
  padding: 0;
  outline: none;
  cursor: text;
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 16px;
  line-height: 1.6;
  color: #000000;
  background-color: #ffffff;
  display: block;
  width: 100%;
}

:global(.editor-container .ProseMirror:focus) {
  outline: none;
}

:global(.editor-container .ProseMirror p) {
  margin: 0;
  padding: 0;
  min-height: 1.6em;
}

:global(.editor-container .ProseMirror p.is-empty::before) {
  content: attr(data-placeholder);
  float: left;
  color: #999;
  pointer-events: none;
  height: 0;
}

:global(.editor-container .ProseMirror h1),
:global(.editor-container .ProseMirror h2),
:global(.editor-container .ProseMirror h3),
:global(.editor-container .ProseMirror h4),
:global(.editor-container .ProseMirror h5),
:global(.editor-container .ProseMirror h6) {
  font-weight: 600;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  line-height: 1.3;
}

:global(.editor-container .ProseMirror h1) {
  font-size: 2em;
}

:global(.editor-container .ProseMirror h2) {
  font-size: 1.5em;
}

:global(.editor-container .ProseMirror h3) {
  font-size: 1.25em;
}

:global(.editor-container .ProseMirror ul),
:global(.editor-container .ProseMirror ol) {
  padding-left: 2em;
  margin: 0.5em 0;
}

:global(.editor-container .ProseMirror li) {
  margin: 0.25em 0;
}

:global(.editor-container .ProseMirror hr) {
  border: none;
  border-top: 2px solid rgba(0, 0, 0, 0.1);
  margin: 2em 0;
}

:global(.editor-container .ProseMirror a) {
  color: #0066cc;
  text-decoration: underline;
  cursor: pointer;
}

:global(.editor-container .ProseMirror a:hover) {
  color: #0052a3;
  text-decoration: underline;
}

:global(.editor-container .ProseMirror table) {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
}

:global(.editor-container .ProseMirror table td),
:global(.editor-container .ProseMirror table th) {
  border: 1px solid rgba(0, 0, 0, 0.1);
  padding: 8px 12px;
  min-width: 100px;
}

:global(.editor-container .ProseMirror table th) {
  background-color: rgba(0, 0, 0, 0.05);
  font-weight: 600;
}

:global(.editor-container .ProseMirror table .selectedCell) {
  background-color: rgba(0, 102, 204, 0.1);
}

@media (prefers-color-scheme: dark) {
  .editor-wrapper {
    background-color: #1a1a1a;
  }
  
  .editor {
    background-color: #1a1a1a;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1);
  }
  
  :global(.editor-container .ProseMirror) {
    color: #e0e0e0;
    background-color: #1a1a1a;
  }
}
</style>
  