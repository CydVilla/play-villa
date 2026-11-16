import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

// Model the small D1 binding surface we use with actual SQLite and atomic batches.
export function database(migrate = true) {
  const sqlite = new DatabaseSync(':memory:')
  const migrations = new URL('../migrations/', import.meta.url)
  const files = readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()
  const apply = (name: string) => sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'))
  if (migrate) files.forEach(apply)

  function prepare(sql: string, params: (string | number | null)[] = []) {
    function result() {
      const before = sqlite.prepare('SELECT total_changes() AS n').get()!.n
      const results = sqlite.prepare(sql).all(...params)
      const after = sqlite.prepare('SELECT total_changes() AS n').get()!.n
      const changes = before === after ? 0 : Number(sqlite.prepare('SELECT changes() AS n').get()!.n)
      return { success: true, results, meta: { changes } }
    }

    return {
      bind: (...args: (string | number | null)[]) => prepare(sql, args),
      run: async () => result(),
      all: async () => result(),
      first: async (column?: string) => {
        const row = result().results[0]
        return column ? row?.[column] ?? null : row ?? null
      },
      result,
    }
  }

  return {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      sqlite.exec('BEGIN')
      try {
        const result = statements.map(statement => statement.result())
        sqlite.exec('COMMIT')
        return result
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
    sqlite, apply,
  }
}
