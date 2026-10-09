// =============================================================================
// ast.h
// FayZul Abstract Syntax Tree (AST) Node Definitions
//
// PURPOSE:
//   Defines the node types that form the AST.
//   The Parser builds an AST from tokens; the Code Generator walks the AST
//   to produce C++. Neither stage needs to know the other exists.
//
// DESIGN:
//   - ASTNode is the abstract base class. Every node inherits from it.
//   - NodeKind is an enum so any pass (codegen, future type-checker, etc.)
//     can switch on the node type without dynamic_cast everywhere.
//   - std::unique_ptr is used for ownership — no manual memory management.
//
// CURRENT NODE SET (v1 — enough for difikhkhafa):
//   ProgramNode          — root: holds a list of statements
//   PrintStmtNode        — difikhkhafa(expr);
//   StringLiteralNode    — "hello"
//   NumberLiteralNode    — 42, 3.14
//   BoolLiteralNode      — Safach / Jhufoot
//   NullLiteralNode      — Khafalafi
//   IdentifierNode       — a user-defined variable/function name
//
// FUTURE NODES (stubs — add implementation in later stages):
//   VarDeclNode          — rafkkhafo x expr kefeBafarrafabafar;
//   AssignNode           — x expr kefeBafarrafabafar;
//   BinaryExprNode       — expr op expr  (arithmetic / comparison)
//   UnaryExprNode        — Nafain expr
//   IfStmtNode           — afagafar (...) { } wafarnafa { }
//   WhileStmtNode        — jafabTafak (...) { }
//   BlockNode            — { stmt; stmt; }
//   BreakStmtNode        — Rufukufo;
//   ContinueStmtNode     — chafalnayDafo;
//
// FUTURE NODES (stubs — add implementation in later stages):
//   FunctionDeclNode     — kafaam name(...) { }
//   ReturnStmtNode       — Wafapafas expr;
//   CallExprNode         — name(arg, arg)
// =============================================================================

#pragma once

#include <memory>
#include <string>
#include <vector>

// ---------------------------------------------------------------------------
// NodeKind — identify each AST node type without dynamic_cast
// ---------------------------------------------------------------------------
enum class NodeKind {
    Program,
    PrintStmt,
    StringLiteral,
    NumberLiteral,
    BoolLiteral,
    NullLiteral,
    Identifier,

    // --- Stage 2 ---
    VarDecl,
    Assign,
    BinaryExpr,

    // --- Stage 3 ---
    IfStmt,
    Block,
    UnaryExpr,

    // --- Stage 4 ---
    WhileStmt,
    BreakStmt,
    ContinueStmt,

    // --- Future stages (not yet implemented) ---
    FunctionDecl,
    ReturnStmt,
    CallExpr,
};

// ---------------------------------------------------------------------------
// ASTNode — abstract base for all nodes
// ---------------------------------------------------------------------------
struct ASTNode {
    NodeKind kind;
    int      line;      // Source line (for future error reporting)
    int      column;    // Source column

    ASTNode(NodeKind k, int ln = 0, int col = 0)
        : kind(k), line(ln), column(col) {}

    virtual ~ASTNode() = default;
};

// Convenience alias
using ASTNodePtr = std::unique_ptr<ASTNode>;

// ---------------------------------------------------------------------------
// ProgramNode — the root of every FayZul program
//   Contains an ordered list of top-level statements.
// ---------------------------------------------------------------------------
struct ProgramNode : ASTNode {
    std::vector<ASTNodePtr> statements;

    ProgramNode() : ASTNode(NodeKind::Program) {}
};

// ---------------------------------------------------------------------------
// PrintStmtNode — difikhkhafa(arg1, arg2, ..., bafas);
//   - arguments: the expressions/values to print (0 or more)
//   - hasEndl: if true, append std::endl (newline) at the end;
//              else, no newline — next print continues on same line
//   The 'bafas' keyword in the argument list sets hasEndl=true and is NOT
//   added to arguments itself — it is a sentinel, not a printed value.
// ---------------------------------------------------------------------------
struct PrintStmtNode : ASTNode {
    std::vector<ASTNodePtr> arguments;  // Values/expressions to print
    bool                    hasEndl;    // True if 'bafas' was used (endl)

    PrintStmtNode(std::vector<ASTNodePtr> args, bool endlFlag, int ln, int col)
        : ASTNode(NodeKind::PrintStmt, ln, col),
          arguments(std::move(args)),
          hasEndl(endlFlag) {}
};

// ---------------------------------------------------------------------------
// Expression leaf nodes
// ---------------------------------------------------------------------------

struct StringLiteralNode : ASTNode {
    std::string value;  // The string content WITHOUT surrounding quotes

    StringLiteralNode(std::string val, int ln, int col)
        : ASTNode(NodeKind::StringLiteral, ln, col), value(std::move(val)) {}
};

struct NumberLiteralNode : ASTNode {
    std::string value;  // Keep as string to preserve original format (e.g. "3.14")

    NumberLiteralNode(std::string val, int ln, int col)
        : ASTNode(NodeKind::NumberLiteral, ln, col), value(std::move(val)) {}
};

struct BoolLiteralNode : ASTNode {
    bool value;

    BoolLiteralNode(bool val, int ln, int col)
        : ASTNode(NodeKind::BoolLiteral, ln, col), value(val) {}
};

struct NullLiteralNode : ASTNode {
    NullLiteralNode(int ln, int col)
        : ASTNode(NodeKind::NullLiteral, ln, col) {}
};

struct IdentifierNode : ASTNode {
    std::string name;

    IdentifierNode(std::string n, int ln, int col)
        : ASTNode(NodeKind::Identifier, ln, col), name(std::move(n)) {}
};

// ---------------------------------------------------------------------------
// VarDeclNode — rafkkhafo x expr kefeBafarrafabafar;
//   Declares a new variable using 'auto' in generated C++.
// ---------------------------------------------------------------------------
struct VarDeclNode : ASTNode {
    std::string name;       // Variable name (identifier)
    ASTNodePtr  initializer; // The expression on the right-hand side of '='

    VarDeclNode(std::string varName, ASTNodePtr init, int ln, int col)
        : ASTNode(NodeKind::VarDecl, ln, col),
          name(std::move(varName)),
          initializer(std::move(init)) {}
};

// ---------------------------------------------------------------------------
// AssignNode — x expr kefeBafarrafabafar;
//   Re-assigns an already-declared variable.
// ---------------------------------------------------------------------------
struct AssignNode : ASTNode {
    std::string target;     // Variable name being assigned to
    ASTNodePtr  value;      // The new value expression

    AssignNode(std::string varName, ASTNodePtr val, int ln, int col)
        : ASTNode(NodeKind::Assign, ln, col),
          target(std::move(varName)),
          value(std::move(val)) {}
};

// ---------------------------------------------------------------------------
// BinaryExprNode — left op right
//   Covers arithmetic: +, -, *, /, %
//   Stage 3 will extend this with comparison/logical operators.
// ---------------------------------------------------------------------------
struct BinaryExprNode : ASTNode {
    std::string op;     // C++ operator string: "+", "-", "*", "/", "%",
                        //                      ">", "<", "==", ">=", "<=", "!=",
                        //                      "&&", "||"
    ASTNodePtr  left;
    ASTNodePtr  right;

    BinaryExprNode(std::string oper, ASTNodePtr lhs, ASTNodePtr rhs, int ln, int col)
        : ASTNode(NodeKind::BinaryExpr, ln, col),
          op(std::move(oper)),
          left(std::move(lhs)),
          right(std::move(rhs)) {}
};

// ---------------------------------------------------------------------------
// BlockNode — { statement; statement; ... }
//   A brace-delimited sequence of statements.
//   Used as the body of if/else, while, and function declarations.
// ---------------------------------------------------------------------------
struct BlockNode : ASTNode {
    std::vector<ASTNodePtr> statements;

    BlockNode(int ln, int col) : ASTNode(NodeKind::Block, ln, col) {}
};

// ---------------------------------------------------------------------------
// IfStmtNode — afagafar (condition) { ... } wafarnafa { ... }
//   The else block (elseBlock) is optional — nullptr means no else branch.
// ---------------------------------------------------------------------------
struct IfStmtNode : ASTNode {
    ASTNodePtr condition;
    ASTNodePtr thenBlock;           // Always a BlockNode
    ASTNodePtr elseBlock;           // BlockNode or nullptr

    IfStmtNode(ASTNodePtr cond, ASTNodePtr thenB, ASTNodePtr elseB, int ln, int col)
        : ASTNode(NodeKind::IfStmt, ln, col),
          condition(std::move(cond)),
          thenBlock(std::move(thenB)),
          elseBlock(std::move(elseB)) {}
};

// ---------------------------------------------------------------------------
// UnaryExprNode — op expr
//   Used for logical NOT: Nafain x  →  !x
//   op is stored as the C++ operator string: "!"
// ---------------------------------------------------------------------------
struct UnaryExprNode : ASTNode {
    std::string op;         // C++ operator string: "!"
    ASTNodePtr  operand;

    UnaryExprNode(std::string oper, ASTNodePtr opnd, int ln, int col)
        : ASTNode(NodeKind::UnaryExpr, ln, col),
          op(std::move(oper)),
          operand(std::move(opnd)) {}
};

// ---------------------------------------------------------------------------
// WhileStmtNode — while (condition) { ... }
// ---------------------------------------------------------------------------
struct WhileStmtNode : ASTNode {
    ASTNodePtr condition;
    ASTNodePtr body;        // Always a BlockNode

    WhileStmtNode(ASTNodePtr cond, ASTNodePtr b, int ln, int col)
        : ASTNode(NodeKind::WhileStmt, ln, col),
          condition(std::move(cond)),
          body(std::move(b)) {}
};

// ---------------------------------------------------------------------------
// BreakStmtNode — break;
// ---------------------------------------------------------------------------
struct BreakStmtNode : ASTNode {
    BreakStmtNode(int ln, int col)
        : ASTNode(NodeKind::BreakStmt, ln, col) {}
};

// ---------------------------------------------------------------------------
// ContinueStmtNode — continue;
// ---------------------------------------------------------------------------
struct ContinueStmtNode : ASTNode {
    ContinueStmtNode(int ln, int col)
        : ASTNode(NodeKind::ContinueStmt, ln, col) {}
};
