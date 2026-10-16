const STRAPI_URL = import.meta.env.STRAPI_URL ?? 'http://localhost:1337';
const STRAPI_TOKEN = import.meta.env.STRAPI_TOKEN;

export interface StrapiImage {
  url: string;
  alternativeText?: string;
}

export interface StrapiResponse<T> {
  data: T;
}

export interface StrapiEntity {
  documentId: string;
  title?: string;
  subtitle?: string;
  slug?: string;
  content?: string;
  description?: string;
  intro?: string;
  order?: number;
  siteName?: string;
  tagline?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  footerText?: string;
  heroImage?: { data: StrapiImage | null };
  coverImage?: { data: StrapiImage | null };
  gallery?: { data: StrapiImage[] };
  socialLinks?: { network: string; url: string }[];
}

async function strapiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${STRAPI_URL}/api${path}`, {
    headers: STRAPI_TOKEN ? { Authorization: `Bearer ${STRAPI_TOKEN}` } : {},
  });
  if (!res.ok) {
    throw new Error(`Strapi ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function mediaUrl(image?: StrapiImage | null): string | undefined {
  if (!image?.url) return undefined;
  return image.url.startsWith('http') ? image.url : `${STRAPI_URL}${image.url}`;
}

export async function getGlobal() {
  const { data } = await strapiFetch<StrapiResponse<StrapiEntity>>('/global');
  return data;
}

export async function getHome() {
  const { data } = await strapiFetch<StrapiResponse<StrapiEntity>>('/home');
  return data;
}

export async function getProjects() {
  const { data } = await strapiFetch<StrapiResponse<StrapiEntity[]>>(
    '/projects?sort=order:asc&populate=coverImage',
  );
  return data;
}

export async function getProject(slug: string) {
  const { data } = await strapiFetch<StrapiResponse<StrapiEntity[]>>(
    `/projects?filters[slug][$eq]=${encodeURIComponent(slug)}&populate=coverImage&populate=gallery`,
  );
  return data[0];
}

export async function getPages() {
  const { data } = await strapiFetch<StrapiResponse<StrapiEntity[]>>('/pages?fields=slug');
  return data;
}

export async function getPage(slug: string) {
  const { data } = await strapiFetch<StrapiResponse<StrapiEntity[]>>(
    `/pages?filters[slug][$eq]=${encodeURIComponent(slug)}&populate=heroImage`,
  );
  return data[0];
}
