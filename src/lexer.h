// =============================================================================
// lexer.h
// FayZul Lexer Interface
//
// PURPOSE:
//   The Lexer reads raw FayZul source code (a std::string) and produces a
//   flat list of Tokens. It is the first stage of the compiler pipeline.
//
//   Input:  std::string  (source code)
//   Output: std::vector<Token>
//
// The Lexer knows about:
//   - FayZul keywords       (from keywords.h)
//   - FayZul operator words (from operators.h)
//   - Symbol tokens         (+, -, *, /, %, =, (, ), {, }, ;, ,)
//   - String literals       ("...")
//   - Number literals       (integer and decimal)
//   - Identifiers           (user-defined names)
//   - Comments              (// line comments — skipped, never tokenized)
//
// The Lexer does NOT know about:
//   - Grammar / syntax (that is the Parser's job)
//   - AST nodes        (that is the Parser's job)
//   - C++ output       (that is the Code Generator's job)
// =============================================================================

#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include "token.h"

class Lexer {
public:
    // Construct with the full source text.
    explicit Lexer(std::string source);

    // Tokenize the entire source and return the token list.
    // Throws std::runtime_error on lexical errors.
    std::vector<Token> tokenize();

private:
    std::string m_source;   // The raw source code
    size_t      m_pos;      // Current read position (index into m_source)
    int         m_line;     // Current line number (1-based)
    int         m_column;   // Current column number (1-based)

    // Keyword lookup table: FayZul word → TokenType
    // Built once in the constructor using the macros from keywords.h / operators.h.
    std::unordered_map<std::string, TokenType> m_keywords;

    // --- Internal helpers ---
    char        peek() const;               // Look at current char without advancing
    char        peekNext() const;           // Look one char ahead without advancing
    char        advance();                  // Consume and return current char
    bool        isAtEnd() const;            // True when m_pos >= m_source.size()

    void        skipWhitespaceAndComments();

    Token       readString();               // Handles "..." string literals
    Token       readNumber();               // Handles integer / decimal numbers
    Token       readWordOrKeyword();        // Handles identifiers and reserved words

    // Construct a single-character token at the current position.
    Token       makeToken(TokenType type, const std::string& lexeme);

    // Throw a formatted lexer error with line/column information.
    [[noreturn]] void lexError(const std::string& message) const;
};
