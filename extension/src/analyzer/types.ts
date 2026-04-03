export interface ImportInfo {
  source: string; // module specifier (e.g. './utils' or 'lodash')
  importedAs: string; // original exported name in the source module (or 'default')
}

export interface FunctionInfo {
  name: string;
  type: 'function' | 'method' | 'class' | 'arrow';
  filePath: string;
  startLine: number;
  endLine: number;
  calls: string[]; // Names of functions this function calls
  imports: Map<string, ImportInfo>; // local name -> { source, importedAs }
  scope: string; // parent scope (e.g., 'MyClass')
}

export interface FileAnalysis {
  filePath: string;
  functions: Map<string, FunctionInfo>;
  imports: Map<string, ImportInfo>; // local name -> { source, importedAs }
  exports: Set<string>; // exported function/class names
}

export interface CallGraphNode {
  id: string;
  name: string;
  type: 'function' | 'method' | 'class' | 'module' | 'file';
  filePath: string;
  startLine: number;
  endLine: number;
  description?: string;
}

export interface CallGraphEdge {
  source: string;
  target: string;
  type: 'calls' | 'imports' | 'extends' | 'implements';
}

export interface CallGraph {
  nodes: Map<string, CallGraphNode>;
  edges: CallGraphEdge[];
}

export interface AnalysisOptions {
  maxDepth: number;
  maxNodes: number;
  includeNodeModules: boolean;
  workspaceRoot: string;
}
