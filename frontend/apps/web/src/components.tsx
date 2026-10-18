import { Button, Input, Label, TextField, FieldError } from '@heroui/react';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export function Failure({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="feedback error">
      {error instanceof Error ? error.message : '请求失败，请重试。'}
    </p>
  );
}

export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: 'text' | 'password' | 'number';
  autoComplete?: string;
  defaultValue?: string;
}) {
  return (
    <TextField name={name} type={type} isRequired defaultValue={defaultValue}>
      <Label>{label}</Label>
      <Input autoComplete={autoComplete} />
      <FieldError />
    </TextField>
  );
}

export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-title">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function Appearance() {
  const [open, setOpen] = useState(false);
  return (
    <div className="appearance">
      <Button variant="ghost" aria-expanded={open} onPress={() => setOpen(!open)}>
        外观
      </Button>
      {open && (
        <div className="appearance-panel">
          <label>
            主题
            <select
              aria-label="主题"
              defaultValue={document.documentElement.dataset.theme ?? 'clean'}
              onChange={(event) => {
                document.documentElement.dataset.theme = event.target.value;
              }}
            >
              <option value="clean">清新</option>
              <option value="zixiao-labs-brand">紫霄实验室</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              defaultChecked={document.documentElement.classList.contains('dark')}
              onChange={(event) => {
                document.documentElement.classList.toggle('dark', event.target.checked);
              }}
            />
            深色模式
          </label>
        </div>
      )}
    </div>
  );
}

export function RepositoryNav({ id }: { id: number }) {
  const entries = [
    ['', '概览'],
    ['/code', '代码'],
    ['/issues', 'Issue'],
    ['/merge-requests', 'Merge Request'],
    ['/pipelines', '流水线'],
    ['/wiki', 'Wiki'],
    ['/insight', 'Insight'],
    ['/members', '成员'],
  ];
  return (
    <nav className="repo-nav" aria-label="仓库导航">
      {entries.map(([suffix, label]) =>
        suffix ? (
          <Link
            key={suffix}
            to="/repos/$id/$section"
            params={{ id: String(id), section: suffix.slice(1) }}
          >
            {label}
          </Link>
        ) : (
          <Link key={suffix} to="/repos/$id" params={{ id: String(id) }}>
            {label}
          </Link>
        ),
      )}
    </nav>
  );
}
