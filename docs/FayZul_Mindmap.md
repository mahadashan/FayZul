# FayZul Project Mind Map

Snapshot of the FayZul compiler as of 2026-10-09, checked against the
source in `src/`, `tools/`, `language/`, `tests/`, and `vscode-extension/`.
"Implemented" means there is a working Lexer → Parser → Semantic →
CodeGen path covered by the regression suite (`node tests/run-tests.js`,
80/80 passing).

## Mind map

```mermaid
mindmap
  root((FayZul))
    Identity
      F ki Boli word transformation
      Fazul means useless
      Esoteric university CC project
      Urdu speaking audience
    Vocabulary source
      language-definition.json
        14 keywords
        6 comparison words
        3 logical words
        5 arithmetic symbols
      generate-language.js
        keywords.h
        operators.h
        fayzul.tmLanguage.json
    Compiler pipeline
      main.cpp driver
        Read .fz file
        Write build/NAME.cpp
        g++ -std=c++17 -pedantic-errors
        Map g++ errors to FayZul lines
        Run build/NAME.exe
      Lexer
        Keyword map from FZ macros
        Strings with escapes
        Integer and decimal numbers
        Line comments
        Line and column tracking
      Parser
        Recursive descent
        7 precedence levels
        Call vs assignment lookahead
        Fails on first error
      Semantic analyzer
        Scopes and declarations
        Loop context for break and continue
        Function arity and return rules
        Recursion order check
      AST
        unique_ptr ownership
        NodeKind dispatch
        Operators stored as C++ strings
      CodeGen
        Functions as C++ templates
        FZ_CTX keeps calls dependent
        fz_ prefix on all names
        Top-level code in main
        Line map for diagnostics
    Implemented features
      Stage 1 print and strings
      Stage 2 variables and arithmetic
      Stage 3 if else comparison logic
      Stage 4 while break continue bafas
      Stage 5 kafaam and Wafapafas
      Stage 6 calls recursion mutual recursion
    Testing
      run-tests.js runner
      Output tests
      Syntax error tests
      Semantic error tests
      Translated C++ error tests
      Examples smoke tests
    Planned features
      Stage 7 error recovery
      Value semantics for strings and bools
      Unary minus
      CLI options
    Editor support
      VS Code extension
        TextMate highlighting
        Completion and snippets
        Hover descriptions
        Reads JSON at runtime
    Known limits
      auto typing fixes a variable type
      Strings are C literals
      Return type from first Wafapafas
      One error at a time
```

## Component dependencies

The mind map cannot draw edges, so the build-time and run-time
dependencies are shown here. Solid arrows are `#include` or data reads;
dashed arrows are generated files.

```mermaid
flowchart LR
    JSON[language-definition.json] --> GEN[tools/generate-language.js]
    GEN -.-> KW[keywords.h]
    GEN -.-> OPS[operators.h]
    GEN -.-> TM[fayzul.tmLanguage.json]
    JSON --> EXT[extension.js]

    TOK[token.h] --> LEX[lexer.cpp]
    KW --> LEX
    OPS --> LEX
    TOK --> PAR[parser.cpp]
    AST[ast.h] --> PAR
    KW -->|error messages only| PAR
    AST --> SEM[semantic.cpp]
    KW -->|error messages only| SEM
    AST --> CG[codegen.cpp]

    LEX --> MAIN[main.cpp]
    PAR --> MAIN
    SEM --> MAIN
    CG --> MAIN
    KW -->|translated g++ messages| MAIN
    MAIN -->|writes| CPP[build/NAME.cpp]
    CPP -->|g++ -std=c++17| EXE[build/NAME.exe]

    TESTS[tests/run-tests.js] -->|builds and runs| MAIN
    CASES[tests/cases] --> TESTS
```

## Notes for readers

- **Manual links that are not generated.** `TokenType` in `token.h`, the
  keyword map in `Lexer::Lexer`, and the `tokenTypeName` switch are
  maintained by hand. A new word in the JSON file does nothing until
  these are updated as well.
- **FayZul spellings outside the lexer** appear only in error messages
  via `FZ_*` macros (parser, semantic analyzer, driver). Grammar and
  semantic logic use `TokenType` values and AST nodes.
- **Codegen is free of FayZul words.** The parser converts operator
  words to C++ operator strings (`">"`, `"&&"`) before building the AST.
- **Functions** become C++17 function templates with a leading `FZ_CTX`
  parameter; see the roadmap §3.1 for why.

See [FayZul_Development_Roadmap.md](FayZul_Development_Roadmap.md) for
design decisions, limitations, and remaining work.
