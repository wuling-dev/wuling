-- 原型记录单独保留，后续各领域迁移时不丢弃原状态或伪造执行结果。
CREATE TABLE historical_items (
    id BIGINT PRIMARY KEY CHECK (id > 0),
    repo_id BIGINT NOT NULL REFERENCES repositories(id),
    kind TEXT NOT NULL CHECK (kind IN ('issues', 'merge-requests', 'pipelines', 'wiki')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    state TEXT NOT NULL,
    source TEXT,
    target TEXT,
    author_id BIGINT REFERENCES users(id),
    author_origin TEXT NOT NULL DEFAULT 'historical_import'
        CHECK (author_origin = 'historical_import' AND author_id IS NULL),
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX historical_items_repo ON historical_items (repo_id, kind, id);

-- 一个实例只接受一次原型快照；记录与数据同事务提交，重试不覆盖后续写入。
CREATE TABLE prototype_import (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    snapshot TEXT NOT NULL,
    ownership TEXT NOT NULL,
    next_id BIGINT NOT NULL CHECK (next_id >= 0),
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
