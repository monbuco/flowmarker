<script lang="ts">
  import { X, Link, Table, Image, Code, Quote, FileText } from "lucide-svelte";
  import { dialogStore, type DialogState } from "./dialogStore";

  let dialogState: DialogState = $state({ visible: false, config: null, resolve: null });

  // Map command titles to icons
  function getIcon(title: string) {
    const titleLower = title.toLowerCase();
    if (titleLower === "link") return Link;
    if (titleLower === "table") return Table;
    if (titleLower === "image") return Image;
    if (titleLower === "code") return Code;
    if (titleLower === "quote") return Quote;
    return FileText; // Default icon
  }

  function capitalizeTitle(title: string): string {
    if (!title) return "";
    return title.charAt(0).toUpperCase() + title.slice(1);
  }

  $effect(() => {
    const unsubscribe = dialogStore.subscribe((state) => {
      dialogState = state;
      if (state.visible && state.config) {
        inputValue = state.config.defaultValue || "";
        // Focus input after a short delay to ensure it's rendered
        setTimeout(() => {
          const input = document.getElementById("dialog-input") as HTMLInputElement;
          if (input) {
            input.focus();
            input.select();
          }
        }, 10);
      }
    });
    return unsubscribe;
  });

  let inputValue = $state("");

  function handleSave() {
    if (inputValue.trim() !== "") {
      dialogStore.hide(inputValue.trim());
    }
  }

  function handleCancel() {
    dialogStore.hide(null);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      handleCancel();
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSave();
    }
  }
</script>

{#if dialogState.visible && dialogState.config}
  <div 
    class="dialog-overlay" 
    onclick={handleCancel}
    onkeydown={(e) => e.key === "Escape" && handleCancel()}
    role="button"
    tabindex="-1"
  >
    <div 
      class="dialog-box" 
      onclick={(e) => e.stopPropagation()} 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="dialog-title"
      tabindex="-1"
    >
      <div class="dialog-header">
        <div class="dialog-title-wrapper">
          {#if dialogState.config}
            {@const iconName = dialogState.config.title.toLowerCase()}
            {#if iconName === "link"}
              <Link size={16} class="dialog-title-icon" />
            {:else if iconName === "table"}
              <Table size={16} class="dialog-title-icon" />
            {:else if iconName === "image"}
              <Image size={16} class="dialog-title-icon" />
            {:else if iconName === "code"}
              <Code size={16} class="dialog-title-icon" />
            {:else if iconName === "quote"}
              <Quote size={16} class="dialog-title-icon" />
            {:else}
              <FileText size={16} class="dialog-title-icon" />
            {/if}
          {/if}
          <span class="dialog-title" id="dialog-title">{capitalizeTitle(dialogState.config.title)}</span>
        </div>
        <button class="dialog-close-btn" onclick={handleCancel} title="Close (Esc)">
          <X size={16} />
        </button>
      </div>
      <div class="dialog-content">
        {#if dialogState.config.label}
          <label class="dialog-label" for="dialog-input">{dialogState.config.label}</label>
        {/if}
        <input
          id="dialog-input"
          type={dialogState.config.type || "text"}
          bind:value={inputValue}
          placeholder={dialogState.config.placeholder}
          class="dialog-input"
          onkeydown={handleKeydown}
          min={dialogState.config.min}
          max={dialogState.config.max}
        />
      </div>
      <div class="dialog-actions">
        <button class="dialog-save-btn" onclick={handleSave} title="Save (Enter)">
          Save
        </button>
        <button class="dialog-cancel-btn" onclick={handleCancel} title="Cancel (Esc)">
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(2px);
  }

  .dialog-box {
    background: white;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    min-width: 320px;
    max-width: 500px;
    width: 90%;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  }

  .dialog-title-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dialog-title-icon {
    color: #666;
    flex-shrink: 0;
  }

  .dialog-title {
    font-size: 14px;
    font-weight: 600;
    color: #333;
    text-decoration: underline;
    text-underline-offset: 4px;
  }

  .dialog-close-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: currentColor;
    border-radius: 4px;
    transition: background-color 0.1s;
  }

  .dialog-close-btn:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }

  .dialog-close-btn :global(svg) {
    stroke: currentColor;
    fill: none;
  }

  .dialog-content {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .dialog-label {
    font-size: 13px;
    color: #666;
    margin-bottom: 4px;
  }

  .dialog-input {
    padding: 8px 12px;
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 4px;
    font-size: 14px;
    font-family: system-ui, -apple-system, sans-serif;
    width: 100%;
    box-sizing: border-box;
  }

  .dialog-input:focus {
    outline: none;
    border-color: #333;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.1);
  }

  .dialog-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 12px 16px;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
  }

  .dialog-save-btn,
  .dialog-cancel-btn {
    padding: 6px 16px;
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: background-color 0.1s;
    font-family: system-ui, -apple-system, sans-serif;
  }

  .dialog-save-btn {
    background: #333;
    color: white;
    border-color: #333;
  }

  .dialog-save-btn:hover {
    background: #000;
    border-color: #000;
  }

  .dialog-save-btn:disabled {
    background: #999;
    border-color: #999;
    cursor: not-allowed;
  }

  .dialog-cancel-btn {
    background: white;
    color: #333;
  }

  .dialog-cancel-btn:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }

  @media (prefers-color-scheme: dark) {
    .dialog-box {
      background: #1a1a1a;
      border-color: rgba(255, 255, 255, 0.1);
    }

    .dialog-title {
      color: #e0e0e0;
    }

    .dialog-title-icon {
      color: #b0b0b0;
    }

    .dialog-header {
      border-bottom-color: rgba(255, 255, 255, 0.1);
    }

    .dialog-label {
      color: #b0b0b0;
    }

    .dialog-input {
      background: #2a2a2a;
      border-color: rgba(255, 255, 255, 0.2);
      color: #e0e0e0;
    }

    .dialog-input:focus {
      border-color: rgba(255, 255, 255, 0.4);
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.1);
    }

    .dialog-save-btn {
      background: #e0e0e0;
      color: #1a1a1a;
      border-color: #e0e0e0;
    }

    .dialog-save-btn:hover {
      background: #fff;
      border-color: #fff;
    }

    .dialog-cancel-btn {
      background: #2a2a2a;
      color: #e0e0e0;
      border-color: rgba(255, 255, 255, 0.2);
    }

    .dialog-cancel-btn:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }

    .dialog-actions {
      border-top-color: rgba(255, 255, 255, 0.1);
    }
  }
</style>

