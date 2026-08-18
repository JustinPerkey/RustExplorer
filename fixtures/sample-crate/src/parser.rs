//! `src/parser.rs` owns everything in `src/parser/`.

mod ast;
mod lexer;

pub fn parse(input: &str) -> Vec<ast::Node> {
    lexer::tokenize(input).into_iter().map(ast::Node::from_token).collect()
}
