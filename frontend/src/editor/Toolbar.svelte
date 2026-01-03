<script lang="ts">
  import { EditorView } from "prosemirror-view";
  import { EditorState } from "prosemirror-state";
  import { onMount, onDestroy } from "svelte";
  import {
    RotateCcw,
    RotateCw,
    Bold,
    Italic,
    Code,
    Type,
    Heading1,
    Heading2,
    Heading3,
    List,
    ListOrdered,
    Link,
    Image,
    Table,
    FileDown,
    FileUp,
    NotebookPen,
    ChevronDown,
  } from "lucide-svelte";
  import {
    toggleBold,
    toggleItalic,
    toggleCode,
    insertCodeBlock,
    setParagraph,
    setHeading,
    toggleBulletList,
    toggleOrderedList,
    insertLink,
    insertImage,
    insertTable,
    pasteFromMarkdown,
    copyAsMarkdown,
    undoCommand,
    redoCommand,
    canUndo,
    canRedo,
    isMarkActive,
    isBlockActive,
    isListActive,
    getLinkUrl,
    insertNoteCommand,
    viewNotes,
  } from "./toolbar";
  import { schema } from "./schema";

  let { view = $bindable(null) }: { view: EditorView | null } = $props();

  let editorState: EditorState | null = $state(null);
  let updateKey = $state(0);
  let notesDropdownOpen = $state(false);

  function forceUpdate() {
    updateKey++;
    if (view) {
      editorState = view.state;
    }
  }

  let cleanup: (() => void) | null = null;
  let rafId: number | null = null;

  function setupEventListeners() {
    if (!view) return () => {};
    
    editorState = view.state;
    
    // Use requestAnimationFrame for efficient updates
    const scheduleUpdate = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (view) {
          editorState = view.state;
          updateKey++;
        }
      });
    };
    
    view.dom.addEventListener("input", scheduleUpdate);
    view.dom.addEventListener("keyup", scheduleUpdate);
    view.dom.addEventListener("mouseup", scheduleUpdate);
    view.dom.addEventListener("focus", scheduleUpdate);
    
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      view?.dom.removeEventListener("input", scheduleUpdate);
      view?.dom.removeEventListener("keyup", scheduleUpdate);
      view?.dom.removeEventListener("mouseup", scheduleUpdate);
      view?.dom.removeEventListener("focus", scheduleUpdate);
    };
  }

  // React to view changes
  $effect(() => {
    if (view) {
      try {
        editorState = view.state;
        if (cleanup) cleanup();
        cleanup = setupEventListeners();
      } catch (error) {
        console.error("Error setting up toolbar:", error);
        editorState = null;
      }
    } else {
      editorState = null;
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
    }
  });

  onDestroy(() => {
    if (cleanup) {
      cleanup();
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }
  });

  async function handleCommand(command: (view: EditorView) => boolean | Promise<boolean>) {
    if (!view) return;
    const result = await command(view);
    if (result) {
      view.focus();
      forceUpdate();
    }
  }

  function handleHeading(level: number) {
    if (!view) return;
    setHeading(view, level);
    view.focus();
    forceUpdate();
  }

</script>

{#if view && editorState !== null && schema}
  <div class="toolbar">
    <div class="toolbar-group">
      <!-- Undo/Redo -->
      <button
        class="toolbar-button"
        class:disabled={!canUndo(editorState)}
        onclick={() => handleCommand(undoCommand)}
        title="Undo (Ctrl+Z)"
        disabled={!canUndo(editorState)}
      >
        <RotateCcw size={16} />
      </button>
      <button
        class="toolbar-button"
        class:disabled={!canRedo(editorState)}
        onclick={() => handleCommand(redoCommand)}
        title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
        disabled={!canRedo(editorState)}
      >
        <RotateCw size={16} />
      </button>
    </div>

    <div class="toolbar-divider"></div>

    <div class="toolbar-group">
      <!-- Block structure -->
      <button
        class="toolbar-button"
          class:active={isBlockActive(editorState, schema.nodes.paragraph)}
        onclick={() => handleCommand(setParagraph)}
        title="Paragraph"
      >
        <Type size={16} />
      </button>
      <button
        class="toolbar-button"
          class:active={isBlockActive(editorState, schema.nodes.heading, { level: 1 })}
        onclick={() => handleHeading(1)}
        title="Heading 1"
      >
        <Heading1 size={16} />
      </button>
      <button
        class="toolbar-button"
          class:active={isBlockActive(editorState, schema.nodes.heading, { level: 2 })}
        onclick={() => handleHeading(2)}
        title="Heading 2"
      >
        <Heading2 size={16} />
      </button>
      <button
        class="toolbar-button"
          class:active={isBlockActive(editorState, schema.nodes.heading, { level: 3 })}
        onclick={() => handleHeading(3)}
        title="Heading 3"
      >
        <Heading3 size={16} />
      </button>
    </div>

    <div class="toolbar-divider"></div>

    <div class="toolbar-group">
      <!-- Text formatting -->
      <button
        class="toolbar-button"
          class:active={isMarkActive(editorState, schema.marks.strong)}
        onclick={() => handleCommand(toggleBold)}
        title="Bold (Ctrl+B)"
      >
        <Bold size={16} />
      </button>
      <button
        class="toolbar-button"
          class:active={isMarkActive(editorState, schema.marks.em)}
        onclick={() => handleCommand(toggleItalic)}
        title="Italic (Ctrl+I)"
      >
        <Italic size={16} />
      </button>
      <button
        class="toolbar-button"
        class:active={isBlockActive(editorState, schema.nodes.code_block)}
        onclick={() => handleCommand(insertCodeBlock)}
        title="Code block"
      >
        <Code size={16} />
      </button>
    </div>

    <div class="toolbar-divider"></div>

    <div class="toolbar-group">
      <!-- Lists -->
      <button
        class="toolbar-button"
          class:active={isListActive(editorState, schema.nodes.bullet_list)}
        onclick={() => handleCommand(toggleBulletList)}
        title="Bullet list"
      >
        <List size={16} />
      </button>
      <button
        class="toolbar-button"
          class:active={isListActive(editorState, schema.nodes.ordered_list)}
        onclick={() => handleCommand(toggleOrderedList)}
        title="Ordered list"
      >
        <ListOrdered size={16} />
      </button>
    </div>

    <div class="toolbar-divider"></div>

    <div class="toolbar-group">
      <!-- Insertions -->
      {#if schema.marks.link}
        <button
          class="toolbar-button"
          class:active={getLinkUrl(editorState) !== null}
          onclick={() => handleCommand(insertLink)}
          title={getLinkUrl(editorState) ? `Edit link: ${getLinkUrl(editorState)}` : "Insert link"}
        >
          <Link size={16} />
        </button>
      {/if}
      {#if schema.nodes.image}
        <button
          class="toolbar-button"
          onclick={() => handleCommand(insertImage)}
          title="Insert image"
        >
          <Image size={16} />
        </button>
      {/if}
      {#if schema.nodes.table}
        <button
          class="toolbar-button"
          onclick={() => handleCommand(insertTable)}
          title="Insert table"
        >
          <Table size={16} />
        </button>
      {/if}
      {#if schema.nodes.note_ref}
        <div class="toolbar-dropdown">
          <button
            class="toolbar-button"
            class:active={notesDropdownOpen}
            onclick={() => {
              notesDropdownOpen = !notesDropdownOpen;
            }}
            onblur={() => {
              // Close dropdown when focus is lost
              setTimeout(() => {
                notesDropdownOpen = false;
              }, 200);
            }}
            title="Notes"
          >
            <NotebookPen size={16} />
            <ChevronDown size={12} class="dropdown-chevron" />
          </button>
          {#if notesDropdownOpen}
            <div class="dropdown-menu">
              <button
                class="dropdown-item"
                onclick={() => {
                  handleCommand(insertNoteCommand);
                  notesDropdownOpen = false;
                }}
              >
                <NotebookPen size={14} />
                <span>Insert Note</span>
              </button>
              <button
                class="dropdown-item"
                onclick={async () => {
                  if (view) {
                    viewNotes(view);
                  }
                  notesDropdownOpen = false;
                }}
              >
                <span>View Notes</span>
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="toolbar-divider"></div>

    <div class="toolbar-group">
      <!-- Markdown operations -->
      <button
        class="toolbar-button"
        onclick={() => handleCommand(pasteFromMarkdown)}
        title="Paste Markdown and convert to document (Ctrl+Shift+V)"
      >
        <FileDown size={16} />
        <span class="toolbar-button-label">Paste MD</span>
      </button>
      <button
        class="toolbar-button"
        onclick={() => handleCommand(copyAsMarkdown)}
        title="Copy document as Markdown (Ctrl+Shift+C)"
      >
        <FileUp size={16} />
        <span class="toolbar-button-label">Copy MD</span>
      </button>
    </div>
  </div>
{/if}

<style>
  .toolbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    width: 100%;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 8px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    background-color: #ffffff;
    flex-wrap: wrap;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }

  .toolbar-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .toolbar-divider {
    width: 1px;
    height: 20px;
    background-color: rgba(0, 0, 0, 0.1);
    margin: 0 4px;
  }

  .toolbar-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 28px;
    height: 28px;
    padding: 4px 8px;
    border: none;
    background-color: transparent;
    color: #666;
    cursor: pointer;
    border-radius: 4px;
    font-size: 14px;
    font-family: system-ui, -apple-system, sans-serif;
    transition: background-color 0.1s;
  }

  .toolbar-button:hover:not(:disabled) {
    background-color: rgba(0, 0, 0, 0.05);
  }

  .toolbar-button.active {
    background-color: rgba(0, 0, 0, 0.1);
    color: #000;
  }

  .toolbar-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .toolbar-button strong {
    font-weight: 700;
  }

  .toolbar-button em {
    font-style: italic;
  }

  .toolbar-button code {
    font-family: 'Courier New', monospace;
    font-size: 12px;
  }

  /* Lucide icons inherit color from button */
  .toolbar-button :global(svg) {
    stroke: currentColor;
    fill: none;
  }

  .toolbar-button-label {
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }

  @media (prefers-color-scheme: dark) {
    .toolbar {
      background-color: #1a1a1a;
      border-bottom-color: rgba(255, 255, 255, 0.1);
    }

    .toolbar-button {
      color: #999;
    }

    .toolbar-button:hover {
      background-color: rgba(255, 255, 255, 0.05);
    }

    .toolbar-button.active {
      background-color: rgba(255, 255, 255, 0.1);
      color: #e0e0e0;
    }

    .toolbar-divider {
      background-color: rgba(255, 255, 255, 0.1);
    }
  }
  
  .toolbar-dropdown {
    position: relative;
    display: inline-block;
  }
  
  .dropdown-chevron {
    margin-left: 2px;
    opacity: 0.6;
  }
  
  .dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    background-color: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    z-index: 1001;
    min-width: 160px;
    padding: 4px;
  }
  
  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    text-align: left;
    cursor: pointer;
    color: #333;
    font-size: 14px;
    border-radius: 2px;
    transition: background-color 0.1s;
  }
  
  .dropdown-item:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }
  
  .dropdown-item:active {
    background-color: rgba(0, 0, 0, 0.1);
  }
  
  @media (prefers-color-scheme: dark) {
    .dropdown-menu {
      background-color: #2a2a2a;
      border-color: rgba(255, 255, 255, 0.1);
    }
    
    .dropdown-item {
      color: #e0e0e0;
    }
    
    .dropdown-item:hover {
      background-color: rgba(255, 255, 255, 0.05);
    }
    
    .dropdown-item:active {
      background-color: rgba(255, 255, 255, 0.1);
    }
  }
</style>

