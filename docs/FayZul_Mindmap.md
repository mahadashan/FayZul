# FayZul Project Mind Map

Snapshot of the FayZul compiler as of 2026-10-09, checked against the
source in `src/`, `tools/`, `language/`, and `vscode-extension/`.
"Implemented" means there is a working Lexer → Parser → CodeGen path that
was exercised by compiling a `.fz` program. "Reserved" means the word is
lexed but the parser rejects it.

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
        Invoke g++
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
        Fails on first error
      AST
        unique_ptr ownership
        NodeKind dispatch
        Operators stored as C++ strings
      CodeGen
        Everything inside main
        auto for variables
        std::cout chains
    Implemented features
      Stage 1 print and strings
      Stage 2 variables and arithmetic
      Stage 3 if else comparison logic
      Stage 4 while break continue bafas
    Planned features
      Stage 5 kafaam and Wafapafas
      Stage 6 calls and arguments
      Stage 7 errors and recovery
      Not yet planned
        Semantic analysis pass
        Unary minus
        String type semantics
        Test suite
    Editor support
      VS Code extension
        TextMate highlighting
        Completion and snippets
        Hover descriptions
        Reads JSON at runtime
    Known gaps
      No semantic checks
      Errors leak from g++
      No regression tests
      Docs drift from code
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
    AST --> CG[codegen.cpp]

    LEX --> MAIN[main.cpp]
    PAR --> MAIN
    CG --> MAIN
    MAIN -->|writes| CPP[build/NAME.cpp]
    CPP -->|g++ via std::system| EXE[build/NAME.exe]
```

## Notes for readers

- **Manual links that are not generated.** `TokenType` in `token.h`, the
  keyword map in `Lexer::Lexer`, and the `tokenTypeName` switch are
  maintained by hand. A new word in the JSON file does nothing until
  these are updated as well.
- **Parser and FayZul spellings.** `parser.cpp` includes `keywords.h`
  only to put the current spelling into error messages. Its grammar
  logic uses `TokenType` values only.
- **Codegen is free of FayZul words.** The parser converts operator
  words to C++ operator strings (`">"`, `"&&"`) before building the AST.
- **Reserved, not implemented.** `kafaam` and `Wafapafas` produce tokens,
  and `NodeKind` has `FunctionDecl`, `ReturnStmt`, and `CallExpr`. There
  are no node structs, parser rules, or codegen for them yet.

See [FayZul_Development_Roadmap.md](FayZul_Development_Roadmap.md) for
priorities, discrepancies, and risks.