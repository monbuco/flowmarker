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
    import { splitListItem, liftListItem } from "prosemirror-schema-list";
  
    import { schema } from "./schema";
    import { buildInputRules } from "./inputRules";
    import { notePlugin } from "./notePlugin";
    import Toolbar from "./Toolbar.svelte";
    import AppMenu from "./AppMenu.svelte";
    import LinkEditor from "./LinkEditor.svelte";
    import TableMenu from "./TableMenu.svelte";
    import InputDialog from "./InputDialog.svelte";
    import NotePopover from "./NotePopover.svelte";
    import NotesSection from "./NotesSection.svelte";
    import { autosavePlugin } from "../lib/persistence/autosavePlugin";
    import { saveDocument, openFile } from "../lib/persistence/fileIO";
    import { deserializeDocument } from "../lib/persistence/serializer";
    import { setNote, clearNotes } from "./notesStore";
    import { Node } from "prosemirror-model";
  
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
          // Handle Shift+Enter for line breaks (let default behavior handle it)
          "Shift-Enter": (state: EditorState, dispatch: any) => {
            // Return false to allow default behavior (insert hard break/newline)
            return false;
          },
          // Markdown operations
          "Shift-Mod-v": (state: EditorState, dispatch: any) => {
            if (!view) return false;
            // Handle async command - schedule it
            (async () => {
              const { pasteFromMarkdown } = await import("./toolbar");
              await pasteFromMarkdown(view);
            })();
            return true; // Prevent default paste
          },
          "Shift-Mod-c": (state: EditorState, dispatch: any) => {
            if (!view) return false;
            // Handle async command - schedule it
            (async () => {
              const { copyAsMarkdown } = await import("./toolbar");
              await copyAsMarkdown(view);
            })();
            return true; // Prevent default copy
          },
          // Save document (Ctrl+S / Cmd+S)
          "Mod-s": (state: EditorState, dispatch: any) => {
            if (!view) return false;
            // Prevent browser default save
            (async () => {
              try {
                await saveDocument(state);
              } catch (error) {
                console.error("Error saving document:", error);
              }
            })();
            return true; // Prevent default browser save
          },
          // Handle Enter key
          "Enter": (state: EditorState, dispatch: any) => {
            const { $from } = state.selection;
            
            // First, check if we're inside a list item
            let listItemDepth = -1;
            for (let d = $from.depth; d > 0; d--) {
              const node = $from.node(d);
              if (node.type === schema.nodes.list_item) {
                listItemDepth = d;
                break;
              }
            }
            
            // If we're inside a list item
            if (listItemDepth >= 0) {
              // Get the list item node to check its content
              const listItemNode = $from.node(listItemDepth);
              const listItemStart = $from.start(listItemDepth);
              const listItemEnd = $from.end(listItemDepth);
              
              // Get text content of the entire list item (including nested content)
              const listItemText = state.doc.textBetween(listItemStart + 1, listItemEnd - 1).trim();
              
              // Check if the list item is empty (no text content)
              if (listItemText === "") {
                // Empty list item - exit the list (lift out)
                const liftCommand = liftListItem(schema.nodes.list_item);
                if (liftCommand(state, dispatch)) {
                  return true;
                }
              } else {
                // Non-empty list item - split it to create a new item
                const splitCommand = splitListItem(schema.nodes.list_item);
                if (splitCommand(state, dispatch)) {
                  return true;
                }
              }
            }
            
            // Check if we're inside a code block
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
            let lineText = state.doc.textBetween(lineStart, lineEnd);
            let lineTextTrimmed = lineText.trim();
            
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
            
            if (lineTextTrimmed === "---" && schema.nodes.horizontal_rule) {
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
            if (lineTextTrimmed === "@table" && schema.nodes.table) {
              // Handle async command - schedule it
              setTimeout(async () => {
                if (view) {
                  const { processCommand } = await import("./commands");
                  await processCommand(view, "table");
                }
              }, 0);
              // Return true to prevent default Enter behavior
              return true;
            }
            
            // Check for @note command - can be anywhere in the line
            if (schema.nodes.note_ref && view) {
              // Check if lineText contains @note (can be inline or standalone)
              if (lineText.includes("@note")) {
                // Use regex to find @note with word boundary to avoid matching partial words
                const noteCommandPattern = /@note\b/;
                const noteCommandMatch = lineText.match(noteCommandPattern);
                if (noteCommandMatch && noteCommandMatch.index !== undefined) {
                  console.log("[@note] Command detected, processing...");
                  // Delete @note text immediately - find exact position
                  // Use start/end of the current depth (paragraph content)
                  const paragraphStart = $from.start($from.depth);
                  const paragraphEnd = $from.end($from.depth);
                  const fullParagraphText = state.doc.textBetween(paragraphStart, paragraphEnd);
                  console.log("[@note] Full paragraph text:", JSON.stringify(fullParagraphText), "paragraphStart:", paragraphStart, "paragraphEnd:", paragraphEnd);
                  // Find the exact match position - search for "@note" starting from the match index
                  const matchIndex = fullParagraphText.indexOf("@note", noteCommandMatch.index);
                  if (matchIndex >= 0) {
                    const matchStart = paragraphStart + matchIndex;
                    const matchEnd = matchStart + 5; // "@note" is exactly 5 characters
                    // Verify we're deleting the right text - use the same method as fullParagraphText
                    const textToDelete = state.doc.textBetween(matchStart, matchEnd);
                    console.log("[@note] Text to delete:", JSON.stringify(textToDelete), "matchStart:", matchStart, "matchEnd:", matchEnd, "length:", textToDelete.length);
                    // Check if it's exactly @note
                    if (textToDelete === "@note") {
                      // Delete @note and position cursor at deletion point
                      const tr = state.tr.delete(matchStart, matchEnd);
                      // Position cursor at the deletion point
                      tr.setSelection(TextSelection.near(tr.doc.resolve(matchStart)));
                      if (dispatch) {
                        dispatch(tr);
                        console.log("[@note] Transaction dispatched");
                      }
                      // Handle async command - use requestAnimationFrame + setTimeout to ensure DOM is updated
                      console.log("[@note] Scheduling insertNote...");
                      requestAnimationFrame(() => {
                        setTimeout(() => {
                          console.log("[@note] setTimeout callback executing, view exists:", !!view);
                          if (view) {
                            (async () => {
                              try {
                                console.log("[@note] Importing insertNote...");
                                const { insertNote } = await import("./commands");
                                console.log("[@note] Calling insertNote...");
                                const result = await insertNote(view);
                                console.log("[@note] insertNote completed, result:", result);
                              } catch (error) {
                                console.error("[@note] Error in insertNote:", error);
                                console.error("[@note] Error stack:", error instanceof Error ? error.stack : "No stack");
                              }
                            })();
                          } else {
                            console.error("[@note] View is null!");
                          }
                        }, 50);
                      });
                      // Return true to prevent default Enter behavior
                      return true;
                    } else {
                      console.log("[@note] Text mismatch, expected '@note', got:", JSON.stringify(textToDelete));
                    }
                  } else {
                    console.log("[@note] Could not find @note in paragraph text");
                  }
                  // Return true to prevent default Enter behavior even if deletion failed
                  return true;
                }
              }
              
              // Check for footnote syntax: [^] or [^1] anywhere in the line
              const footnotePattern = /\[\^([^\]]*)\]/;
              const footnoteMatch = lineText.match(footnotePattern);
              if (footnoteMatch && footnoteMatch.index !== undefined) {
                const paragraphNode = $from.node($from.depth);
                if (paragraphNode.type === schema.nodes.paragraph) {
                  const paragraphStart = $from.start($from.depth);
                  const paragraphEnd = $from.end($from.depth);
                  const fullParagraphText = state.doc.textBetween(paragraphStart, paragraphEnd);
                  // Find the exact match position
                  const matchIndex = fullParagraphText.indexOf(footnoteMatch[0], footnoteMatch.index);
                  if (matchIndex >= 0) {
                    const matchStart = paragraphStart + matchIndex;
                    const matchEnd = matchStart + footnoteMatch[0].length;
                    // Verify we're deleting the right text (should be [^...])
                    const textToDelete = state.doc.textBetween(matchStart, matchEnd);
                    if (textToDelete === footnoteMatch[0]) {
                      // Delete the [^...] text immediately (including brackets)
                      const tr = state.tr.delete(matchStart, matchEnd);
                      // Position cursor at the deletion point
                      tr.setSelection(TextSelection.near(tr.doc.resolve(matchStart)));
                      if (dispatch) {
                        dispatch(tr);
                      }
                      // Handle async command - use setTimeout to ensure it runs after dispatch
                      setTimeout(() => {
                        if (view) {
                          (async () => {
                            try {
                              console.log("Calling insertNote from footnote...");
                              const { insertNote } = await import("./commands");
                              const result = await insertNote(view);
                              console.log("insertNote result:", result);
                            } catch (error) {
                              console.error("Error inserting note:", error);
                            }
                          })();
                        }
                      }, 100);
                      // Return true to prevent default Enter behavior
                      return true;
                    }
                  }
                  // Return true to prevent default Enter behavior
                  return true;
                }
              }
            }
            
            // Check for header row shortcut: | header | header | + Enter
            // This opens the table dialog with column count pre-filled
            const tableHeaderPattern = /^\|.+\|/;
            if (tableHeaderPattern.test(lineTextTrimmed) && schema.nodes.table) {
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
            notePlugin(),
            autosavePlugin(),
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
              // Plain paste - no Markdown parsing
              // Markdown parsing is now explicit via "Paste MD" action
              // Let ProseMirror handle default paste behavior
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

    /**
     * Load document from .flm file
     */
    async function loadDocument() {
      if (!view) return;
      
      try {
        const doc = await openFile();
        if (!doc) return; // User cancelled

        // Deserialize document
        const { doc: docJSON, notes } = deserializeDocument(doc);

        // Create ProseMirror node from JSON
        const newDoc = Node.fromJSON(schema, docJSON);

        // Update editor state
        const newState = EditorState.create({
          doc: newDoc,
          schema,
          plugins: view.state.plugins,
        });

        // Apply new state
        view.updateState(newState);

        // Load notes into store
        clearNotes();
        if (notes) {
          notes.forEach((note) => {
            setNote({
              noteId: note.noteId,
              content: note.content,
              number: note.number,
            });
          });
        }

        // Trigger renumbering to ensure notes are in sync
        if (notes && notes.length > 0) {
          // Import and call renumber function
          const { renumberNotes } = await import("./notes");
          renumberNotes(view.state);
        }
      } catch (error) {
        console.error("Error loading document:", error);
      }
    }

    // Expose load function globally for menu/toolbar (optional)
    if (typeof window !== "undefined") {
      (window as any).loadFlowmarkDocument = loadDocument;
    }

    onDestroy(() => {
      if (view) {
        view.destroy();
        view = null;
      }
    });
  </script>
  
  <div class="editor-wrapper">
    <AppMenu {view} />
    <Toolbar {view} />
    <div class="editor">
      <div bind:this={editorEl} class="editor-container">
        {#if view}
          <LinkEditor {view} />
          <TableMenu {view} />
          <InputDialog />
          <NotePopover {view} />
        {/if}
      </div>
      <div class="notes-wrapper">
        {#if view}
          <NotesSection {view} />
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
  padding-top: 152px; /* Add extra padding at top to account for AppMenu (32px) + Toolbar (120px) */
  background-color: #ffffff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
}

.editor-container {
  min-height: 400px;
  width: 100%;
  position: relative;
  display: block;
}

.notes-wrapper {
  margin-top: auto;
  padding-top: 2em;
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

:global(.editor-container .ProseMirror sup.note-ref) {
  vertical-align: super;
  font-size: 0.75em;
  line-height: 0;
  position: relative;
  top: -0.5em;
  color: #666;
  cursor: pointer;
  user-select: none;
  font-weight: 500;
  transition: color 0.15s ease;
}

:global(.editor-container .ProseMirror sup.note-ref:hover) {
  color: #333;
  text-decoration: none;
}

/* Note highlighting animation */
:global(.note-highlight) {
  animation: noteHighlight 2s ease-in-out;
  background-color: rgba(255, 255, 0, 0.2);
  border-radius: 2px;
  padding: 2px 4px;
  margin: -2px -4px;
}

@keyframes noteHighlight {
  0% {
    background-color: rgba(255, 255, 0, 0);
  }
  25% {
    background-color: rgba(255, 255, 0, 0.3);
  }
  50% {
    background-color: rgba(255, 255, 0, 0.2);
  }
  100% {
    background-color: rgba(255, 255, 0, 0);
  }
}

@media (prefers-color-scheme: dark) {
  :global(.note-highlight) {
    background-color: rgba(255, 255, 0, 0.15);
  }
  
  @keyframes noteHighlight {
    0% {
      background-color: rgba(255, 255, 0, 0);
    }
    25% {
      background-color: rgba(255, 255, 0, 0.25);
    }
    50% {
      background-color: rgba(255, 255, 0, 0.15);
    }
    100% {
      background-color: rgba(255, 255, 0, 0);
    }
  }
}

/* Note: note-content styles removed - notes are now rendered outside ProseMirror */

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
  
  :global(.editor-container .ProseMirror sup.note-ref) {
    color: #999;
  }
  
  :global(.editor-container .ProseMirror sup.note-ref:hover) {
    color: #ccc;
  }
}
</style>
  