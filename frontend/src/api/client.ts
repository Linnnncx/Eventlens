const API_BASE = import.meta.env.VITE_API_BASE || '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    const body = await parseJson<unknown>(res).catch(() => undefined);
    throw new ApiError(res.statusText || 'Request failed', res.status, body);
  }
  return parseJson<T>(res);
}

export async function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) {
    const errBody = await parseJson<unknown>(res).catch(() => undefined);
    throw new ApiError(res.statusText || 'Request failed', res.status, errBody);
  }
  return parseJson<T>(res);
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await parseJson<unknown>(res).catch(() => undefined);
    throw new ApiError(res.statusText || 'Request failed', res.status, errBody);
  }
  return parseJson<T>(res);
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await parseJson<unknown>(res).catch(() => undefined);
    throw new ApiError(res.statusText || 'Request failed', res.status, errBody);
  }
  return parseJson<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const errBody = await parseJson<unknown>(res).catch(() => undefined);
    throw new ApiError(res.statusText || 'Request failed', res.status, errBody);
  }
  return parseJson<T>(res);
}

export { API_BASE };
