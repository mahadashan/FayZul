// =============================================================================
// codegen.h
// FayZul C++ Code Generator Interface
//
// PURPOSE:
//   The Code Generator walks the AST and produces a C++ source string.
//   It is the final stage before invoking g++.
//
//   Input:  const ProgramNode&  (AST root, already checked by SemanticAnalyzer)
//   Output: std::string         (complete, compilable C++17 source code)
//
// The Code Generator knows about:
//   - AST node types (from ast.h)
//   - Target C++ idioms (std::cout, function templates, etc.)
//
// The Code Generator does NOT know about:
//   - FayZul keywords or tokens (those were resolved by the Lexer/Parser)
//   - Source file paths or compilation commands (that is main.cpp's job)
//
// DESIGN:
//   generateNode() dispatches on NodeKind.
//   Each node kind has its own generateXxx() helper.
//   Adding support for a new node type = adding one case + one method.
//
//   lineMap() records, for every generated C++ line, the FayZul source line
//   it came from (0 for boilerplate). main.cpp uses it to report g++ errors
//   at FayZul line numbers.
// =============================================================================

#pragma once

#include <string>
#include <vector>
#include "ast.h"

class CodeGenerator {
public:
    CodeGenerator() = default;

    // Generate a complete C++ source file from the program AST.
    std::string generate(const ProgramNode& program);

    // lineMap()[i] is the FayZul line for generated C++ line i + 1 (0 = none).
    const std::vector<int>& lineMap() const { return m_lineMap; }

private:
    std::string      m_output;           // Accumulated C++ source
    int              m_indentLevel = 0;  // Current indentation level (for pretty output)
    bool             m_inFunction  = false;
    int              m_sourceLine  = 0;  // FayZul line of the node being generated
    std::vector<int> m_lineMap;

    // Dispatch to the correct generate method based on node kind
    void generateNode(const ASTNode& node);

    // --- Function generators ---
    std::string functionSignature(const FunctionDeclNode& node) const;
    void generateFunctionDecl(const FunctionDeclNode& node);

    // --- Statement generators ---
    void generatePrintStmt(const PrintStmtNode& node);
    void generateVarDecl(const VarDeclNode& node);
    void generateAssign(const AssignNode& node);
    void generateIfStmt(const IfStmtNode& node);
    void generateWhileStmt(const WhileStmtNode& node);
    void generateBreakStmt(const BreakStmtNode& node);
    void generateContinueStmt(const ContinueStmtNode& node);
    void generateReturnStmt(const ReturnStmtNode& node);
    void generateCallStmt(const CallStmtNode& node);
    void generateBlock(const BlockNode& node);

    // --- Expression generators (return a C++ expression string) ---
    std::string generateExpr(const ASTNode& node);
    std::string generateStringLiteral(const StringLiteralNode& node);
    std::string generateNumberLiteral(const NumberLiteralNode& node);
    std::string generateBoolLiteral(const BoolLiteralNode& node);
    std::string generateNullLiteral(const NullLiteralNode& node);
    std::string generateIdentifier(const IdentifierNode& node);
    std::string generateBinaryExpr(const BinaryExprNode& node);
    std::string generateUnaryExpr(const UnaryExprNode& node);
    std::string generateCallExpr(const CallExprNode& node);

    // --- Utility ---
    static std::string cppName(const std::string& fayzulName);
    std::string indent() const;
    void        emitLine(const std::string& text);

    [[noreturn]] void codegenError(const ASTNode& node, const std::string& message) const;
};
