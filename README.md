# Codetographer

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Ask your AI assistant how something works. Get a visual map that links back to the code.

![Codetographer demo](https://raw.githubusercontent.com/Kelvination/codetographer/main/examples/demo.gif)

## What is this?

Understanding unfamiliar codebases is hard. You ask your AI "how does authentication work?" and get back a wall of text explaining different files and functions. By the time you've read through it, you've forgotten where it started.

Codetographer takes a different approach. Instead of text explanations, your AI generates an interactive visual map of the code flow. Each node in the graph represents a real function or class in your codebase, and clicking it takes you directly to that code.

**NEW in v0.2.0:** Automatic semantic call graph generation for JavaScript/TypeScript! No need to manually create graphs - Codetographer can now analyze your codebase and automatically generate call graphs with configurable depth and scope.

The workflow is simple: install the extension, give your AI assistant the skill file, then ask questions like you normally would. When you ask "how does X work?", you get a `.cgraph` file that opens as a navigable diagram. For JavaScript/TypeScript projects, you can also use built-in commands to automatically generate call graphs from any function.

## Getting Started

### Install the Extension

```bash
git clone https://github.com/Kelvination/codetographer.git
cd codetographer
pnpm install        # or npm/yarn
pnpm setup          # one-time setup
pnpm build:local    # build and install
```

> Marketplace release coming soon.

### Add the AI Skill

**For Claude Code:**
```bash
mkdir -p .claude/skills
cp path/to/codetographer/skill/SKILL.md .claude/skills/codetographer.md
```

**For other AI assistants:**
Use [`skill/SKILL.md`](skill/SKILL.md) as a prompt or system instruction. The skill tells the AI how to generate `.cgraph` files when you ask about code architecture.

### Try it

Once set up, you have two ways to create call graphs:

#### Option 1: Automatic Call Graph Generation (JavaScript/TypeScript)

For JavaScript and TypeScript codebases, use the built-in semantic analyzer:

1. **From a specific function:**
   - Open a JS/TS file
   - Place your cursor on a function name
   - Open Command Palette (Cmd+Shift+P / Ctrl+Shift+P)
   - Run: `Codetographer: Generate Call Graph from Selection`
   - A `.cgraph` file will be created showing the call graph from that function

2. **Entire codebase analysis:**
   - Open Command Palette
   - Run: `Codetographer: Analyze Codebase Call Graph`
   - Analyzes all JS/TS files in your workspace
   - Creates a comprehensive call graph

**Configure the analyzer** in VS Code Settings:
- Search for "Codetographer"
- Adjust max depth, max nodes, file patterns, etc.

#### Option 2: AI-Generated Graphs (All Languages)

Ask your AI assistant questions like:

- "How does user authentication work?"
- "Show me the data flow for order processing"
- "Create a graph of the API routes"

The AI will create a `.cgraph` file that automatically opens as an interactive graph.

## How It Works

### The basics

1. You ask your AI assistant a question about how something in the code works
2. The AI analyzes the relevant code and creates a `.cgraph` file
3. VS Code opens the file and renders it as an interactive graph
4. Each node links to the actual code—click to jump there

### Under the hood

`.cgraph` files are JSON documents containing:
- **Nodes**: Functions, classes, or modules with labels, descriptions, and file locations (path + line numbers)
- **Edges**: Relationships between nodes (calls, imports, extends, etc.)
- **Layout**: Direction and grouping hints

When you Cmd+Click (Ctrl+Click) a node, the extension tells VS Code to open that file at the exact line. The graph layout is computed automatically using [ELK.js](https://github.com/kieler/elkjs).

## Interacting with Graphs

| Action | Result |
|--------|--------|
| Click a node | Highlights connected nodes, dims others |
| Cmd+Click / Ctrl+Click | Opens file at that code location |
| Click the `+` button | Expands the node's full description |
| Drag | Pan around the graph |
| Scroll / pinch | Zoom in and out |
| Bottom-left controls | Zoom buttons, fit to view |

## Automatic Semantic Analysis

For JavaScript and TypeScript projects, Codetographer can automatically analyze your code to generate call graphs:

### Features

- **Function-level analysis**: Start from any function and trace its calls
- **Configurable depth**: Control how deep the analysis goes (1-10 levels)
- **Cross-file tracking**: Follows imports and exports across files
- **Codebase-wide analysis**: Generate graphs for entire projects
- **Smart filtering**: Exclude node_modules, dist, and other build artifacts

### How It Works

The semantic analyzer uses Babel to parse JavaScript/TypeScript files and extract:
- Function declarations and expressions
- Class methods and constructors
- Arrow functions
- Import/export relationships
- Function calls and invocations

It then builds a call graph by:
1. Parsing all relevant files in your workspace
2. Extracting function definitions and their calls
3. Resolving imports to link functions across files
4. Building a graph with configurable depth and node limits
5. Converting to the `.cgraph` format for visualization

### Configuration

Available settings (search "Codetographer" in VS Code settings):

| Setting | Default | Description |
|---------|---------|-------------|
| `codetographer.analysis.maxDepth` | 3 | Maximum depth for call graph traversal |
| `codetographer.analysis.maxNodes` | 50 | Maximum number of nodes in the graph |
| `codetographer.analysis.includeNodeModules` | false | Include calls to node_modules |
| `codetographer.analysis.filePatterns` | `**/*.{js,jsx,ts,tsx}` | Files to analyze |
| `codetographer.analysis.excludePatterns` | `**/node_modules/**`, etc. | Files to exclude |

### Limitations

- Currently supports JavaScript and TypeScript
- Does not analyze dynamic calls (e.g., `fn[methodName]()`)
- Does not follow calls through node_modules by default
- Large codebases may need depth/node limits adjusted


## The .cgraph Format

<details>
<summary><strong>Schema Reference</strong> (click to expand)</summary>

### Basic Structure

```json
{
  "version": "1.0",
  "metadata": {
    "title": "Graph Title",
    "description": "What this graph shows",
    "generated": "2025-01-01T00:00:00Z",
    "scope": "src/relevant/path"
  },
  "nodes": [...],
  "edges": [...],
  "groups": [...],
  "layout": {
    "type": "layered",
    "direction": "TB"
  },
  "legend": {...}
}
```

### Nodes

```json
{
  "id": "unique-id",
  "label": "functionName()",
  "type": "function",
  "description": "What this does",
  "location": {
    "file": "src/path/to/file.ts",
    "startLine": 42,
    "endLine": 67
  },
  "group": "optional-group-id"
}
```

**Node types:** `function`, `method`, `class`, `module`, `file`

### Edges

```json
{
  "id": "edge-1",
  "source": "source-node-id",
  "target": "target-node-id",
  "type": "calls",
  "importance": "primary",
  "color": "#ff6b6b"
}
```

**Edge types:** `calls`, `imports`, `extends`, `implements`, `uses`

**Importance levels:** `primary` (thick), `secondary` (normal), `tertiary` (thin)

### Groups

Groups create visual sections for organizing related nodes:

```json
{
  "id": "api-layer",
  "label": "API Layer",
  "description": "HTTP request handlers"
}
```

Assign nodes to groups with the `group` field.

### Layout Options

**Types:**
- `layered` (default): Hierarchical tree, good for call flows
- `force`: Compact web layout, good for interconnected systems
- `stress`: Even spacing, good for general relationships

**Directions** (for layered): `TB` (top-bottom), `LR` (left-right), `BT`, `RL`

### Legend

```json
"legend": {
  "title": "Data Flow",
  "items": [
    { "color": "#ff6b6b", "label": "Write operations" },
    { "color": "#4ecdc4", "label": "Read operations" }
  ]
}
```

</details>

## Development

### Quick Start

```bash
pnpm install        # install dependencies
pnpm setup          # one-time setup (installs vsce)
pnpm build:local    # build, package, and install locally
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm setup` | One-time dev setup |
| `pnpm build` | Build extension and webview |
| `pnpm build:local` | Build, package, and install to VS Code/Cursor |
| `pnpm package` | Create `.vsix` package |

### Testing

**Quick testing:** Run `pnpm build:local` to build and install. The script auto-detects VS Code vs Cursor and can reload your window automatically.

**Debugging:** Use VS Code's Run and Debug panel → select "Run Extension (Watch)". This launches an Extension Development Host with automatic rebuilds.

### Project Structure

```
codetographer/
├── extension/          # VS Code extension (TypeScript)
│   ├── src/
│   │   ├── extension.ts
│   │   └── cgraphEditorProvider.ts
│   └── media/          # Built webview assets
├── webview/            # React app for graph rendering
│   └── src/
│       ├── components/
│       │   ├── GraphCanvas.tsx
│       │   └── CodeNode.tsx
│       └── hooks/
├── skill/              # AI skill for generating graphs
│   └── SKILL.md
└── scripts/            # Build utilities
```

## License

Apache 2.0 - see [LICENSE](LICENSE) for details.
