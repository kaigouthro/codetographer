import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CallGraphAnalyzer } from '../analyzer/callGraphAnalyzer';
import { AnalysisOptions, CallGraph } from '../analyzer/types';

interface CGraph {
  version: string;
  metadata: {
    title: string;
    description?: string;
    generated: string;
    scope?: string;
  };
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    description?: string;
    location: {
      file: string;
      startLine: number;
      endLine?: number;
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
  }>;
  layout?: {
    direction: string;
  };
}

export async function generateCallGraphFromSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    return;
  }

  const document = editor.document;
  const selection = editor.selection;

  // Get workspace root
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('File is not in a workspace');
    return;
  }

  // Get configuration
  const config = vscode.workspace.getConfiguration('codetographer.analysis');
  const maxDepth = config.get<number>('maxDepth', 3);
  const maxNodes = config.get<number>('maxNodes', 50);
  const includeNodeModules = config.get<boolean>('includeNodeModules', false);

  const options: AnalysisOptions = {
    maxDepth,
    maxNodes,
    includeNodeModules,
    workspaceRoot: workspaceFolder.uri.fsPath,
  };

  // Determine what function/class is at the cursor
  const position = selection.active;
  const wordRange = document.getWordRangeAtPosition(position);
  if (!wordRange) {
    vscode.window.showErrorMessage('No symbol at cursor position');
    return;
  }

  const functionName = document.getText(wordRange);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Generating call graph for ${functionName}`,
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ increment: 20, message: 'Analyzing codebase...' });

        const analyzer = new CallGraphAnalyzer(workspaceFolder.uri.fsPath);
        const callGraph = await analyzer.generateCallGraph(
          document.uri.fsPath,
          functionName,
          options
        );

        progress.report({ increment: 40, message: 'Building graph...' });

        const cgraph = convertToCGraph(callGraph, functionName, workspaceFolder.uri.fsPath);

        progress.report({ increment: 20, message: 'Creating file...' });

        await saveCGraphFile(cgraph, functionName, workspaceFolder.uri.fsPath);

        progress.report({ increment: 20, message: 'Done!' });
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to generate call graph: ${error}`);
      }
    }
  );
}

export async function analyzeCodebase(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  // Get configuration
  const config = vscode.workspace.getConfiguration('codetographer.analysis');
  const maxDepth = config.get<number>('maxDepth', 3);
  const maxNodes = config.get<number>('maxNodes', 50);
  const includeNodeModules = config.get<boolean>('includeNodeModules', false);
  const filePatterns = config.get<string[]>('filePatterns', [
    '**/*.js',
    '**/*.jsx',
    '**/*.ts',
    '**/*.tsx',
  ]);
  const excludePatterns = config.get<string[]>('excludePatterns', [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
  ]);

  const options: AnalysisOptions = {
    maxDepth,
    maxNodes,
    includeNodeModules,
    workspaceRoot,
  };

  // Ask user for confirmation
  const answer = await vscode.window.showInformationMessage(
    `Analyze entire codebase? This may take some time for large projects.`,
    'Yes',
    'No'
  );

  if (answer !== 'Yes') {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Analyzing codebase',
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ increment: 20, message: 'Finding files...' });

        const analyzer = new CallGraphAnalyzer(workspaceRoot);
        const callGraph = await analyzer.analyzeCodebase(
          filePatterns,
          excludePatterns,
          options
        );

        progress.report({ increment: 40, message: 'Building graph...' });

        // For large graphs, we might want to filter or group nodes
        const cgraph = convertToCGraph(callGraph, 'Codebase Overview', workspaceRoot);

        progress.report({ increment: 20, message: 'Creating file...' });

        await saveCGraphFile(cgraph, 'codebase-analysis', workspaceRoot);

        progress.report({ increment: 20, message: 'Done!' });

        vscode.window.showInformationMessage(
          `Analyzed ${callGraph.nodes.size} functions/classes`
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to analyze codebase: ${error}`);
      }
    }
  );
}

function convertToCGraph(
  callGraph: CallGraph,
  title: string,
  workspaceRoot: string
): CGraph {
  const nodes = Array.from(callGraph.nodes.values()).map((node) => ({
    id: node.id,
    label: node.name,
    type: node.type,
    description: `Located in ${node.filePath}`,
    location: {
      file: node.filePath,
      startLine: node.startLine,
      endLine: node.endLine,
    },
  }));

  const edges = callGraph.edges.map((edge, index) => ({
    id: `edge-${index}`,
    source: edge.source,
    target: edge.target,
    type: edge.type,
  }));

  return {
    version: '1.0',
    metadata: {
      title,
      description: `Call graph with ${nodes.length} nodes and ${edges.length} edges`,
      generated: new Date().toISOString(),
      scope: workspaceRoot,
    },
    nodes,
    edges,
    layout: {
      direction: 'TB',
    },
  };
}

async function saveCGraphFile(
  cgraph: CGraph,
  baseName: string,
  workspaceRoot: string
): Promise<void> {
  const fileName = `${baseName}-callgraph.cgraph`;
  const filePath = path.join(workspaceRoot, fileName);

  // Write the file
  fs.writeFileSync(filePath, JSON.stringify(cgraph, null, 2), 'utf-8');

  // Open the file
  const uri = vscode.Uri.file(filePath);
  await vscode.commands.executeCommand('vscode.open', uri);

  vscode.window.showInformationMessage(`Created call graph: ${fileName}`);
}
