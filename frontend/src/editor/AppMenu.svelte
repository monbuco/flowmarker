<script lang="ts">
  import { EditorView } from "prosemirror-view";
  import { undoCommand, redoCommand, canUndo, canRedo } from "./toolbar";
  import { saveDocument, saveAs, openFile } from "../lib/persistence/fileIO";
  import { deserializeDocument } from "../lib/persistence/serializer";
  import { setNote, clearNotes } from "./notesStore";
  import { Node } from "prosemirror-model";
  import { EditorState } from "prosemirror-state";
  import { schema } from "./schema";
  import { fileStore as fileStoreModule } from "../lib/persistence/fileStore";
  import { onMount, onDestroy } from "svelte";

  let { view = $bindable(null) }: { view: EditorView | null } = $props();

  let activeMenu: string | null = $state(null);
  let fileStore = $state({ path: null, isDirty: false });
  let fileMenuRef: HTMLElement | null = $state(null);
  let editMenuRef: HTMLElement | null = $state(null);
  let viewMenuRef: HTMLElement | null = $state(null);

  let unsubscribe: (() => void) | null = null;

  onMount(() => {
    unsubscribe = fileStoreModule.subscribe((state) => {
      fileStore = state;
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  });

  function closeMenu() {
    activeMenu = null;
  }

  function handleMenuClick(menuName: string, event: MouseEvent) {
    event.stopPropagation();
    if (activeMenu === menuName) {
      activeMenu = null;
    } else {
      activeMenu = menuName;
    }
  }

  function handleMenuItemClick(action: () => void | Promise<void>) {
    closeMenu();
    action();
  }

  // File menu actions
  async function handleNew() {
    if (!view) return;
    
    // Check if document is dirty
    if (fileStore.isDirty) {
      // TODO: Show confirmation dialog
      const confirmed = confirm("You have unsaved changes. Create a new document?");
      if (!confirmed) return;
    }

    // Clear editor
    const emptyDoc = schema.nodes.doc.create(
      {},
      schema.nodes.paragraph.create()
    );
    const newState = EditorState.create({
      doc: emptyDoc,
      schema,
      plugins: view.state.plugins,
    });
    view.updateState(newState);
    clearNotes();
    
    // Reset file store
    fileStoreModule.reset();
  }

  async function handleOpen() {
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
        const { renumberNotes } = await import("./notes");
        renumberNotes(view.state);
      }
    } catch (error) {
      console.error("Error loading document:", error);
    }
  }

  async function handleSave() {
    if (!view) return;
    try {
      await saveDocument(view.state);
    } catch (error) {
      console.error("Error saving document:", error);
    }
  }

  async function handleSaveAs() {
    if (!view) return;
    try {
      await saveAs(view.state);
    } catch (error) {
      console.error("Error saving document:", error);
    }
  }

  // Edit menu actions
  function handleUndo() {
    if (!view) return;
    undoCommand(view);
  }

  function handleRedo() {
    if (!view) return;
    redoCommand(view);
  }

  // View menu actions (placeholder for future implementation)
  function handleToggleMarkdownView() {
    // TODO: Implement markdown view toggle
    console.log("Toggle Markdown View (not implemented yet)");
  }

  function handleToggleSplitView() {
    // TODO: Implement split view toggle
    console.log("Toggle Split View (not implemented yet)");
  }

  // Close menu when clicking outside
  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".app-menu")) {
      closeMenu();
    }
  }

  // Close menu on escape key
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      closeMenu();
    }
  }
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

{#if view}
  <div class="app-menu">
    <div class="menu-bar">
      <button
        bind:this={fileMenuRef}
        class="menu-item"
        class:active={activeMenu === "file"}
        onclick={(e) => handleMenuClick("file", e)}
      >
        File
      </button>
      <button
        bind:this={editMenuRef}
        class="menu-item"
        class:active={activeMenu === "edit"}
        onclick={(e) => handleMenuClick("edit", e)}
      >
        Edit
      </button>
      <button
        bind:this={viewMenuRef}
        class="menu-item"
        class:active={activeMenu === "view"}
        onclick={(e) => handleMenuClick("view", e)}
      >
        View
      </button>
    </div>

    <!-- File Menu Dropdown -->
    {#if activeMenu === "file"}
      <div class="dropdown-menu" style="left: {fileMenuRef?.offsetLeft || 0}px;">
        <button class="dropdown-item" onclick={() => handleMenuItemClick(handleNew)}>
          New
        </button>
        <button class="dropdown-item" onclick={() => handleMenuItemClick(handleOpen)}>
          Open…
        </button>
        <div class="dropdown-divider"></div>
        <button class="dropdown-item" onclick={() => handleMenuItemClick(handleSave)}>
          Save
        </button>
        <button class="dropdown-item" onclick={() => handleMenuItemClick(handleSaveAs)}>
          Save As…
        </button>
        <div class="dropdown-divider"></div>
        <button class="dropdown-item" disabled>Export</button>
      </div>
    {/if}

    <!-- Edit Menu Dropdown -->
    {#if activeMenu === "edit"}
      <div class="dropdown-menu" style="left: {editMenuRef?.offsetLeft || 0}px;">
        <button
          class="dropdown-item"
          class:disabled={!canUndo(view.state)}
          onclick={() => handleMenuItemClick(handleUndo)}
          disabled={!canUndo(view.state)}
        >
          Undo
        </button>
        <button
          class="dropdown-item"
          class:disabled={!canRedo(view.state)}
          onclick={() => handleMenuItemClick(handleRedo)}
          disabled={!canRedo(view.state)}
        >
          Redo
        </button>
      </div>
    {/if}

    <!-- View Menu Dropdown -->
    {#if activeMenu === "view"}
      <div class="dropdown-menu" style="left: {viewMenuRef?.offsetLeft || 0}px;">
        <button class="dropdown-item" onclick={() => handleMenuItemClick(handleToggleMarkdownView)}>
          Toggle Markdown View
        </button>
        <button class="dropdown-item" onclick={() => handleMenuItemClick(handleToggleSplitView)}>
          Toggle Split View
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .app-menu {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 32px;
    background-color: #ffffff;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    z-index: 2000;
    display: flex;
    align-items: center;
    padding: 0 8px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    user-select: none;
  }

  .menu-bar {
    display: flex;
    align-items: center;
    gap: 0;
    height: 100%;
  }

  .menu-item {
    padding: 6px 12px;
    border: none;
    background-color: transparent;
    color: #333;
    cursor: pointer;
    font-size: 13px;
    font-family: system-ui, -apple-system, sans-serif;
    border-radius: 3px;
    transition: background-color 0.1s;
  }

  .menu-item:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }

  .menu-item.active {
    background-color: rgba(0, 0, 0, 0.1);
  }

  .dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    background-color: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-top: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    min-width: 160px;
    padding: 4px 0;
    margin-top: -1px;
  }

  .dropdown-item {
    display: block;
    width: 100%;
    padding: 6px 16px;
    border: none;
    background-color: transparent;
    color: #333;
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    font-family: system-ui, -apple-system, sans-serif;
    transition: background-color 0.1s;
  }

  .dropdown-item:hover:not(:disabled) {
    background-color: rgba(0, 0, 0, 0.05);
  }

  .dropdown-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .dropdown-divider {
    height: 1px;
    background-color: rgba(0, 0, 0, 0.1);
    margin: 4px 0;
  }

  @media (prefers-color-scheme: dark) {
    .app-menu {
      background-color: #1a1a1a;
      border-bottom-color: rgba(255, 255, 255, 0.1);
    }

    .menu-item {
      color: #e0e0e0;
    }

    .menu-item:hover {
      background-color: rgba(255, 255, 255, 0.05);
    }

    .menu-item.active {
      background-color: rgba(255, 255, 255, 0.1);
    }

    .dropdown-menu {
      background-color: #1a1a1a;
      border-color: rgba(255, 255, 255, 0.15);
    }

    .dropdown-item {
      color: #e0e0e0;
    }

    .dropdown-item:hover:not(:disabled) {
      background-color: rgba(255, 255, 255, 0.05);
    }

    .dropdown-divider {
      background-color: rgba(255, 255, 255, 0.1);
    }
  }
</style>

