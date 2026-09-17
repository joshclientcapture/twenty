import { Injectable } from '@nestjs/common';

import { randomUUID } from 'crypto';

type GraphqlError = { message: string; extensions?: Record<string, unknown> };

export type MetadataField = { id: string; name: string; type: string };
export type MetadataObject = { id: string; nameSingular: string; fieldsList: MetadataField[] };
export type WantedField = { name: string; label: string; type: string; icon: string; extra?: Record<string, unknown> };

export const selectOptions = (options: { value: string; label: string; color: string }[]) =>
  options.map((option, position) => ({ ...option, id: randomUUID(), position }));

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

  async listObjects(): Promise<MetadataObject[]> {
    const result = await this.metadata<{ objects: { edges: { node: MetadataObject }[] } }>(
      `query OsObjects { objects(paging: { first: 1000 }) { edges { node { id nameSingular fieldsList { id name type } } } } }`,
    );
    return result.objects.edges.map((edge) => edge.node);
  }

  // Idempotent: creates only the fields the object is missing, then returns every field id by name.
  async ensureFields(objectNameSingular: string, wanted: WantedField[]): Promise<Record<string, string>> {
    const objects = await this.listObjects();
    const object = objects.find((candidate) => candidate.nameSingular === objectNameSingular);
    if (!object) throw new Error(`object ${objectNameSingular} not found`);
    const existing = new Set(object.fieldsList.map((field) => field.name));
    let created = 0;
    for (const field of wanted) {
      if (existing.has(field.name)) continue;
      await this.metadata(
        `mutation CreateOsField($input: CreateOneFieldMetadataInput!) { createOneField(input: $input) { id name } }`,
        { input: { field: { objectMetadataId: object.id, name: field.name, label: field.label, type: field.type, icon: field.icon, ...(field.extra ?? {}) } } },
      );
      created++;
    }
    if (created === 0) return Object.fromEntries(object.fieldsList.map((field) => [field.name, field.id]));
    const refreshed = (await this.listObjects()).find((candidate) => candidate.nameSingular === objectNameSingular);
    return Object.fromEntries((refreshed?.fieldsList ?? []).map((field) => [field.name, field.id]));
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
