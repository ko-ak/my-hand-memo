const DB_NAME = 'HandMemoDB'
const DB_VERSION = 1
const STORE_NAME = 'memos'

export interface LineConfig {
  points: number[]
  stroke: string
  strokeWidth: number
  tension: number
  lineCap: string
  lineJoin: string
}

export interface Memo {
  id: string
  title: string
  lines: LineConfig[]
  createdAt: Date
  updatedAt: Date
}

export const indexedDBHelper = {
  async open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          objectStore.createIndex('title', 'title', { unique: false })
          objectStore.createIndex('createdAt', 'createdAt', { unique: false })
          objectStore.createIndex('updatedAt', 'updatedAt', { unique: false })
        }
      }
    })
  },

  async saveMemo(memo: Memo): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const objectStore = transaction.objectStore(STORE_NAME)
      const request = objectStore.put(memo)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  },

  async getMemo(id: string): Promise<Memo | null> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const objectStore = transaction.objectStore(STORE_NAME)
      const request = objectStore.get(id)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result || null)
    })
  },

  async getAllMemos(): Promise<Memo[]> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const objectStore = transaction.objectStore(STORE_NAME)
      const request = objectStore.getAll()

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
  },

  async deleteMemo(id: string): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const objectStore = transaction.objectStore(STORE_NAME)
      const request = objectStore.delete(id)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }
}
