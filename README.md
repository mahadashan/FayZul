# FayZul Programming Language v1

**FayZul is an esoteric programming language inspired by the Urdu secret language `ف کی بولی` (F ki Boli).** It is a fun, intentionally impractical project for Urdu speakers, built as a university Compiler Construction project.

The defining idea behind FayZul comes from F ki Boli, a way of transforming and elongating Urdu words so that someone who knows Urdu may not understand them immediately. For example, **`dikha` becomes `difikkhafa`**. FayZul applies this linguistic idea to programming syntax, giving familiar programming concepts unusual, obfuscated-looking words.

The name **FayZul** combines **“Fay”**, from *F ki Boli*, with **“fazul” (فضول)**, the Urdu word for useless or pointless. That is intentional: FayZul is an esoteric language made for curiosity, experimentation, and fun, not to solve a practical programming problem or replace general-purpose languages.

The compiler is written in standard **C++17**. It compiles FayZul source files (`.fz`) into generated C++ code, then invokes `g++` to produce a native Windows executable (`.exe`). The project currently uses no external C++ libraries or frameworks.

---

## Quick Start

Run these commands in PowerShell from the project directory:

```powershell
# 1. Build the FayZul compiler
cd FayZul_v1
g++ -std=c++17 -Wall -Wextra -o build/fayzul.exe src/main.cpp src/lexer.cpp src/parser.cpp src/codegen.cpp

# 2. Compile and run a FayZul program
.\build\fayzul.exe examples\hello.fz
```

The compiler generates C++ and an executable in `build/` for the input program.

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
│   ├── operators.h                 Generated macros for word-based operators
│   ├── token.h                     TokenType enum and Token structure
│   ├── lexer.h                     Lexer interface
│   ├── lexer.cpp                   Converts source text into tokens
│   ├── ast.h                       Abstract syntax tree node structures
│   ├── parser.h                    Parser interface and grammar documentation
│   ├── parser.cpp                  Recursive-descent parser; builds the AST
│   ├── codegen.h                   Code generator interface
│   ├── codegen.cpp                 Generates C++ source from the AST
│   └── main.cpp                    CLI driver; runs the pipeline and invokes g++
├── vscode-extension/               VS Code language support for .fz files
│   ├── package.json
│   ├── extension.js                 Completion and hover providers
│   ├── language-configuration.json
│   └── syntaxes/fayzul.tmLanguage.json
├── examples/
│   └── hello.fz                     Example FayZul program
├── build/
│   ├── fayzul.exe                   Compiled FayZul compiler
│   ├── hello.cpp                    Generated C++ source
│   └── hello.exe                    Compiled FayZul program
├── README.md
└── CLAUDE.md                        AI coding-assistant project context
```

Generated files in `build/` appear after building or compiling programs.

---

## Compiler Pipeline

```text
hello.fz (FayZul source)
        |
        v
Lexer       Reads characters and produces tokens
        |
        v
Tokens      Token type, lexeme, line, and column
        |
        v
Parser      Checks syntax and builds the abstract syntax tree (AST)
        |
        v
AST         Structured representation of the program
        |
        v
CodeGenerator  Converts the AST into C++ source
        |
        v
build/hello.cpp
        |
        v  g++ -std=c++17
build/hello.exe
        |
        v
Program output in the terminal
```

The language definition file supplies the word mappings used to generate the keyword and operator headers, as well as the VS Code highlighting grammar.

---

## Language Reference

The spellings below reflect the current implementation. The language is inspired by F ki Boli, and the vocabulary may evolve as the project develops.

### Reserved Words

| FayZul word | Meaning | Status |
|---|---|---|
| `difikhkhafa` | Print or output | Implemented |
| `bafas` | End-line marker for output | Implemented |
| `rafkkhafo` | Declare or store a variable | Implemented |
| `kefeBafarrafabafar` | Assignment marker | Implemented |
| `afagafar` | `if` condition | Implemented |
| `wafarnafa` | `else` or otherwise | Implemented |
| `jafabTafak` | `while` loop | Implemented |
| `kafaam` | Function declaration | Planned, Stage 5 |
| `Wafapafas` | Return a value | Planned, Stage 5 |
| `Rufukufo` | Break out of a loop | Implemented |
| `chafalnayDafo` | Continue to the next loop iteration | Implemented |
| `Safach` | Boolean `true` | Implemented |
| `Jhufoot` | Boolean `false` | Implemented |
| `Khafalafi` | Null or empty value | Implemented |

### Comparison Operators

| FayZul word | C++ equivalent | Status |
|---|---|---|
| `bafaraHafai` | `>` | Implemented |
| `chofotafaHafai` | `<` | Implemented |
| `bafarrafabafarHafai` | `==` | Implemented |
| `bafarafaYafaBafarrafabafarHafai` | `>=` | Implemented |
| `chofotafaYafaBafarrafabafarHafai` | `<=` | Implemented |
| `mufukhtafalafifHafai` | `!=` | Implemented |

### Logical Operators

| FayZul word | C++ equivalent | Status |
|---|---|---|
| `Afaur` | `&&` | Implemented |
| `Yafa` | `\|\|` | Implemented |
| `Nafain` | `!` | Implemented |

### Arithmetic Operators

| Symbol | Meaning | Status |
|---|---|---|
| `+` | Addition | Implemented |
| `-` | Subtraction | Implemented |
| `*` | Multiplication | Implemented |
| `/` | Division | Implemented |
| `%` | Modulo | Implemented |

### Delimiters and punctuation

| Symbol | Purpose |
|---|---|
| `(` `)` | Group expressions, function calls, and conditions |
| `{` `}` | Enclose a block of statements |
| `,` | Separate output arguments |
| `;` | End a statement |
| `"` | Enclose string literals |
| `//` | Begin a line comment |

---

## Syntax Examples

### Output

```fayzul
difikhkhafa("Hello from FayZul!", bafas);
difikhkhafa(42, bafas);
difikhkhafa(x, bafas);
difikhkhafa("x is: ", x, bafas);
difikhkhafa("loading... ");
difikhkhafa("done", bafas);
difikhkhafa(bafas);
```

`bafas` adds a newline at the end of the output. Without it, the next output continues on the same line. Multiple arguments are printed consecutively without an automatic separator, so include spaces in strings when needed. Passing only `bafas` prints a blank line.

### Variables and Assignment

```fayzul
rafkkhafo x 10 kefeBafarrafabafar;
rafkkhafo name "Ali" kefeBafarrafabafar;
rafkkhafo flag Safach kefeBafarrafabafar;
x 99 kefeBafarrafabafar;
```

### Arithmetic

```fayzul
difikhkhafa(x + y * 2);
difikhkhafa((x + y) * 2);
rafkkhafo result (x + y) * 2 kefeBafarrafabafar;
```

Multiplication, division, and modulo have higher precedence than addition and subtraction. Parentheses can override the default precedence.

### Conditions

```fayzul
afagafar (x bafaraHafai 5) {
    difikhkhafa("x is greater than 5", bafas);
} wafarnafa {
    difikhkhafa("x is 5 or less", bafas);
}
```

### Logical Operators

```fayzul
afagafar (x bafaraHafai 0 Afaur x chofotafaHafai 100) {
    difikhkhafa("x is between 0 and 100", bafas);
}

afagafar (Nafain flag) {
    difikhkhafa("flag is false", bafas);
}
```

### While Loops

```fayzul
rafkkhafo i 0 kefeBafarrafabafar;
jafabTafak (i chofotafaHafai 5) {
    difikhkhafa(i, bafas);
    i i + 1 kefeBafarrafabafar;
}
```

### Break and Continue

```fayzul
jafabTafak (Safach) {
    afagafar (n bafarrafabafarHafai 3) {
        Rufukufo;
    }
    n n + 1 kefeBafarrafabafar;
}

jafabTafak (k chofotafaHafai 5) {
    k k + 1 kefeBafarrafabafar;
    afagafar (k bafarrafabafarHafai 3) {
        chafalnayDafo;
    }
    difikhkhafa(k, bafas);
}
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
| 1 | `Yafa` (`||`) | `parseLogicalOr` |
| 2 | `Afaur` (`&&`) | `parseLogicalAnd` |
| 3 | `Nafain` (`!`) | `parseLogicalNot` |
| 4 | Comparison words | `parseComparison` |
| 5 | `+`, `-` | `parseAdditive` |
| 6 | `*`, `/`, `%` | `parseTerm` |
| 7 | Literals, identifiers, parenthesized expressions | `parsePrimary` |

---

## Current Grammar (BNF-style)

```text
program        → statement* EOF
statement      → printStmt
               | varDeclStmt
               | assignStmt
               | ifStmt
               | whileStmt
               | breakStmt
               | continueStmt
printStmt      → PRINT '(' (printArg (',' printArg)*)? ')' ';'
printArg       → expression | ENDLINE
varDeclStmt    → STORE IDENTIFIER expression ASSIGN ';'
assignStmt     → IDENTIFIER expression ASSIGN ';'
ifStmt         → IF '(' expression ')' block (ELSE block)?
whileStmt      → WHILE '(' expression ')' block
breakStmt      → BREAK ';'
continueStmt   → CONTINUE ';'
block          → '{' statement* '}'
expression     → logicalOr
logicalOr      → logicalAnd (OR logicalAnd)*
logicalAnd     → logicalNot (AND logicalNot)*
logicalNot     → NOT logicalNot | comparison
comparison     → additive (compOp additive)?
additive       → term (('+' | '-') term)*
term           → primary (('*' | '/' | '%') primary)*
primary        → STRING | NUMBER | BOOL_TRUE | BOOL_FALSE | NULL
               | IDENTIFIER
               | '(' expression ')'
compOp         → GT | LT | EQ | GTE | LTE | NEQ
```

Function declarations and return statements are not part of the current grammar yet. They are planned for a later stage.

---

## Error Reporting

The compiler reports errors with source locations. Example messages include:

```text
[Lexer Error]   Line 3, Column 12: Unknown character '@'
[Lexer Error]   Line 5, Column 1: Unterminated string: reached end of file
[Parser Error]  Line 7, Column 5: Expected ';' after 'difikhkhafa' statement (got 'EOF')
[Parser Error]  Line 9, Column 1: Unexpected token 'xyz' (expected a statement)
[CodeGen Error] Line 12, Column 3: Code generator does not yet handle this node type
```

---

## Development Environment

| Item | Value |
|---|---|
| Operating system | Windows |
| C++ compiler | g++ 16.1.0 (MinGW-w64) |
| Language standard | C++17 |
| Shell | PowerShell |
| IDE | VS Code |

---

## VS Code Language Support

The extension in `vscode-extension/` recognizes `.fz` files as FayZul. It provides syntax highlighting, keyword completion, and hover descriptions. Completion and hover information come from `language/language-definition.json`, the same source used to generate the keyword and operator headers.

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
| 5 | `kafaam` functions and `Wafapafas` return | Planned |
| 6 | Function calls and multiple arguments | Planned |
| 7 | Improved error messages and parser recovery | Planned |

---

## Project Philosophy

FayZul is intentionally an esoteric language. Its success is not measured by performance or practical usefulness. The point is to explore compiler construction through a language whose syntax has a distinctive linguistic and cultural origin. The project turns the obfuscation style of F ki Boli into a playful programming experience for people who know Urdu.
