<script lang="ts">
  import { EditorView } from "prosemirror-view";
  import { notesStore, type Note } from "./notesStore";
  import { findNoteReferences } from "./notes";
  import { schema } from "./schema";
  import { scrollToNoteReference, updateNotePositions } from "./noteNavigation";

  let { view }: { view: EditorView | null } = $props();
  
  let notes: Note[] = $state([]);
  
  function handleBackReference(noteId: string, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (view) {
      scrollToNoteReference(noteId, view);
    }
  }

  // Subscribe to notes store and update when document changes
  $effect(() => {
    if (!view) {
      notes = [];
      return;
    }

    const updateNotes = () => {
      if (!view) return;
      
      const { doc } = view.state;
      const refs = findNoteReferences(doc, schema);
      
      // Get unique note IDs in document order (preserving order)
      const noteIdsInOrder: string[] = [];
      const seen = new Set<string>();
      for (const ref of refs) {
        if (!seen.has(ref.noteId)) {
          seen.add(ref.noteId);
          noteIdsInOrder.push(ref.noteId);
        }
      }
      
      // Get notes from store
      let notesMap: Map<string, Note> = new Map();
      const unsubscribe = notesStore.subscribe((store) => {
        notesMap = store;
      });
      
      // Filter to only notes that exist in the document and renumber
      const activeNotes = noteIdsInOrder
        .map((noteId, index) => {
          const note = notesMap.get(noteId);
          if (note) {
            return { ...note, number: index + 1 };
          }
          return null;
        })
        .filter((note): note is Note => note !== null);
      
      notes = activeNotes;
      unsubscribe();
    };

    // Initial update
    updateNotes();

    // Update when document changes
    const handleUpdate = () => {
      requestAnimationFrame(() => {
        updateNotes();
        // Also update note positions when document changes
        updateNotePositions(view);
      });
    };

    view.dom.addEventListener("input", handleUpdate);
    view.dom.addEventListener("selectionchange", handleUpdate);

    // Also subscribe to notes store changes
    const unsubscribeStore = notesStore.subscribe(() => {
      updateNotes();
    });

    return () => {
      view?.dom.removeEventListener("input", handleUpdate);
      view?.dom.removeEventListener("selectionchange", handleUpdate);
      unsubscribeStore();
    };
  });
</script>

{#if notes.length > 0}
  <div class="notes-section">
    <hr class="notes-divider" />
    <div class="notes-list">
      {#each notes as note (note.noteId)}
        <div class="note-item" data-note-id={note.noteId}>
          <span class="note-number">{note.number}.</span>
          <span class="note-text">{note.content || "(empty note)"}</span>
          <button
            class="back-reference"
            on:click={(e) => handleBackReference(note.noteId, e)}
            title="Go back to reference in text"
            aria-label="Go back to reference in text"
          >
            ↩
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .notes-section {
    margin-top: auto;
    padding-top: 2em;
    user-select: none;
    /* Allow pointer events for back-reference buttons */
    pointer-events: auto;
  }

  .notes-divider {
    border: none;
    border-top: 2px solid rgba(0, 0, 0, 0.1);
    margin: 2em 0 1em 0;
  }

  .notes-list {
    font-size: 0.9em;
    color: #666;
  }

  .note-item {
    display: flex;
    align-items: flex-start;
    gap: 0.5em;
    margin-bottom: 0.5em;
    line-height: 1.5;
    position: relative;
  }
  
  .back-reference {
    background: none;
    border: none;
    color: #666;
    cursor: pointer;
    font-size: 0.9em;
    padding: 0 0.25em;
    margin-left: auto;
    opacity: 0.5;
    transition: opacity 0.2s ease, color 0.2s ease;
    flex-shrink: 0;
    user-select: none;
    line-height: 1;
  }
  
  .back-reference:hover {
    opacity: 1;
    color: #333;
  }
  
  .back-reference:active {
    transform: scale(0.95);
  }

  .note-number {
    font-weight: 500;
    color: #333;
    flex-shrink: 0;
  }

  .note-text {
    flex: 1;
    word-wrap: break-word;
  }

  @media (prefers-color-scheme: dark) {
    .notes-divider {
      border-top-color: rgba(255, 255, 255, 0.1);
    }

    .notes-list {
      color: #999;
    }

    .note-number {
      color: #ccc;
    }
    
    .back-reference {
      color: #999;
    }
    
    .back-reference:hover {
      color: #ccc;
    }
  }
</style>

