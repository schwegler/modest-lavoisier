# Native Nodes

Offline-capable local Markdown Wiki note-taking desktop application. A beautiful, client-side personal wiki that edits standard Markdown files directly on your local device.

## Features

- **Local Directory Sync:** Edits save automatically to your hard drive files using browser File APIs.
- **Double-bracket Wiki Linking:** Write `[[Page Name]]` to instantly link pages. Broken links allow quick creation.
- **Interactive Connection Graph:** Drift and navigate through a physics-based visual network of notes.
- **Light/Dark Theme:** Switchable themes with `Cmd+I` shortcut.
- **Multiple Views:** Edit, Preview, or Split views.

## Installation & Development

This project is built as a Tauri desktop application.

### Prerequisites

- [Node.js](https://nodejs.org/) and npm installed on your machine.
- Rust toolchain installed (for compiling the Tauri backend).

### Setup

Clone the repository and install dependencies:

```bash
npm install
```

### Running the App

Start the application locally in development mode:

```bash
npm start
```

### Building the App

Build and package the application for distribution using Tauri:

```bash
npm run build
```

The packaged applications will be output to the `src-tauri/target/release/bundle/` directory.

## Testing

This project uses [Playwright](https://playwright.dev/) for testing. Run the tests with:

```bash
npm test
```

## Keyboard Shortcuts

- `Cmd + S` - Save Active Article
- `Cmd + N` - Create New Page
- `Cmd + F` - Search Workspace
- `Cmd + G` - Toggle Connection Map
- `Cmd + I` - Toggle Light/Dark Theme
- `Alt + L` - Cycle View Modes (Edit/Split/Preview)

## Maintainers

Native Nodes Maintainers (<maintainer@native-nodes.notes>)