export function seo(
  title: string,
  publicPage = false,
  description = '武陵 DevOps，自托管代码与协作工作台。',
) {
  return {
    meta: [
      { title: `${title} · 武陵 DevOps` },
      { name: 'description', content: description },
      {
        name: 'robots',
        content:
          publicPage && import.meta.env.WULING_INDEXABLE ? 'index,follow' : 'noindex,nofollow',
      },
    ],
  };
}
