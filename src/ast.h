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
// NODE SET (all implemented):
//   ProgramNode          — root: holds a list of top-level statements
//   PrintStmtNode        — difikhkhafa(expr, ..., bafas);
//   StringLiteralNode    — "hello"
//   NumberLiteralNode    — 42, 3.14
//   BoolLiteralNode      — Safach / Jhufoot
//   NullLiteralNode      — Khafalafi
//   IdentifierNode       — a variable reference
//   VarDeclNode          — rafkkhafo x expr kefeBafarrafabafar;
//   AssignNode           — x expr kefeBafarrafabafar;
//   BinaryExprNode       — expr op expr  (arithmetic / comparison / logical)
//   UnaryExprNode        — Nafain expr
//   IfStmtNode           — afagafar (...) { } wafarnafa { }
//   WhileStmtNode        — jafabTafak (...) { }
//   BlockNode            — { stmt; stmt; }
//   BreakStmtNode        — Rufukufo;
//   ContinueStmtNode     — chafalnayDafo;
//   FunctionDeclNode     — kafaam name(a, b) { }      (top level only)
//   ReturnStmtNode       — Wafapafas expr;  /  Wafapafas;
//   CallExprNode         — name(arg, arg)              (expression)
//   CallStmtNode         — name(arg, arg);             (statement)
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

    // --- Stages 5 and 6 ---
    FunctionDecl,
    ReturnStmt,
    CallExpr,
    CallStmt,
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
    ASTNodePtr  initializer; // The value expression written before kefeBafarrafabafar

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
//   Covers arithmetic, comparison, and binary logical operators.
//   The parser stores the C++ operator string, never the FayZul word.
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

// ---------------------------------------------------------------------------
// Parameter — one name in a function's parameter list
// ---------------------------------------------------------------------------
struct Parameter {
    std::string name;
    int         line;
    int         column;
};

// ---------------------------------------------------------------------------
// FunctionDeclNode — kafaam name(a, b) { ... }
//   Allowed only at the top level of a program.
//   returnsValue is a syntactic fact recorded by the parser: true when the
//   body contains at least one 'Wafapafas <expr>;'.
// ---------------------------------------------------------------------------
struct FunctionDeclNode : ASTNode {
    std::string            name;
    std::vector<Parameter> params;
    ASTNodePtr             body;          // Always a BlockNode
    bool                   returnsValue;

    FunctionDeclNode(std::string fnName, std::vector<Parameter> ps, ASTNodePtr b,
                     bool retVal, int ln, int col)
        : ASTNode(NodeKind::FunctionDecl, ln, col),
          name(std::move(fnName)),
          params(std::move(ps)),
          body(std::move(b)),
          returnsValue(retVal) {}
};

// ---------------------------------------------------------------------------
// ReturnStmtNode — Wafapafas expr;  or  Wafapafas;
//   value is nullptr for a return without a value.
// ---------------------------------------------------------------------------
struct ReturnStmtNode : ASTNode {
    ASTNodePtr value;

    ReturnStmtNode(ASTNodePtr val, int ln, int col)
        : ASTNode(NodeKind::ReturnStmt, ln, col), value(std::move(val)) {}
};

// ---------------------------------------------------------------------------
// CallExprNode — name(arg, arg)
// ---------------------------------------------------------------------------
struct CallExprNode : ASTNode {
    std::string             callee;
    std::vector<ASTNodePtr> arguments;

    CallExprNode(std::string name, std::vector<ASTNodePtr> args, int ln, int col)
        : ASTNode(NodeKind::CallExpr, ln, col),
          callee(std::move(name)),
          arguments(std::move(args)) {}
};

// ---------------------------------------------------------------------------
// CallStmtNode — name(arg, arg);
//   A call used as a statement; its result (if any) is discarded.
// ---------------------------------------------------------------------------
struct CallStmtNode : ASTNode {
    ASTNodePtr call;        // Always a CallExprNode

    CallStmtNode(ASTNodePtr c, int ln, int col)
        : ASTNode(NodeKind::CallStmt, ln, col), call(std::move(c)) {}
};
