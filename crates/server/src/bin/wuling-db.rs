use wuling_storage as storage;

#[tokio::main]
async fn main() -> storage::Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args != ["migrate"] {
        return Err(
            std::io::Error::other("用法: wuling-db migrate；设置 WULING_DATABASE_URL").into(),
        );
    }
    let url = std::env::var("WULING_DATABASE_URL")
        .map_err(|_| std::io::Error::other("请设置 WULING_DATABASE_URL"))?;
    let mut client = storage::connect_local(&url).await?;
    storage::migrate(&mut client).await?;
    println!("数据库迁移完成");
    Ok(())
}
