import { save, open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { EditorState } from "prosemirror-state";
import { serializeDocument, deserializeDocument, type FlowmarkDocument } from "./serializer";
import { fileStore } from "./fileStore";
import { get } from "svelte/store";

/**
 * Save document as .flm file
 */
export async function saveAs(state: EditorState): Promise<string | null> {
  try {
    const filePath = await save({
      defaultPath: "document.flm",
      filters: [
        {
          name: "Flowmark",
          extensions: ["flm"],
        },
      ],
    });

    if (!filePath) {
      return null; // User cancelled
    }

    await saveToFile(filePath, state);
    return filePath;
  } catch (error) {
    console.error("Error saving file:", error);
    throw error;
  }
}

/**
 * Save document to existing file path
 */
export async function saveToFile(filePath: string, state: EditorState): Promise<void> {
  try {
    // Get current file state to preserve createdAt
    const currentState = get(fileStore);
    const currentPath = currentState.path;
    let createdAt: string | undefined;
    
    // If saving to the same file, try to preserve createdAt
    if (currentPath === filePath) {
      try {
        const existingDoc = await loadFromFile(filePath);
        createdAt = existingDoc.createdAt;
      } catch {
        // File doesn't exist or can't be read, use new timestamp
      }
    }

    // Serialize document to JSON (no ZIP handling here)
    const doc = serializeDocument(state, createdAt);
    const documentJson = JSON.stringify(doc, null, 2);

    // Call Rust backend to create .flm ZIP archive
    await invoke("save_flm", {
      path: filePath,
      documentJson: documentJson,
    });

    fileStore.setPath(filePath);
    fileStore.setDirty(false);
  } catch (error) {
    console.error("Error writing file:", error);
    throw error;
  }
}

/**
 * Load document from .flm file
 */
export async function loadFromFile(filePath: string): Promise<FlowmarkDocument> {
  try {
    // Call Rust backend to extract document.json from .flm ZIP
    const documentJson = await invoke<string>("load_flm", {
      path: filePath,
    });

    // Parse JSON
    const doc = JSON.parse(documentJson) as FlowmarkDocument;

    // Update file store
    fileStore.setPath(filePath);
    fileStore.setDirty(false);

    return doc;
  } catch (error) {
    console.error("Error loading file:", error);
    throw error;
  }
}

/**
 * Open file dialog and load document
 */
export async function openFile(): Promise<FlowmarkDocument | null> {
  try {
    const filePath = await open({
      multiple: false,
      filters: [
        {
          name: "Flowmark",
          extensions: ["flm"],
        },
      ],
    });

    if (!filePath || typeof filePath !== "string") {
      return null; // User cancelled
    }

    return await loadFromFile(filePath);
  } catch (error) {
    console.error("Error opening file:", error);
    throw error;
  }
}

/**
 * Save document (save as if no path, save to path if exists)
 */
export async function saveDocument(state: EditorState): Promise<string | null> {
  const currentState = get(fileStore);
  const currentPath = currentState.path;
  
  if (currentPath) {
    // Save to existing file
    await saveToFile(currentPath, state);
    return currentPath;
  } else {
    // Save as new file
    return await saveAs(state);
  }
}

