// =============================================================================
// codegen.cpp
// FayZul C++ Code Generator Implementation
//
// PURPOSE:
//   Walks the AST and emits a C++17 source file string.
//
// IMPORTANT:
//   There are NO FayZul keywords anywhere in this file.
//   The code generator only knows about AST node kinds and C++ syntax.
//   This proves the pipeline is clean: Lexer handles FayZul text,
//   Parser builds the AST, CodeGen translates AST → C++.
//
// GENERATED FILE STRUCTURE:
//   #include <iostream>
//   #include <string>
//
//   // forward declarations of every FayZul function
//   template<class FZ_CTX, class T0> auto fz_name(T0 fz_param);
//
//   // function definitions
//   template<class FZ_CTX, class T0>
//   auto fz_name(T0 fz_param) { ... }
//
//   int main() {
//       <top-level statements>
//       return 0;
//   }
//
// NAMES:
//   Every FayZul identifier is emitted with an "fz_" prefix, so FayZul names
//   can never collide with C++ keywords (int, class, ...) or with main().
//
// FUNCTIONS (untyped parameters in C++17):
//   - Each parameter gets its own template type parameter (T0, T1, ...), so
//     one FayZul function works with any argument types.
//   - Functions with a value-returning return statement use a deduced 'auto'
//     return type; functions without one are declared 'void'.
//   - Every function also takes a leading template parameter FZ_CTX, and
//     calls made inside a function are written fz_f<FZ_CTX>(...). This makes
//     every call "dependent", so C++ resolves it only when main() instantiates
//     the function — after all definitions exist. Without it, a call with
//     non-dependent arguments (e.g. g() or h(2)) to a function defined later
//     fails with "use of 'auto' before deduction". main() calls fz_f<void>(...).
//   - Forward declarations allow recursion and mutual recursion in any order.
// =============================================================================

#include "codegen.h"
#include <stdexcept>
#include <sstream>

// ---------------------------------------------------------------------------
// generate() — main entry point
//   Emits function declarations and definitions, then wraps all other
//   top-level statements in a standard C++ main() function.
// ---------------------------------------------------------------------------
std::string CodeGenerator::generate(const ProgramNode& program) {
    m_output.clear();
    m_lineMap.clear();
    m_indentLevel = 0;
    m_inFunction  = false;
    m_sourceLine  = 0;

    // Standard C++ boilerplate header
    emitLine("#include <iostream>");
    emitLine("#include <string>");
    emitLine("");

    std::vector<const FunctionDeclNode*> functions;
    for (const auto& stmt : program.statements) {
        if (stmt->kind == NodeKind::FunctionDecl) {
            functions.push_back(static_cast<const FunctionDeclNode*>(stmt.get()));
        }
    }

    if (!functions.empty()) {
        for (const FunctionDeclNode* fn : functions) {
            m_sourceLine = fn->line;
            emitLine(functionSignature(*fn) + ";");
        }
        m_sourceLine = 0;
        emitLine("");

        for (const FunctionDeclNode* fn : functions) {
            generateFunctionDecl(*fn);
            m_sourceLine = 0;
            emitLine("");
        }
    }

    emitLine("int main() {");
    m_indentLevel = 1;

    for (const auto& stmt : program.statements) {
        if (stmt->kind != NodeKind::FunctionDecl) {
            generateNode(*stmt);
        }
    }

    m_sourceLine = 0;
    emitLine("");
    emitLine(indent() + "return 0;");

    m_indentLevel = 0;
    emitLine("}");

    return m_output;
}

// ---------------------------------------------------------------------------
// generateNode — dispatch on NodeKind
// ---------------------------------------------------------------------------
void CodeGenerator::generateNode(const ASTNode& node) {
    int savedLine = m_sourceLine;
    m_sourceLine  = node.line;

    switch (node.kind) {
        case NodeKind::PrintStmt:
            generatePrintStmt(static_cast<const PrintStmtNode&>(node));
            break;

        case NodeKind::VarDecl:
            generateVarDecl(static_cast<const VarDeclNode&>(node));
            break;

        case NodeKind::Assign:
            generateAssign(static_cast<const AssignNode&>(node));
            break;

        case NodeKind::IfStmt:
            generateIfStmt(static_cast<const IfStmtNode&>(node));
            break;

        case NodeKind::WhileStmt:
            generateWhileStmt(static_cast<const WhileStmtNode&>(node));
            break;

        case NodeKind::BreakStmt:
            generateBreakStmt(static_cast<const BreakStmtNode&>(node));
            break;

        case NodeKind::ContinueStmt:
            generateContinueStmt(static_cast<const ContinueStmtNode&>(node));
            break;

        case NodeKind::ReturnStmt:
            generateReturnStmt(static_cast<const ReturnStmtNode&>(node));
            break;

        case NodeKind::CallStmt:
            generateCallStmt(static_cast<const CallStmtNode&>(node));
            break;

        default:
            codegenError(node, "Code generator does not yet handle this node type");
    }

    m_sourceLine = savedLine;
}

// ---------------------------------------------------------------------------
// Function declarations
//   functionSignature() builds the template header and signature shared by
//   the forward declaration and the definition, e.g.
//     template<class FZ_CTX, class T0, class T1> auto fz_add(T0 fz_a, T1 fz_b)
// ---------------------------------------------------------------------------
std::string CodeGenerator::functionSignature(const FunctionDeclNode& node) const {
    std::ostringstream oss;
    oss << "template<class FZ_CTX";
    for (size_t i = 0; i < node.params.size(); ++i) {
        oss << ", class T" << i;
    }
    oss << "> " << (node.returnsValue ? "auto " : "void ") << cppName(node.name) << "(";
    for (size_t i = 0; i < node.params.size(); ++i) {
        if (i > 0) oss << ", ";
        oss << "T" << i << " " << cppName(node.params[i].name);
    }
    oss << ")";
    return oss.str();
}

void CodeGenerator::generateFunctionDecl(const FunctionDeclNode& node) {
    m_sourceLine = node.line;
    emitLine(functionSignature(node) + " {");

    m_inFunction  = true;
    m_indentLevel = 1;
    generateBlock(static_cast<const BlockNode&>(*node.body));
    m_indentLevel = 0;
    m_inFunction  = false;

    m_sourceLine = node.line;
    emitLine("}");
}

// ---------------------------------------------------------------------------
// generatePrintStmt
//   C++:  std::cout << arg1 << arg2 << std::endl;
//
//   Multi-argument outputs are chained with '<<'.
//   If hasEndl is true, '<< std::endl' is appended last (adds a newline and
//   flushes). Otherwise nothing is appended, so subsequent print calls
//   continue writing on the same output line.
// ---------------------------------------------------------------------------
void CodeGenerator::generatePrintStmt(const PrintStmtNode& node) {
    // An empty print with no newline is a no-op; emitting 'std::cout;'
    // would only trigger a "statement has no effect" warning.
    if (node.arguments.empty() && !node.hasEndl) {
        return;
    }

    std::ostringstream oss;
    oss << indent() << "std::cout";

    for (const auto& arg : node.arguments) {
        oss << " << " << generateExpr(*arg);
    }

    if (node.hasEndl) {
        oss << " << std::endl";
    }

    oss << ";";
    emitLine(oss.str());
}

// ---------------------------------------------------------------------------
// generateVarDecl
//   C++:  auto fz_x = 42;
//
//   We use 'auto' so the C++ compiler infers the type from the initializer.
// ---------------------------------------------------------------------------
void CodeGenerator::generateVarDecl(const VarDeclNode& node) {
    std::string init = generateExpr(*node.initializer);
    emitLine(indent() + "auto " + cppName(node.name) + " = " + init + ";");
}

// ---------------------------------------------------------------------------
// generateAssign
//   C++:  fz_x = 100;
// ---------------------------------------------------------------------------
void CodeGenerator::generateAssign(const AssignNode& node) {
    std::string val = generateExpr(*node.value);
    emitLine(indent() + cppName(node.target) + " = " + val + ";");
}

// ---------------------------------------------------------------------------
// generateIfStmt
//   C++:  if ((fz_x > 5)) { ... } else { ... }
//
//   Indentation is managed by m_indentLevel:
//     - The 'if (cond) {' line is at the current indent level.
//     - The body statements are one level deeper.
//     - The closing '}' returns to the outer level.
// ---------------------------------------------------------------------------
void CodeGenerator::generateIfStmt(const IfStmtNode& node) {
    std::string cond = generateExpr(*node.condition);
    emitLine(indent() + "if (" + cond + ") {");

    m_indentLevel++;
    generateBlock(static_cast<const BlockNode&>(*node.thenBlock));
    m_indentLevel--;

    if (node.elseBlock) {
        emitLine(indent() + "} else {");
        m_indentLevel++;
        generateBlock(static_cast<const BlockNode&>(*node.elseBlock));
        m_indentLevel--;
    }

    emitLine(indent() + "}");
}

// ---------------------------------------------------------------------------
// generateWhileStmt
//   C++:  while (cond) { ... }
// ---------------------------------------------------------------------------
void CodeGenerator::generateWhileStmt(const WhileStmtNode& node) {
    std::string cond = generateExpr(*node.condition);
    emitLine(indent() + "while (" + cond + ") {");

    m_indentLevel++;
    generateBlock(static_cast<const BlockNode&>(*node.body));
    m_indentLevel--;

    emitLine(indent() + "}");
}

// ---------------------------------------------------------------------------
// generateBreakStmt / generateContinueStmt
//   C++:  break;  /  continue;
// ---------------------------------------------------------------------------
void CodeGenerator::generateBreakStmt(const BreakStmtNode& /*node*/) {
    emitLine(indent() + "break;");
}

void CodeGenerator::generateContinueStmt(const ContinueStmtNode& /*node*/) {
    emitLine(indent() + "continue;");
}

// ---------------------------------------------------------------------------
// generateReturnStmt
//   C++:  return expr;  /  return;
// ---------------------------------------------------------------------------
void CodeGenerator::generateReturnStmt(const ReturnStmtNode& node) {
    if (node.value) {
        emitLine(indent() + "return " + generateExpr(*node.value) + ";");
    } else {
        emitLine(indent() + "return;");
    }
}

// ---------------------------------------------------------------------------
// generateCallStmt
//   C++:  fz_f<void>(args);   (or fz_f<FZ_CTX>(args); inside a function)
// ---------------------------------------------------------------------------
void CodeGenerator::generateCallStmt(const CallStmtNode& node) {
    emitLine(indent() + generateExpr(*node.call) + ";");
}

// ---------------------------------------------------------------------------
// generateBlock
//   Iterates over all statements in a block and generates each one.
//   Does NOT emit braces — the surrounding if/while/function does that.
// ---------------------------------------------------------------------------
void CodeGenerator::generateBlock(const BlockNode& node) {
    for (const auto& stmt : node.statements) {
        generateNode(*stmt);
    }
}

// ---------------------------------------------------------------------------
// generateExpr — dispatch expression nodes, return a C++ expression string
// ---------------------------------------------------------------------------
std::string CodeGenerator::generateExpr(const ASTNode& node) {
    switch (node.kind) {
        case NodeKind::StringLiteral:
            return generateStringLiteral(static_cast<const StringLiteralNode&>(node));
        case NodeKind::NumberLiteral:
            return generateNumberLiteral(static_cast<const NumberLiteralNode&>(node));
        case NodeKind::BoolLiteral:
            return generateBoolLiteral(static_cast<const BoolLiteralNode&>(node));
        case NodeKind::NullLiteral:
            return generateNullLiteral(static_cast<const NullLiteralNode&>(node));
        case NodeKind::Identifier:
            return generateIdentifier(static_cast<const IdentifierNode&>(node));
        case NodeKind::BinaryExpr:
            return generateBinaryExpr(static_cast<const BinaryExprNode&>(node));
        case NodeKind::UnaryExpr:
            return generateUnaryExpr(static_cast<const UnaryExprNode&>(node));
        case NodeKind::CallExpr:
            return generateCallExpr(static_cast<const CallExprNode&>(node));

        default:
            codegenError(node, "Code generator does not yet handle this expression type");
    }
}

// ---------------------------------------------------------------------------
// Expression generators
// ---------------------------------------------------------------------------

std::string CodeGenerator::generateStringLiteral(const StringLiteralNode& node) {
    // The parser already stripped the surrounding quotes; re-add them for C++
    // and re-escape the characters the lexer decoded.
    std::string result = "\"";
    for (char c : node.value) {
        switch (c) {
            case '"':  result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '\n': result += "\\n";  break;
            case '\t': result += "\\t";  break;
            default:   result += c;      break;
        }
    }
    result += "\"";
    return result;
}

std::string CodeGenerator::generateNumberLiteral(const NumberLiteralNode& node) {
    return node.value; // Already a valid C++ numeric literal
}

std::string CodeGenerator::generateBoolLiteral(const BoolLiteralNode& node) {
    return node.value ? "true" : "false";
}

std::string CodeGenerator::generateNullLiteral(const NullLiteralNode& /*node*/) {
    return "nullptr";
}

std::string CodeGenerator::generateIdentifier(const IdentifierNode& node) {
    return cppName(node.name);
}

// ---------------------------------------------------------------------------
// generateBinaryExpr
//   All operators (+, -, *, /, %, >, <, ==, >=, <=, !=, &&, ||) are stored
//   as C++ operator strings in the AST node (the parser translated them).
//   We simply wrap in parentheses and emit.
// ---------------------------------------------------------------------------
std::string CodeGenerator::generateBinaryExpr(const BinaryExprNode& node) {
    std::string left  = generateExpr(*node.left);
    std::string right = generateExpr(*node.right);
    return "(" + left + " " + node.op + " " + right + ")";
}

// ---------------------------------------------------------------------------
// generateUnaryExpr
//   C++:  (!x)
// ---------------------------------------------------------------------------
std::string CodeGenerator::generateUnaryExpr(const UnaryExprNode& node) {
    std::string operand = generateExpr(*node.operand);
    return "(" + node.op + operand + ")";
}

// ---------------------------------------------------------------------------
// generateCallExpr
//   C++:  fz_f<void>(a, b)       in main()
//         fz_f<FZ_CTX>(a, b)     inside a function (keeps the call dependent)
// ---------------------------------------------------------------------------
std::string CodeGenerator::generateCallExpr(const CallExprNode& node) {
    std::string result = cppName(node.callee) + (m_inFunction ? "<FZ_CTX>(" : "<void>(");
    for (size_t i = 0; i < node.arguments.size(); ++i) {
        if (i > 0) result += ", ";
        result += generateExpr(*node.arguments[i]);
    }
    return result + ")";
}

// ---------------------------------------------------------------------------
// Utility methods
// ---------------------------------------------------------------------------

std::string CodeGenerator::cppName(const std::string& fayzulName) {
    return "fz_" + fayzulName;
}

std::string CodeGenerator::indent() const {
    return std::string(static_cast<size_t>(m_indentLevel) * 4, ' ');
}

void CodeGenerator::emitLine(const std::string& text) {
    m_output += text + "\n";
    m_lineMap.push_back(m_sourceLine);
}

void CodeGenerator::codegenError(const ASTNode& node, const std::string& message) const {
    std::ostringstream oss;
    oss << "[CodeGen Error] Line " << node.line << ", Column " << node.column
        << ": " << message;
    throw std::runtime_error(oss.str());
}
