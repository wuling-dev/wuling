//! 网页 JWT 与可撤销刷新链；不复用 PAT / OAuth 凭据。
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio_postgres::{Client, GenericClient};
use wuling_storage::{Result, identity::User};

pub const ACCESS_SECONDS: u64 = 900;
const AUDIENCE: &str = "wuling-web";

fn invalid() -> Box<dyn std::error::Error + Send + Sync> {
    io::Error::new(io::ErrorKind::PermissionDenied, "网页凭据无效").into()
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("系统时间须晚于 Unix epoch")
        .as_secs()
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    active_kid: String,
    keys: Vec<KeyConfig>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct KeyConfig {
    kid: String,
    secret_hex: String,
    verify_until: Option<u64>,
}
struct Key {
    decode: DecodingKey,
    verify_until: Option<u64>,
}
// 不派生 Debug，避免签名配置被调试输出泄露。
pub struct Jwt {
    active_kid: String,
    encode: EncodingKey,
    keys: HashMap<String, Key>,
    issuer: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Claims {
    pub sub: String,
    pub sid: String,
    pub iss: String,
    pub aud: String,
    pub iat: u64,
    pub exp: u64,
}
impl Jwt {
    /// 只读取显式外部配置；固定 HS256，最多一个有绝对截止时间的旧验证密钥。
    pub fn from_config(raw: &str, issuer: &str) -> Result<Self> {
        let config: Config =
            serde_json::from_str(raw).map_err(|_| io::Error::other("JWT 密钥配置 JSON 无效"))?;
        if !(1..=2).contains(&config.keys.len()) || issuer.is_empty() {
            return Err(io::Error::other("JWT 必须配置当前密钥及至多一个旧验证密钥").into());
        }
        let mut keys = HashMap::new();
        let mut secrets = Vec::new();
        let mut encode = None;
        for key in config.keys {
            if key.kid.is_empty()
                || key.kid.len() > 64
                || !key
                    .kid
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                || !(64..=128).contains(&key.secret_hex.len())
                || !key.secret_hex.len().is_multiple_of(2)
                || !key.secret_hex.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err(io::Error::other(
                    "JWT kid 或密钥格式无效；密钥须为32–64字节随机值的十六进制编码",
                )
                .into());
            }
            let secret = (0..key.secret_hex.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&key.secret_hex[i..i + 2], 16).expect("已验证十六进制"))
                .collect::<Vec<_>>();
            if secrets.contains(&secret) || keys.contains_key(&key.kid) {
                return Err(io::Error::other("JWT 密钥及 kid 不得重复").into());
            }
            if key.kid == config.active_kid {
                if key.verify_until.is_some() {
                    return Err(io::Error::other("当前 JWT 签名密钥不得有旧密钥截止时间").into());
                }
                encode = Some(EncodingKey::from_secret(&secret));
            } else if key
                .verify_until
                .is_none_or(|until| until > now() + ACCESS_SECONDS)
            {
                return Err(
                    io::Error::other("旧 JWT 密钥必须指定不超过15分钟的绝对验证截止时间").into(),
                );
            }
            keys.insert(
                key.kid,
                Key {
                    decode: DecodingKey::from_secret(&secret),
                    verify_until: key.verify_until,
                },
            );
            secrets.push(secret);
        }
        Ok(Self {
            active_kid: config.active_kid,
            encode: encode.ok_or_else(|| io::Error::other("缺少当前 JWT 签名密钥"))?,
            keys,
            issuer: issuer.into(),
        })
    }
    pub fn sign(&self, user: i64, sid: &str, absolute_expiry: u64) -> Result<String> {
        let iat = now();
        if absolute_expiry <= iat {
            return Err(invalid());
        }
        let claims = Claims {
            sub: user.to_string(),
            sid: sid.into(),
            iss: self.issuer.clone(),
            aud: AUDIENCE.into(),
            iat,
            exp: (iat + ACCESS_SECONDS).min(absolute_expiry),
        };
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some(self.active_kid.clone());
        Ok(jsonwebtoken::encode(&header, &claims, &self.encode)?)
    }
    pub fn verify(&self, token: &str) -> Result<Claims> {
        if token.len() > 4096 {
            return Err(invalid());
        }
        let header = jsonwebtoken::decode_header(token).map_err(|_| invalid())?;
        if header.alg != Algorithm::HS256 || header.typ.as_deref() != Some("JWT") {
            return Err(invalid());
        }
        let key = header
            .kid
            .as_ref()
            .and_then(|id| self.keys.get(id))
            .ok_or_else(invalid)?;
        if key.verify_until.is_some_and(|until| now() >= until) {
            return Err(invalid());
        }
        let mut validation = Validation::new(Algorithm::HS256);
        validation.leeway = 0;
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        validation.set_issuer(&[&self.issuer]);
        validation.set_audience(&[AUDIENCE]);
        let claims = jsonwebtoken::decode::<Claims>(token, &key.decode, &validation)
            .map_err(|_| invalid())?
            .claims;
        if claims.sub.parse::<i64>().ok().is_none_or(|id| id <= 0)
            || !random_format(&claims.sid)
            || claims.iat > now()
            || claims.exp <= now()
            || claims.exp <= claims.iat
            || claims.exp - claims.iat > ACCESS_SECONDS
        {
            return Err(invalid());
        }
        Ok(claims)
    }
}

fn random_format(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn random() -> Result<String> {
    let mut bytes = [0u8; 32];
    OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|_| io::Error::other("网页凭据生成失败"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn digest(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}
pub struct Credentials {
    pub access: String,
    pub refresh: String,
    pub refresh_seconds: u64,
}

pub async fn user(db: &impl GenericClient, jwt: &Jwt, token: &str) -> Result<Option<User>> {
    let Ok(claims) = jwt.verify(token) else {
        return Ok(None);
    };
    Ok(db.query_opt(
        "SELECT u.id,u.username,u.admin,u.active FROM web_sessions s JOIN users u ON u.id=s.user_id
         WHERE s.id=$1 AND u.id=$2 AND u.active AND s.revoked_at IS NULL AND s.expires_at>now()",
        &[&claims.sid,&claims.sub.parse::<i64>()?],
    ).await?.map(|r| User { id:r.get(0),username:r.get(1),admin:r.get(2),active:r.get(3) }))
}

/// 可凭刷新 Cookie 退出，即使 access JWT 已过期；仅持有有效签名 JWT 也可撤销。
pub async fn revoke(
    db: &impl GenericClient,
    jwt: &Jwt,
    access: Option<&str>,
    refresh: Option<&str>,
) -> Result<()> {
    let sid = access.and_then(|v| jwt.verify(v).ok()).map(|c| c.sid);
    let hash = refresh.filter(|v| random_format(v)).map(digest);
    db.execute(
        "UPDATE web_sessions SET revoked_at=now() WHERE revoked_at IS NULL AND
        (id=$1 OR id IN (SELECT session_id FROM web_refresh_tokens WHERE digest=$2))",
        &[&sid, &hash],
    )
    .await?;
    Ok(())
}
pub async fn start(
    db: &mut Client,
    jwt: &Jwt,
    user: i64,
    days: i32,
    old_access: Option<&str>,
    old_refresh: Option<&str>,
) -> Result<Credentials> {
    if !(1..=90).contains(&days) {
        return Err(io::Error::other("网页会话绝对期限须为1–90天").into());
    }
    let tx = db.transaction().await?;
    if tx
        .query_opt(
            "SELECT id FROM users WHERE id=$1 AND active FOR SHARE",
            &[&user],
        )
        .await?
        .is_none()
    {
        return Err(invalid());
    }
    revoke(&tx, jwt, old_access, old_refresh).await?;
    let sid = random()?;
    let refresh = random()?;
    let expiry = now() + days as u64 * 86400;
    let access = jwt.sign(user, &sid, expiry)?;
    tx.execute("INSERT INTO web_sessions(id,user_id,expires_at) VALUES($1,$2,to_timestamp($3::double precision))",
        &[&sid,&user,&(expiry as f64)]).await?;
    tx.execute(
        "INSERT INTO web_refresh_tokens(digest,session_id) VALUES($1,$2)",
        &[&digest(&refresh), &sid],
    )
    .await?;
    tx.commit().await?;
    Ok(Credentials {
        access,
        refresh,
        refresh_seconds: expiry.saturating_sub(now()),
    })
}

/// 锁顺序为用户 → 会话。重放必须提交撤销后再返回 None，不能被错误分支回滚。
pub async fn refresh(db: &mut Client, jwt: &Jwt, token: &str) -> Result<Option<Credentials>> {
    if !random_format(token) {
        return Ok(None);
    }
    let hash = digest(token);
    let tx = db.transaction().await?;
    let Some(row)=tx.query_opt("SELECT s.id,s.user_id FROM web_refresh_tokens r JOIN web_sessions s ON s.id=r.session_id WHERE r.digest=$1",&[&hash]).await?
        else { return Ok(None) };
    let sid: String = row.get(0);
    let user: i64 = row.get(1);
    if tx
        .query_opt(
            "SELECT id FROM users WHERE id=$1 AND active FOR SHARE",
            &[&user],
        )
        .await?
        .is_none()
    {
        return Ok(None);
    }
    let row=tx.query_one("SELECT revoked_at IS NOT NULL,extract(epoch FROM expires_at)::bigint FROM web_sessions WHERE id=$1 FOR UPDATE",&[&sid]).await?;
    let expiry = row.get::<_, i64>(1) as u64;
    if row.get::<_, bool>(0) || expiry <= now() {
        return Ok(None);
    }
    let used: bool = tx
        .query_one(
            "SELECT used_at IS NOT NULL FROM web_refresh_tokens WHERE digest=$1",
            &[&hash],
        )
        .await?
        .get(0);
    if used {
        tx.execute(
            "UPDATE web_sessions SET revoked_at=now() WHERE id=$1",
            &[&sid],
        )
        .await?;
        tx.commit().await?;
        return Ok(None);
    }
    let refresh = random()?;
    let access = jwt.sign(user, &sid, expiry)?;
    tx.execute(
        "UPDATE web_refresh_tokens SET used_at=now() WHERE digest=$1",
        &[&hash],
    )
    .await?;
    tx.execute(
        "INSERT INTO web_refresh_tokens(digest,session_id) VALUES($1,$2)",
        &[&digest(&refresh), &sid],
    )
    .await?;
    tx.commit().await?;
    Ok(Some(Credentials {
        access,
        refresh,
        refresh_seconds: expiry.saturating_sub(now()),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn config() -> String {
        json!({"active_kid":"current","keys":[{"kid":"current","secret_hex":"11".repeat(32)}]})
            .to_string()
    }
    fn signed(value: &serde_json::Value, alg: Algorithm, kid: &str) -> String {
        let mut header = Header::new(alg);
        header.kid = Some(kid.into());
        let secret = if alg == Algorithm::HS256 {
            vec![0x11; 32]
        } else {
            vec![0x11; 64]
        };
        jsonwebtoken::encode(&header, value, &EncodingKey::from_secret(&secret)).unwrap()
    }
    #[test]
    fn jwt_validates_all_trust_boundaries() {
        let jwt = Jwt::from_config(&config(), "https://wuling.example").unwrap();
        let token = jwt.sign(1, &"a".repeat(64), now() + 86400).unwrap();
        let claims = jwt.verify(&token).unwrap();
        assert_eq!(claims.exp - claims.iat, ACCESS_SECONDS);
        let value = serde_json::to_value(claims).unwrap();
        for (key, bad) in [
            ("iss", json!("https://other.example")),
            ("aud", json!("oauth-client")),
            ("sub", json!("0")),
            ("sid", json!("../session")),
            ("iat", json!(now() + 100)),
            ("exp", json!(now() - 1)),
        ] {
            let mut changed = value.clone();
            changed[key] = bad;
            assert!(
                jwt.verify(&signed(&changed, Algorithm::HS256, "current"))
                    .is_err()
            );
        }
        for key in ["exp", "iss", "aud", "sub", "sid", "iat"] {
            let mut changed = value.clone();
            changed.as_object_mut().unwrap().remove(key);
            assert!(
                jwt.verify(&signed(&changed, Algorithm::HS256, "current"))
                    .is_err()
            );
        }
        assert!(
            jwt.verify(&signed(&value, Algorithm::HS384, "current"))
                .is_err()
        );
        assert!(
            jwt.verify(&signed(&value, Algorithm::HS256, "unknown"))
                .is_err()
        );
        assert!(
            Jwt::from_config(&config(), "https://other.example")
                .unwrap()
                .verify(&token)
                .is_err()
        );
        let mut changed = value;
        changed["exp"] = json!(now() + ACCESS_SECONDS + 100);
        assert!(
            jwt.verify(&signed(&changed, Algorithm::HS256, "current"))
                .is_err()
        );
        let mut tampered = token.into_bytes();
        tampered[20] = if tampered[20] == b'A' { b'B' } else { b'A' };
        assert!(jwt.verify(std::str::from_utf8(&tampered).unwrap()).is_err());
    }
    #[test]
    fn key_rotation_is_bounded_and_explicit() {
        let old = Jwt::from_config(&config(), "issuer").unwrap();
        let token = old.sign(1, &"a".repeat(64), now() + 86400).unwrap();
        let mut rotation = json!({"active_kid":"next","keys":[
            {"kid":"next","secret_hex":"22".repeat(32)},
            {"kid":"current","secret_hex":"11".repeat(32),"verify_until":now()+300}
        ]});
        let rotated = Jwt::from_config(&rotation.to_string(), "issuer").unwrap();
        assert!(rotated.verify(&token).is_ok());
        assert!(
            old.verify(&rotated.sign(1, &"a".repeat(64), now() + 86400).unwrap())
                .is_err()
        );
        rotation["keys"][1]["verify_until"] = json!(0);
        assert!(
            Jwt::from_config(&rotation.to_string(), "issuer")
                .unwrap()
                .verify(&token)
                .is_err()
        );
        rotation["keys"][1]["verify_until"] = json!(now() + ACCESS_SECONDS + 100);
        assert!(Jwt::from_config(&rotation.to_string(), "issuer").is_err());
        for raw in ["", "{}", r#"{"active_kid":"missing","keys":[]}"#] {
            assert!(Jwt::from_config(raw, "issuer").is_err());
        }
        let mut weak: serde_json::Value = serde_json::from_str(&config()).unwrap();
        weak["keys"][0]["secret_hex"] = json!("short");
        assert!(Jwt::from_config(&weak.to_string(), "issuer").is_err());
    }
}
