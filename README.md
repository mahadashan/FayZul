# FayZul Programming Language v1

**FayZul is an esoteric programming language inspired by the Urdu secret language `ف کی بولی` (F ki Boli).** It is a fun, intentionally impractical project for Urdu speakers, built as a university Compiler Construction project.

The defining idea behind FayZul comes from F ki Boli, a way of transforming and elongating Urdu words so that someone who knows Urdu may not understand them immediately. For example, FayZul's print keyword **`difikhkhafa`** is an F ki Boli form of the Urdu word **`dikha`** ("show"). FayZul applies this linguistic idea to programming syntax, giving familiar programming concepts unusual, obfuscated-looking words.

The name **FayZul** combines **“Fay”**, from *F ki Boli*, with **“fazul” (فضول)**, the Urdu word for useless or pointless. That is intentional: FayZul is an esoteric language made for curiosity, experimentation, and fun, not to solve a practical programming problem or replace general-purpose languages.

The compiler is written in standard **C++17**. It compiles FayZul source files (`.fz`) into generated C++17 code, then invokes `g++ -std=c++17 -pedantic-errors` to produce a native Windows executable (`.exe`). The project uses no external C++ libraries or frameworks.

---

## Quick Start

Run these commands in PowerShell from the project directory:

```powershell
# 1. Build the FayZul compiler
cd FayZul_v1
g++ -std=c++17 -Wall -Wextra -o build/fayzul.exe src/main.cpp src/lexer.cpp src/parser.cpp src/semantic.cpp src/codegen.cpp

# 2. Compile and run a FayZul program
.\build\fayzul.exe examples\hello.fz
.\build\fayzul.exe examples\functions.fz

# 3. Run the regression tests (builds the compiler first)
node tests/run-tests.js
```

The compiler writes the generated C++ and the executable to a `build/` folder in the **current working directory**, prints the generated C++, compiles it, and then runs the program.

If you change FayZul words in `language/language-definition.json`, regenerate the C++ headers and syntax-highlighting grammar:

```powershell
node tools/generate-language.js
```

---

## Project Structure

```text
FayZul_v1/
├── language/
│   └── language-definition.json   Single source of truth for FayZul words
├── tools/
│   └── generate-language.js       Generates C++ headers and TextMate grammar
├── src/
│   ├── keywords.h                 Generated macros for reserved keywords
│   ├── operators.h                Generated macros for word-based operators
│   ├── token.h                    TokenType enum and Token structure
│   ├── lexer.h / lexer.cpp        Converts source text into tokens
│   ├── ast.h                      Abstract syntax tree node structures
│   ├── parser.h / parser.cpp      Recursive-descent parser; builds the AST
│   ├── semantic.h / semantic.cpp  Semantic checks (scopes, functions, returns)
│   ├── codegen.h / codegen.cpp    Generates C++17 source from the AST
│   └── main.cpp                   CLI driver; runs the pipeline and invokes g++
├── tests/
│   ├── run-tests.js               Regression test runner (Node.js)
│   └── cases/                     .fz programs with expected output or errors
├── vscode-extension/              VS Code language support for .fz files
│   ├── package.json
│   ├── extension.js               Completion and hover providers
│   ├── language-configuration.json
│   └── syntaxes/fayzul.tmLanguage.json
├── examples/
│   ├── hello.fz                   Nested loops (prints a triangle)
│   └── functions.fz               Functions, recursion, mutual recursion
├── docs/
│   ├── FayZul_Development_Roadmap.md
│   └── FayZul_Mindmap.md
├── build/                         Compiler and generated program outputs
├── README.md
└── CLAUDE.md                      AI coding-assistant project context
```

---

## Compiler Pipeline

```text
program.fz (FayZul source)
        |
        v
Lexer          Reads characters and produces tokens (type, lexeme, line, column)
        |
        v
Parser         Checks syntax and builds the abstract syntax tree (AST)
        |
        v
Semantic       Checks declarations, scopes, loops, functions, and returns
        |
        v
CodeGenerator  Converts the AST into C++17 source
        |
        v
build/program.cpp
        |
        v  g++ -std=c++17 -pedantic-errors
build/program.exe
        |
        v
Program output in the terminal
```

The language definition file supplies the word mappings used to generate the keyword and operator headers, as well as the VS Code highlighting grammar.

---

## Language Reference

### Reserved Words (14)

| FayZul word | Meaning | Status |
|---|---|---|
| `difikhkhafa` | Print or output | Implemented |
| `bafas` | End-line marker for output | Implemented |
| `rafkkhafo` | Declare a variable | Implemented |
| `kefeBafarrafabafar` | Postfix assignment marker | Implemented |
| `afagafar` | `if` condition | Implemented |
| `wafarnafa` | `else` / otherwise | Implemented |
| `jafabTafak` | `while` loop | Implemented |
| `Rufukufo` | Break out of a loop | Implemented |
| `chafalnayDafo` | Continue to the next loop iteration | Implemented |
| `kafaam` | Function declaration | Implemented |
| `Wafapafas` | Return from a function | Implemented |
| `Safach` | Boolean `true` | Implemented |
| `Jhufoot` | Boolean `false` | Implemented |
| `Khafalafi` | Null value (`nullptr`) | Implemented |

### Word Operators (9)

FayZul has **9** word-based operators: 6 comparison and 3 logical.

| FayZul word | C++ equivalent |
|---|---|
| `bafaraHafai` | `>` |
| `chofotafaHafai` | `<` |
| `bafarrafabafarHafai` | `==` |
| `bafarafaYafaBafarrafabafarHafai` | `>=` |
| `chofotafaYafaBafarrafabafarHafai` | `<=` |
| `mufukhtafalafifHafai` | `!=` |
| `Afaur` | `&&` |
| `Yafa` | `\|\|` |
| `Nafain` | `!` |

### Arithmetic Operators (symbols)

| Symbol | Meaning |
|---|---|
| `+` | Addition |
| `-` | Subtraction (binary only; there is no unary minus, write `0 - 5`) |
| `*` | Multiplication |
| `/` | Division (integer division when both sides are whole numbers) |
| `%` | Modulo |

### Delimiters and punctuation

| Symbol | Purpose |
|---|---|
| `(` `)` | Group expressions, conditions, print arguments, function parameters and calls |
| `{` `}` | Enclose a block of statements |
| `,` | Separate print arguments, parameters, and call arguments |
| `;` | End a statement |
| `"` | Enclose string literals (escapes: `\n`, `\t`, `\"`, `\\`) |
| `//` | Begin a line comment |

---

## Syntax Examples

### Output

```fayzul
difikhkhafa("Hello from FayZul!", bafas);
difikhkhafa("x is: ", x, bafas);
difikhkhafa("loading... ");
difikhkhafa("done", bafas);
difikhkhafa(bafas);
difikhkhafa();
```

`bafas` adds one newline at the end of the output, wherever it appears in the argument list. Without it, the next output continues on the same line. Arguments are printed one after another with no separator. `difikhkhafa(bafas);` prints a blank line and `difikhkhafa();` does nothing. Booleans print as `1` / `0`, and `Khafalafi` prints `nullptr`.

### Variables and Assignment

```fayzul
rafkkhafo x 10 kefeBafarrafabafar;
rafkkhafo name "Ali" kefeBafarrafabafar;
rafkkhafo flag Safach kefeBafarrafabafar;
x 99 kefeBafarrafabafar;
x (x + 1) * 2 kefeBafarrafabafar;
```

Assignment is postfix: the value comes before `kefeBafarrafabafar`. A variable must be declared with `rafkkhafo` before it is used, and a name can be declared only once per block. Inner blocks may declare a variable that shadows an outer one.

### Conditions and Logic

```fayzul
afagafar (x bafaraHafai 0 Afaur x chofotafaHafai 100) {
    difikhkhafa("x is between 0 and 100", bafas);
} wafarnafa {
    difikhkhafa("x is out of range", bafas);
}
```

### Loops, Break, and Continue

```fayzul
rafkkhafo k 0 kefeBafarrafabafar;
jafabTafak (k chofotafaHafai 5) {
    k k + 1 kefeBafarrafabafar;
    afagafar (k bafarrafabafarHafai 3) {
        chafalnayDafo;
    }
    afagafar (k bafarrafabafarHafai 5) {
        Rufukufo;
    }
    difikhkhafa(k, " ");
}
```

`Rufukufo` and `chafalnayDafo` are only allowed inside a `jafabTafak` loop and affect the innermost loop.

### Functions

```fayzul
kafaam fact(n) {
    afagafar (n chofotafaYafaBafarrafabafarHafai 1) {
        Wafapafas 1;
    }
    Wafapafas n * fact(n - 1);
}

kafaam jor(a, b) {
    Wafapafas a + b;
}

kafaam salam(naam) {
    difikhkhafa("Salam, ", naam, "!", bafas);
}

salam("FayZul");
difikhkhafa(fact(5), " ", jor(2, 0.5), bafas);
```

Function rules:

- `kafaam` declarations are allowed only at the top level. A function may be called before or after its declaration, and recursion and mutual recursion are supported.
- Parameters are untyped and passed by value. The same function works with different argument types, e.g. `jor(2, 3)` and `jor(2, 0.5)`.
- **Scope:** a function body sees only its parameters and its own variables. Top-level variables are **not** visible inside functions; pass them as arguments.
- A function either always returns a value (`Wafapafas value;`) or never does (`Wafapafas;` or no `Wafapafas`). Mixing the two is an error.
- A value-returning function must return on every path. Loops are not assumed to return, so end the function with a `Wafapafas`.
- A function with no `Wafapafas value;` can only be called as a statement, not used inside an expression.
- **Return types are inferred from the first `Wafapafas`.** Put the base case before any recursive call, and make every `Wafapafas` in a function return the same type for a given call. For example, `fact(2.5)` above is an error because `Wafapafas 1;` returns a whole number while `n * fact(n - 1)` returns a decimal. Write `Wafapafas 1.0;` if the function should work with decimals.
- Function, parameter, and variable names share one namespace: a variable cannot have a function's name.

### Calls vs. assignments

A statement that starts with a name followed by `(` is a **call** when the `)` that matches the first `(` is immediately followed by `;`. Otherwise it is an **assignment** whose value begins with a parenthesised expression:

```fayzul
dikhao(1);                       // call
dikhao((1) + 2);                 // call
x (1) kefeBafarrafabafar;         // assignment: x = 1
x (1) + 2 kefeBafarrafabafar;     // assignment: x = 3
x jor(x, 1) kefeBafarrafabafar;   // assignment with a call as the value
```

### Comments

```fayzul
// This is a line comment. The lexer ignores it.
```

---

## Operator Precedence

From lowest to highest:

| Level | Operators | Parser rule |
|---:|---|---|
| 1 | `Yafa` (`\|\|`) | `parseLogicalOr` |
| 2 | `Afaur` (`&&`) | `parseLogicalAnd` |
| 3 | `Nafain` (`!`) | `parseLogicalNot` |
| 4 | Comparison words (non-associative: `a < b < c` is a syntax error) | `parseComparison` |
| 5 | `+`, `-` | `parseAdditive` |
| 6 | `*`, `/`, `%` | `parseTerm` |
| 7 | Literals, identifiers, calls, parenthesised expressions | `parsePrimary` |

Because `Nafain` sits **below** comparison, `Nafain x bafaraHafai 5` means `!(x > 5)`. Binary operators at the same level are left-associative.

---

## Grammar (BNF-style)

```text
program        → ( functionDecl | statement )* EOF
functionDecl   → FUNCTION IDENTIFIER '(' paramList? ')' block      (top level only)
paramList      → IDENTIFIER ( ',' IDENTIFIER )*
statement      → printStmt | varDeclStmt | assignStmt | callStmt
               | ifStmt | whileStmt | breakStmt | continueStmt | returnStmt
printStmt      → PRINT '(' ( printArg ( ',' printArg )* )? ')' ';'
printArg       → expression | ENDLINE
varDeclStmt    → STORE IDENTIFIER expression ASSIGN ';'
assignStmt     → IDENTIFIER expression ASSIGN ';'
callStmt       → IDENTIFIER '(' argList? ')' ';'
argList        → expression ( ',' expression )*
ifStmt         → IF '(' expression ')' block ( ELSE block )?
whileStmt      → WHILE '(' expression ')' block
breakStmt      → BREAK ';'
continueStmt   → CONTINUE ';'
returnStmt     → RETURN expression? ';'
block          → '{' statement* '}'
expression     → logicalOr
logicalOr      → logicalAnd ( OR logicalAnd )*
logicalAnd     → logicalNot ( AND logicalNot )*
logicalNot     → NOT logicalNot | comparison
comparison     → additive ( compOp additive )?
additive       → term ( ( '+' | '-' ) term )*
term           → primary ( ( '*' | '/' | '%' ) primary )*
primary        → STRING | NUMBER | BOOL_TRUE | BOOL_FALSE | NULL
               | IDENTIFIER '(' argList? ')'
               | IDENTIFIER
               | '(' expression ')'
compOp         → GT | LT | EQ | GTE | LTE | NEQ
```

`callStmt` and `assignStmt` are told apart by the rule in [Calls vs. assignments](#calls-vs-assignments).

---

## Error Reporting

The compiler stops at the first error and reports it with its FayZul source position. Example messages (all taken from the regression tests):

```text
[Lexer Error] Line 2, Column 35: Unknown character '@'
[Lexer Error] Line 1, Column 13: Unterminated string: newline inside string literal
[Parser Error] Line 2, Column 1: Expected ';' after 'difikhkhafa' statement (got 'difikhkhafa')
[Parser Error] Line 2, Column 1: Expected ';' after call to 'f' (or 'kefeBafarrafabafar' to assign a value to 'f') (got 'difikhkhafa')
[Semantic Error] Line 1, Column 13: Variable 'y' is not declared
[Semantic Error] Line 1, Column 1: 'Rufukufo' can only be used inside a 'jafabTafak' loop
[Semantic Error] Line 4, Column 13: Function 'jor' expects 2 argument(s) but got 1
[Semantic Error] Line 3, Column 15: Variable 'x' is declared at the top level and is not visible inside function 'f'. Pass it as a parameter instead
[Semantic Error] Line 3, Column 23: Recursive call to 'fact' comes before any non-recursive 'Wafapafas' in 'fact'. ...
[C++ Error] Line 5: This 'Wafapafas' returns a whole number, but an earlier 'Wafapafas' in the same function returned a decimal number. ...
```

Lexer, parser, and semantic errors are produced by FayZul itself. Some type errors (see [Known Limitations](#known-limitations)) are only detected by g++; the compiler then reports them as `[C++ Error]` at the FayZul line that produced the failing C++, and points to the full g++ log in `build/<name>.gpp.log`.

---

## Testing

```powershell
node tests/run-tests.js              # build the compiler, then run every test
node tests/run-tests.js --no-build   # reuse build/fayzul.exe
node tests/run-tests.js functions    # run tests whose path contains "functions"
```

Each `tests/cases/**/name.fz` has either a `name.out` file (the program must compile, and its output must match exactly) or a `name.err` file (compilation must fail, and every line of the file must appear in the compiler's messages). Every `examples/*.fz` file is also compiled and run as a smoke test. Tests run in temporary directories and do not write into the project.

The suite has 80 tests: 23 output tests for Stages 1–6, 55 error tests (lexer, parser, semantic, and translated C++ errors), and the 2 example programs.

---

## Known Limitations

- **Values use C++ `auto` typing.** A variable's type is fixed by its first value:
  - Assigning a decimal to a whole-number variable truncates it (`x 2.5` gives `2`).
  - Assigning a string to a number variable is a `[C++ Error]`.
  - `/` on two whole numbers is integer division (`7 / 2` is `3`).
- **Strings are C string literals** (`const char*`):
  - `+` on strings is a `[C++ Error]`.
  - `bafarrafabafarHafai` on strings compares addresses, not text, so the result is not reliable.
- **Booleans behave as numbers.** They print as `1` / `0`, and `1 + Safach` is `2`.
- **No unary minus.** Write `0 - 5`.
- **No `else if` keyword.** Nest an `afagafar` inside `wafarnafa { ... }`.
- **Function return types are inferred** from the first `Wafapafas`. See [Functions](#functions) for the base-case-first and same-type rules.
- **One error at a time.** The compiler stops at the first error; there is no parser error recovery yet (Stage 7).
- **The `build/` folder is relative to the current directory,** and the compiler always runs the program after compiling it.

---

## Development Environment

| Item | Value |
|---|---|
| Operating system | Windows |
| C++ compiler | g++ 16.1.0 (MinGW-w64) |
| Compiler source standard | C++17 |
| Generated program standard | C++17 (`-std=c++17 -pedantic-errors`) |
| Test runner | Node.js (also used by `tools/generate-language.js`) |
| Shell | PowerShell |
| IDE | VS Code |

---

## VS Code Language Support

The extension in `vscode-extension/` recognizes `.fz` files as FayZul. It provides syntax highlighting, keyword completion with snippets, and hover descriptions. Completion and hover information come from `language/language-definition.json`, the same source used to generate the keyword and operator headers.

### Try the extension locally

1. Open the `FayZul_v1` folder in VS Code.
2. Press **F5** or choose **Run → Start Debugging**, then select **Launch FayZul Extension**.
3. In the new Extension Development Host window, open `examples/hello.fz`.
4. Type `dif` to see keyword suggestions. Hover over a keyword to view its description.

You can also launch it from PowerShell, if the `code` command is available on your `PATH`:

```powershell
code --extensionDevelopmentPath="$PWD\vscode-extension" "$PWD\examples"
```

This is lightweight VS Code language support, not a full Language Server Protocol implementation.

---

## Roadmap

| Stage | Feature | Status |
|---:|---|---|
| 1 | `difikhkhafa` output and string literals | Complete |
| 2 | `rafkkhafo` variables and arithmetic | Complete |
| 3 | `afagafar` / `wafarnafa` conditionals and operators | Complete |
| 4 | `jafabTafak` loops, `Rufukufo` break, and `chafalnayDafo` continue | Complete |
| 5 | `kafaam` functions and `Wafapafas` return | Complete |
| 6 | Function calls, multiple arguments, recursion | Complete |
| 7 | Improved error messages and parser recovery | Partial: semantic errors and mapped C++ errors are done; recovery after the first error is not |

All "Complete" stages are covered by the regression suite in `tests/`. See [docs/FayZul_Development_Roadmap.md](docs/FayZul_Development_Roadmap.md) for remaining work.

---

## Project Philosophy

FayZul is intentionally an esoteric language. Its success is not measured by performance or practical usefulness. The point is to explore compiler construction through a language whose syntax has a distinctive linguistic and cultural origin. The project turns the obfuscation style of F ki Boli into a playful programming experience for people who know Urdu.
