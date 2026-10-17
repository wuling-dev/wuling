CREATE TABLE personal_tokens (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    digest BYTEA NOT NULL UNIQUE CHECK (octet_length(digest)=32),
    scope TEXT NOT NULL CHECK (scope IN ('read','write')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX personal_tokens_user ON personal_tokens(user_id);
