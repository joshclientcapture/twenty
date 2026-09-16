import { REACT_APP_SERVER_BASE_URL } from '~/config';

// The OS analytics now live in the `os` schema of Twenty's own database and are reached
// through twenty-server (`/os/rpc/:fn`, `/os/sync/:step`) with the normal session cookie.

type SyncStepResult = { step: string; ok: boolean; detail?: unknown; skipped?: string; error?: string };

type ClientResult<TData> = { data: TData | null; error: Error | null };

const post = async <TResponse,>(path: string, body?: unknown): Promise<TResponse> => {
  const response = await fetch(`${REACT_APP_SERVER_BASE_URL}/os/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      message = payload.message ?? payload.error ?? message;
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new Error(Array.isArray(message) ? message.join(', ') : String(message));
  }
  return (await response.json()) as TResponse;
};

export const osRpc = async <TData,>(functionName: string, args?: Record<string, unknown>): Promise<TData> =>
  (await post<{ data: TData }>(`rpc/${functionName}`, args)).data;

export const osSync = async (step: string): Promise<SyncStepResult[]> =>
  (await post<{ results: SyncStepResult[] }>(`sync/${step}`)).results;

// Same call shape the OS data layer was written against (`{ data, error }`), so the
// hundred-odd fetchers in data.ts stay untouched.
export const osClient = {
  rpc: async <TData = unknown,>(functionName: string, args?: Record<string, unknown>): Promise<ClientResult<TData>> => {
    try {
      return { data: await osRpc<TData>(functionName, args), error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  },
  functions: {
    // Only `refresh-all` was ported; the other OS edge functions (attribution, search matching,
    // admin users, rentals) belong to OS pages the CRM does not have.
    invoke: async <TData = { ok?: boolean; error?: string },>(name: string, options?: { body?: Record<string, unknown> }): Promise<ClientResult<TData>> => {
      if (name !== 'refresh-all') {
        return { data: null, error: new Error(`${name} is not available in the CRM yet`) };
      }
      const step = typeof options?.body?.step === 'string' ? options.body.step : options?.body?.fast ? 'fast' : 'all';
      try {
        const results = await osSync(step);
        const failed = results.filter((result) => !result.ok);
        return {
          data: { ok: failed.length === 0, results } as TData,
          error: failed.length ? new Error(failed.map((result) => `${result.step}: ${result.error}`).join('; ')) : null,
        };
      } catch (error) {
        return { data: null, error: error as Error };
      }
    },
  },
};
