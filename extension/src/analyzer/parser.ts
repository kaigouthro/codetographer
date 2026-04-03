import * as parser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import * as fs from 'fs';
import * as path from 'path';
import { FileAnalysis, FunctionInfo, ImportInfo } from './types';

export class CodeParser {
  /**
   * Parse a JavaScript/TypeScript file and extract function definitions and calls
   */
  static parseFile(filePath: string, workspaceRoot: string): FileAnalysis | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(workspaceRoot, filePath);

      const ast = parser.parse(content, {
        sourceType: 'module',
        plugins: [
          'typescript',
          'jsx',
          'decorators-legacy',
          'classProperties',
          'objectRestSpread',
          'optionalChaining',
          'nullishCoalescingOperator',
          'dynamicImport',
        ],
      });

      const functions = new Map<string, FunctionInfo>();
      const imports = new Map<string, ImportInfo>();
      const exports = new Set<string>();

      // Use a stack to correctly track nested class scopes
      const classStack: string[] = [];

      traverse(ast, {
        // Track imports
        ImportDeclaration(nodePath: NodePath<t.ImportDeclaration>) {
          const source = nodePath.node.source.value;
          nodePath.node.specifiers.forEach((spec) => {
            if (t.isImportSpecifier(spec) && t.isIdentifier(spec.imported)) {
              imports.set(spec.local.name, {
                source,
                importedAs: spec.imported.name,
              });
            } else if (t.isImportDefaultSpecifier(spec)) {
              imports.set(spec.local.name, { source, importedAs: 'default' });
            } else if (t.isImportNamespaceSpecifier(spec)) {
              imports.set(spec.local.name, { source, importedAs: '*' });
            }
          });
        },

        // Track exports
        ExportNamedDeclaration(nodePath: NodePath<t.ExportNamedDeclaration>) {
          if (nodePath.node.declaration) {
            if (t.isFunctionDeclaration(nodePath.node.declaration) && nodePath.node.declaration.id) {
              exports.add(nodePath.node.declaration.id.name);
            } else if (t.isClassDeclaration(nodePath.node.declaration) && nodePath.node.declaration.id) {
              exports.add(nodePath.node.declaration.id.name);
            } else if (t.isVariableDeclaration(nodePath.node.declaration)) {
              nodePath.node.declaration.declarations.forEach((decl) => {
                if (t.isIdentifier(decl.id)) {
                  exports.add(decl.id.name);
                }
              });
            }
          }
          nodePath.node.specifiers?.forEach((spec) => {
            if (t.isExportSpecifier(spec) && t.isIdentifier(spec.exported)) {
              exports.add(spec.exported.name);
            }
          });
        },

        ExportDefaultDeclaration(nodePath: NodePath<t.ExportDefaultDeclaration>) {
          if (t.isFunctionDeclaration(nodePath.node.declaration) && nodePath.node.declaration.id) {
            exports.add(nodePath.node.declaration.id.name);
          } else if (t.isClassDeclaration(nodePath.node.declaration) && nodePath.node.declaration.id) {
            exports.add(nodePath.node.declaration.id.name);
          } else if (t.isIdentifier(nodePath.node.declaration)) {
            exports.add(nodePath.node.declaration.name);
          }
        },

        // Track class declarations using enter/exit to correctly scope methods
        ClassDeclaration: {
          enter(nodePath: NodePath<t.ClassDeclaration>) {
            if (!nodePath.node.id) return;
            const className = nodePath.node.id.name;
            const startLine = nodePath.node.loc?.start.line || 0;
            const endLine = nodePath.node.loc?.end.line || 0;

            classStack.push(className);

            functions.set(className, {
              name: className,
              type: 'class',
              filePath: relativePath,
              startLine,
              endLine,
              calls: [],
              imports: new Map(imports),
              scope: '',
            });
          },
          exit() {
            classStack.pop();
          },
        },

        // Track function declarations
        FunctionDeclaration(nodePath: NodePath<t.FunctionDeclaration>) {
          if (!nodePath.node.id) return;

          const funcName = nodePath.node.id.name;
          const startLine = nodePath.node.loc?.start.line || 0;
          const endLine = nodePath.node.loc?.end.line || 0;
          const calls: string[] = [];

          // Find all function calls within this function
          nodePath.traverse({
            CallExpression(callPath: NodePath<t.CallExpression>) {
              const callee = callPath.node.callee;
              if (t.isIdentifier(callee)) {
                calls.push(callee.name);
              } else if (t.isMemberExpression(callee)) {
                const objName = CodeParser.getMemberExpressionName(callee);
                if (objName) calls.push(objName);
              }
            },
          });

          const scope = classStack[classStack.length - 1] || '';
          const fullName = scope ? `${scope}.${funcName}` : funcName;

          functions.set(fullName, {
            name: funcName,
            type: 'function',
            filePath: relativePath,
            startLine,
            endLine,
            calls,
            imports: new Map(imports),
            scope,
          });
        },

        // Track arrow functions and function expressions assigned to variables
        VariableDeclarator(nodePath: NodePath<t.VariableDeclarator>) {
          if (!t.isIdentifier(nodePath.node.id)) return;

          const varName = nodePath.node.id.name;
          const init = nodePath.node.init;

          if (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) {
            const startLine = nodePath.node.loc?.start.line || 0;
            const endLine = nodePath.node.loc?.end.line || 0;
            const calls: string[] = [];

            // Find all function calls within this function
            const functionPath = nodePath.get('init') as NodePath;
            functionPath.traverse({
              CallExpression(callPath: NodePath<t.CallExpression>) {
                const callee = callPath.node.callee;
                if (t.isIdentifier(callee)) {
                  calls.push(callee.name);
                } else if (t.isMemberExpression(callee)) {
                  const objName = CodeParser.getMemberExpressionName(callee);
                  if (objName) calls.push(objName);
                }
              },
            });

            const scope = classStack[classStack.length - 1] || '';
            const fullName = scope ? `${scope}.${varName}` : varName;

            functions.set(fullName, {
              name: varName,
              type: 'arrow',
              filePath: relativePath,
              startLine,
              endLine,
              calls,
              imports: new Map(imports),
              scope,
            });
          }
        },

        // Track class methods
        ClassMethod(nodePath: NodePath<t.ClassMethod>) {
          if (!t.isIdentifier(nodePath.node.key) && !t.isStringLiteral(nodePath.node.key)) return;

          const methodName = t.isIdentifier(nodePath.node.key)
            ? nodePath.node.key.name
            : nodePath.node.key.value;
          const startLine = nodePath.node.loc?.start.line || 0;
          const endLine = nodePath.node.loc?.end.line || 0;
          const calls: string[] = [];

          // Find all function calls within this method
          nodePath.traverse({
            CallExpression(callPath: NodePath<t.CallExpression>) {
              const callee = callPath.node.callee;
              if (t.isIdentifier(callee)) {
                calls.push(callee.name);
              } else if (t.isMemberExpression(callee)) {
                const objName = CodeParser.getMemberExpressionName(callee);
                if (objName) calls.push(objName);
              }
            },
          });

          const scope = classStack[classStack.length - 1] || '';
          const fullName = scope ? `${scope}.${methodName}` : methodName;

          functions.set(fullName, {
            name: methodName,
            type: 'method',
            filePath: relativePath,
            startLine,
            endLine,
            calls,
            imports: new Map(imports),
            scope,
          });
        },
      });

      return {
        filePath: relativePath,
        functions,
        imports,
        exports,
      };
    } catch (error) {
      console.error(`Error parsing file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Get the full name of a member expression (e.g., 'obj.method' or 'this.method').
   * Returns null for unresolvable expressions such as chained call results
   * (e.g., `obj.method1().method2()`).
   */
  private static getMemberExpressionName(node: t.MemberExpression): string | null {
    const parts: string[] = [];

    const walkMemberExpr = (n: t.Expression | t.PrivateName): boolean => {
      if (t.isIdentifier(n)) {
        parts.unshift(n.name);
        return true;
      } else if (t.isMemberExpression(n)) {
        if (t.isIdentifier(n.property)) {
          parts.unshift(n.property.name);
        }
        return walkMemberExpr(n.object);
      } else if (t.isThisExpression(n)) {
        parts.unshift('this');
        return true;
      }
      // CallExpression objects (chained calls like obj.method1().method2()) are
      // not supported - return false so the caller can skip them gracefully.
      return false;
    };

    if (walkMemberExpr(node)) {
      return parts.join('.');
    }
    return null;
  }
}

