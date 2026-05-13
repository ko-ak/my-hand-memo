import { gapi } from 'gapi-script'

const CLIENT_ID = '205887830808-k14l2jn5u56fvrvf7hbet84gf4hj5k2e.apps.googleusercontent.com'
const SCOPES = 'https://www.googleapis.com/auth/drive.file'

export interface GoogleDriveFile {
  id: string
  name: string
  modifiedTime: string
  webViewLink: string
}

export class GoogleDriveHelper {
  private isInitialized = false
  private isSignedIn = false

  async initialize(): Promise<void> {
    if (this.isInitialized) return

    return new Promise((resolve, reject) => {
      gapi.load('client:auth2', async () => {
        try {
          await gapi.client.init({
            clientId: CLIENT_ID,
            scope: SCOPES,
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
          })
          this.isInitialized = true

          // 認証状態をチェック
          this.isSignedIn = gapi.auth2.getAuthInstance().isSignedIn.get()
          
          // 認証状態の変化を監視
          gapi.auth2.getAuthInstance().isSignedIn.listen((signedIn: boolean) => {
            this.isSignedIn = signedIn
          })

          resolve()
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  async signIn(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const authInstance = gapi.auth2.getAuthInstance()
    if (!authInstance.isSignedIn.get()) {
      await authInstance.signIn()
    }
    this.isSignedIn = true
  }

  async signOut(): Promise<void> {
    if (!this.isInitialized) return

    const authInstance = gapi.auth2.getAuthInstance()
    if (authInstance.isSignedIn.get()) {
      await authInstance.signOut()
    }
    this.isSignedIn = false
  }

  isAuthorized(): boolean {
    return this.isSignedIn
  }

  async createFolder(folderName: string): Promise<GoogleDriveFile> {
    if (!this.isSignedIn) {
      throw new Error('Not signed in')
    }

    const response = await gapi.client.drive.files.create({
      resource: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      }
    })

    return {
      id: response.result.id!,
      name: response.result.name!,
      modifiedTime: response.result.modifiedTime!,
      webViewLink: response.result.webViewLink!
    }
  }

  async saveFile(folderId: string, fileName: string, content: string): Promise<GoogleDriveFile> {
    if (!this.isSignedIn) {
      throw new Error('Not signed in')
    }

    const response = await gapi.client.drive.files.create({
      resource: {
        name: fileName,
        parents: [folderId],
        mimeType: 'application/json'
      },
      media: {
        mimeType: 'application/json',
        body: content
      }
    })

    return {
      id: response.result.id!,
      name: response.result.name!,
      modifiedTime: response.result.modifiedTime!,
      webViewLink: response.result.webViewLink!
    }
  }

  async updateFile(fileId: string, content: string): Promise<GoogleDriveFile> {
    if (!this.isSignedIn) {
      throw new Error('Not signed in')
    }

    const response = await gapi.client.drive.files.update({
      fileId: fileId,
      media: {
        mimeType: 'application/json',
        body: content
      }
    })

    return {
      id: response.result.id!,
      name: response.result.name!,
      modifiedTime: response.result.modifiedTime!,
      webViewLink: response.result.webViewLink!
    }
  }

  async getFile(fileId: string): Promise<string> {
    if (!this.isSignedIn) {
      throw new Error('Not signed in')
    }

    const response = await gapi.client.drive.files.get({
      fileId: fileId,
      alt: 'media'
    })

    return response.body
  }

  async listFiles(folderId: string): Promise<GoogleDriveFile[]> {
    if (!this.isSignedIn) {
      throw new Error('Not signed in')
    }

    const response = await gapi.client.drive.files.list({
      q: `'${folderId}' in parents and mimeType = 'application/json'`,
      fields: 'files(id, name, modifiedTime, webViewLink)'
    })

    return response.result.files?.map((file: any) => ({
      id: file.id!,
      name: file.name!,
      modifiedTime: file.modifiedTime!,
      webViewLink: file.webViewLink!
    })) || []
  }

  async deleteFile(fileId: string): Promise<void> {
    if (!this.isSignedIn) {
      throw new Error('Not signed in')
    }

    await gapi.client.drive.files.delete({
      fileId: fileId
    })
  }
}

export const googleDriveHelper = new GoogleDriveHelper()
