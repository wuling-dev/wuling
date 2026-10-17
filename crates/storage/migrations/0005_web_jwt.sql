-- 显式使旧不透明 Cookie 失效；API Token 不受影响。
DELETE FROM sessions;

CREATE TABLE web_sessions (
    id TEXT PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX web_sessions_user ON web_sessions(user_id);

-- 保留已消费摘要到会话清理时，用于检测刷新凭据重放。
CREATE TABLE web_refresh_tokens (
    digest BYTEA PRIMARY KEY CHECK (octet_length(digest)=32),
    session_id TEXT NOT NULL REFERENCES web_sessions(id) ON DELETE CASCADE,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX web_refresh_current ON web_refresh_tokens(session_id) WHERE used_at IS NULL;
