# FayZul Compiler Development Context

This file gives Claude Code and other AI coding assistants the project
context and engineering rules they need when working on FayZul. Keep it
aligned with the actual implementation.

## Project Identity

FayZul is an intentionally esoteric programming language created as a
university Compiler Construction project. Its defining inspiration is
the Urdu secret language **ف کی بولی (F ki Boli)**, in which words are
elongated and obfuscated according to a recognizable pattern. For
example, the Urdu word `dikha` can become `difikkhafa`.

The name **FayZul** is a deliberate wordplay. **Fay** comes from F ki
Boli, while **Zul** evokes **فضول (fazul)**, meaning useless or
pointless. The language is intentionally impractical and is meant to be
a fun project for Urdu speakers, not a replacement for general-purpose
languages or a solution to a real-world problem.

Treat F ki Boli as the linguistic foundation of FayZul, not merely as
inspiration for arbitrary Urdu-flavoured keywords. When proposing new
words, prefer forms consistent with the project's established F ki Boli
style. Do not claim that the compiler automatically transforms arbitrary
Urdu text into F ki Boli unless that feature has actually been
implemented. The current language uses explicitly defined keywords and
operators.

## Project Goal

The compiler accepts FayZul source files (`.fz`), translates them into
C++17, and invokes `g++` to produce a native Windows executable. The
compiler is implemented in standard C++17 without external C++ libraries
or frameworks.

The project is intended to demonstrate compiler construction concepts,
including lexical analysis, parsing, abstract syntax trees (ASTs), code
generation, error reporting, and basic editor support.

## Core Rules and Architecture

1.  **Build a real compiler, not a string-replacement script.** Preserve
    the Lexer, Parser, AST, and Code Generator pipeline. Do not
    implement language semantics by globally replacing strings.

2.  **Keep the vocabulary centralized.**
    `language/language-definition.json` is the single source of truth
    for FayZul words and their descriptions. After editing it, run:

    ``` powershell
    node tools/generate-language.js
    ```

    This regenerates `src/keywords.h`, `src/operators.h`, and the VS
    Code TextMate grammar. Do not hand-edit generated files or duplicate
    the vocabulary in the VS Code extension.

3.  **Do not hardcode FayZul words in compiler logic.** The Lexer should
    use a keyword map built from generated macros. The Parser should
    operate on `TokenType` values. The Code Generator should work from
    AST nodes and standard C++ constructs, without checking FayZul
    keyword spellings.

4.  **Keep code generation AST-driven.** The Code Generator should emit
    C++ by walking the AST defined in `src/ast.h`. Keep
    language-specific spellings out of `codegen.cpp`.

5.  **Respect the F ki Boli identity.** Do not invent a word just
    because it sounds unusual. When adding vocabulary, consider whether
    it fits the language's F ki Boli transformation style. If a
    transformation rule is unclear, flag it as a design decision rather
    than pretending a rule has been established.

6.  **Develop incrementally.** Make sure the current build works and
    test existing behavior before adding a feature. Avoid breaking
    syntax that already works unless the change is intentional and
    documented.

7.  **Keep documentation synchronized.** If syntax, grammar, keywords,
    operators, or feature status changes, update the relevant sections
    in `README.md`, this file, grammar comments, and examples.

## Build and Run

From the project root, build the compiler:

``` powershell
g++ -std=c++17 -Wall -Wextra -o build/fayzul.exe src/main.cpp src/lexer.cpp src/parser.cpp src/codegen.cpp
```

Compile and run an example program:

``` powershell
.\build\fayzul.exe examples\hello.fz
```

The compiler translates the `.fz` source to generated C++ and invokes
`g++` to build the program. Check the actual command-line behavior in
`src/main.cpp` before changing build or output assumptions.

## Project Structure

``` text
FayZul_v1/
├── language/
│   └── language-definition.json   Single source of truth for FayZul vocabulary
├── tools/
│   └── generate-language.js       Generates C++ headers and TextMate grammar
├── src/
│   ├── keywords.h                 Generated keyword macros
│   ├── operators.h                Generated word-based operator macros
│   ├── token.h                    TokenType enum and Token structure
│   ├── lexer.h / lexer.cpp        Source text to tokens
│   ├── ast.h                      AST node definitions
│   ├── parser.h / parser.cpp      Recursive-descent parser, tokens to AST
│   ├── codegen.h / codegen.cpp    AST to generated C++ source
│   └── main.cpp                   CLI driver and compiler pipeline
├── vscode-extension/
│   ├── package.json
│   ├── extension.js               Completion and hover providers
│   ├── language-configuration.json
│   └── syntaxes/
│       └── fayzul.tmLanguage.json Generated syntax-highlighting grammar
├── examples/
│   └── hello.fz
├── build/                         Compiler and generated program outputs
├── README.md
└── CLAUDE.md
```

Confirm this structure against the current repository before assuming a
file exists. Do not create duplicate interfaces or files without
checking the existing code first.

## Current Language Vocabulary and Syntax

The following spellings and behaviors are documented in the project
README. Verify the source definitions and implementation before changing
them.

### Reserved Words

  FayZul word            Meaning
  ---------------------- --------------------------------------------
  `difikhkhafa`          Print or output
  `bafas`                Newline marker used inside print arguments
  `rafkkhafo`            Declare or store a variable
  `kefeBafarrafabafar`   Postfix assignment marker
  `afagafar`             If condition
  `wafarnafa`            Else or otherwise
  `jafabTafak`           While loop
  `kafaam`               Function declaration, planned
  `Wafapafas`            Return from function, planned
  `Rufukufo`             Break out of a loop
  `chafalnayDafo`        Continue to the next loop iteration
  `Safach`               Boolean true
  `Jhufoot`              Boolean false
  `Khafalafi`            Null or empty value

### Comparison Operators

  FayZul word                          Equivalent
  ------------------------------------ ------------
  `bafaraHafai`                        `>`
  `chofotafaHafai`                     `<`
  `bafarrafabafarHafai`                `==`
  `bafarafaYafaBafarrafabafarHafai`    `>=`
  `chofotafaYafaBafarrafabafarHafai`   `<=`
  `mufukhtafalafifHafai`               `!=`

### Logical Operators

  FayZul word   Equivalent
  ------------- ------------
  `Afaur`       `&&`
  `Yafa`        `||`
  `Nafain`      `!`

### Arithmetic Operators

The language currently documents these symbol-based arithmetic
operators:

  Symbol   Meaning
  -------- ----------------
  `+`      Addition
  `-`      Subtraction
  `*`      Multiplication
  `/`      Division
  `%`      Modulo

Do not assume that every word listed here is implemented just because it
appears in the vocabulary. Check `language/language-definition.json`,
the token definitions, parser, code generator, and tests. Keep the
README's implementation status accurate.

## Existing Syntax Rules

### Postfix Assignment

Assignment uses the word `kefeBafarrafabafar` after the expression,
rather than the conventional `=` symbol.

``` fayzul
rafkkhafo x 10 kefeBafarrafabafar;
rafkkhafo name "Ali" kefeBafarrafabafar;

x 99 kefeBafarrafabafar;
```

The first two examples declare and initialize variables. The last
reassigns an existing variable. Preserve this syntax unless a deliberate
language-design change is requested.

### Print and Newline Control

`difikhkhafa` accepts zero or more comma-separated arguments. Arguments
are concatenated in order. The special word `bafas` controls the newline
and is not printed as a value.

``` fayzul
difikhkhafa("Hello from FayZul!", bafas);
difikhkhafa("x is:", x, bafas);
difikhkhafa("loading... ");
difikhkhafa("done", bafas);
difikhkhafa(bafas);
difikhkhafa();
```

Documented behavior: - Including `bafas` requests a newline at the end
of the output. - Omitting `bafas` leaves the output on the current
line. - `difikhkhafa(bafas);` prints a blank line. - `difikhkhafa();` is
a valid no-op. - Multiple values are concatenated without automatic
separators. Add spaces explicitly in string literals when needed.

Preserve the behavior in the implementation and tests when modifying
print handling.

### Conditionals

``` fayzul
afagafar (x bafaraHafai 5) {
    difikhkhafa("x is greater than 5", bafas);
} wafarnafa {
    difikhkhafa("x is 5 or less", bafas);
}
```

### Loops

``` fayzul
rafkkhafo i 0 kefeBafarrafabafar;

jafabTafak (i chofotafaHafai 5) {
    difikhkhafa(i, bafas);
    i i + 1 kefeBafarrafabafar;
}
```

`Rufukufo;` exits a loop. `chafalnayDafo;` skips the rest of the current
iteration and continues with the next iteration.

### Comments

Line comments use `//` and are ignored by the Lexer.

``` fayzul
// This is a FayZul comment.
```

## Compiler Pipeline

Keep the current flow intact unless the project design intentionally
changes:

1.  `main.cpp` reads a `.fz` source file.
2.  The Lexer converts source text into tokens, including source
    locations.
3.  The Parser consumes tokens and builds an AST.
4.  The Code Generator walks the AST and emits C++ source.
5.  The compiler writes the generated `.cpp` file and invokes `g++`.
6.  The resulting Windows executable runs the translated program.

## Adding a New Keyword or Operator

1.  Add the spelling, macro name, and description to
    `language/language-definition.json`.
2.  Run `node tools/generate-language.js`.
3.  Add or update the relevant `TokenType` in `src/token.h`.
4.  Add the Lexer keyword-map entry using the generated `FZ_*` macro,
    not a raw string.
5.  Update the Parser and AST if the new word introduces a language
    construct or changes syntax.
6.  Update Code Generator behavior through AST nodes, not by checking
    the keyword spelling.
7.  Update examples, grammar documentation, `README.md`, and this file.
8.  Build the compiler and test both the new feature and existing
    examples.

### When a Word Replaces an Existing Symbol or Syntax Form

For example, if a word-based operator replaces a symbol:

1.  Update the Lexer to recognize the new word and remove the obsolete
    symbol case if appropriate.
2.  Update the Parser to consume the new token in the correct order.
3.  Update error messages and grammar documentation.
4.  Add or update tests for valid and invalid syntax.
5.  Keep the Code Generator independent of FayZul spellings.

## Adding a New Language Feature

Follow the existing architecture:

1.  **`src/token.h`:** Add a `TokenType` if required.
2.  **`src/ast.h`:** Define the AST node and update `NodeKind` if
    required.
3.  **`src/parser.h` and `src/parser.cpp`:** Add parsing logic and
    update the grammar.
4.  **`src/codegen.h` and `src/codegen.cpp`:** Generate C++ from the new
    AST node or expression.
5.  **Examples and tests:** Add a `.fz` example and tests for expected
    behavior and errors.
6.  **Validation:** Rebuild the compiler, run the examples and
    regression tests, and check the generated C++ when debugging.

## Current Roadmap

The README currently records this feature progression:

-   **Stage 1:** Print statement and string literals.
-   **Stage 2:** Variables, assignment, arithmetic, and operator
    precedence.
-   **Stage 3:** If/else, comparison operators, and logical operators.
-   **Stage 4:** While loops, break, continue, multi-argument print, and
    `bafas` newline control.
-   **Stage 5:** Function declarations and return statements.
-   **Stage 6:** Function calls and multiple arguments.
-   **Stage 7:** Improved error messages and parser recovery.

The README marks Stages 1 through 4 as complete and Stage 5 onward as
planned. Verify the current code and tests before changing these status
claims.

## Working Style for AI Coding Assistants

-   Inspect relevant files before editing them. Treat the repository as
    the source of truth for implementation details.
-   Make the smallest coherent change that solves the requested task.
-   Do not claim a feature is implemented without verifying its code
    path and tests.
-   Do not silently alter FayZul spellings, grammar, semantics, or
    examples.
-   Preserve the project's deliberately playful and esoteric identity
    while keeping compiler engineering sound.
-   Explain important design trade-offs plainly and identify assumptions
    that require a decision.
-   After a change, report what changed, which files were touched, and
    what build or tests were run. Be honest if something could not be
    tested.
