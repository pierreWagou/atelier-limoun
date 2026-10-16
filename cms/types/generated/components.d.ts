import type { Schema, Struct } from '@strapi/strapi';

export interface SharedSocialLink extends Struct.ComponentSchema {
  collectionName: 'components_shared_social_links';
  info: {
    displayName: 'Social link';
    icon: 'link';
  };
  attributes: {
    network: Schema.Attribute.Enumeration<
      ['instagram', 'facebook', 'pinterest', 'other']
    > &
      Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'shared.social-link': SharedSocialLink;
    }
  }
}
