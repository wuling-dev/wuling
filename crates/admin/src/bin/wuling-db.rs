use wuling_storage as storage;

#[tokio::main(flavor = "current_thread")]
async fn main() -> storage::Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args != ["migrate"] && !(args.len() == 4 && args[0] == "import") {
        return Err(
            std::io::Error::other(
                "用法: wuling-db migrate | import <state.json> <备份文件> <归属表.json>；设置 WULING_DATABASE_URL",
            ).into(),
        );
    }
    let url = std::env::var("WULING_DATABASE_URL")
        .map_err(|_| std::io::Error::other("请设置 WULING_DATABASE_URL"))?;
    let mut client = storage::connect_local(&url).await?;
    if args[0] == "migrate" {
        storage::migrate(&mut client).await?;
        println!("数据库迁移完成");
    } else {
        let outcome = wuling_import::import(
            &mut client,
            std::path::Path::new(&args[1]),
            std::path::Path::new(&args[2]),
            std::path::Path::new(&args[3]),
        )
        .await?;
        println!("{outcome:?}");
    }
    Ok(())
}
