#[derive(Debug)]
pub struct Node {
    pub text: String,
}

impl Node {
    pub fn from_token(token: String) -> Self {
        Self { text: token }
    }
}
