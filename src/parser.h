// =============================================================================
// parser.h
// FayZul Parser Interface
//
// PURPOSE:
//   The Parser consumes the flat token list produced by the Lexer and builds
//   a tree of AST nodes. It is the second stage of the compiler pipeline.
//
//   Input:  std::vector<Token>  (from Lexer)
//   Output: std::unique_ptr<ProgramNode>  (the AST root)
//
// The Parser knows about:
//   - Token types and their sequence (grammar rules)
//   - AST node types (from ast.h)
//
// The Parser does NOT know about:
//   - Raw FayZul source text (all characters were consumed by the Lexer)
//   - C++ output (that is the Code Generator's job)
//
// GRAMMAR SUPPORTED (Stages 1–6):
//   program        → ( functionDecl | statement )* EOF
//   functionDecl   → FUNCTION IDENTIFIER '(' paramList? ')' block   (top level only)
//   paramList      → IDENTIFIER ( ',' IDENTIFIER )*
//   statement      → printStmt | varDeclStmt | assignStmt | callStmt
//                  | ifStmt | whileStmt | breakStmt | continueStmt
//                  | returnStmt
//   printStmt      → PRINT '(' ( printArg (',' printArg)* )? ')' ';'
//   printArg       → expression | ENDLINE
//   varDeclStmt    → STORE IDENTIFIER expression ASSIGN ';'
//   assignStmt     → IDENTIFIER expression ASSIGN ';'
//   callStmt       → IDENTIFIER '(' argList? ')' ';'
//   argList        → expression ( ',' expression )*
//   ifStmt         → IF '(' expression ')' block ( ELSE block )?
//   whileStmt      → WHILE '(' expression ')' block
//   breakStmt      → BREAK ';'
//   continueStmt   → CONTINUE ';'
//   returnStmt     → RETURN expression? ';'
//   block          → '{' statement* '}'
//
// CALL vs. ASSIGNMENT (both may start with IDENTIFIER '('):
//   At statement start, IDENTIFIER '(' is a callStmt exactly when the token
//   after the matching ')' is ';'. Otherwise it is an assignStmt whose value
//   begins with a parenthesised expression, e.g.  x (1) kefeBafarrafabafar;
//   The forms cannot overlap: an assignStmt always has ASSIGN before its ';'.
//   expression     → logicalOr
//   logicalOr      → logicalAnd  ( OR  logicalAnd  )*
//   logicalAnd     → logicalNot  ( AND logicalNot  )*
//   logicalNot     → NOT logicalNot  |  comparison
//   comparison     → additive ( compOp additive )?
//   compOp         → GT | LT | EQ | GTE | LTE | NEQ
//   additive       → term   ( ('+' | '-') term   )*
//   term           → primary ( ('*' | '/' | '%') primary )*
//   primary        → STRING | NUMBER | BOOL_TRUE | BOOL_FALSE | NULL
//                    | IDENTIFIER '(' argList? ')'      (call expression)
//                    | IDENTIFIER | '(' expression ')'
// =============================================================================

#pragma once

#include <vector>
#include <memory>
#include "token.h"
#include "ast.h"

class Parser {
public:
    // Construct with the token list produced by the Lexer.
    explicit Parser(std::vector<Token> tokens);

    // Parse the entire program and return the AST root.
    // Throws std::runtime_error on syntax errors.
    std::unique_ptr<ProgramNode> parse();

private:
    std::vector<Token> m_tokens;
    size_t             m_pos;       // Index of current (un-consumed) token

    // Set while parsing a function body: records whether a value-returning
    // 'Wafapafas expr;' was seen (stored in FunctionDeclNode::returnsValue).
    bool               m_sawValueReturn = false;

    // --- Token navigation helpers ---
    const Token& current() const;               // Peek at the current token
    const Token& peek(size_t offset = 1) const; // Peek ahead by `offset`
    Token        consume();                     // Return current token and advance
    Token        expect(TokenType type, const std::string& errorMsg); // Consume or throw

    bool isAtEnd() const;
    bool check(TokenType type) const;           // True if current token is `type`
    bool match(TokenType type);                 // Consume if current is `type`, else false

    // --- Parsing rules: statements ---
    ASTNodePtr parseStatement();
    ASTNodePtr parsePrintStatement();   // difikhkhafa(args..., bafas?);
    ASTNodePtr parseVarDeclStatement();  // rafkkhafo x expr kefeBafarrafabafar;
    ASTNodePtr parseAssignStatement();   // x expr kefeBafarrafabafar;
    ASTNodePtr parseIfStatement();       // afagafar (cond) { } wafarnafa { }
    ASTNodePtr parseWhileStatement();    // jafabTafak (cond) { }
    ASTNodePtr parseBreakStatement();    // Rufukufo;
    ASTNodePtr parseContinueStatement(); // chafalnayDafo;
    ASTNodePtr parseBlock();             // { statement* }
    ASTNodePtr parseFunctionDecl();      // kafaam name(a, b) { }
    ASTNodePtr parseReturnStatement();   // Wafapafas expr;  /  Wafapafas;
    ASTNodePtr parseCallStatement();     // name(args);
    ASTNodePtr parseCallExpr();          // name(args) — current token is the name
    bool       isCallStatement() const;  // IDENTIFIER '(' ... ')' ';' lookahead
    size_t     afterMatchingParen(size_t open) const; // index after the ')' matching m_tokens[open]

    // --- Parsing rules: expression hierarchy (lowest → highest precedence) ---
    ASTNodePtr parseExpression();        // entry point → calls logicalOr
    ASTNodePtr parseLogicalOr();         // Yafa  (||)
    ASTNodePtr parseLogicalAnd();        // Afaur (&&)
    ASTNodePtr parseLogicalNot();        // Nafain (!)
    ASTNodePtr parseComparison();        // bafaraHafai, chofotafaHafai, etc.
    ASTNodePtr parseAdditive();          // + and -
    ASTNodePtr parseTerm();              // *, /, %
    ASTNodePtr parsePrimary();           // literals, identifiers, ( expr )

    // --- Error helper ---
    [[noreturn]] void parseError(const std::string& message) const;
};
