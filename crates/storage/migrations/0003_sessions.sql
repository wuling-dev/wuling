-- 只保存高熵会话凭据摘要；账号停用同时使查询认证失败。
CREATE TABLE sessions (
    digest BYTEA PRIMARY KEY CHECK (octet_length(digest) = 32),
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
