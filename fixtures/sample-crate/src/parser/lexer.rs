pub fn tokenize(input: &str) -> Vec<String> {
    input.split_whitespace().map(str::to_owned).collect()
}
