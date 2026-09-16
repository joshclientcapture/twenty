import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

const BATCH_SIZE = 500;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

const quote = (identifier: string) => {
  if (!IDENTIFIER.test(identifier)) throw new Error(`unsafe identifier ${identifier}`);
  return `"${identifier}"`;
};

@Injectable()
export class OsUpsertService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // Column order comes from the first row; every row must carry the same keys.
  async rows(
    table: string,
    rows: Record<string, unknown>[],
    conflictColumns: string[],
    casts: Record<string, string> = {},
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const columns = Object.keys(rows[0]);
    const updatable = columns.filter((column) => !conflictColumns.includes(column));
    const target = `os.${quote(table)}`;
    let written = 0;

    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      const params: unknown[] = [];
      const tuples = batch.map((row) => {
        const placeholders = columns.map((column) => {
          params.push(row[column] === undefined ? null : row[column]);
          const cast = casts[column] ? `::${casts[column]}` : '';
          return `$${params.length}${cast}`;
        });
        return `(${placeholders.join(',')})`;
      });
      const updateClause = updatable.length
        ? `do update set ${updatable.map((column) => `${quote(column)} = excluded.${quote(column)}`).join(', ')}`
        : 'do nothing';
      await this.dataSource.query(
        `insert into ${target} (${columns.map(quote).join(',')}) values ${tuples.join(',')}
         on conflict (${conflictColumns.map(quote).join(',')}) ${updateClause}`,
        params,
      );
      written += batch.length;
    }
    return written;
  }
}
