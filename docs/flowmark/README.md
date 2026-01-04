# FlowMark File Format Specification

**Version:** 0.1  
**Last Updated:** 2026

## Philosophy

FlowMark is based on the following principles:

- **Writing should be as simple and durable as paper and pencil.** The format must remain readable and editable for decades, without dependency on specific software or proprietary formats.

- **Content must remain readable without specialized software.** A .flm file can be opened with any ZIP tool, and its contents can be read with any text editor.

- **Markdown is the canonical content format.** The document content is stored as plain Markdown, following CommonMark standards. This ensures compatibility with countless existing tools and future-proof readability.

- **The editor must never own or lock the content.** FlowMarker is a tool for creating and editing .flm files, but the format is independent. A .flm file can be created, edited, or maintained without FlowMarker.

The format prioritizes:

- **Human-readability** — All content is stored as plain text
- **Tool-agnostic design** — No dependency on specific software
- **Long-term durability** — Standard formats that will remain accessible
- **Ease of manual creation and editing** — Users can work with .flm files directly

## Definition

A **FlowMark File** (`.flm`) is a standard ZIP archive containing Markdown content and optional resources. It uses no proprietary binary formats, no encryption, and no compression tricks. Any ZIP tool can open, inspect, and extract its contents.

The .flm extension is a convention for identifying FlowMark files, but the file itself is a standard ZIP archive that can be renamed, extracted, or manipulated with any ZIP-compatible tool.

## File Structure

A .flm file has the following structure:

```
document.flm
├── document.md        (required)
├── assets/            (optional)
│   └── images/
│       └── *.png / *.jpg / *.gif / *.webp
└── meta.yaml          (optional)
```

### document.md (Required)

**Location:** Root of the ZIP archive  
**Encoding:** UTF-8  
**Format:** CommonMark-compatible Markdown

This file contains the canonical source of all document content. It must be present in every .flm file and is the primary file that readers should process.

The Markdown content may include:

- Standard Markdown elements (headings, paragraphs, lists, links)
- Tables
- Code blocks
- Images (referenced from `assets/`)
- Footnotes (using standard Markdown footnote syntax)
- Any other CommonMark-compatible features

**Note:** While FlowMarker may use ProseMirror internally for editing, the editor state is never stored. On save, the editor converts its state to Markdown, which is then written to `document.md`. The Markdown file is always the source of truth.

### assets/ (Optional)

**Location:** `assets/` directory in the ZIP root  
**Purpose:** Binary resources referenced by the document

The `assets/` directory contains all binary files referenced in `document.md`, such as images. This keeps the document text clean and allows for easy resource management.

**Structure:**

- `assets/images/` — Image files (PNG, JPG, GIF, WebP, etc.)
- Future subdirectories may include other media types

**References:**

All references from `document.md` must be relative paths, e.g.:

```markdown
![Alt text](assets/images/example.png)
```

**Note:** The `assets/` directory is optional. A document with no images or other binary resources may omit it entirely.

### meta.yaml (Optional)

**Location:** Root of the ZIP archive  
**Encoding:** UTF-8  
**Format:** YAML

This file contains metadata about the document that is useful for editors and tools, but not required to read the content. It may include:

- Editor state (cursor position, view settings)
- Timestamps (created, modified)
- Version information
- Custom metadata

**Important:** The `meta.yaml` file is optional and can be safely deleted or regenerated. It does not affect the readability of the document content. If missing, tools should assume default values.

**Example:**

```yaml
format: flowmark
version: 0.1
createdAt: 2026-01-15T10:30:00Z
updatedAt: 2026-01-20T14:45:00Z
editor:
  cursorPosition: 1234
  viewMode: wysiwyg
```

## Manual Creation and Editing

A .flm file can be created, edited, or maintained without FlowMarker or any specialized software.

### Creating a .flm File Manually

1. Create a folder (e.g., `my-document/`)
2. Create `document.md` with your Markdown content
3. (Optional) Create `assets/images/` and add image files
4. (Optional) Create `meta.yaml` with metadata
5. Compress the folder contents as a ZIP archive
6. Rename the ZIP file to `.flm`

**Example using command line:**

```bash
mkdir my-document
cd my-document
echo "# My Document" > document.md
mkdir -p assets/images
# Add images to assets/images/
zip -r ../my-document.flm .
```

### Editing a .flm File Manually

1. Extract the .flm file (it's a ZIP archive)
2. Edit `document.md` with any text editor
3. Add, remove, or modify files in `assets/` as needed
4. (Optional) Edit `meta.yaml`
5. Re-compress the folder contents as a ZIP archive
6. Rename back to `.flm`

**Example using command line:**

```bash
unzip document.flm -d document-extracted
cd document-extracted
# Edit document.md with your preferred editor
# Modify assets/ as needed
cd ..
zip -r document.flm document-extracted/*
```

### Tools

Any tool that can work with ZIP archives and text files can be used:

- **ZIP tools:** `zip`, `unzip`, 7-Zip, WinRAR, macOS Archive Utility
- **Text editors:** Any editor that supports UTF-8 (VS Code, Vim, Notepad++, etc.)
- **Markdown processors:** Pandoc, Marked, any CommonMark-compatible tool

**FlowMarker is not required to create or edit .flm files.**

## Relationship with FlowMarker

FlowMarker is an editor and packager for .flm files. It provides:

- A WYSIWYG editing experience using ProseMirror
- Automatic conversion between editor state and Markdown
- Convenient packaging and unpackaging of .flm files
- Integration with the file system and autosave

However, FlowMarker's internal formats (ProseMirror JSON, editor state) are never canonical. The workflow is:

1. **On Load:** FlowMarker extracts `document.md` from the .flm file, parses it as Markdown, and converts it to ProseMirror state for editing.

2. **On Save:** FlowMarker converts the ProseMirror editor state to Markdown, writes it to `document.md`, updates `meta.yaml` if present, and packages everything into a .flm ZIP archive.

The .flm file is a container, not a document format itself. The document format is Markdown, stored in `document.md`.

## Design Goals

The .flm format is designed to achieve:

- **Durability over decades** — Standard ZIP and Markdown formats that will remain readable
- **Compatibility with Git** — Text-based content that works well with version control
- **Academic and professional writing** — Support for footnotes, citations, and structured content
- **Minimal cognitive overhead** — Simple structure that users can understand and manipulate
- **Clear separation between content and tooling** — Content is independent of the editor

## Non-Goals

The .flm format explicitly does not aim to be:

- **A layout or design format** — It stores content, not presentation
- **A replacement for PDF or DOCX** — Different use cases and requirements
- **Focused on visual styling** — Styling is handled by export tools, not the format itself
- **Dependent on FlowMarker** — The format is editor-agnostic

## Version History

- **0.1** (2026) — Initial specification
  - Required `document.md`
  - Optional `assets/` and `meta.yaml`
  - Standard ZIP archive structure

## Implementation Notes

### ZIP Compression

The ZIP archive should use standard compression (Deflate). No special compression methods are required. Tools should be able to create and read .flm files using standard ZIP libraries.

### File Naming

While the specification uses `document.md` as the canonical name, implementations may support other names (e.g., `content.md`, `index.md`) for flexibility. However, `document.md` is the recommended standard.

### Character Encoding

All text files (`.md`, `.yaml`) must use UTF-8 encoding without BOM. Binary files in `assets/` should use their standard formats.

### Path Separators

Within the ZIP archive, paths should use forward slashes (`/`) as separators, following ZIP standard conventions.

## Compatibility

A .flm file should be:

- **Readable** by any ZIP tool
- **Editable** with any text editor
- **Processable** by any Markdown parser
- **Compatible** with version control systems (Git, etc.)
- **Future-proof** for decades to come

## References

- [CommonMark Specification](https://commonmark.org/)
- [ZIP File Format Specification](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
- [YAML Specification](https://yaml.org/spec/)

---

**This specification is part of the FlowMarker project and may be updated as the format evolves. Contributions and feedback are welcome.**

