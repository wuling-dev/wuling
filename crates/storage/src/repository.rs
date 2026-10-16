use super::Result;
use serde::Serialize;
use tokio_postgres::GenericClient;

#[derive(Debug, Serialize)]
pub struct Repository {
    pub id: i64,
    pub owner_id: i64,
    pub name: String,
    pub description: String,
    pub public: bool,
}

pub async fn find(client: &impl GenericClient, id: i64) -> Result<Option<Repository>> {
    Ok(client
        .query_opt(
            "SELECT id, owner_id, name, description, public FROM repositories WHERE id = $1",
            &[&id],
        )
        .await?
        .map(|row| Repository {
            id: row.get(0),
            owner_id: row.get(1),
            name: row.get(2),
            description: row.get(3),
            public: row.get(4),
        }))
}
