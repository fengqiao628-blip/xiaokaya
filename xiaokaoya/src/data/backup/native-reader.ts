import { DATABASE_VERSION } from '../../shared/identity'
import { tablesForVersion } from '../schema'
export interface NativeSnapshot {
  schemaVersion: number
  data: Record<string, Record<string, unknown>[]>
}
// Read the existing native version only, before Dexie is allowed to upgrade it.
export async function readNativeDatabase(name: string): Promise<NativeSnapshot | null> {
  const databases = await indexedDB.databases()
  if (!databases.some((database) => database.name === name)) return null
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    let absent = false
    request.onupgradeneeded = () => {
      absent = true
      request.transaction?.abort()
    }
    request.onerror = () => (absent ? resolve(null) : reject(request.error))
    request.onblocked = () => reject(new Error('数据连接被其他窗口占用，请关闭旧窗口后重试'))
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      if (database.version % 10 || database.version / 10 > DATABASE_VERSION) {
        database.close()
        reject(new Error('数据库版本不受当前程序支持，未进行升级或重置'))
        return
      }
      const names = [...database.objectStoreNames]
      const data: NativeSnapshot['data'] = {}
      const transaction = database.transaction(names, 'readonly')
      for (const table of names) {
        const read = transaction.objectStore(table).getAll()
        read.onsuccess = () => {
          data[table] = read.result
        }
      }
      transaction.oncomplete = () => {
        const schemaVersion = database.version / 10
        database.close()
        resolve({ schemaVersion, data })
      }
      transaction.onabort = transaction.onerror = () => {
        database.close()
        reject(transaction.error ?? new Error('无法读取旧数据库快照'))
      }
    }
  })
}

// Recover an interrupted old-version restore before allowing any version upgrade.
export async function replaceNativePayload(
  name: string,
  schemaVersion: number,
  data: NativeSnapshot['data'],
) {
  const expected = [...tablesForVersion(schemaVersion)].sort()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('旧库被占用，恢复检查已停止'))
    request.onsuccess = () => {
      const database = request.result
      if (
        database.version !== schemaVersion * 10 ||
        [...database.objectStoreNames].sort().join('|') !== expected.join('|')
      ) {
        database.close()
        reject(new Error('恢复时数据库版本或表清单发生变化'))
        return
      }
      const transaction = database.transaction(expected, 'readwrite')
      for (const table of expected) {
        const store = transaction.objectStore(table)
        store.clear()
        for (const row of data[table]) store.add(row)
      }
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = transaction.onabort = () => {
        database.close()
        reject(transaction.error ?? new Error('原版本恢复事务失败'))
      }
    }
  })
}
