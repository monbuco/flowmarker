<script lang="ts">
  import { EditorView } from "prosemirror-view";
  import { EditorState } from "prosemirror-state";
  import { Pencil, Trash2 } from "lucide-svelte";
  import { schema } from "./schema";
  import { getNoteContent } from "./notes";
  import { editNote, deleteNote } from "./commands";

  let { view }: { view: EditorView | null } = $props();
  
  let editorState: EditorState | null = $state(null);

  let noteId = $state<string | null>(null);
  let noteContent = $state("");
  let noteNumber = $state(0);
  let isVisible = $state(false);
  let position = $state({ top: 0, left: 0 });
  let hoverTimeout: number | null = null;

  function updateNoteInfo(targetNoteId: string | null, targetElement: HTMLElement | null) {
    if (!view || !targetNoteId) {
      isVisible = false;
      noteId = null;
      return;
    }

    // Get fresh state
    const currentState = view.state;
    const content = getNoteContent(currentState.doc, currentState.schema, targetNoteId);
    
    // Show popover even if content is empty (content can be null or empty string)
    noteId = targetNoteId;
    noteContent = content || "";
    
    // Find the note reference to get its number
    const { doc, schema } = currentState;
    let foundNumber = 1;
    doc.descendants((node, pos) => {
      if (node.type === schema.nodes.note_ref && node.attrs.noteId === targetNoteId) {
        foundNumber = node.attrs.number || 1;
      }
    });
    noteNumber = foundNumber;

    // Get position of the note reference element relative to editor container
    if (targetElement) {
      // Find the editor-container parent
      const editorContainer = view.dom.closest('.editor-container') as HTMLElement;
      if (editorContainer) {
        const containerRect = editorContainer.getBoundingClientRect();
        const elementRect = targetElement.getBoundingClientRect();
        
        position = {
          top: elementRect.bottom - containerRect.top + 5,
          left: elementRect.left - containerRect.left,
        };
        isVisible = true;
      } else {
        // Fallback: use view.dom
        const viewRect = view.dom.getBoundingClientRect();
        const elementRect = targetElement.getBoundingClientRect();
        
        position = {
          top: elementRect.bottom - viewRect.top + 5,
          left: elementRect.left - viewRect.left,
        };
        isVisible = true;
      }
    }
  }

  function handleEdit() {
    if (!view || !noteId) return;
    
    (async () => {
      await editNote(view, noteId);
      // After editing, update the popover content
      if (view && editorState) {
        const content = getNoteContent(editorState.doc, editorState.schema, noteId);
        if (content !== null) {
          noteContent = content;
        }
      }
    })();
  }

  function handleDelete() {
    if (!view || !noteId) return;
    
    if (confirm("Delete this note? This will remove the note reference and its content.")) {
      deleteNote(view, noteId);
      // Hide popover after deletion
      isVisible = false;
      noteId = null;
    }
  }

  // Update state when view changes
  $effect(() => {
    if (!view) {
      editorState = null;
      isVisible = false;
      return;
    }

    editorState = view.state;

    // Set up hover tracking on note references using mouseover/mouseout
    // These events bubble, unlike mouseenter/mouseleave
    let currentHoveredNoteId: string | null = null;
    
    const handleMouseOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const noteRefElement = target.closest('[data-note-ref]') as HTMLElement | null;
      
      if (noteRefElement) {
        const targetNoteId = noteRefElement.getAttribute('data-note-id');
        if (targetNoteId && targetNoteId !== currentHoveredNoteId) {
          currentHoveredNoteId = targetNoteId;
          
          // Clear any existing timeout
          if (hoverTimeout !== null) {
            clearTimeout(hoverTimeout);
          }
          
          // Small delay to prevent flickering
          hoverTimeout = window.setTimeout(() => {
            updateNoteInfo(targetNoteId, noteRefElement);
          }, 100);
        }
      } else {
        // Check if we're entering the popover
        const popoverElement = target.closest('.note-popover');
        if (!popoverElement) {
          // Not hovering over note ref or popover - clear hover state
          currentHoveredNoteId = null;
        }
      }
    };

    const handleMouseOut = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const relatedTarget = event.relatedTarget as HTMLElement | null;
      
      // Check if we're leaving a note reference
      const noteRefElement = target.closest('[data-note-ref]');
      const enteringPopover = relatedTarget?.closest('.note-popover');
      const enteringNoteRef = relatedTarget?.closest('[data-note-ref]');
      
      // Only hide if we're leaving a note reference and not entering the popover or another note ref
      if (noteRefElement && !enteringPopover && !enteringNoteRef) {
        currentHoveredNoteId = null;
        
        // Clear timeout if mouse leaves before delay
        if (hoverTimeout !== null) {
          clearTimeout(hoverTimeout);
        }
        
        // Hide popover after a short delay (to allow moving to popover)
        hoverTimeout = window.setTimeout(() => {
          isVisible = false;
          noteId = null;
        }, 150);
      }
    };

    // Add event listeners to editor DOM using capture phase
    // This ensures we catch events before ProseMirror processes them
    view.dom.addEventListener("mouseover", handleMouseOver, true);
    view.dom.addEventListener("mouseout", handleMouseOut, true);

    // Track state changes to update note content
    const scheduleUpdate = () => {
      requestAnimationFrame(() => {
        if (view && editorState && noteId) {
          editorState = view.state;
          const content = getNoteContent(editorState.doc, editorState.schema, noteId);
          if (content !== null) {
            noteContent = content;
          }
        }
      });
    };

    view.dom.addEventListener("selectionchange", scheduleUpdate);
    view.dom.addEventListener("keyup", scheduleUpdate);
    view.dom.addEventListener("input", scheduleUpdate);

    return () => {
      view?.dom.removeEventListener("mouseover", handleMouseOver, true);
      view?.dom.removeEventListener("mouseout", handleMouseOut, true);
      view?.dom.removeEventListener("selectionchange", scheduleUpdate);
      view?.dom.removeEventListener("keyup", scheduleUpdate);
      view?.dom.removeEventListener("input", scheduleUpdate);
      if (hoverTimeout !== null) {
        clearTimeout(hoverTimeout);
      }
    };
  });
</script>

{#if isVisible && view && editorState && noteId !== null}
  <div
    class="note-popover"
    style="top: {position.top}px; left: {position.left}px;"
    role="tooltip"
    onmouseenter={() => {
      if (hoverTimeout !== null) clearTimeout(hoverTimeout);
    }}
    onmouseleave={() => {
      hoverTimeout = window.setTimeout(() => {
        isVisible = false;
        noteId = null;
      }, 200);
    }}
  >
    <div class="note-preview">
      <div class="note-content-text">
        <span class="note-number">{noteNumber}.</span>
        <span class="note-text">{noteContent || "(empty note)"}</span>
      </div>
      <div class="note-actions">
        <button class="note-edit-btn" onclick={handleEdit} title="Edit note">
          <Pencil size={14} />
        </button>
        <button class="note-delete-btn" onclick={handleDelete} title="Delete note">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .note-popover {
    position: absolute;
    z-index: 1000;
    background: white;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    padding: 10px 12px;
    font-size: 13px;
    min-width: 200px;
    max-width: 400px;
    pointer-events: auto;
  }

  .note-preview {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .note-content-text {
    flex: 1;
    display: flex;
    align-items: flex-start;
    gap: 6px;
    color: #333;
    line-height: 1.5;
  }

  .note-number {
    font-weight: 500;
    color: #666;
    flex-shrink: 0;
  }

  .note-text {
    flex: 1;
    word-wrap: break-word;
  }

  .note-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .note-edit-btn,
  .note-delete-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px 6px;
    font-size: 14px;
    border-radius: 3px;
    transition: background-color 0.1s;
    display: flex;
    align-items: center;
    justify-content: center;
    color: currentColor;
  }

  .note-edit-btn :global(svg),
  .note-delete-btn :global(svg) {
    stroke: currentColor;
    fill: none;
  }

  .note-edit-btn:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }

  .note-delete-btn:hover {
    background-color: rgba(220, 38, 38, 0.1);
    color: #dc2626;
  }

  @media (prefers-color-scheme: dark) {
    .note-popover {
      background: #1a1a1a;
      border-color: rgba(255, 255, 255, 0.1);
    }

    .note-content-text {
      color: #e0e0e0;
    }

    .note-number {
      color: #999;
    }

    .note-edit-btn:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }
  }
</style>

