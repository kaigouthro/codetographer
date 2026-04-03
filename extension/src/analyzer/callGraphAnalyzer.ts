import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodeParser } from './parser';
import {
  FileAnalysis,
  FunctionInfo,
  CallGraph,
  CallGraphNode,
  CallGraphEdge,
  AnalysisOptions,
} from './types';

export class CallGraphAnalyzer {
  private fileCache: Map<string, FileAnalysis> = new Map();

  constructor(private workspaceRoot: string) {}

  /**
   * Generate a call graph starting from a specific function
   */
  async generateCallGraph(
    startFilePath: string,
    startFunctionName: string,
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

    // Find the starting function
    const startFunc = startFile.functions.get(startFunctionName);
    if (!startFunc) {
      throw new Error(`Function ${startFunctionName} not found in ${startFilePath}`);
    }

    // Add starting node
    const startNodeId = this.createNodeId(startFunc.filePath, startFunctionName);
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
        // Check if this is an imported function
        let targetFile = filePath;
        let targetFuncName = calledFuncName;

        if (funcInfo.imports.has(calledFuncName)) {
          const importSource = funcInfo.imports.get(calledFuncName)!;

          // Skip node_modules if not included
          if (!options.includeNodeModules && importSource.includes('node_modules')) {
            continue;
          }

          // Resolve the import path
          const resolvedPath = this.resolveImportPath(filePath, importSource);
          if (!resolvedPath) continue;

          targetFile = resolvedPath;
          // For imports, we might need to find the actual exported function
          const targetFileAnalysis = await this.analyzeFile(
            path.join(this.workspaceRoot, resolvedPath)
          );
          if (!targetFileAnalysis) continue;

          // Try to find the function in the target file
          if (!targetFileAnalysis.functions.has(calledFuncName)) {
            // If not found directly, it might be a default export or renamed
            // For now, skip
            continue;
          }
        } else {
          // Local function call - try to find it in the same file
          const localFunc = fileAnalysis.functions.get(calledFuncName);
          if (!localFunc) {
            // Might be a method call on 'this' or a different scope
            // Try to find with current scope
            const scopedName = funcInfo.scope
              ? `${funcInfo.scope}.${calledFuncName}`
              : calledFuncName;
            const scopedFunc = fileAnalysis.functions.get(scopedName);
            if (scopedFunc) {
              targetFuncName = scopedName;
            } else {
              continue; // Function not found
            }
          }
        }

        const targetNodeId = this.createNodeId(targetFile, targetFuncName);

        // Add the called function as a node if not already added
        if (!graph.nodes.has(targetNodeId)) {
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
   * Analyze all files in the workspace and build a complete call graph
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

    // Build the graph
    for (const [filePath, analysis] of fileAnalyses) {
      for (const [funcName, funcInfo] of analysis.functions) {
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
          // Try to resolve the call
          let targetFile = filePath;
          let targetFuncName = calledFunc;

          if (funcInfo.imports.has(calledFunc)) {
            const importSource = funcInfo.imports.get(calledFunc)!;
            if (!options.includeNodeModules && importSource.includes('node_modules')) {
              continue;
            }

            const resolvedPath = this.resolveImportPath(filePath, importSource);
            if (resolvedPath && fileAnalyses.has(resolvedPath)) {
              targetFile = resolvedPath;
            } else {
              continue;
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
   * Resolve an import path to an absolute file path
   */
  private resolveImportPath(fromFile: string, importPath: string): string | null {
    // Handle relative imports
    if (importPath.startsWith('.')) {
      const fromDir = path.dirname(fromFile);
      let resolved = path.join(fromDir, importPath);

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
    }

    // Handle node_modules or other absolute imports
    // For now, we skip these unless they're in the workspace
    return null;
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
    const parts = nodeId.split('::');
    return [parts[0], parts[1]];
  }

  /**
   * Clear the file cache
   */
  clearCache(): void {
    this.fileCache.clear();
  }
}
