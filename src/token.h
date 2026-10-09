// =============================================================================
// token.h
// FayZul Token Types and Token Structure
//
// PURPOSE:
//   Defines every kind of token the FayZul lexer can produce.
//   A Token is the atomic unit passed from the Lexer to the Parser.
//
// DESIGN NOTES:
//   - TokenType is an enum class for type-safety (no implicit int conversions).
//   - The Token struct carries: type, the raw lexeme string, line, and column
//     so that error messages can report exact source positions.
//   - tokenTypeName() converts a TokenType to a human-readable string for
//     debugging and error messages.
// =============================================================================

#pragma once

#include <string>

// ---------------------------------------------------------------------------
// TokenType — all possible kinds of tokens in FayZul
// ---------------------------------------------------------------------------
enum class TokenType {
    // --- Literals ---
    String,         // "hello"
    Number,         // 42, 3.14
    BoolTrue,       // Safach
    BoolFalse,      // Jhufoot
    Null,           // Khafalafi

    // --- Keywords ---
    Print,          // difikhkhafa
    EndLine,        // bafas
    Store,          // rafkkhafo
    Assign,         // kefeBafarrafabafar
    If,             // afagafar
    Else,           // wafarnafa
    While,          // jafabTafak
    Break,          // Rufukufo
    Continue,       // chafalnayDafo
    Function,       // kafaam
    Return,         // Wafapafas

    // --- Word-based comparison operators ---
    OpGreaterThan,          // bafaraHafai
    OpLessThan,             // chofotafaHafai
    OpEqual,                // bafarrafabafarHafai
    OpGreaterThanOrEqual,   // bafarafaYafaBafarrafabafarHafai
    OpLessThanOrEqual,      // chofotafaYafaBafarrafabafarHafai
    OpNotEqual,             // mufukhtafalafifHafai

    // --- Word-based logical operators ---
    OpAnd,          // Afaur
    OpOr,           // Yafa
    OpNot,          // Nafain

    // --- Arithmetic operators (symbol-based) ---
    Plus,           // +
    Minus,          // -
    Multiply,       // *
    Divide,         // /
    Modulo,         // %

    // --- Punctuation ---
    LeftParen,      // (
    RightParen,     // )
    LeftBrace,      // {
    RightBrace,     // }
    Semicolon,      // ;
    Comma,          // ,

    // --- Identifier (user-defined name) ---
    Identifier,

    // --- Sentinel ---
    EndOfFile
};

// ---------------------------------------------------------------------------
// Token — one lexical unit produced by the Lexer
// ---------------------------------------------------------------------------
struct Token {
    TokenType   type;       // What kind of token is this?
    std::string lexeme;     // The raw source text (e.g. "difikhkhafa", "42", "+")
    int         line;       // 1-based source line number
    int         column;     // 1-based source column number

    Token(TokenType t, std::string lex, int ln, int col)
        : type(t), lexeme(std::move(lex)), line(ln), column(col) {}
};

// ---------------------------------------------------------------------------
// Utility: convert TokenType → readable string (for debugging / errors)
// ---------------------------------------------------------------------------
inline std::string tokenTypeName(TokenType t) {
    switch (t) {
        case TokenType::String:                 return "String";
        case TokenType::Number:                 return "Number";
        case TokenType::BoolTrue:               return "BoolTrue";
        case TokenType::BoolFalse:              return "BoolFalse";
        case TokenType::Null:                   return "Null";
        case TokenType::Print:                  return "Print";
        case TokenType::EndLine:                return "EndLine";
        case TokenType::Store:                  return "Store";
        case TokenType::Assign:                 return "Assign";
        case TokenType::If:                     return "If";
        case TokenType::Else:                   return "Else";
        case TokenType::While:                  return "While";
        case TokenType::Break:                  return "Break";
        case TokenType::Continue:               return "Continue";
        case TokenType::Function:               return "Function";
        case TokenType::Return:                 return "Return";
        case TokenType::OpGreaterThan:          return "OpGreaterThan";
        case TokenType::OpLessThan:             return "OpLessThan";
        case TokenType::OpEqual:                return "OpEqual";
        case TokenType::OpGreaterThanOrEqual:   return "OpGreaterThanOrEqual";
        case TokenType::OpLessThanOrEqual:      return "OpLessThanOrEqual";
        case TokenType::OpNotEqual:             return "OpNotEqual";
        case TokenType::OpAnd:                  return "OpAnd";
        case TokenType::OpOr:                   return "OpOr";
        case TokenType::OpNot:                  return "OpNot";
        case TokenType::Plus:                   return "Plus";
        case TokenType::Minus:                  return "Minus";
        case TokenType::Multiply:               return "Multiply";
        case TokenType::Divide:                 return "Divide";
        case TokenType::Modulo:                 return "Modulo";
        case TokenType::LeftParen:              return "LeftParen";
        case TokenType::RightParen:             return "RightParen";
        case TokenType::LeftBrace:              return "LeftBrace";
        case TokenType::RightBrace:             return "RightBrace";
        case TokenType::Semicolon:              return "Semicolon";
        case TokenType::Comma:                  return "Comma";
        case TokenType::Identifier:             return "Identifier";
        case TokenType::EndOfFile:              return "EndOfFile";
        default:                                return "Unknown";
    }
}
