// =============================================================================
// semantic.h
// FayZul Semantic Analyzer Interface
//
// PURPOSE:
//   Checks a parsed program for errors that are grammatically valid but
//   meaningless, so they are reported as FayZul errors instead of as g++
//   errors in the generated C++. It runs between the Parser and the Code
//   Generator and never modifies the AST.
//
//   Input:  const ProgramNode&  (AST root from Parser)
//   Output: nothing on success; throws std::runtime_error on the first error
//
// RULES CHECKED:
//   Variables
//     - A variable must be declared (rafkkhafo) before it is used or assigned.
//     - A name cannot be declared twice in the same block.
//     - A variable cannot be used in its own initializer.
//     - Inner blocks may shadow outer variables.
//   Loops
//     - Rufukufo / chafalnayDafo only inside a jafabTafak loop
//       (a function body starts a new loop context).
//   Functions
//     - Function names are unique; parameter names are unique per function.
//     - Variables and parameters cannot reuse a function's name.
//     - Calls must name a declared function with the right argument count.
//     - A function with no 'Wafapafas <value>;' cannot be used in an
//       expression.
//     - Wafapafas only inside a function; a function either always returns a
//       value or never does; a value-returning function must return on every
//       path.
//     - Function scope: a body sees only its parameters and its own locals.
//       Top-level variables are NOT visible inside functions.
//     - Return-type inference order: in a value-returning function, a
//       non-recursive 'Wafapafas' must come before any call that can recurse
//       back into the function (see checkRecursionOrder).
// =============================================================================

#pragma once

#include <map>
#include <set>
#include <string>
#include <vector>
#include "ast.h"

class SemanticAnalyzer {
public:
    void analyze(const ProgramNode& program);

private:
    struct FunctionInfo {
        const FunctionDeclNode* decl = nullptr;
        std::set<std::string>   callees;         // functions called directly
        std::set<std::string>   recursionGroup;  // functions that can call back into this one
    };

    std::map<std::string, FunctionInfo> m_functions;
    std::set<std::string>               m_topLevelVariables;

    // Variable scopes, innermost last: name -> declaration line
    std::vector<std::map<std::string, int>> m_scopes;
    const FunctionDeclNode* m_function   = nullptr;  // function being checked
    int                     m_loopDepth  = 0;
    const std::string*      m_declaring  = nullptr;  // variable whose initializer is being checked

    // --- Passes ---
    void collectFunctions(const ProgramNode& program);
    void computeRecursionGroups();
    void collectTopLevelVariables(const ASTNode& stmt);

    // --- Function checks ---
    void checkFunction(const FunctionDeclNode& fn);
    void checkReturnConsistency(const FunctionDeclNode& fn, const ASTNode& stmt,
                                const ReturnStmtNode*& first);
    void checkRecursionOrder(const FunctionDeclNode& fn);
    void recursionOrderStmt(const FunctionDeclNode& fn, const ASTNode& stmt, bool& baseSeen);
    void recursionOrderExpr(const FunctionDeclNode& fn, const ASTNode& expr, bool baseSeen);

    // --- Statement / expression checks ---
    void checkStatement(const ASTNode& stmt);
    void checkBlock(const BlockNode& block);
    void checkExpr(const ASTNode& expr);
    void checkCall(const CallExprNode& call, bool asStatement);

    // --- Helpers ---
    bool isVariable(const std::string& name) const;
    void declareVariable(const std::string& name, const ASTNode& at);
    static bool definitelyReturns(const ASTNode& stmt);
    static void collectCallees(const ASTNode& node, std::set<std::string>& out);

    [[noreturn]] void error(int line, int column, const std::string& message) const;
    [[noreturn]] void error(const ASTNode& at, const std::string& message) const;
};
