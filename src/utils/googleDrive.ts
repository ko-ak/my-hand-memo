export interface GoogleDriveFile {
  id: string
  name: string
  modifiedTime: string
  webViewLink: string
}

export class GoogleDriveHelper {
  private isInitialized = false
  private accessToken: string | null = null

  async initialize(): Promise<void> {
    if (this.isInitialized) return
    this.isInitialized = true
  }

  setAccessToken(token: string): void {
    this.accessToken = token
  }

  clearAccessToken(): void {
    this.accessToken = null
  }

  isAuthorized(): boolean {
    return this.accessToken !== null
  }

  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    if (!this.accessToken) {
      throw new Error('Not signed in')
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(options.headers || {})
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Google Drive APIエラー: ${response.status} ${errorText}`)
    }

    if (response.status === 204) {
      return undefined as T
    }

    return response.json()
  }

  async createFolder(folderName: string): Promise<GoogleDriveFile> {
    if (!this.accessToken) {
      throw new Error('Not signed in')
    }

    return this.request<GoogleDriveFile>('https://www.googleapis.com/drive/v3/files?fields=id,name,modifiedTime,webViewLink', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      })
    })
  }

  async findFolder(folderName: string): Promise<GoogleDriveFile | null> {
    if (!this.accessToken) {
      throw new Error('Not signed in')
    }

    const query = encodeURIComponent(`name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)
    const response = await this.request<{ files?: GoogleDriveFile[] }>(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime,webViewLink)`)
    const files = response.files || []
    return files.length > 0 ? files[0] : null
  }

  async saveFile(folderId: string, fileName: string, content: string): Promise<GoogleDriveFile> {
    if (!this.accessToken) {
      throw new Error('Not signed in')
    }

    const metadata = {
      name: fileName,
      parents: [folderId],
      mimeType: 'application/json'
    }
    const body = new FormData()
    body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
    body.append('file', new Blob([content], { type: 'application/json' }))

    return this.request<GoogleDriveFile>('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,webViewLink', {
      method: 'POST',
      body
    })
  }

  async updateFile(fileId: string, content: string): Promise<GoogleDriveFile> {
    if (!this.accessToken) {
      throw new Error('Not signed in')
    }

    return this.request<GoogleDriveFile>(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,modifiedTime,webViewLink`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: content
    })
  }

  async getFile(fileId: string): Promise<string> {
    if (!this.accessToken) {
      throw new Error('Not signed in')
    }

    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Google Drive APIエラー: ${response.status} ${errorText}`)
    }

    return response.text()
  }

  async listFiles(folderId: string): Promise<GoogleDriveFile[]> {
    if (!this.accessToken) {
      throw new Error('Not signed in')
    }

    const query = encodeURIComponent(`'${folderId}' in parents and mimeType = 'application/json'`)
    const response = await this.request<{ files?: GoogleDriveFile[] }>(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime,webViewLink)`)
    return response.files || []
  }

  async deleteFile(fileId: string): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not signed in')
    }

    await this.request<void>(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE'
    })
  }
}

export const googleDriveHelper = new GoogleDriveHelper()
