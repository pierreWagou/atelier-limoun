import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STRAPI = 'http://strapi.test';

function mockFetchOnce(payload: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: () => Promise.resolve(payload),
    }),
  );
}

async function loadClient() {
  vi.resetModules();
  return import('./strapi');
}

beforeEach(() => {
  vi.stubEnv('STRAPI_URL', STRAPI);
  vi.stubEnv('STRAPI_TOKEN', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('mediaUrl', () => {
  it('prefixes relative URLs with the Strapi origin', async () => {
    const { mediaUrl } = await loadClient();
    expect(mediaUrl({ url: '/uploads/cat.jpg' })).toBe(`${STRAPI}/uploads/cat.jpg`);
  });

  it('leaves absolute URLs untouched', async () => {
    const { mediaUrl } = await loadClient();
    expect(mediaUrl({ url: 'https://cdn.example.com/cat.jpg' })).toBe(
      'https://cdn.example.com/cat.jpg',
    );
  });

  it('returns undefined for missing media', async () => {
    const { mediaUrl } = await loadClient();
    expect(mediaUrl(undefined)).toBeUndefined();
    expect(mediaUrl(null)).toBeUndefined();
    expect(mediaUrl({ url: '' })).toBeUndefined();
  });
});

describe('strapiFetch', () => {
  it('calls the expected endpoint without auth headers by default', async () => {
    mockFetchOnce({ data: [] });
    const { getProjects } = await loadClient();
    await getProjects();
    expect(fetch).toHaveBeenCalledWith(
      `${STRAPI}/api/projects?sort=order:asc&populate=coverImage`,
      { headers: {} },
    );
  });

  it('sends a bearer token when STRAPI_TOKEN is set', async () => {
    vi.stubEnv('STRAPI_TOKEN', 'my-token');
    mockFetchOnce({ data: [] });
    const { getProjects } = await loadClient();
    await getProjects();
    expect(fetch).toHaveBeenCalledWith(expect.any(String), {
      headers: { Authorization: 'Bearer my-token' },
    });
  });

  it('throws on non-OK responses', async () => {
    mockFetchOnce({}, false, 500);
    const { getHome } = await loadClient();
    await expect(getHome()).rejects.toThrow(/Strapi \/home failed: 500/);
  });

  it('returns the payload data', async () => {
    mockFetchOnce({ data: { title: 'Atelier Limoun' } });
    const { getHome } = await loadClient();
    const home = await getHome();
    expect(home.title).toBe('Atelier Limoun');
  });
});

describe('slug queries', () => {
  it('URL-encodes the slug in project lookups', async () => {
    mockFetchOnce({ data: [] });
    const { getProject } = await loadClient();
    await getProject('café & thé');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('filters[slug][$eq]=caf%C3%A9%20%26%20th%C3%A9'),
      expect.anything(),
    );
  });
});
