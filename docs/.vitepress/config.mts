import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Atelier Limoun',
  description: 'Showcase website for a craft atelier — content editing and operations docs',
  base: process.env.VITEPRESS_BASE ?? '/',
  // README/deploy.md links target GitHub file paths; they are valid on GitHub
  // but dead inside the docs site (which uses routes). Ignore those only.
  ignoreDeadLinks: [/README/, /docs\/deploy/, /AGENTS/],
  vite: {
    server: { port: 5176 },
  },
  themeConfig: {
    nav: [
      { text: 'Accueil', link: '/' },
      { text: "Guide d'édition", link: '/edit' },
      { text: 'Déploiement', link: '/deploy' },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/pierreWagou/atelier-limoun' }],
    footer: {
      message: 'Private — all rights reserved.',
      copyright: 'Copyright © 2026 Pierre Romon',
    },
  },
  head: [
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: `${process.env.VITEPRESS_BASE ?? '/'}favicon.svg`,
      },
    ],
  ],
});
