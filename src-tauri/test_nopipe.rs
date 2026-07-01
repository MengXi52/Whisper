fn main() {
    use std::process::{Command, Stdio};
    // 不使用 pipe，直接继承 stdout
    let status = Command::new("rustc")
        .arg("--version")
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status();
    println!("status: {:?}", status);
}
