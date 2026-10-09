// =============================================================================
// semantic.cpp
// FayZul Semantic Analyzer Implementation
//
// PURPOSE:
//   Implements the checks listed in semantic.h. Like the Parser, this file
//   never hardcodes FayZul spellings: error messages use the generated
//   FZ_* macros from keywords.h.
//
// WHY THE RECURSION-ORDER RULE EXISTS:
//   Functions are translated to C++ function templates whose return type is
//   deduced ('auto') from their return statements. C++ deduces that type from
//   the FIRST return statement the compiler meets while instantiating the
//   body. If a call that can recurse back into the function is met before
//   any non-recursive return, the type is still unknown and g++ fails with
//   "use of ... before deduction of 'auto'". checkRecursionOrder() rejects
//   exactly those programs, with a FayZul message, before g++ ever runs.
// =============================================================================

#include "semantic.h"
#include "keywords.h"

#include <sstream>
#include <stdexcept>

namespace {
std::string quote(const char* word) { return "'" + std::string(word) + "'"; }
}

// ---------------------------------------------------------------------------
// analyze() — entry point
// ---------------------------------------------------------------------------
void SemanticAnalyzer::analyze(const ProgramNode& program) {
    m_functions.clear();
    m_topLevelVariables.clear();
    m_scopes.clear();
    m_function  = nullptr;
    m_loopDepth = 0;
    m_declaring = nullptr;

    collectFunctions(program);
    computeRecursionGroups();
    for (const auto& stmt : program.statements) {
        if (stmt->kind != NodeKind::FunctionDecl) {
            collectTopLevelVariables(*stmt);
        }
    }

    // Top-level statements live in one scope (they become main() in C++).
    // Function bodies are checked with their own, separate scope stack.
    m_scopes.emplace_back();
    for (const auto& stmt : program.statements) {
        if (stmt->kind == NodeKind::FunctionDecl) {
            checkFunction(static_cast<const FunctionDeclNode&>(*stmt));
        } else {
            checkStatement(*stmt);
        }
    }
    m_scopes.clear();
}

// ---------------------------------------------------------------------------
// collectFunctions — register every top-level function (calls may refer to
// functions declared later in the file)
// ---------------------------------------------------------------------------
void SemanticAnalyzer::collectFunctions(const ProgramNode& program) {
    for (const auto& stmt : program.statements) {
        if (stmt->kind != NodeKind::FunctionDecl) continue;
        const auto& fn = static_cast<const FunctionDeclNode&>(*stmt);

        auto existing = m_functions.find(fn.name);
        if (existing != m_functions.end()) {
            error(fn, "Function '" + fn.name + "' is already declared on line " +
                      std::to_string(existing->second.decl->line));
        }

        FunctionInfo info;
        info.decl = &fn;
        collectCallees(*fn.body, info.callees);
        m_functions[fn.name] = std::move(info);
    }
}

// ---------------------------------------------------------------------------
// computeRecursionGroups
//   group(F) = { G | F can reach G and G can reach F through calls }.
//   F is in its own group only if it is (directly or indirectly) recursive.
// ---------------------------------------------------------------------------
void SemanticAnalyzer::computeRecursionGroups() {
    std::map<std::string, std::set<std::string>> reach;
    for (const auto& entry : m_functions) {
        std::set<std::string>&  seen = reach[entry.first];
        std::vector<std::string> work(entry.second.callees.begin(), entry.second.callees.end());
        while (!work.empty()) {
            std::string name = work.back();
            work.pop_back();
            auto it = m_functions.find(name);
            if (it == m_functions.end() || !seen.insert(name).second) continue;
            work.insert(work.end(), it->second.callees.begin(), it->second.callees.end());
        }
    }

    for (auto& entry : m_functions) {
        const std::string& f = entry.first;
        for (const std::string& g : reach[f]) {
            if (reach[g].count(f)) entry.second.recursionGroup.insert(g);
        }
    }
}

void SemanticAnalyzer::collectTopLevelVariables(const ASTNode& stmt) {
    switch (stmt.kind) {
        case NodeKind::VarDecl:
            m_topLevelVariables.insert(static_cast<const VarDeclNode&>(stmt).name);
            break;
        case NodeKind::Block:
            for (const auto& s : static_cast<const BlockNode&>(stmt).statements) {
                collectTopLevelVariables(*s);
            }
            break;
        case NodeKind::IfStmt: {
            const auto& n = static_cast<const IfStmtNode&>(stmt);
            collectTopLevelVariables(*n.thenBlock);
            if (n.elseBlock) collectTopLevelVariables(*n.elseBlock);
            break;
        }
        case NodeKind::WhileStmt:
            collectTopLevelVariables(*static_cast<const WhileStmtNode&>(stmt).body);
            break;
        default:
            break;
    }
}

// ---------------------------------------------------------------------------
// checkFunction
// ---------------------------------------------------------------------------
void SemanticAnalyzer::checkFunction(const FunctionDeclNode& fn) {
    // Fresh context: a function sees only its parameters and its own locals.
    auto savedScopes = std::move(m_scopes);
    int  savedLoops  = m_loopDepth;
    m_scopes.clear();
    m_scopes.emplace_back();
    m_function  = &fn;
    m_loopDepth = 0;

    for (const Parameter& p : fn.params) {
        if (m_functions.count(p.name)) {
            error(p.line, p.column, "Parameter '" + p.name + "' of '" + fn.name +
                  "' has the same name as a function");
        }
        auto& scope = m_scopes.back();
        if (scope.count(p.name)) {
            error(p.line, p.column, "Parameter '" + p.name + "' appears more than once in '" +
                  fn.name + "'");
        }
        scope[p.name] = p.line;
    }

    const ReturnStmtNode* firstReturn = nullptr;
    checkReturnConsistency(fn, *fn.body, firstReturn);

    // The body block shares the parameter scope, like a C++ function body.
    for (const auto& stmt : static_cast<const BlockNode&>(*fn.body).statements) {
        checkStatement(*stmt);
    }

    if (fn.returnsValue && !definitelyReturns(*fn.body)) {
        error(fn, "Function '" + fn.name + "' returns a value, but it can reach the end of "
                  "its body without " + quote(FZ_RETURN) + ". End the function with " +
                  quote(FZ_RETURN) + " <value>; or make sure every path returns");
    }

    if (fn.returnsValue) {
        checkRecursionOrder(fn);
    }

    m_scopes    = std::move(savedScopes);
    m_loopDepth = savedLoops;
    m_function  = nullptr;
}

// ---------------------------------------------------------------------------
// checkReturnConsistency — every Wafapafas in a function either has a value
// or none does (C++ cannot deduce one return type from both forms)
// ---------------------------------------------------------------------------
void SemanticAnalyzer::checkReturnConsistency(const FunctionDeclNode& fn, const ASTNode& stmt,
                                              const ReturnStmtNode*& first) {
    switch (stmt.kind) {
        case NodeKind::ReturnStmt: {
            const auto& r = static_cast<const ReturnStmtNode&>(stmt);
            if (!first) {
                first = &r;
            } else if ((first->value == nullptr) != (r.value == nullptr)) {
                std::string withValue = "'" + std::string(FZ_RETURN) + " <value>;'";
                std::string bare      = "'" + std::string(FZ_RETURN) + ";'";
                error(r, "Function '" + fn.name + "' has both " + bare + " (no value) and " +
                         withValue + "; this one conflicts with the one on line " +
                         std::to_string(first->line) + ". A function must either always "
                         "return a value or never return one");
            }
            break;
        }
        case NodeKind::Block:
            for (const auto& s : static_cast<const BlockNode&>(stmt).statements) {
                checkReturnConsistency(fn, *s, first);
            }
            break;
        case NodeKind::IfStmt: {
            const auto& n = static_cast<const IfStmtNode&>(stmt);
            checkReturnConsistency(fn, *n.thenBlock, first);
            if (n.elseBlock) checkReturnConsistency(fn, *n.elseBlock, first);
            break;
        }
        case NodeKind::WhileStmt:
            checkReturnConsistency(fn, *static_cast<const WhileStmtNode&>(stmt).body, first);
            break;
        default:
            break;
    }
}

// ---------------------------------------------------------------------------
// checkRecursionOrder
//   Walks the body in source order (the order g++ instantiates it). Until a
//   'Wafapafas <expr>' whose expression calls nothing in the recursion group
//   has been seen, any call into the group is an error.
//   Functions that return no value are emitted with an explicit 'void'
//   return type, so they need no deduction and are exempt.
// ---------------------------------------------------------------------------
void SemanticAnalyzer::checkRecursionOrder(const FunctionDeclNode& fn) {
    if (m_functions[fn.name].recursionGroup.empty()) return;
    bool baseSeen = false;
    recursionOrderStmt(fn, *fn.body, baseSeen);
}

void SemanticAnalyzer::recursionOrderStmt(const FunctionDeclNode& fn, const ASTNode& stmt,
                                          bool& baseSeen) {
    switch (stmt.kind) {
        case NodeKind::Block:
            for (const auto& s : static_cast<const BlockNode&>(stmt).statements) {
                recursionOrderStmt(fn, *s, baseSeen);
            }
            break;
        case NodeKind::PrintStmt:
            for (const auto& a : static_cast<const PrintStmtNode&>(stmt).arguments) {
                recursionOrderExpr(fn, *a, baseSeen);
            }
            break;
        case NodeKind::VarDecl:
            recursionOrderExpr(fn, *static_cast<const VarDeclNode&>(stmt).initializer, baseSeen);
            break;
        case NodeKind::Assign:
            recursionOrderExpr(fn, *static_cast<const AssignNode&>(stmt).value, baseSeen);
            break;
        case NodeKind::CallStmt:
            recursionOrderExpr(fn, *static_cast<const CallStmtNode&>(stmt).call, baseSeen);
            break;
        case NodeKind::IfStmt: {
            const auto& n = static_cast<const IfStmtNode&>(stmt);
            recursionOrderExpr(fn, *n.condition, baseSeen);
            recursionOrderStmt(fn, *n.thenBlock, baseSeen);
            if (n.elseBlock) recursionOrderStmt(fn, *n.elseBlock, baseSeen);
            break;
        }
        case NodeKind::WhileStmt: {
            const auto& n = static_cast<const WhileStmtNode&>(stmt);
            recursionOrderExpr(fn, *n.condition, baseSeen);
            recursionOrderStmt(fn, *n.body, baseSeen);
            break;
        }
        case NodeKind::ReturnStmt: {
            const auto& r = static_cast<const ReturnStmtNode&>(stmt);
            if (r.value) {
                // Throws if the value calls into the group before a base case;
                // otherwise this return fixes the function's return type.
                recursionOrderExpr(fn, *r.value, baseSeen);
                baseSeen = true;
            }
            break;
        }
        default:
            break;
    }
}

void SemanticAnalyzer::recursionOrderExpr(const FunctionDeclNode& fn, const ASTNode& expr,
                                          bool baseSeen) {
    if (baseSeen) return;
    switch (expr.kind) {
        case NodeKind::CallExpr: {
            const auto& call = static_cast<const CallExprNode&>(expr);
            const auto& group = m_functions[fn.name].recursionGroup;
            if (group.count(call.callee)) {
                std::string how = (call.callee == fn.name)
                    ? "Recursive call to '" + fn.name + "'"
                    : "Call to '" + call.callee + "' (which calls back into '" + fn.name + "')";
                error(call, how + " comes before any non-recursive " + quote(FZ_RETURN) +
                      " in '" + fn.name + "'. FayZul infers a function's return type from its "
                      "first " + quote(FZ_RETURN) + ", so put a base case (a " + quote(FZ_RETURN) +
                      " that does not recurse) before this call");
            }
            for (const auto& a : call.arguments) recursionOrderExpr(fn, *a, baseSeen);
            break;
        }
        case NodeKind::BinaryExpr: {
            const auto& b = static_cast<const BinaryExprNode&>(expr);
            recursionOrderExpr(fn, *b.left, baseSeen);
            recursionOrderExpr(fn, *b.right, baseSeen);
            break;
        }
        case NodeKind::UnaryExpr:
            recursionOrderExpr(fn, *static_cast<const UnaryExprNode&>(expr).operand, baseSeen);
            break;
        default:
            break;
    }
}

// ---------------------------------------------------------------------------
// checkStatement
// ---------------------------------------------------------------------------
void SemanticAnalyzer::checkStatement(const ASTNode& stmt) {
    switch (stmt.kind) {
        case NodeKind::PrintStmt:
            for (const auto& a : static_cast<const PrintStmtNode&>(stmt).arguments) {
                checkExpr(*a);
            }
            break;

        case NodeKind::VarDecl: {
            const auto& n = static_cast<const VarDeclNode&>(stmt);
            m_declaring = &n.name;
            checkExpr(*n.initializer);
            m_declaring = nullptr;
            declareVariable(n.name, n);
            break;
        }

        case NodeKind::Assign: {
            const auto& n = static_cast<const AssignNode&>(stmt);
            if (m_functions.count(n.target)) {
                error(n, "Cannot assign to '" + n.target + "' because it is a function");
            }
            if (!isVariable(n.target)) {
                if (m_function && m_topLevelVariables.count(n.target)) {
                    error(n, "Variable '" + n.target + "' is declared at the top level and is not "
                             "visible inside function '" + m_function->name + "'");
                }
                error(n, "Cannot assign to '" + n.target + "' because it is not declared. Declare "
                         "it first with " + quote(FZ_STORE));
            }
            checkExpr(*n.value);
            break;
        }

        case NodeKind::CallStmt:
            checkCall(static_cast<const CallExprNode&>(*static_cast<const CallStmtNode&>(stmt).call),
                      true);
            break;

        case NodeKind::IfStmt: {
            const auto& n = static_cast<const IfStmtNode&>(stmt);
            checkExpr(*n.condition);
            checkBlock(static_cast<const BlockNode&>(*n.thenBlock));
            if (n.elseBlock) checkBlock(static_cast<const BlockNode&>(*n.elseBlock));
            break;
        }

        case NodeKind::WhileStmt: {
            const auto& n = static_cast<const WhileStmtNode&>(stmt);
            checkExpr(*n.condition);
            m_loopDepth++;
            checkBlock(static_cast<const BlockNode&>(*n.body));
            m_loopDepth--;
            break;
        }

        case NodeKind::BreakStmt:
            if (m_loopDepth == 0) {
                error(stmt, quote(FZ_BREAK) + " can only be used inside a " + quote(FZ_WHILE) + " loop");
            }
            break;

        case NodeKind::ContinueStmt:
            if (m_loopDepth == 0) {
                error(stmt, quote(FZ_CONTINUE) + " can only be used inside a " + quote(FZ_WHILE) + " loop");
            }
            break;

        case NodeKind::ReturnStmt: {
            const auto& n = static_cast<const ReturnStmtNode&>(stmt);
            if (!m_function) {
                error(n, quote(FZ_RETURN) + " can only be used inside a " + quote(FZ_FUNCTION) + " function");
            }
            if (n.value) checkExpr(*n.value);
            break;
        }

        default:
            error(stmt, "Unexpected statement kind in semantic analysis");
    }
}

void SemanticAnalyzer::checkBlock(const BlockNode& block) {
    m_scopes.emplace_back();
    for (const auto& s : block.statements) {
        checkStatement(*s);
    }
    m_scopes.pop_back();
}

// ---------------------------------------------------------------------------
// checkExpr
// ---------------------------------------------------------------------------
void SemanticAnalyzer::checkExpr(const ASTNode& expr) {
    switch (expr.kind) {
        case NodeKind::StringLiteral:
        case NodeKind::NumberLiteral:
        case NodeKind::BoolLiteral:
        case NodeKind::NullLiteral:
            break;

        case NodeKind::Identifier: {
            const auto& id = static_cast<const IdentifierNode&>(expr);
            if (m_declaring && *m_declaring == id.name) {
                error(id, "Variable '" + id.name + "' is used in its own initializer");
            }
            if (isVariable(id.name)) break;
            if (m_functions.count(id.name)) {
                error(id, "Function '" + id.name + "' must be called with parentheses, e.g. " +
                          id.name + "(...)");
            }
            if (m_function && m_topLevelVariables.count(id.name)) {
                error(id, "Variable '" + id.name + "' is declared at the top level and is not "
                          "visible inside function '" + m_function->name + "'. Pass it as a "
                          "parameter instead");
            }
            error(id, "Variable '" + id.name + "' is not declared");
        }

        case NodeKind::BinaryExpr: {
            const auto& b = static_cast<const BinaryExprNode&>(expr);
            checkExpr(*b.left);
            checkExpr(*b.right);
            break;
        }

        case NodeKind::UnaryExpr:
            checkExpr(*static_cast<const UnaryExprNode&>(expr).operand);
            break;

        case NodeKind::CallExpr:
            checkCall(static_cast<const CallExprNode&>(expr), false);
            break;

        default:
            error(expr, "Unexpected expression kind in semantic analysis");
    }
}

void SemanticAnalyzer::checkCall(const CallExprNode& call, bool asStatement) {
    auto it = m_functions.find(call.callee);
    if (it == m_functions.end()) {
        if (isVariable(call.callee)) {
            error(call, "'" + call.callee + "' is a variable, not a function");
        }
        error(call, "Function '" + call.callee + "' is not declared");
    }

    const FunctionDeclNode& fn = *it->second.decl;
    if (call.arguments.size() != fn.params.size()) {
        error(call, "Function '" + fn.name + "' expects " + std::to_string(fn.params.size()) +
                    " argument(s) but got " + std::to_string(call.arguments.size()));
    }
    if (!asStatement && !fn.returnsValue) {
        error(call, "Function '" + fn.name + "' does not return a value (it has no " +
                    quote(FZ_RETURN) + " <value>;), so it cannot be used in an expression");
    }

    for (const auto& a : call.arguments) {
        checkExpr(*a);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
bool SemanticAnalyzer::isVariable(const std::string& name) const {
    for (auto it = m_scopes.rbegin(); it != m_scopes.rend(); ++it) {
        if (it->count(name)) return true;
    }
    return false;
}

void SemanticAnalyzer::declareVariable(const std::string& name, const ASTNode& at) {
    if (m_functions.count(name)) {
        error(at, "Cannot declare variable '" + name + "' because a function has that name");
    }
    auto& scope = m_scopes.back();
    auto existing = scope.find(name);
    if (existing != scope.end()) {
        error(at, "Variable '" + name + "' is already declared in this block (line " +
                  std::to_string(existing->second) + ")");
    }
    scope[name] = at.line;
}

// A statement "definitely returns" if every path through it ends in a
// Wafapafas. Loops are conservatively treated as possibly not returning.
bool SemanticAnalyzer::definitelyReturns(const ASTNode& stmt) {
    switch (stmt.kind) {
        case NodeKind::ReturnStmt:
            return true;
        case NodeKind::Block:
            for (const auto& s : static_cast<const BlockNode&>(stmt).statements) {
                if (definitelyReturns(*s)) return true;
            }
            return false;
        case NodeKind::IfStmt: {
            const auto& n = static_cast<const IfStmtNode&>(stmt);
            return n.elseBlock && definitelyReturns(*n.thenBlock) && definitelyReturns(*n.elseBlock);
        }
        default:
            return false;
    }
}

void SemanticAnalyzer::collectCallees(const ASTNode& node, std::set<std::string>& out) {
    switch (node.kind) {
        case NodeKind::CallExpr: {
            const auto& c = static_cast<const CallExprNode&>(node);
            out.insert(c.callee);
            for (const auto& a : c.arguments) collectCallees(*a, out);
            break;
        }
        case NodeKind::CallStmt:
            collectCallees(*static_cast<const CallStmtNode&>(node).call, out);
            break;
        case NodeKind::Block:
            for (const auto& s : static_cast<const BlockNode&>(node).statements) collectCallees(*s, out);
            break;
        case NodeKind::PrintStmt:
            for (const auto& a : static_cast<const PrintStmtNode&>(node).arguments) collectCallees(*a, out);
            break;
        case NodeKind::VarDecl:
            collectCallees(*static_cast<const VarDeclNode&>(node).initializer, out);
            break;
        case NodeKind::Assign:
            collectCallees(*static_cast<const AssignNode&>(node).value, out);
            break;
        case NodeKind::IfStmt: {
            const auto& n = static_cast<const IfStmtNode&>(node);
            collectCallees(*n.condition, out);
            collectCallees(*n.thenBlock, out);
            if (n.elseBlock) collectCallees(*n.elseBlock, out);
            break;
        }
        case NodeKind::WhileStmt: {
            const auto& n = static_cast<const WhileStmtNode&>(node);
            collectCallees(*n.condition, out);
            collectCallees(*n.body, out);
            break;
        }
        case NodeKind::ReturnStmt: {
            const auto& r = static_cast<const ReturnStmtNode&>(node);
            if (r.value) collectCallees(*r.value, out);
            break;
        }
        case NodeKind::BinaryExpr: {
            const auto& b = static_cast<const BinaryExprNode&>(node);
            collectCallees(*b.left, out);
            collectCallees(*b.right, out);
            break;
        }
        case NodeKind::UnaryExpr:
            collectCallees(*static_cast<const UnaryExprNode&>(node).operand, out);
            break;
        default:
            break;
    }
}

void SemanticAnalyzer::error(int line, int column, const std::string& message) const {
    std::ostringstream oss;
    oss << "[Semantic Error] Line " << line << ", Column " << column << ": " << message;
    throw std::runtime_error(oss.str());
}

void SemanticAnalyzer::error(const ASTNode& at, const std::string& message) const {
    error(at.line, at.column, message);
}
