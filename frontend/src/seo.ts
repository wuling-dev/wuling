export function seo(title: string, path: string, publicPage = true) {
  const indexable = import.meta.env.WULING_INDEXABLE && publicPage
  return {
    meta: [{ title: `${title} · 武陵 DevOps` }, { name: 'description', content: '武陵 DevOps：代码托管、Issue、合并请求、流水线与团队知识库。' }, { name: 'robots', content: indexable ? 'index,follow' : 'noindex,nofollow' }, { property: 'og:title', content: `${title} · 武陵 DevOps` }],
    links: [{ rel: 'canonical', href: new URL(path, import.meta.env.WULING_PUBLIC_ORIGIN).href }],
  }
}
