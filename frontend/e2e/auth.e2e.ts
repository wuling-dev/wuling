import { test, expect } from '@lightning-js/lightning';
import { chromium, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Repository } from '@wuling/api-client';

test('real JWT UI: accounts, members, API Tokens, refresh, isolation and themes', async () => {
  const origin = process.env.WULING_E2E_ORIGIN;
  if (!origin) throw new Error('Run sh scripts/check-web.sh to provide an isolated backend');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource'))
      errors.push(message.text());
  });
  const pictures = resolve('test-results/auth');
  await mkdir(pictures, { recursive: true });
  async function login(page: Page, username: string) {
    await page.goto(origin + '/login');
    await page.getByLabel('用户名', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill('test-only-long-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(origin + '/workspace');
    await page.getByRole('button', { name: '退出', exact: true }).waitFor();
  }
  try {
    await page.goto(origin + '/login');
    await page.getByLabel('用户名', { exact: true }).waitFor();
    await page.waitForFunction(
      () => document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled === false,
    );
    await page.getByLabel('用户名', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(
      await page
        .getByLabel('密码', { exact: true })
        .evaluate((element) => element === document.activeElement),
    ).toBe(true);
    await expect(await page.getByLabel('密码', { exact: true }).getAttribute('autocomplete')).toBe(
      'current-password',
    );
    await page.screenshot({ path: resolve(pictures, 'login-clean.png'), fullPage: true });
    await page.getByLabel('用户名', { exact: true }).fill('alice');
    await page.getByLabel('密码', { exact: true }).fill('wrong');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '需要有效登录会话' }).waitFor();
    await login(page, 'alice');
    await page.getByText('新建仓库', { exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('alice-private');
    await page.getByLabel('描述', { exact: true }).fill('仅 Alice 与获邀成员可见');
    await page.getByRole('button', { name: '创建仓库', exact: true }).click();
    const repo = page.getByRole('link', { name: 'alice-private', exact: true });
    await repo.waitFor();
    const href = await repo.getAttribute('href');
    if (!href) throw new Error('No repository URL');
    await page.goto(origin + href + '/members');
    await page.getByRole('heading', { name: '仓库成员', exact: true }).waitFor();
    await page.getByLabel('用户 ID', { exact: true }).fill('2');
    await page.getByRole('button', { name: '添加成员', exact: true }).click();
    await page.getByText('bob', { exact: true }).waitFor();
    await page.getByLabel('bob 的角色', { exact: true }).selectOption('developer');
    await page.getByRole('status').filter({ hasText: '成员权限已保存' }).waitFor();
    await page.screenshot({ path: resolve(pictures, 'members-clean.png'), fullPage: true });
    await page.getByRole('link', { name: 'API Token', exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('workstation');
    await page.getByRole('button', { name: '创建令牌', exact: true }).click();
    await page.getByTestId('new-token').waitFor();
    const token = await page.getByTestId('new-token').textContent();
    await expect(token?.startsWith('wlp_')).toBe(true);
    // Never persist a real token into screenshots or test output.
    await page.getByRole('button', { name: '我已保存，隐藏' }).click();
    await expect(await page.getByTestId('new-token').count()).toBe(0);
    await page.reload();
    await page.getByText('workstation', { exact: true }).waitFor();
    await expect(await page.getByTestId('new-token').count()).toBe(0);
    const cookies = await context.cookies();
    await expect(
      cookies
        .filter((cookie) => cookie.name.startsWith('wuling_'))
        .every((cookie) => cookie.httpOnly),
    ).toBe(true);
    await expect(await page.evaluate(() => document.cookie.includes('wuling_'))).toBe(false);
    const storage = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    // Router scroll metadata is allowed; credentials and one-time API Tokens are not.
    await expect(
      storage.includes('wlp_') ||
        storage.includes('wuling_session') ||
        storage.includes('wuling_refresh'),
    ).toBe(false);
    await page.getByText('外观', { exact: true }).click();
    await page.getByLabel('主题', { exact: true }).selectOption('zixiao-labs-brand');
    await page.getByLabel('深色模式').check();
    await page.getByText('外观', { exact: true }).click();
    await page.screenshot({ path: resolve(pictures, 'tokens-brand-dark.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    // Paint below-fold controls before a full-page capture (Chromium defers offscreen painting).
    await page
      .getByRole('button', { name: '撤销 workstation', exact: true })
      .scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: resolve(pictures, 'tokens-mobile.png'), fullPage: true });
    await expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    // Access cookie expires in all tabs; Web Locks serialize refresh so only one old refresh value is consumed.
    const second = await context.newPage();
    await second.goto(origin + '/settings/tokens');
    await second.getByText('workstation', { exact: true }).waitFor();
    let refreshes = 0;
    context.on('request', (request) => {
      if (request.url().endsWith('/api/auth/refresh')) refreshes++;
    });
    await context.clearCookies({ name: 'wuling_session' });
    await Promise.all([
      page.getByRole('link', { name: '工作台', exact: true }).click(),
      second.reload(),
    ]);
    await page.getByRole('link', { name: 'alice-private', exact: true }).waitFor();
    await second.getByText('workstation', { exact: true }).waitFor();
    await expect(refreshes).toBe(1);
    // Verify the API Token immediately stops working after the UI revoke action.
    await expect(
      (await fetch(origin + '/api/repos', { headers: { authorization: `Bearer ${token}` } }))
        .status,
    ).toBe(200);
    second.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await second.getByRole('button', { name: '撤销 workstation', exact: true }).click();
    await second.getByRole('status').filter({ hasText: '令牌已撤销' }).waitFor();
    await expect(
      (await fetch(origin + '/api/repos', { headers: { authorization: `Bearer ${token}` } }))
        .status,
    ).toBe(401);
    // Remove Bob using UI, then ensure his fresh login cannot see Alice's cached private data.
    await page.goto(origin + href + '/members');
    page.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await page.getByRole('button', { name: '移除 bob' }).click();
    await page.getByRole('status').filter({ hasText: '成员已移除' }).waitFor();
    await page.getByRole('button', { name: '退出', exact: true }).click();
    await page.waitForURL(origin + '/login');
    await second.waitForURL(origin + '/login');
    await login(page, 'bob');
    await page.getByText('从第一个仓库开始', { exact: true }).waitFor();
    await expect(await page.getByText('alice-private', { exact: true }).count()).toBe(0);
    await page.goto(origin + href + '/members');
    await page.getByRole('alert').filter({ hasText: '仓库不存在' }).waitFor();
    await expect(await page.getByText('alice', { exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: '退出', exact: true }).click();
    await page.waitForURL(origin + '/login');
    await login(page, 'alice');
    await page.getByRole('link', { name: 'API Token', exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('sensitive-client');
    await page.getByRole('button', { name: '创建令牌', exact: true }).click();
    await page.getByTestId('new-token').waitFor();
    await page.getByRole('button', { name: '我已保存，隐藏' }).click();
    await page.getByText('sensitive-client', { exact: true }).waitFor();
    // Both cookies gone: failed renewal must hide the private page and route cache.
    await context.clearCookies();
    await page.getByRole('link', { name: '工作台', exact: true }).click();
    await page.waitForURL(origin + '/login');
    await expect(await page.getByText('sensitive-client', { exact: true }).count()).toBe(0);
    await page.goto(origin + '/settings/tokens');
    await page.getByRole('heading', { name: '请先登录', exact: true }).waitFor();
    await expect(await page.getByText('sensitive-client', { exact: true }).count()).toBe(0);

    // Real Git README + real Rust API, not a mocked SEO snapshot.
    await login(page, 'alice');
    const created = await context.request.post(origin + '/api/repos', {
      headers: { origin },
      data: { name: 'public-guide', description: 'Public SSR metadata fixture', public: true },
    });
    await expect(created.status()).toBe(201);
    const published = (await created.json()) as Repository;
    const root = process.env.WULING_DATA_DIR;
    if (!root) throw new Error('Missing isolated Git fixture directory');
    const work = resolve(root, 'readme-fixture');
    await mkdir(work);
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        [
          '-C',
          work,
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          ...args,
        ],
        { stdio: 'pipe' },
      );
    git('init', '--initial-branch=main');
    await writeFile(
      resolve(work, 'README.md'),
      '# Repository guide\n\nSearchable README from a real Git commit.\n',
    );
    git('add', 'README.md');
    git('commit', '-m', 'Add README fixture');
    git('push', resolve(root, 'repos', `${published.id}.git`), 'main');
    git('push', resolve(root, 'repos', `${href.split('/').pop()}.git`), 'main');
    const publicPath = `/repos/${published.id}`;
    const publicResponse = await fetch(origin + publicPath);
    const publicHtml = await publicResponse.text();
    await expect(publicHtml).toContain('<h1>Repository guide</h1>');
    await expect(publicHtml).toContain('Public SSR metadata fixture');
    await expect(publicHtml.match(/rel="canonical"/g)?.length).toBe(1);
    await expect(publicResponse.headers.get('x-robots-tag')).toBe(
      process.env.WULING_INDEXABLE === 'true' ? 'index, follow' : 'noindex, nofollow',
    );
    const privateResponse = await context.request.get(origin + href);
    await expect(privateResponse.headers()['x-robots-tag']).toBe('noindex, nofollow');
    await expect(await privateResponse.text()).not.toContain('Repository guide');
    const workspaceResponse = await context.request.get(origin + publicPath + '/code');
    await expect(workspaceResponse.headers()['x-robots-tag']).toBe('noindex, nofollow');
    await expect(await workspaceResponse.text()).not.toContain('Searchable README');
    const sitemap = await fetch(origin + '/sitemap.xml');
    if (process.env.WULING_INDEXABLE === 'true') {
      const xml = await sitemap.text();
      await expect(xml).toContain(origin + publicPath);
      await expect(xml).toContain(origin + '/docs');
      await expect(xml).not.toContain(origin + href + '</loc>');
    } else {
      await expect(sitemap.status).toBe(404);
    }
    await page.goto(origin + href);
    await page.getByRole('heading', { name: 'Repository guide', exact: true }).waitFor();
    await page.goto(origin + publicPath);
    await page.getByRole('heading', { name: 'Repository guide', exact: true }).waitFor();
    await page.screenshot({ path: resolve(pictures, 'public-readme.png'), fullPage: true });
    await page.getByRole('link', { name: '代码', exact: true }).click();
    await page.getByRole('button', { name: 'README.md', exact: true }).click();
    await page.locator('pre').filter({ hasText: 'Searchable README' }).waitFor();
    await page.goto(origin + '/');
    await page.screenshot({ path: resolve(pictures, 'landing.png'), fullPage: true });
    await page.goto(origin + '/docs');
    await page.getByRole('heading', { name: '创建与浏览仓库', exact: true }).waitFor();
    await page.goto(origin + '/api/docs/');
    await page.locator('.swagger-ui .info .title').filter({ hasText: 'Wuling HTTP API' }).waitFor();
    await expect(errors).toEqual([]);
  } catch (error) {
    await page.screenshot({
      path: resolve(pictures, 'failure.png'),
      fullPage: true,
      mask: [page.getByTestId('new-token')],
    });
    console.error('Browser runtime errors:', errors);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
});
