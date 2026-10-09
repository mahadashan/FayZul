// =============================================================================
// lexer.cpp
// FayZul Lexer Implementation
//
// PURPOSE:
//   Implements the Lexer class declared in lexer.h.
//
// KEY DESIGN DECISION — The Keyword Map:
//   The constructor builds m_keywords once:
//
//       m_keywords[FZ_PRINT] = TokenType::Print;
//
//   When readWordOrKeyword() reads any word from the source, it does a
//   single map lookup:
//
//       auto it = m_keywords.find(word);
//       if (it != m_keywords.end()) → it's a keyword/operator token
//       else                        → it's a user-defined Identifier
//
//   This is why you will NOT find raw FayZul strings like "difikhkhafa"
//   anywhere in this file. The FayZul word is stored ONLY in keywords.h.
// =============================================================================

#include "lexer.h"
#include "keywords.h"
#include "operators.h"

#include <stdexcept>
#include <cctype>
#include <sstream>

// ---------------------------------------------------------------------------
// Constructor — build the keyword lookup table
// ---------------------------------------------------------------------------
Lexer::Lexer(std::string source)
    : m_source(std::move(source)), m_pos(0), m_line(1), m_column(1)
{
    // --- Keywords ---
    m_keywords[FZ_PRINT]    = TokenType::Print;
    m_keywords[FZ_ENDL]     = TokenType::EndLine;
    m_keywords[FZ_STORE]    = TokenType::Store;
    m_keywords[FZ_ASSIGN]   = TokenType::Assign;
    m_keywords[FZ_IF]       = TokenType::If;
    m_keywords[FZ_ELSE]     = TokenType::Else;
    m_keywords[FZ_WHILE]    = TokenType::While;
    m_keywords[FZ_BREAK]    = TokenType::Break;
    m_keywords[FZ_CONTINUE] = TokenType::Continue;
    m_keywords[FZ_FUNCTION] = TokenType::Function;
    m_keywords[FZ_RETURN]   = TokenType::Return;
    m_keywords[FZ_TRUE]     = TokenType::BoolTrue;
    m_keywords[FZ_FALSE]    = TokenType::BoolFalse;
    m_keywords[FZ_NULL]     = TokenType::Null;

    // --- Comparison operator words ---
    m_keywords[FZ_OP_GT]    = TokenType::OpGreaterThan;
    m_keywords[FZ_OP_LT]    = TokenType::OpLessThan;
    m_keywords[FZ_OP_EQ]    = TokenType::OpEqual;
    m_keywords[FZ_OP_GTE]   = TokenType::OpGreaterThanOrEqual;
    m_keywords[FZ_OP_LTE]   = TokenType::OpLessThanOrEqual;
    m_keywords[FZ_OP_NEQ]   = TokenType::OpNotEqual;

    // --- Logical operator words ---
    m_keywords[FZ_OP_AND]   = TokenType::OpAnd;
    m_keywords[FZ_OP_OR]    = TokenType::OpOr;
    m_keywords[FZ_OP_NOT]   = TokenType::OpNot;
}

// ---------------------------------------------------------------------------
// tokenize() — main entry point
// ---------------------------------------------------------------------------
std::vector<Token> Lexer::tokenize() {
    std::vector<Token> tokens;

    while (true) {
        skipWhitespaceAndComments();

        if (isAtEnd()) {
            tokens.emplace_back(TokenType::EndOfFile, "", m_line, m_column);
            break;
        }

        char c = peek();

        // ----- String literal -----
        if (c == '"') {
            tokens.push_back(readString());
            continue;
        }

        // ----- Number literal -----
        if (std::isdigit(static_cast<unsigned char>(c))) {
            tokens.push_back(readNumber());
            continue;
        }

        // ----- Word: keyword, operator word, or identifier -----
        if (std::isalpha(static_cast<unsigned char>(c)) || c == '_') {
            tokens.push_back(readWordOrKeyword());
            continue;
        }

        // ----- Single-character symbol tokens -----
        int tokenLine   = m_line;
        int tokenColumn = m_column;
        char sym        = advance();

        switch (sym) {
            case '+': tokens.emplace_back(TokenType::Plus,       "+", tokenLine, tokenColumn); break;
            case '-': tokens.emplace_back(TokenType::Minus,      "-", tokenLine, tokenColumn); break;
            case '*': tokens.emplace_back(TokenType::Multiply,   "*", tokenLine, tokenColumn); break;
            case '/': tokens.emplace_back(TokenType::Divide,     "/", tokenLine, tokenColumn); break;
            case '%': tokens.emplace_back(TokenType::Modulo,     "%", tokenLine, tokenColumn); break;
            case '(': tokens.emplace_back(TokenType::LeftParen,  "(", tokenLine, tokenColumn); break;
            case ')': tokens.emplace_back(TokenType::RightParen, ")", tokenLine, tokenColumn); break;
            case '{': tokens.emplace_back(TokenType::LeftBrace,  "{", tokenLine, tokenColumn); break;
            case '}': tokens.emplace_back(TokenType::RightBrace, "}", tokenLine, tokenColumn); break;
            case ';': tokens.emplace_back(TokenType::Semicolon,  ";", tokenLine, tokenColumn); break;
            case ',': tokens.emplace_back(TokenType::Comma,      ",", tokenLine, tokenColumn); break;

            default: {
                std::ostringstream oss;
                oss << "Unknown character '" << sym << "'";
                // Temporarily rewind column to point at the bad char
                lexError(oss.str());
            }
        }
    }

    return tokens;
}

// ---------------------------------------------------------------------------
// skipWhitespaceAndComments
//   Advances past spaces, tabs, newlines, and // line comments.
//   Updates m_line and m_column correctly.
// ---------------------------------------------------------------------------
void Lexer::skipWhitespaceAndComments() {
    while (!isAtEnd()) {
        char c = peek();

        if (c == ' ' || c == '\t' || c == '\r') {
            advance();
        } else if (c == '\n') {
            advance();  // advance() handles m_line increment
        } else if (c == '/' && peekNext() == '/') {
            // Line comment — skip until end of line
            while (!isAtEnd() && peek() != '\n') {
                advance();
            }
        } else {
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// readString — consume a "..." string literal
// ---------------------------------------------------------------------------
Token Lexer::readString() {
    int startLine   = m_line;
    int startColumn = m_column;

    advance(); // consume opening '"'

    std::string value;
    while (!isAtEnd() && peek() != '"') {
        // Basic escape sequences
        if (peek() == '\\') {
            advance(); // consume backslash
            if (isAtEnd()) {
                lexError("Unterminated string: escape sequence at end of file");
            }
            char esc = advance();
            switch (esc) {
                case 'n':  value += '\n'; break;
                case 't':  value += '\t'; break;
                case '"':  value += '"';  break;
                case '\\': value += '\\'; break;
                default:
                    // Pass unknown escape through literally
                    value += '\\';
                    value += esc;
                    break;
            }
        } else if (peek() == '\n') {
            lexError("Unterminated string: newline inside string literal");
        } else {
            value += advance();
        }
    }

    if (isAtEnd()) {
        lexError("Unterminated string: reached end of file");
    }

    advance(); // consume closing '"'

    // The lexeme stored includes the surrounding quotes so the parser can
    // distinguish a string token visually during debugging.
    return Token(TokenType::String, "\"" + value + "\"", startLine, startColumn);
}

// ---------------------------------------------------------------------------
// readNumber — consume an integer or decimal number literal
// ---------------------------------------------------------------------------
Token Lexer::readNumber() {
    int startLine   = m_line;
    int startColumn = m_column;

    std::string num;
    while (!isAtEnd() && std::isdigit(static_cast<unsigned char>(peek()))) {
        num += advance();
    }

    // Optional decimal part
    if (!isAtEnd() && peek() == '.' &&
        std::isdigit(static_cast<unsigned char>(peekNext()))) {
        num += advance(); // consume '.'
        while (!isAtEnd() && std::isdigit(static_cast<unsigned char>(peek()))) {
            num += advance();
        }
    }

    return Token(TokenType::Number, num, startLine, startColumn);
}

// ---------------------------------------------------------------------------
// readWordOrKeyword — consume an alphabetic word, then classify it
// ---------------------------------------------------------------------------
Token Lexer::readWordOrKeyword() {
    int startLine   = m_line;
    int startColumn = m_column;

    std::string word;
    // FayZul identifiers: letters, digits, underscores
    while (!isAtEnd() &&
           (std::isalnum(static_cast<unsigned char>(peek())) || peek() == '_')) {
        word += advance();
    }

    // Look up in the keyword map (which was built from the #define macros).
    // This is the ONLY place classification happens — no scattered string literals.
    auto it = m_keywords.find(word);
    if (it != m_keywords.end()) {
        return Token(it->second, word, startLine, startColumn);
    }

    // Not a reserved word → user-defined identifier
    return Token(TokenType::Identifier, word, startLine, startColumn);
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
char Lexer::peek() const {
    if (isAtEnd()) return '\0';
    return m_source[m_pos];
}

char Lexer::peekNext() const {
    if (m_pos + 1 >= m_source.size()) return '\0';
    return m_source[m_pos + 1];
}

char Lexer::advance() {
    char c = m_source[m_pos++];
    if (c == '\n') {
        m_line++;
        m_column = 1;
    } else {
        m_column++;
    }
    return c;
}

bool Lexer::isAtEnd() const {
    return m_pos >= m_source.size();
}

Token Lexer::makeToken(TokenType type, const std::string& lexeme) {
    return Token(type, lexeme, m_line, m_column);
}

// ---------------------------------------------------------------------------
// lexError — throw a formatted error with line + column
// ---------------------------------------------------------------------------
void Lexer::lexError(const std::string& message) const {
    std::ostringstream oss;
    oss << "[Lexer Error] Line " << m_line << ", Column " << m_column
        << ": " << message;
    throw std::runtime_error(oss.str());
}
