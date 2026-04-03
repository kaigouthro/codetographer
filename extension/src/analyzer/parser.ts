import * as parser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import * as fs from 'fs';
import * as path from 'path';
import { FileAnalysis, FunctionInfo } from './types';

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
      const imports = new Map<string, string>();
      const exports = new Set<string>();

      // Track current scope for nested functions
      let currentClass: string | null = null;

      traverse(ast, {
        // Track imports
        ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
          const source = path.node.source.value;
          path.node.specifiers.forEach((spec) => {
            if (t.isImportSpecifier(spec) && t.isIdentifier(spec.imported)) {
              imports.set(spec.local.name, source);
            } else if (t.isImportDefaultSpecifier(spec)) {
              imports.set(spec.local.name, source);
            } else if (t.isImportNamespaceSpecifier(spec)) {
              imports.set(spec.local.name, source);
            }
          });
        },

        // Track exports
        ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
          if (path.node.declaration) {
            if (t.isFunctionDeclaration(path.node.declaration) && path.node.declaration.id) {
              exports.add(path.node.declaration.id.name);
            } else if (t.isClassDeclaration(path.node.declaration) && path.node.declaration.id) {
              exports.add(path.node.declaration.id.name);
            } else if (t.isVariableDeclaration(path.node.declaration)) {
              path.node.declaration.declarations.forEach((decl) => {
                if (t.isIdentifier(decl.id)) {
                  exports.add(decl.id.name);
                }
              });
            }
          }
          path.node.specifiers?.forEach((spec) => {
            if (t.isExportSpecifier(spec) && t.isIdentifier(spec.exported)) {
              exports.add(spec.exported.name);
            }
          });
        },

        ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
          if (t.isFunctionDeclaration(path.node.declaration) && path.node.declaration.id) {
            exports.add(path.node.declaration.id.name);
          } else if (t.isClassDeclaration(path.node.declaration) && path.node.declaration.id) {
            exports.add(path.node.declaration.id.name);
          } else if (t.isIdentifier(path.node.declaration)) {
            exports.add(path.node.declaration.name);
          }
        },

        // Track class declarations
        ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
          if (!path.node.id) return;

          const className = path.node.id.name;
          const startLine = path.node.loc?.start.line || 0;
          const endLine = path.node.loc?.end.line || 0;

          currentClass = className;

          functions.set(className, {
            name: className,
            type: 'class',
            filePath: relativePath,
            startLine,
            endLine,
            calls: [],
            imports: new Map(),
            scope: '',
          });
        },

        // Track function declarations
        FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
          if (!path.node.id) return;

          const funcName = path.node.id.name;
          const startLine = path.node.loc?.start.line || 0;
          const endLine = path.node.loc?.end.line || 0;
          const calls: string[] = [];

          // Find all function calls within this function
          path.traverse({
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

          const scope = currentClass || '';
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
        VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
          if (!t.isIdentifier(path.node.id)) return;

          const varName = path.node.id.name;
          const init = path.node.init;

          if (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) {
            const startLine = path.node.loc?.start.line || 0;
            const endLine = path.node.loc?.end.line || 0;
            const calls: string[] = [];

            // Find all function calls within this function
            const functionPath = path.get('init') as NodePath;
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

            const scope = currentClass || '';
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
        ClassMethod(path: NodePath<t.ClassMethod>) {
          if (!t.isIdentifier(path.node.key) && !t.isStringLiteral(path.node.key)) return;

          const methodName = t.isIdentifier(path.node.key)
            ? path.node.key.name
            : path.node.key.value;
          const startLine = path.node.loc?.start.line || 0;
          const endLine = path.node.loc?.end.line || 0;
          const calls: string[] = [];

          // Find all function calls within this method
          path.traverse({
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

          const scope = currentClass || '';
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
   * Get the full name of a member expression (e.g., 'obj.method' or 'this.method')
   */
  private static getMemberExpressionName(node: t.MemberExpression): string | null {
    const parts: string[] = [];

    const traverse = (n: t.Expression | t.PrivateName): boolean => {
      if (t.isIdentifier(n)) {
        parts.unshift(n.name);
        return true;
      } else if (t.isMemberExpression(n)) {
        if (t.isIdentifier(n.property)) {
          parts.unshift(n.property.name);
        }
        return traverse(n.object);
      } else if (t.isThisExpression(n)) {
        parts.unshift('this');
        return true;
      }
      return false;
    };

    if (traverse(node)) {
      return parts.join('.');
    }
    return null;
  }
}
