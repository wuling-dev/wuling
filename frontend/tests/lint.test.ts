import { test, expect } from '@lightning-js/lightning';
import { ESLint } from 'eslint';

test('React anti-patterns are blocked, not merely documented', async () => {
  const eslint = new ESLint({
    overrideConfig: {
      languageOptions: { parserOptions: { projectService: false, project: null } },
      rules: {
        '@typescript-eslint/no-floating-promises': 'off',
        '@typescript-eslint/await-thenable': 'off',
      },
    },
  });
  const [result] = await eslint.lintText(
    `
    import { useState, useEffect } from 'react';
    export function Bad({ items, active }) {
      if (active) useState(0);
      const [value, setValue] = useState(0);
      useEffect(() => { setValue(1); }, []);
      function Nested() { return <div />; }
      return <div>{items.map((item, index) => <Nested key={index} />)}{value}</div>;
    }
  `,
    { filePath: 'apps/web/src/lint-probe.tsx' },
  );
  const rules = result.messages.map((message) => message.ruleId);
  await expect(rules).toContain('react-hooks/rules-of-hooks');
  await expect(rules).toContain('react-hooks/set-state-in-effect');
  await expect(rules).toContain('@eslint-react/no-array-index-key');
  await expect(rules).toContain('@eslint-react/no-nested-component-definitions');
});
