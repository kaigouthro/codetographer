import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodeParser } from './parser';
import {
  FileAnalysis,
  CallGraph,
  CallGraphNode,
  CallGraphEdge,
  AnalysisOptions,
} from './types';

export class CallGraphAnalyzer {
  private fileCache: Map<string, FileAnalysis> = new Map();

  constructor(private workspaceRoot: string) {}

  /**
   * Generate a call graph starting from a specific function.
   * Falls back to line-number-based lookup when the bare name is not found,
   * so class methods (stored as `ClassName.methodName`) can be resolved from
   * a cursor position.
   */
  async generateCallGraph(
    startFilePath: string,
    startFunctionName: string,
    startLine: number,
    options: AnalysisOptions
  ): Promise<CallGraph> {
    const graph: CallGraph = {
      nodes: new Map(),
      edges: [],
    };

    const visited = new Set<string>();
    const queue: Array<{ funcId: string; depth: number }> = [];

    // Parse the starting file
    const startFile = await this.analyzeFile(startFilePath);
    if (!startFile) {
      throw new Error(`Failed to parse file: ${startFilePath}`);
    }

    // Find the starting function: exact match first, then by cursor line,
    // then by suffix (handles class methods when only the bare name is given).
    let resolvedName = startFunctionName;
    if (!startFile.functions.has(startFunctionName)) {
      // Try to find by cursor position
      const byLine = this.findFunctionByLine(startFile, startLine);
      if (byLine) {
        resolvedName = byLine;
      } else {
        // Try suffix match: `ClassName.methodName` ending with `.${startFunctionName}`
        const suffix = `.${startFunctionName}`;
        for (const key of startFile.functions.keys()) {
          if (key.endsWith(suffix)) {
            resolvedName = key;
            break;
          }
        }
      }
    }

    const startFunc = startFile.functions.get(resolvedName);
    if (!startFunc) {
      throw new Error(`Function '${startFunctionName}' not found in ${startFilePath}`);
    }

    // Add starting node
    const startNodeId = this.createNodeId(startFunc.filePath, resolvedName);
    graph.nodes.set(startNodeId, {
      id: startNodeId,
      name: startFunc.name,
      type: startFunc.type === 'arrow' ? 'function' : startFunc.type,
      filePath: startFunc.filePath,
      startLine: startFunc.startLine,
      endLine: startFunc.endLine,
    });

    queue.push({ funcId: startNodeId, depth: 0 });
    visited.add(startNodeId);

    // BFS to traverse the call graph
    while (queue.length > 0 && graph.nodes.size < options.maxNodes) {
      const { funcId, depth } = queue.shift()!;

      if (depth >= options.maxDepth) {
        continue;
      }

      // Get the function info
      const [filePath, functionName] = this.parseNodeId(funcId);
      const fileAnalysis = await this.analyzeFile(
        path.join(this.workspaceRoot, filePath)
      );

      if (!fileAnalysis) continue;

      const funcInfo = fileAnalysis.functions.get(functionName);
      if (!funcInfo) continue;

      // Process each function call
      for (const calledFuncName of funcInfo.calls) {
        // Normalize `this.method` → `ClassName.method` so intra-class edges resolve.
        const normalizedCallName = this.normalizeCall(calledFuncName, funcInfo.scope);

        // Check if this is an imported function
        let targetFile = filePath;
        let targetFuncName = normalizedCallName;

        // Use the local (possibly aliased) name for import lookup
        const localCallName = normalizedCallName.startsWith('this.')
          ? normalizedCallName.slice(5)
          : normalizedCallName;

        if (funcInfo.imports.has(localCallName)) {
          const importInfo = funcInfo.imports.get(localCallName)!;
          const importSource = importInfo.source;

          // Skip external (non-relative) package imports unless configured otherwise
          const isExternal =
            !importSource.startsWith('.') && !path.isAbsolute(importSource);
          if (!options.includeNodeModules && isExternal) {
            continue;
          }

          // Resolve the import path
          const resolvedPath = this.resolveImportPath(filePath, importSource);
          if (!resolvedPath) continue;

          targetFile = resolvedPath;
          const targetFileAnalysis = await this.analyzeFile(
            path.join(this.workspaceRoot, resolvedPath)
          );
          if (!targetFileAnalysis) continue;

          // The function in the target module is exported under its original name
          const exportedName = importInfo.importedAs;
          if (exportedName === 'default') {
            // Try to find the default export - first look for the local alias, then any default
            if (!targetFileAnalysis.functions.has(localCallName)) {
              continue;
            }
            targetFuncName = localCallName;
          } else if (exportedName === '*') {
            // Namespace import - skip for now
            continue;
          } else {
            if (!targetFileAnalysis.functions.has(exportedName)) {
              continue;
            }
            targetFuncName = exportedName;
          }
        } else {
          // Local function call - try exact match first
          if (!fileAnalysis.functions.has(normalizedCallName)) {
            // Try with current scope prefix (e.g., `ClassName.method`)
            const scopedName = funcInfo.scope
              ? `${funcInfo.scope}.${normalizedCallName}`
              : normalizedCallName;
            if (fileAnalysis.functions.has(scopedName)) {
              targetFuncName = scopedName;
            } else {
              continue; // Function not found locally
            }
          }
        }

        const targetNodeId = this.createNodeId(targetFile, targetFuncName);

        // Add the called function as a node if not already added
        if (!graph.nodes.has(targetNodeId) && graph.nodes.size < options.maxNodes) {
          const targetFileAnalysis = await this.analyzeFile(
            path.join(this.workspaceRoot, targetFile)
          );
          const targetFunc = targetFileAnalysis?.functions.get(targetFuncName);

          if (targetFunc) {
            graph.nodes.set(targetNodeId, {
              id: targetNodeId,
              name: targetFunc.name,
              type: targetFunc.type === 'arrow' ? 'function' : targetFunc.type,
              filePath: targetFunc.filePath,
              startLine: targetFunc.startLine,
              endLine: targetFunc.endLine,
            });

            // Add to queue for further exploration
            if (!visited.has(targetNodeId)) {
              visited.add(targetNodeId);
              queue.push({ funcId: targetNodeId, depth: depth + 1 });
            }
          }
        }

        // Add edge
        if (graph.nodes.has(targetNodeId)) {
          graph.edges.push({
            source: funcId,
            target: targetNodeId,
            type: targetFile !== filePath ? 'imports' : 'calls',
          });
        }
      }
    }

    return graph;
  }

  /**
   * Analyze all files in the workspace and build a complete call graph.
   * Respects maxNodes to prevent unbounded graph growth on large codebases.
   */
  async analyzeCodebase(
    filePatterns: string[],
    excludePatterns: string[],
    options: AnalysisOptions
  ): Promise<CallGraph> {
    const graph: CallGraph = {
      nodes: new Map(),
      edges: [],
    };

    // Find all matching files
    const files = await this.findFiles(filePatterns, excludePatterns);

    // Analyze each file
    const fileAnalyses = new Map<string, FileAnalysis>();
    for (const file of files) {
      const analysis = await this.analyzeFile(file);
      if (analysis) {
        const relativePath = path.relative(this.workspaceRoot, file);
        fileAnalyses.set(relativePath, analysis);
      }
    }

    // Build the graph, respecting maxNodes
    outer: for (const [filePath, analysis] of fileAnalyses) {
      for (const [funcName, funcInfo] of analysis.functions) {
        if (graph.nodes.size >= options.maxNodes) break outer;

        const nodeId = this.createNodeId(filePath, funcName);

        // Add node
        graph.nodes.set(nodeId, {
          id: nodeId,
          name: funcInfo.name,
          type: funcInfo.type === 'arrow' ? 'function' : funcInfo.type,
          filePath: funcInfo.filePath,
          startLine: funcInfo.startLine,
          endLine: funcInfo.endLine,
        });

        // Add edges for function calls
        for (const calledFunc of funcInfo.calls) {
          const normalizedCall = this.normalizeCall(calledFunc, funcInfo.scope);
          const localCallName = normalizedCall.startsWith('this.')
            ? normalizedCall.slice(5)
            : normalizedCall;

          let targetFile = filePath;
          let targetFuncName = normalizedCall;

          if (funcInfo.imports.has(localCallName)) {
            const importInfo = funcInfo.imports.get(localCallName)!;
            const importSource = importInfo.source;

            const isExternal =
              !importSource.startsWith('.') && !path.isAbsolute(importSource);
            if (!options.includeNodeModules && isExternal) {
              continue;
            }

            const resolvedPath = this.resolveImportPath(filePath, importSource);
            if (!resolvedPath || !fileAnalyses.has(resolvedPath)) {
              continue;
            }
            targetFile = resolvedPath;
            const exportedName = importInfo.importedAs;
            if (exportedName === 'default') {
              targetFuncName = localCallName;
            } else if (exportedName === '*') {
              continue;
            } else {
              targetFuncName = exportedName;
            }
          }

          const targetNodeId = this.createNodeId(targetFile, targetFuncName);
          if (graph.nodes.has(targetNodeId)) {
            graph.edges.push({
              source: nodeId,
              target: targetNodeId,
              type: targetFile !== filePath ? 'imports' : 'calls',
            });
          }
        }
      }
    }

    return graph;
  }

  /**
   * Analyze a single file and cache the result
   */
  private async analyzeFile(filePath: string): Promise<FileAnalysis | null> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.workspaceRoot, filePath);

    if (this.fileCache.has(absolutePath)) {
      return this.fileCache.get(absolutePath)!;
    }

    const analysis = CodeParser.parseFile(absolutePath, this.workspaceRoot);
    if (analysis) {
      this.fileCache.set(absolutePath, analysis);
    }

    return analysis;
  }

  /**
   * Find files matching the given patterns
   */
  private async findFiles(
    includePatterns: string[],
    excludePatterns: string[]
  ): Promise<string[]> {
    const files: string[] = [];

    for (const pattern of includePatterns) {
      const uris = await vscode.workspace.findFiles(
        pattern,
        `{${excludePatterns.join(',')}}`
      );
      files.push(...uris.map((uri) => uri.fsPath));
    }

    return files;
  }

  /**
   * Resolve an import path to a relative file path (relative to workspaceRoot).
   * Only handles relative imports; absolute/package imports return null.
   */
  private resolveImportPath(fromFile: string, importPath: string): string | null {
    // Only handle relative imports
    if (!importPath.startsWith('.')) {
      return null;
    }

    const fromDir = path.dirname(fromFile);
    const resolved = path.join(fromDir, importPath);

    // Try common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    for (const ext of ['', ...extensions]) {
      const testPath = path.join(this.workspaceRoot, resolved + ext);
      if (fs.existsSync(testPath)) {
        return path.relative(this.workspaceRoot, testPath);
      }
    }

    // Try index files
    for (const ext of extensions) {
      const indexPath = path.join(this.workspaceRoot, resolved, `index${ext}`);
      if (fs.existsSync(indexPath)) {
        return path.relative(this.workspaceRoot, indexPath);
      }
    }

    return null;
  }

  /**
   * Normalize a call expression name:
   * - `this.method` → `Scope.method` when scope is known
   * - Other forms are returned unchanged
   */
  private normalizeCall(callName: string, scope: string): string {
    if (callName.startsWith('this.') && scope) {
      return `${scope}.${callName.slice(5)}`;
    }
    return callName;
  }

  /**
   * Find the innermost function/method whose line range contains `line`.
   * Returns the map key (e.g. `ClassName.methodName`) or null.
   */
  private findFunctionByLine(
    fileAnalysis: FileAnalysis,
    line: number
  ): string | null {
    let bestKey: string | null = null;
    let bestSize = Infinity;

    for (const [key, info] of fileAnalysis.functions) {
      if (info.type === 'class') continue; // Skip class nodes
      if (info.startLine <= line && info.endLine >= line) {
        const size = info.endLine - info.startLine;
        if (size < bestSize) {
          bestSize = size;
          bestKey = key;
        }
      }
    }

    return bestKey;
  }

  /**
   * Create a unique node ID from file path and function name
   */
  private createNodeId(filePath: string, functionName: string): string {
    return `${filePath}::${functionName}`;
  }

  /**
   * Parse a node ID back into file path and function name
   */
  private parseNodeId(nodeId: string): [string, string] {
    const idx = nodeId.indexOf('::');
    return [nodeId.slice(0, idx), nodeId.slice(idx + 2)];
  }

  /**
   * Clear the file cache
   */
  clearCache(): void {
    this.fileCache.clear();
  }
}
