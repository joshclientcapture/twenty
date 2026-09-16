import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { OS_RPC_ALLOW_LIST } from 'src/conversifi-os/constants/os-rpc-allow-list.constant';

type FunctionSignature = { name: string; type: string }[];

const FUNCTION_NAME = /^[a-z_][a-z0-9_]*$/;

@Injectable()
export class OsRpcService {
  private readonly signatureCache = new Map<string, FunctionSignature>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // Mirrors PostgREST: named JSON arguments, each cast to the declared parameter type.
  async call(functionName: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!FUNCTION_NAME.test(functionName) || !OS_RPC_ALLOW_LIST.has(functionName)) {
      throw new NotFoundException(`unknown os function ${functionName}`);
    }
    const signature = await this.signature(functionName);
    const known = new Set(signature.map((parameter) => parameter.name));
    for (const key of Object.keys(args)) {
      if (!known.has(key)) throw new BadRequestException(`unknown argument ${key} for ${functionName}`);
    }
    const params: unknown[] = [];
    const assignments = signature
      .filter((parameter) => parameter.name in args)
      .map((parameter) => {
        params.push(this.serialize(args[parameter.name], parameter.type));
        return `${parameter.name} := $${params.length}::${parameter.type}`;
      });
    const rows: { result: unknown }[] = await this.dataSource.query(
      `select os.${functionName}(${assignments.join(', ')}) as result`,
      params,
    );
    return rows[0]?.result ?? null;
  }

  private serialize(value: unknown, type: string) {
    if (value === undefined) return null;
    if (type === 'jsonb' || type === 'json') return value === null ? null : JSON.stringify(value);
    return value;
  }

  private async signature(functionName: string): Promise<FunctionSignature> {
    const cached = this.signatureCache.get(functionName);
    if (cached) return cached;
    const rows: { names: string[] | null; types: string[] }[] = await this.dataSource.query(
      `select p.proargnames as names,
              array(select format_type(t, null) from unnest(p.proargtypes) as t) as types
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'os' and p.proname = $1
       order by p.pronargs desc limit 1`,
      [functionName],
    );
    if (rows.length === 0) throw new NotFoundException(`os function ${functionName} is not installed`);
    const { names, types } = rows[0];
    const signature = types.map((type, index) => ({ name: names?.[index] ?? `arg${index}`, type }));
    this.signatureCache.set(functionName, signature);
    return signature;
  }
}
