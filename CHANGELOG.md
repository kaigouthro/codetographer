# Changelog

All notable changes to the Codetographer extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-04-03

### Added
- **Automatic Semantic Call Graph Analysis** for JavaScript and TypeScript
  - New command: `Codetographer: Generate Call Graph from Selection`
    - Analyzes a specific function and generates its call graph automatically
    - Traces function calls across files with configurable depth
  - New command: `Codetographer: Analyze Codebase Call Graph`
    - Analyzes entire codebase and generates comprehensive call graph
    - Configurable file patterns and exclusions
- **Code Parser** using Babel
  - Parses JavaScript and TypeScript files
  - Extracts function declarations, arrow functions, class methods
  - Tracks imports, exports, and function calls
  - Handles modern JavaScript features (JSX, decorators, optional chaining, etc.)
- **Call Graph Analyzer**
  - BFS-based graph traversal from starting function
  - Cross-file dependency tracking
  - Import path resolution
  - Configurable depth and node limits
- **Configuration Options** (VS Code settings)
  - `codetographer.analysis.maxDepth`: Maximum depth for call graph analysis (default: 3)
  - `codetographer.analysis.maxNodes`: Maximum number of nodes (default: 50)
  - `codetographer.analysis.includeNodeModules`: Include node_modules in analysis (default: false)
  - `codetographer.analysis.filePatterns`: File patterns to include (default: JS/TS files)
  - `codetographer.analysis.excludePatterns`: Patterns to exclude (default: node_modules, dist, build)
- **Documentation**
  - Updated README with automatic analysis features
  - Updated skill file with new capabilities
  - Added semantic analysis examples and usage guide
  - Added configuration examples

### Changed
- Updated extension description to mention semantic analysis
- Bumped version to 0.2.0
- Enhanced skill file with two modes of operation (automatic vs manual)

### Dependencies
- Added `@babel/parser` ^7.23.0
- Added `@babel/traverse` ^7.23.0
- Added `@babel/types` ^7.23.0
- Added `@types/babel__traverse` ^7.20.0

## [0.1.3] - 2026-01-25

### Changed
- Updated README for marketplace release
- Updated demo image link

## [0.1.0] - 2025-11-25

### Added
- Initial release
- Custom editor for `.cgraph` files
- Interactive graph visualization using React Flow and ELK.js
- Node types: function, method, class, module, file
- Edge types: calls, imports, extends, implements, uses
- Support for groups (visual sections)
- Layout options: layered, force, stress
- Click to navigate to code locations
- Draggable nodes with position persistence
- Legend support for custom edge colors
- AI skill file for generating `.cgraph` files
- Command to open `.cgraph` as JSON text

[0.2.0]: https://github.com/Kelvination/codetographer/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/Kelvination/codetographer/compare/v0.1.0...v0.1.3
[0.1.0]: https://github.com/Kelvination/codetographer/releases/tag/v0.1.0
