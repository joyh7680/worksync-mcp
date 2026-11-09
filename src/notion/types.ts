// Narrow boundary types. Public API SDK payloads are checked by the SDK and by our live schema validation.
export type Property = { id: string; name: string; type: string; [key: string]: unknown };
export interface DataSource {
  id: string;
  parent: { database_id?: string };
  properties: Record<string, Property>;
}
export interface Page {
  id: string;
  url: string;
  last_edited_time: string;
  archived?: boolean;
  in_trash?: boolean;
  parent: { data_source_id?: string; database_id?: string };
  properties: Record<string, Property>;
}
export interface View {
  id: string;
  name: string;
  data_source_id: string | null;
  parent: { database_id: string };
  filter: unknown;
  configuration?: {
    type: string;
    subtasks?: { property_id?: string; display_mode?: string } | null;
  } | null;
}
export interface NotionGateway {
  getDataSource(id: string): Promise<DataSource>;
  getDatabase(id: string): Promise<{ id: string; data_sources: { id: string }[] }>;
  getPage(id: string): Promise<Page>;
  getUser(id: string): Promise<{ id: string; type?: string }>;
  getView(id: string): Promise<View>;
  listViews(dataSourceId: string): Promise<View[]>;
  query(dataSourceId: string, parentProperty: string, parentId: string): Promise<Page[]>;
  create(dataSourceId: string, properties: Record<string, unknown>): Promise<Page>;
  update(id: string, properties: Record<string, unknown>): Promise<Page>;
}
export function value<T>(p: Property | undefined, type: string): T | undefined {
  return p?.[type] as T | undefined;
}
export const textOf = (p: Property | undefined) =>
  (value<{ plain_text?: string; text?: { content: string } }[]>(p, p?.type ?? '') ?? [])
    .map((t) => t.plain_text ?? t.text?.content ?? '')
    .join('');
export const relationOf = (p: Property | undefined) =>
  (value<{ id: string }[]>(p, 'relation') ?? []).map((r) => r.id);
export const dateOf = (p: Property | undefined) =>
  value<{ start: string } | null>(p, 'date')?.start ?? null;
