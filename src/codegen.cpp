// =============================================================================
// codegen.cpp
// FayZul C++ Code Generator Implementation
//
// PURPOSE:
//   Walks the AST and emits a C++ source file string.
//
// IMPORTANT:
//   There are NO FayZul keywords anywhere in this file.
//   The code generator only knows about AST node kinds and C++ syntax.
//   This proves the pipeline is clean: Lexer handles FayZul text,
//   Parser builds the AST, CodeGen translates AST → C++.
//
// GENERATED FILE STRUCTURE:
//   #include <iostream>
//
//   int main() {
//       <statements>
//       return 0;
//   }
// =============================================================================

#include "codegen.h"
#include <stdexcept>
#include <sstream>

// ---------------------------------------------------------------------------
// generate() — main entry point
//   Wraps all statements in a standard C++ main() function.
// ---------------------------------------------------------------------------
std::string CodeGenerator::generate(const ProgramNode& program) {
    m_output.clear();
    m_indentLevel = 0;

    // Standard C++ boilerplate header
    emitLine("#include <iostream>");
    emitLine("#include <string>");
    emitLine("");
    emitLine("int main() {");

    m_indentLevel = 1;

    for (const auto& stmt : program.statements) {
        generateNode(*stmt);
    }

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

        // --- Future node types — add cases here ---
        // case NodeKind::FunctionDecl: generateFunctionDecl(...); break;
        // case NodeKind::ReturnStmt:   emitLine(indent() + "return " + generateExpr(...) + ";"); break;

        default:
            codegenError(node, "Code generator does not yet handle this node type");
    }
}

// ---------------------------------------------------------------------------
// generatePrintStmt
//   FayZul:  difikhkhafa(arg1, arg2, bafas);
//   C++:     std::cout << arg1 << arg2 << std::endl;
//
//   FayZul:  difikhkhafa("hello ");              // no bafas
//   C++:     std::cout << "hello ";               // no endl — no newline
//
//   Multi-argument outputs are chained with '<<'.
//   If hasEndl is true, '<< std::endl' is appended last (adds a newline and
//   flushes). Otherwise nothing is appended, so subsequent print calls
//   continue writing on the same output line.
// ---------------------------------------------------------------------------
void CodeGenerator::generatePrintStmt(const PrintStmtNode& node) {
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
//   FayZul:  rafkkhafo x = 42;
//   C++:     auto x = 42;
//
//   We use 'auto' so the compiler infers the type, matching FayZul's
//   dynamically-typed feel without needing a type system yet.
// ---------------------------------------------------------------------------
void CodeGenerator::generateVarDecl(const VarDeclNode& node) {
    std::string init = generateExpr(*node.initializer);
    emitLine(indent() + "auto " + node.name + " = " + init + ";");
}

// ---------------------------------------------------------------------------
// generateAssign
//   FayZul:  x = 100;
//   C++:     x = 100;
// ---------------------------------------------------------------------------
void CodeGenerator::generateAssign(const AssignNode& node) {
    std::string val = generateExpr(*node.value);
    emitLine(indent() + node.target + " = " + val + ";");
}

// ---------------------------------------------------------------------------
// generateIfStmt
//   FayZul:  afagafar (x bafaraHafai 5) { ... } wafarnafa { ... }
//   C++:     if ((x > 5)) { ... } else { ... }
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
//   C++:     while (cond) { ... }
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
// generateBreakStmt
//   C++:     break;
// ---------------------------------------------------------------------------
void CodeGenerator::generateBreakStmt(const BreakStmtNode& /*node*/) {
    emitLine(indent() + "break;");
}

// ---------------------------------------------------------------------------
// generateContinueStmt
//   C++:     continue;
// ---------------------------------------------------------------------------
void CodeGenerator::generateContinueStmt(const ContinueStmtNode& /*node*/) {
    emitLine(indent() + "continue;");
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

        // Future: CallExpr, etc.
        default:
            codegenError(node, "Code generator does not yet handle this expression type");
    }
}

// ---------------------------------------------------------------------------
// Expression generators
// ---------------------------------------------------------------------------

std::string CodeGenerator::generateStringLiteral(const StringLiteralNode& node) {
    // The parser already stripped the surrounding quotes; re-add them for C++.
    // We also need to re-escape any special characters.
    // For v1, we trust the lexer has handled escape sequences correctly.
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
    return node.name; // Pass through directly as a C++ identifier
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
//   FayZul:  Nafain x
//   C++:     (!x)
// ---------------------------------------------------------------------------
std::string CodeGenerator::generateUnaryExpr(const UnaryExprNode& node) {
    std::string operand = generateExpr(*node.operand);
    return "(" + node.op + operand + ")";
}

// ---------------------------------------------------------------------------
// Utility methods
// ---------------------------------------------------------------------------

std::string CodeGenerator::indent() const {
    return std::string(static_cast<size_t>(m_indentLevel) * 4, ' ');
}

void CodeGenerator::emit(const std::string& text) {
    m_output += text;
}

void CodeGenerator::emitLine(const std::string& text) {
    m_output += text + "\n";
}

void CodeGenerator::codegenError(const ASTNode& node, const std::string& message) const {
    std::ostringstream oss;
    oss << "[CodeGen Error] Line " << node.line << ", Column " << node.column
        << ": " << message;
    throw std::runtime_error(oss.str());
}
