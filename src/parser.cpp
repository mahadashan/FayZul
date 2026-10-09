// =============================================================================
// parser.cpp
// FayZul Parser Implementation
//
// PURPOSE:
//   Implements the recursive-descent parser declared in parser.h.
//
// HOW IT WORKS:
//   Each grammar rule has a corresponding parseXxx() method. The method reads
//   tokens using current(), match(), expect(), etc. and builds AST nodes.
//   If the token stream doesn't match the expected grammar, parseError() is
//   called with a human-readable message (including line and column).
//
// EXTENDING THE PARSER (future stages):
//   1. Add a new parseXxxStatement() or parseXxxExpression() method.
//   2. Add a branch inside parseStatement() to dispatch to it.
//   3. No existing code needs to change.
// =============================================================================

#include "parser.h"
#include "keywords.h"
#include <stdexcept>
#include <sstream>

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------
Parser::Parser(std::vector<Token> tokens)
    : m_tokens(std::move(tokens)), m_pos(0) {}

// ---------------------------------------------------------------------------
// parse() — entry point
// ---------------------------------------------------------------------------
std::unique_ptr<ProgramNode> Parser::parse() {
    auto program = std::make_unique<ProgramNode>();

    while (!isAtEnd()) {
        program->statements.push_back(parseStatement());
    }

    return program;
}

// ---------------------------------------------------------------------------
// parseStatement — dispatch to the correct statement parser
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseStatement() {
    const Token& tok = current();

    switch (tok.type) {
        case TokenType::Print:
            return parsePrintStatement();

        case TokenType::Store:
            return parseVarDeclStatement();

        case TokenType::If:
            return parseIfStatement();

        case TokenType::While:
            return parseWhileStatement();

        case TokenType::Break:
            return parseBreakStatement();

        case TokenType::Continue:
            return parseContinueStatement();

        // An identifier at statement position is an assignment: x = expr;
        case TokenType::Identifier:
            return parseAssignStatement();

        // --- Future statement types ---
        // case TokenType::Function: return parseFunctionDecl();
        // case TokenType::Return:   return parseReturnStatement();

        default:
            parseError("Unexpected token '" + tok.lexeme + "' — expected a statement");
    }
}

// ---------------------------------------------------------------------------
// parsePrintStatement
//
//   Grammar rule:
//     printStmt → PRINT '(' ( printArg (',' printArg)* )? ')' ';'
//     printArg  → expression | ENDLINE
//
//   ENDLINE is the FayZul keyword 'bafas' — it sets the hasEndl flag and is
//   NOT added to the argument vector (it is a sentinel, not a value to print).
//   Multiple 'bafas' occurrences are folded into a single flag.
//   Without 'bafas', no newline is appended — next print continues on the same
//   line (like Python's print(..., end="") or omitting C++ std::endl).
//
//   Example FayZul:
//     difikhkhafa("Hello ", "world", bafas);          // multi-arg + newline
//     difikhkhafa("x is:", x, bafas);                 // Python-style var entry
//     difikhkhafa("loading... ");                   // no newline
//     difikhkhafa("done", bafas);                     // "loading... done<NL>"
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parsePrintStatement() {
    int stmtLine = current().line;
    int stmtCol  = current().column;

    consume(); // consume the PRINT token (e.g. "difikhkhafa")

    expect(TokenType::LeftParen, "Expected '(' after '" + std::string(FZ_PRINT) + "'");

    std::vector<ASTNodePtr> args;
    bool hasEndl = false;

    // Optional: argument list. An empty list → difikhkhafa();
    if (!check(TokenType::RightParen)) {
        while (true) {
            if (check(TokenType::EndLine)) {
                consume();
                hasEndl = true;
            } else {
                args.push_back(parseExpression());
            }

            if (check(TokenType::Comma)) {
                consume();
                continue;
            }
            break;
        }
    }

    expect(TokenType::RightParen, "Expected ')' after arguments to '" + std::string(FZ_PRINT) + "'");
    expect(TokenType::Semicolon,  "Expected ';' after '" + std::string(FZ_PRINT) + "' statement");

    return std::make_unique<PrintStmtNode>(std::move(args), hasEndl, stmtLine, stmtCol);
}

// ---------------------------------------------------------------------------
// parseVarDeclStatement
//
//   Grammar rule:
//     varDeclStmt → STORE IDENTIFIER expression ASSIGN ';'
//
//   Example FayZul:
//     rafkkhafo x 42 kefeBafarrafabafar;
//     rafkkhafo name "Ali" kefeBafarrafabafar;
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseVarDeclStatement() {
    int stmtLine = current().line;
    int stmtCol  = current().column;

    consume(); // consume STORE token

    // The next token must be the variable name
    Token nameTok = expect(TokenType::Identifier,
        "Expected variable name after '" + std::string(FZ_STORE) + "'");

    // Parse the initializer expression BEFORE the assign keyword
    ASTNodePtr init = parseExpression();

    expect(TokenType::Assign,
        "Expected '" + std::string(FZ_ASSIGN) + "' after initializer expression in variable declaration");

    expect(TokenType::Semicolon,
        "Expected ';' after variable declaration");

    return std::make_unique<VarDeclNode>(nameTok.lexeme, std::move(init), stmtLine, stmtCol);
}

// ---------------------------------------------------------------------------
// parseAssignStatement
//
//   Grammar rule:
//     assignStmt → IDENTIFIER expression ASSIGN ';'
//
//   Example FayZul:
//     x 100 kefeBafarrafabafar;
//
//   Note: the Identifier token is still at current() when we enter here.
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseAssignStatement() {
    int stmtLine = current().line;
    int stmtCol  = current().column;

    Token nameTok = consume(); // consume the IDENTIFIER

    // Parse the value expression BEFORE the assign keyword
    ASTNodePtr val = parseExpression();

    expect(TokenType::Assign,
        "Expected '" + std::string(FZ_ASSIGN) + "' after value expression in assignment");

    expect(TokenType::Semicolon,
        "Expected ';' after assignment");

    return std::make_unique<AssignNode>(nameTok.lexeme, std::move(val), stmtLine, stmtCol);
}

// ---------------------------------------------------------------------------
// parseIfStatement
//
//   Grammar rule:
//     ifStmt → IF '(' expression ')' block ( ELSE block )?
//
//   Example FayZul:
//     afagafar (x bafaraHafai 5) {
//         difikhkhafa("big");
//     } wafarnafa {
//         difikhkhafa("small");
//     }
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseIfStatement() {
    int stmtLine = current().line;
    int stmtCol  = current().column;

    consume(); // consume IF token

    expect(TokenType::LeftParen,
        "Expected '(' after '" + std::string(FZ_IF) + "'");

    ASTNodePtr cond = parseExpression();

    expect(TokenType::RightParen,
        "Expected ')' after '" + std::string(FZ_IF) + "' condition");

    ASTNodePtr thenBlock = parseBlock();

    // Optional else branch
    ASTNodePtr elseBlock = nullptr;
    if (check(TokenType::Else)) {
        consume(); // consume ELSE token
        elseBlock = parseBlock();
    }

    return std::make_unique<IfStmtNode>(
        std::move(cond), std::move(thenBlock), std::move(elseBlock),
        stmtLine, stmtCol);
}

// ---------------------------------------------------------------------------
// parseWhileStatement
//
//   Grammar rule:
//     whileStmt → WHILE '(' expression ')' block
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseWhileStatement() {
    int stmtLine = current().line;
    int stmtCol  = current().column;

    consume(); // consume WHILE token

    expect(TokenType::LeftParen,
        "Expected '(' after '" + std::string(FZ_WHILE) + "'");

    ASTNodePtr cond = parseExpression();

    expect(TokenType::RightParen,
        "Expected ')' after '" + std::string(FZ_WHILE) + "' condition");

    ASTNodePtr body = parseBlock();

    return std::make_unique<WhileStmtNode>(
        std::move(cond), std::move(body), stmtLine, stmtCol);
}

// ---------------------------------------------------------------------------
// parseBreakStatement
//
//   Grammar rule:
//     breakStmt → BREAK ';'
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseBreakStatement() {
    int stmtLine = current().line;
    int stmtCol  = current().column;

    consume(); // consume BREAK token
    expect(TokenType::Semicolon,
        "Expected ';' after '" + std::string(FZ_BREAK) + "'");

    return std::make_unique<BreakStmtNode>(stmtLine, stmtCol);
}

// ---------------------------------------------------------------------------
// parseContinueStatement
//
//   Grammar rule:
//     continueStmt → CONTINUE ';'
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseContinueStatement() {
    int stmtLine = current().line;
    int stmtCol  = current().column;

    consume(); // consume CONTINUE token
    expect(TokenType::Semicolon,
        "Expected ';' after '" + std::string(FZ_CONTINUE) + "'");

    return std::make_unique<ContinueStmtNode>(stmtLine, stmtCol);
}

// ---------------------------------------------------------------------------
// parseBlock
//
//   Grammar rule:
//     block → '{' statement* '}'
//
//   Parses any sequence of statements enclosed in braces.
//   Used by if, while, and function declarations.
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseBlock() {
    int blockLine = current().line;
    int blockCol  = current().column;

    expect(TokenType::LeftBrace, "Expected '{' to open block");

    auto block = std::make_unique<BlockNode>(blockLine, blockCol);

    while (!check(TokenType::RightBrace) && !isAtEnd()) {
        block->statements.push_back(parseStatement());
    }

    expect(TokenType::RightBrace, "Expected '}' to close block");

    return block;
}

// ---------------------------------------------------------------------------
// parseExpression — top-level entry point for all expressions
//
//   Delegates to parseLogicalOr which is the lowest-precedence operator level.
//   The entire precedence chain is:
//     parseExpression → parseLogicalOr → parseLogicalAnd → parseLogicalNot
//                    → parseComparison → parseAdditive → parseTerm → parsePrimary
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseExpression() {
    return parseLogicalOr();
}

// ---------------------------------------------------------------------------
// parseLogicalOr — handles Yafa (||)
//
//   logicalOr → logicalAnd ( Yafa logicalAnd )*
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseLogicalOr() {
    ASTNodePtr left = parseLogicalAnd();

    while (check(TokenType::OpOr)) {
        Token opTok = consume();
        ASTNodePtr right = parseLogicalAnd();
        // Translate FayZul word to C++ operator in the AST
        left = std::make_unique<BinaryExprNode>(
            "||", std::move(left), std::move(right),
            opTok.line, opTok.column);
    }

    return left;
}

// ---------------------------------------------------------------------------
// parseLogicalAnd — handles Afaur (&&)
//
//   logicalAnd → logicalNot ( Afaur logicalNot )*
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseLogicalAnd() {
    ASTNodePtr left = parseLogicalNot();

    while (check(TokenType::OpAnd)) {
        Token opTok = consume();
        ASTNodePtr right = parseLogicalNot();
        // Translate FayZul word to C++ operator in the AST
        left = std::make_unique<BinaryExprNode>(
            "&&", std::move(left), std::move(right),
            opTok.line, opTok.column);
    }

    return left;
}

// ---------------------------------------------------------------------------
// parseLogicalNot — handles Nafain (!)
//
//   logicalNot → Nafain logicalNot  |  comparison
//
//   This is right-associative (Nafain Nafain x = !!x), which is correct.
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseLogicalNot() {
    if (check(TokenType::OpNot)) {
        Token notTok = consume(); // consume Nafain
        ASTNodePtr operand = parseLogicalNot();
        // Translate Nafain → "!" in the AST
        return std::make_unique<UnaryExprNode>(
            "!", std::move(operand),
            notTok.line, notTok.column);
    }
    return parseComparison();
}

// ---------------------------------------------------------------------------
// parseComparison — handles the FayZul word-based comparison operators
//
//   comparison → additive ( compOp additive )?
//
//   The FayZul operator WORD is consumed but the C++ operator STRING is
//   stored in the BinaryExprNode, so the code generator stays word-free.
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseComparison() {
    ASTNodePtr left = parseAdditive();

    // Check for any comparison operator token
    TokenType t = current().type;
    if (t == TokenType::OpGreaterThan   || t == TokenType::OpLessThan    ||
        t == TokenType::OpEqual         || t == TokenType::OpGreaterThanOrEqual ||
        t == TokenType::OpLessThanOrEqual || t == TokenType::OpNotEqual)
    {
        Token opTok = consume();

        // Map FayZul operator token → C++ operator string
        std::string cppOp;
        switch (opTok.type) {
            case TokenType::OpGreaterThan:         cppOp = ">";  break;
            case TokenType::OpLessThan:            cppOp = "<";  break;
            case TokenType::OpEqual:               cppOp = "=="; break;
            case TokenType::OpGreaterThanOrEqual:  cppOp = ">="; break;
            case TokenType::OpLessThanOrEqual:     cppOp = "<="; break;
            case TokenType::OpNotEqual:            cppOp = "!="; break;
            default: break; // unreachable
        }

        ASTNodePtr right = parseAdditive();
        left = std::make_unique<BinaryExprNode>(
            cppOp, std::move(left), std::move(right),
            opTok.line, opTok.column);
    }

    return left;
}

// ---------------------------------------------------------------------------
// parseAdditive — handles + and - (was called parseExpression in Stage 2)
//
//   additive → term ( ('+' | '-') term )*
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseAdditive() {
    ASTNodePtr left = parseTerm();

    while (check(TokenType::Plus) || check(TokenType::Minus)) {
        Token opTok = consume();
        ASTNodePtr right = parseTerm();
        left = std::make_unique<BinaryExprNode>(
            opTok.lexeme, std::move(left), std::move(right),
            opTok.line, opTok.column);
    }

    return left;
}

// ---------------------------------------------------------------------------
// parseTerm — handles *, /, % (higher precedence than + -)
//
//   term → primary ( ('*' | '/' | '%') primary )*
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parseTerm() {
    ASTNodePtr left = parsePrimary();

    while (check(TokenType::Multiply) || check(TokenType::Divide) || check(TokenType::Modulo)) {
        Token opTok = consume();
        ASTNodePtr right = parsePrimary();
        left = std::make_unique<BinaryExprNode>(
            opTok.lexeme, std::move(left), std::move(right),
            opTok.line, opTok.column);
    }

    return left;
}

// ---------------------------------------------------------------------------
// parsePrimary — leaf expressions (highest precedence)
//
//   primary → STRING | NUMBER | BOOL_TRUE | BOOL_FALSE | NULL
//           | IDENTIFIER | '(' expression ')'
// ---------------------------------------------------------------------------
ASTNodePtr Parser::parsePrimary() {
    const Token& tok = current();

    switch (tok.type) {
        case TokenType::String: {
            // Strip the surrounding quotes stored by the lexer
            std::string raw     = tok.lexeme;
            std::string content = raw.substr(1, raw.size() - 2);
            Token t = consume();
            return std::make_unique<StringLiteralNode>(content, t.line, t.column);
        }

        case TokenType::Number: {
            Token t = consume();
            return std::make_unique<NumberLiteralNode>(t.lexeme, t.line, t.column);
        }

        case TokenType::BoolTrue: {
            Token t = consume();
            return std::make_unique<BoolLiteralNode>(true, t.line, t.column);
        }

        case TokenType::BoolFalse: {
            Token t = consume();
            return std::make_unique<BoolLiteralNode>(false, t.line, t.column);
        }

        case TokenType::Null: {
            Token t = consume();
            return std::make_unique<NullLiteralNode>(t.line, t.column);
        }

        case TokenType::Identifier: {
            Token t = consume();
            return std::make_unique<IdentifierNode>(t.lexeme, t.line, t.column);
        }

        // Parenthesised expression: ( expr )
        case TokenType::LeftParen: {
            int parenLine = tok.line;
            int parenCol  = tok.column;
            consume(); // consume '('
            ASTNodePtr inner = parseExpression();
            expect(TokenType::RightParen, "Expected ')' to close parenthesised expression");
            // We return the inner expression directly — no wrapper node needed
            (void)parenLine; (void)parenCol;
            return inner;
        }

        default:
            parseError("Expected an expression but got '" + tok.lexeme + "'");
    }
}

// ---------------------------------------------------------------------------
// Token navigation helpers
// ---------------------------------------------------------------------------

const Token& Parser::current() const {
    // m_pos is always a valid index because the last token is EndOfFile
    return m_tokens[m_pos];
}

const Token& Parser::peek(size_t offset) const {
    size_t idx = m_pos + offset;
    if (idx >= m_tokens.size()) {
        return m_tokens.back(); // EndOfFile
    }
    return m_tokens[idx];
}

Token Parser::consume() {
    Token tok = m_tokens[m_pos];
    if (!isAtEnd()) m_pos++;
    return tok;
}

Token Parser::expect(TokenType type, const std::string& errorMsg) {
    if (!check(type)) {
        parseError(errorMsg + " (got '" + current().lexeme + "')");
    }
    return consume();
}

bool Parser::isAtEnd() const {
    return m_tokens[m_pos].type == TokenType::EndOfFile;
}

bool Parser::check(TokenType type) const {
    return current().type == type;
}

bool Parser::match(TokenType type) {
    if (check(type)) {
        consume();
        return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// parseError — throw with line + column context
// ---------------------------------------------------------------------------
void Parser::parseError(const std::string& message) const {
    const Token& tok = current();
    std::ostringstream oss;
    oss << "[Parser Error] Line " << tok.line << ", Column " << tok.column
        << ": " << message;
    throw std::runtime_error(oss.str());
}
