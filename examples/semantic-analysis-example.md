# Semantic Call Graph Analysis Examples

This document demonstrates the automatic semantic analysis features in Codetographer v0.2.0+.

## Example 1: Analyzing a Single Function

Given this JavaScript code:

```javascript
// src/auth/login.js
import { validateCredentials } from './validator';
import { generateToken } from './token';
import { findUser } from '../database/users';

export async function handleLogin(username, password) {
  const user = await findUser(username);
  if (!user) {
    throw new Error('User not found');
  }

  const isValid = validateCredentials(password, user.passwordHash);
  if (!isValid) {
    throw new Error('Invalid credentials');
  }

  const token = generateToken(user.id, user.roles);
  return { token, user };
}
```

**Steps:**
1. Place cursor on `handleLogin`
2. Run: `Codetographer: Generate Call Graph from Selection`
3. Result: A call graph showing:
   - `handleLogin` → `findUser`
   - `handleLogin` → `validateCredentials`
   - `handleLogin` → `generateToken`

With depth > 1, it will also analyze the called functions and their dependencies.

## Example 2: Analyzing Class Methods

```typescript
// src/services/UserService.ts
import { Database } from '../database';
import { EmailService } from './EmailService';

export class UserService {
  constructor(private db: Database, private email: EmailService) {}

  async createUser(userData: UserData): Promise<User> {
    const user = await this.db.insert('users', userData);
    await this.sendWelcomeEmail(user);
    return user;
  }

  private async sendWelcomeEmail(user: User): Promise<void> {
    await this.email.send({
      to: user.email,
      subject: 'Welcome!',
      body: this.getWelcomeMessage(user.name)
    });
  }

  private getWelcomeMessage(name: string): string {
    return `Welcome, ${name}!`;
  }
}
```

**Analyzing `createUser`:**
- Shows calls to `this.db.insert` and `this.sendWelcomeEmail`
- With depth 2, also shows `sendWelcomeEmail` → `email.send` and `getWelcomeMessage`

## Example 3: Codebase-Wide Analysis

For a project structure like:
```
src/
  api/
    routes.js
    handlers.js
  services/
    auth.js
    users.js
  database/
    connection.js
    queries.js
```

Running `Codetographer: Analyze Codebase Call Graph` will:
1. Parse all `.js` files in `src/`
2. Extract all function definitions
3. Build a complete call graph showing all function relationships
4. Create a `.cgraph` file with the entire project structure

## Configuration Examples

### High-Detail Analysis
```json
{
  "codetographer.analysis.maxDepth": 5,
  "codetographer.analysis.maxNodes": 100,
  "codetographer.analysis.includeNodeModules": false
}
```

### Quick Overview
```json
{
  "codetographer.analysis.maxDepth": 2,
  "codetographer.analysis.maxNodes": 20,
  "codetographer.analysis.includeNodeModules": false
}
```

### Include External Dependencies
```json
{
  "codetographer.analysis.maxDepth": 3,
  "codetographer.analysis.maxNodes": 75,
  "codetographer.analysis.includeNodeModules": true
}
```

## Supported Code Patterns

The analyzer recognizes:

### Function Declarations
```javascript
function myFunction() { }
async function asyncFunction() { }
```

### Arrow Functions
```javascript
const myFunc = () => { };
const asyncFunc = async () => { };
```

### Class Methods
```javascript
class MyClass {
  myMethod() { }
  async asyncMethod() { }
  static staticMethod() { }
}
```

### Function Expressions
```javascript
const func = function() { };
const asyncFunc = async function() { };
```

### Calls Tracked
- Direct function calls: `myFunction()`
- Method calls: `obj.method()`
- This calls: `this.method()`
- Imported function calls: `importedFunc()`
- Chained calls: `obj.method1().method2()`

## Limitations

**Not currently supported:**
- Dynamic function calls: `obj[functionName]()`
- Callback references: `array.map(myFunc)` (sees the call to `map` but not `myFunc`)
- Higher-order functions: Functions passed as arguments aren't fully traced
- Reflection/eval: `eval()`, `Function()`, etc.
- Non-JavaScript/TypeScript languages

**Workarounds:**
- For unsupported patterns, use manual `.cgraph` file creation
- Adjust `maxDepth` and `maxNodes` for better results
- Use file patterns to focus on specific parts of the codebase

## Tips

1. **Start small**: Begin with a single function to understand the output
2. **Adjust depth**: Use depth 2-3 for most analyses, higher for deep traces
3. **Filter wisely**: Use exclude patterns to skip test files, mocks, etc.
4. **Combine approaches**: Use automatic analysis for structure, manual graphs for concepts
5. **Iterate**: Generate, review, adjust settings, regenerate
