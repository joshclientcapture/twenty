import { Injectable } from '@nestjs/common';

type GraphqlError = { message: string; extensions?: Record<string, unknown> };

const env = (name: string) => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
};

// Talks to this same server over loopback with the workspace API key the os:api-key command
// minted, so the bridge writes records and metadata exactly the way the app itself does.
@Injectable()
export class TwentyApiService {
  private get baseUrl() {
    return `http://127.0.0.1:${env('NODE_PORT') ?? '3000'}`;
  }

  isConfigured() {
    return !!env('OS_TWENTY_API_KEY');
  }

  async records<TData>(query: string, variables: Record<string, unknown> = {}): Promise<TData> {
    return this.post<TData>('/graphql', query, variables);
  }

  async metadata<TData>(query: string, variables: Record<string, unknown> = {}): Promise<TData> {
    return this.post<TData>('/metadata', query, variables);
  }

  private async post<TData>(path: string, query: string, variables: Record<string, unknown>): Promise<TData> {
    const token = env('OS_TWENTY_API_KEY');
    if (!token) throw new Error('OS_TWENTY_API_KEY is not set');
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw new Error(`twenty ${path} ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const payload = (await response.json()) as { data?: TData; errors?: GraphqlError[] };
    if (payload.errors?.length) {
      const details = payload.errors.map((error) => `${error.message}${error.extensions ? ' ' + JSON.stringify(error.extensions).slice(0, 800) : ''}`);
      throw new Error(`twenty ${path}: ${details.join('; ')}`);
    }
    if (!payload.data) throw new Error(`twenty ${path}: empty response`);
    return payload.data;
  }
}
