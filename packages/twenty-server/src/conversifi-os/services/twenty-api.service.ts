import { Injectable } from '@nestjs/common';

import { randomUUID } from 'crypto';

type GraphqlError = { message: string; extensions?: Record<string, unknown> };

export type MetadataField = { id: string; name: string; type: string };
export type MetadataObject = { id: string; nameSingular: string; fieldsList: MetadataField[] };
type SelectOption = { id?: string; value: string; label: string; color: string; position?: number };
type PersonEmails = { id: string; emails: { primaryEmail: string | null; additionalEmails: string[] | null } };
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

  // Every person's primary and additional addresses, lowercased, mapped to the person id.
  async peopleByEmail(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const person of await this.allPeople()) {
      if (person.emails.primaryEmail) map.set(person.emails.primaryEmail.toLowerCase(), person.id);
      for (const extra of person.emails.additionalEmails ?? []) if (extra && !map.has(extra.toLowerCase())) map.set(extra.toLowerCase(), person.id);
    }
    return map;
  }

  // Id → primary and additional addresses, for adding a newly seen address to a known person.
  async peopleWithEmails(): Promise<Map<string, { primaryEmail: string | null; additionalEmails: string[] }>> {
    const people = await this.allPeople();
    return new Map(people.map((person) => [person.id, { primaryEmail: person.emails.primaryEmail, additionalEmails: person.emails.additionalEmails ?? [] }]));
  }

  async peopleByPrimaryEmail(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const person of await this.allPeople()) if (person.emails.primaryEmail) map.set(person.emails.primaryEmail.toLowerCase(), person.id);
    return map;
  }

  private async allPeople(): Promise<PersonEmails[]> {
    const people: PersonEmails[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 500; page++) {
      const result: { people: { edges: { node: PersonEmails }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await this.records(
        `query OsPeople($after: String) { people(first: 200, after: $after) { edges { node { id emails { primaryEmail additionalEmails } } } pageInfo { hasNextPage endCursor } } }`,
        { after: cursor },
      );
      people.push(...result.people.edges.map((edge) => edge.node));
      if (!result.people.pageInfo.hasNextPage) break;
      cursor = result.people.pageInfo.endCursor;
    }
    return people;
  }

  // Appends any missing options to an existing SELECT field, keeping the current ones untouched.
  async ensureSelectOptions(objectNameSingular: string, fieldName: string, wanted: SelectOption[]) {
    const result = await this.metadata<{ objects: { edges: { node: { nameSingular: string; fieldsList: { id: string; name: string; options: SelectOption[] | null }[] } }[] } }>(
      `query OsFieldOptions { objects(paging: { first: 1000 }) { edges { node { nameSingular fieldsList { id name options } } } } }`,
    );
    const object = result.objects.edges.map((edge) => edge.node).find((candidate) => candidate.nameSingular === objectNameSingular);
    const field = object?.fieldsList.find((candidate) => candidate.name === fieldName);
    if (!field) return;
    const current = field.options ?? [];
    const missing = wanted.filter((option) => !current.some((existing) => existing.value === option.value));
    if (missing.length === 0) return;
    const options = [...current, ...missing.map((option, index) => ({ ...option, id: option.id ?? randomUUID(), position: current.length + index }))];
    await this.metadata(
      `mutation AppendOsOptions($id: UUID!, $update: UpdateFieldInput!) { updateOneField(input: { id: $id, update: $update }) { id } }`,
      { id: field.id, update: { options } },
    );
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
