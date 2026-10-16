import type { Core } from '@strapi/strapi';

const PUBLIC_READ_ACTIONS = [
  'api::global.global.find',
  'api::global.global.findOne',
  'api::home.home.find',
  'api::home.home.findOne',
  'api::page.page.find',
  'api::page.page.findOne',
  'api::project.project.find',
  'api::project.project.findOne',
];

async function grantPublicRead({ strapi }: { strapi: Core.Strapi }) {
  const publicRole = await strapi.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });
  if (!publicRole) return;

  const existing = await strapi.db
    .query('plugin::users-permissions.permission')
    .findMany({ where: { role: publicRole.id } });
  const granted = new Set(existing.map((p) => p.action));

  for (const action of PUBLIC_READ_ACTIONS) {
    if (!granted.has(action)) {
      await strapi.db.query('plugin::users-permissions.permission').create({
        data: { action, role: publicRole.id },
      });
    }
  }
  strapi.log.info('Public read permissions granted for content APIs');
}

async function seedDemoContent({ strapi }: { strapi: Core.Strapi }) {
  const existing = await strapi.documents('api::project.project').findMany();
  if (existing.length > 0) return;

  await strapi.documents('api::global.global').create({
    data: {
      siteName: 'Atelier Limoun',
      tagline: 'Créations artisanales',
      contactEmail: 'contact@atelier-limoun.fr',
      footerText: 'Atelier Limoun — tous droits réservés',
    },
  });

  await strapi.documents('api::home.home').create({
    data: {
      title: 'Atelier Limoun',
      subtitle: 'Créations artisanales sur mesure',
      intro: "<p>Bienvenue à l'Atelier Limoun. Découvrez nos créations et nos projets récents.</p>",
    },
  });

  const project = await strapi.documents('api::project.project').create({
    data: {
      title: 'Exemple de projet',
      slug: 'exemple-de-projet',
      description: 'Un projet de démonstration — remplacez-le depuis le CMS.',
      order: 1,
    },
  });
  await strapi.documents('api::project.project').publish({ documentId: project.documentId });

  const page = await strapi.documents('api::page.page').create({
    data: {
      title: 'À propos',
      slug: 'a-propos',
      content: "<p>Page de démonstration. Éditez-la depuis l'admin du CMS.</p>",
    },
  });
  await strapi.documents('api::page.page').publish({ documentId: page.documentId });

  strapi.log.info('Demo content seeded');
}

export default {
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await grantPublicRead({ strapi });
    await seedDemoContent({ strapi });
  },
};
