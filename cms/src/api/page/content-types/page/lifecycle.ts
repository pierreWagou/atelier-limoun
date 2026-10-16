import { triggerSiteRebuild } from '../../../shared/rebuild';

export default {
  async afterCreate(event: { params: { data: { publishedAt?: unknown } } }) {
    if (event.params.data.publishedAt) await triggerSiteRebuild();
  },
  async afterUpdate(event: { params: { data: { publishedAt?: unknown } } }) {
    if (event.params.data.publishedAt) await triggerSiteRebuild();
  },
};
