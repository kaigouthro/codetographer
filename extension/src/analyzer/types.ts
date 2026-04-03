export interface FunctionInfo {
  name: string;
  type: 'function' | 'method' | 'class' | 'arrow';
  filePath: string;
  startLine: number;
  endLine: number;
  calls: string[]; // Names of functions this function calls
  imports: Map<string, string>; // imported name -> source file
  scope: string; // parent scope (e.g., 'MyClass.myMethod')
}

export interface FileAnalysis {
  filePath: string;
  functions: Map<string, FunctionInfo>;
  imports: Map<string, string>; // imported name -> source file
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
