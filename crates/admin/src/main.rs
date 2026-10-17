use std::io::{self, BufRead, IsTerminal};
use wuling_storage::{self as storage, Result};

const USAGE: &str = "本机运维工具（不提供远程服务）
用法: wuling-admin bootstrap <用户名>
      wuling-admin create-user <管理员用户名> <新用户名>
数据库迁移/导入: wuling-db migrate | import <state.json> <备份文件> <归属表.json>
设置 WULING_DATABASE_URL；密码从隐藏提示或标准输入逐行读取，不作为命令行参数。";

fn read_password_line(reader: &mut impl BufRead) -> Result<String> {
    let mut value = Vec::new();
    // 限制读取量，而不是无限读取后才检查；不记录密码。
    while value.len() <= 1025 {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            break;
        }
        let end = buffer.iter().position(|byte| *byte == b'\n');
        let count = end
            .map_or(buffer.len(), |index| index + 1)
            .min(1026 - value.len());
        value.extend_from_slice(&buffer[..count]);
        reader.consume(count);
        if end.is_some_and(|index| index < count) {
            break;
        }
    }
    if value.ends_with(b"\n") {
        value.pop();
        if value.ends_with(b"\r") {
            value.pop();
        }
    }
    if value.is_empty() || value.len() > 1024 {
        return Err(io::Error::other("密码输入为空或过长").into());
    }
    Ok(String::from_utf8(value)?)
}

fn password(prompt: &str) -> Result<String> {
    if io::stdin().is_terminal() {
        return Ok(rpassword::prompt_password(prompt)?);
    }
    read_password_line(&mut io::stdin().lock())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args == ["--help"] || args == ["-h"] {
        println!("{USAGE}");
        return Ok(());
    }
    if !matches!(args.as_slice(), [command, _] if command == "bootstrap")
        && !matches!(args.as_slice(), [command, _, _] if command == "create-user")
    {
        return Err(io::Error::other(USAGE).into());
    }
    let url = std::env::var("WULING_DATABASE_URL")
        .map_err(|_| io::Error::other("请设置 WULING_DATABASE_URL"))?;
    let mut client = storage::connect_local(&url).await?;
    let user = if args[0] == "bootstrap" {
        iam::bootstrap(&mut client, &args[1], password("管理员密码: ")?).await?
    } else {
        let admin_password = password("管理员密码: ")?;
        let new_password = password("新用户密码: ")?;
        iam::create_user(
            &mut client,
            &args[1],
            admin_password,
            &args[2],
            new_password,
        )
        .await?
    };
    println!(
        "用户创建完成：ID={}，用户名={}，管理员={}",
        user.id, user.username, user.admin
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_separate_bounded_password_lines() {
        let mut input = &b"first-password\r\nsecond-password\n"[..];
        assert_eq!(read_password_line(&mut input).unwrap(), "first-password");
        assert_eq!(read_password_line(&mut input).unwrap(), "second-password");
        assert!(read_password_line(&mut input).is_err());
        assert!(read_password_line(&mut &b"\n"[..]).is_err());
        assert!(read_password_line(&mut &vec![b'x'; 1025][..]).is_err());
        assert_eq!(
            read_password_line(&mut &vec![b'x'; 1024][..])
                .unwrap()
                .len(),
            1024
        );
    }
}
