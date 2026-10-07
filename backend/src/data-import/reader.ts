/**
 * Chunked Parquet reader for the downloaded data lake.
 *
 * Never loads a whole file: rows are pulled in [rowStart, rowEnd) windows so
 * the 10M-row files stay resident-friendly. Parquet integers decode as
 * BigInt; they are converted to Number here (the lake's ids are ~1e8, far
 * below Number.MAX_SAFE_INTEGER) and any unsafe value aborts loudly instead
 * of silently corrupting an id.
 */
import { parquetMetadata, parquetReadObjects } from 'hyparquet';
import { readFile } from 'node:fs/promises';

export type DatasetRow = Record<string, unknown>;

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function convertValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`Parquet integer ${value} exceeds safe range — refusing to truncate an id`);
    }
    return Number(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(convertValue);
  return value;
}

export function convertRow(row: Record<string, unknown>): DatasetRow {
  const out: DatasetRow = {};
  for (const [key, value] of Object.entries(row)) out[key] = convertValue(value);
  return out;
}

export async function countRows(path: string): Promise<number> {
  const buffer = await readFile(path);
  const meta = parquetMetadata(toArrayBuffer(buffer));
  const total = (meta as { num_rows?: bigint | number }).num_rows;
  return typeof total === 'bigint' ? Number(total) : Number(total ?? 0);
}

export async function readChunk(
  path: string,
  options: { columns?: string[]; rowStart: number; rowEnd: number },
): Promise<DatasetRow[]> {
  const buffer = await readFile(path);
  const result = await parquetReadObjects({
    file: toArrayBuffer(buffer),
    columns: options.columns,
    rowStart: options.rowStart,
    rowEnd: options.rowEnd,
  });
  const rows: DatasetRow[] = [];
  const unknownResult: unknown = result;
  if (unknownResult && typeof (unknownResult as AsyncIterable<Record<string, unknown>>)[Symbol.asyncIterator] === 'function') {
    for await (const row of unknownResult as AsyncIterable<Record<string, unknown>>) rows.push(convertRow(row));
  } else if (Array.isArray(unknownResult)) {
    for (const row of unknownResult as Array<Record<string, unknown>>) rows.push(convertRow(row));
  }
  return rows;
}

/** Async generator over [offset, offset+chunkSize) windows until `total` rows. */
export async function* iterateChunks(
  path: string,
  options: { columns?: string[]; chunkSize: number; startOffset?: number; total: number; limit?: number },
): AsyncGenerator<{ rows: DatasetRow[]; offset: number }> {
  const start = options.startOffset ?? 0;
  const end = options.limit !== undefined ? Math.min(options.total, start + options.limit) : options.total;
  for (let offset = start; offset < end; offset += options.chunkSize) {
    const rows = await readChunk(path, {
      columns: options.columns,
      rowStart: offset,
      rowEnd: Math.min(offset + options.chunkSize, end),
    });
    if (rows.length === 0) break;
    yield { rows, offset };
  }
}
