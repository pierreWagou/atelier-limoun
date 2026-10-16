const REBUILD_URL = process.env.SITE_REBUILD_URL;
const REBUILD_TOKEN = process.env.SITE_REBUILD_TOKEN;

export async function triggerSiteRebuild() {
  if (!REBUILD_URL) return;
  try {
    await fetch(REBUILD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(REBUILD_TOKEN ? { Authorization: `Bearer ${REBUILD_TOKEN}` } : {}),
      },
      body: JSON.stringify({ source: 'strapi', at: new Date().toISOString() }),
    });
    strapi.log.info(`Site rebuild triggered: ${REBUILD_URL}`);
  } catch (err) {
    strapi.log.error(`Failed to trigger site rebuild: ${err}`);
  }
}
