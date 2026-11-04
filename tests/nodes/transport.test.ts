import type { IExecuteFunctions } from 'n8n-workflow';

import { resolveBaseUrl, taasRequest } from '../../nodes/Taas/transport';
import { DEFAULT_BASE_URL } from '../../src/constants';

function ctxWith(http: jest.Mock, baseUrl = DEFAULT_BASE_URL): IExecuteFunctions {
  return {
    getCredentials: jest.fn().mockResolvedValue({ baseUrl, apiKey: 'fake-key-for-tests' }),
    helpers: { httpRequestWithAuthentication: http },
  } as unknown as IExecuteFunctions;
}

const OK = { ok: true };

/** A 429 with a zero-second retry hint so the retry is instant in tests. */
const rateLimited = () => ({
  statusCode: 429,
  response: { headers: { 'retry-after': '0' }, body: { code: 'rate_limit_exceeded' } },
});

describe('resolveBaseUrl', () => {
  it('reads the credential base URL and strips trailing slashes', async () => {
    const ctx = {
      ...ctxWith(jest.fn(), `${DEFAULT_BASE_URL}///`),
      getNode: jest.fn().mockReturnValue({ name: 'Synthaveil (TAAS)', type: 'taas' }),
    } as unknown as IExecuteFunctions;
    expect(await resolveBaseUrl(ctx)).toBe(DEFAULT_BASE_URL);
  });
});

describe('taasRequest', () => {
  it('sends an authenticated request and returns the parsed body', async () => {
    const http = jest.fn().mockResolvedValue(OK);
    const ctx = ctxWith(http);

    const body = await taasRequest(ctx, {
      baseUrl: 'https://staging.synthaveil.com',
      method: 'POST',
      path: '/api/v1/tokenize',
      body: { record: {} },
    });

    expect(body).toEqual(OK);
    expect(http).toHaveBeenCalledTimes(1);
    const [credName, opts] = http.mock.calls[0];
    expect(credName).toBe('taasApi');
    expect(opts).toMatchObject({
      method: 'POST',
      baseURL: 'https://staging.synthaveil.com',
      url: '/api/v1/tokenize',
      json: true,
      body: { record: {} },
    });
  });

  it('omits the body for a GET (no body key)', async () => {
    const http = jest.fn().mockResolvedValue(OK);
    const ctx = ctxWith(http);
    await taasRequest(ctx, {
      baseUrl: 'https://staging.synthaveil.com',
      method: 'GET',
      path: '/api/v1/usage',
    });
    expect(http.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('retries once on a 429 and returns the retry body (retryOnRateLimit default true)', async () => {
    const http = jest.fn().mockRejectedValueOnce(rateLimited()).mockResolvedValueOnce(OK);
    const ctx = ctxWith(http);

    const body = await taasRequest(ctx, {
      baseUrl: 'https://staging.synthaveil.com',
      method: 'POST',
      path: '/api/v1/tokenize',
    });

    expect(body).toEqual(OK);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('does not retry when retryOnRateLimit is false', async () => {
    const http = jest.fn().mockRejectedValue(rateLimited());
    const ctx = ctxWith(http);

    await expect(
      taasRequest(ctx, {
        baseUrl: 'https://staging.synthaveil.com',
        method: 'POST',
        path: '/api/v1/tokenize',
        retryOnRateLimit: false,
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('propagates a second 429 after the single retry (no infinite loop)', async () => {
    const http = jest.fn().mockRejectedValue(rateLimited());
    const ctx = ctxWith(http);

    await expect(
      taasRequest(ctx, {
        baseUrl: 'https://staging.synthaveil.com',
        method: 'POST',
        path: '/api/v1/tokenize',
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-429 error', async () => {
    const http = jest.fn().mockRejectedValue({ statusCode: 500 });
    const ctx = ctxWith(http);

    await expect(
      taasRequest(ctx, {
        baseUrl: 'https://staging.synthaveil.com',
        method: 'POST',
        path: '/api/v1/tokenize',
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(http).toHaveBeenCalledTimes(1);
  });
});
