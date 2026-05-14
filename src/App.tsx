import { useRef, useEffect, useState } from 'react'
import { Stage, Layer, Line } from 'react-konva'
import Konva from 'konva'
import { indexedDBHelper, Memo, LineConfig } from './utils/indexedDB'
import { googleDriveHelper } from './utils/googleDrive'
import { GoogleOAuthProvider, useGoogleLogin, googleLogout } from '@react-oauth/google'
import { firebaseSignIn, firebaseSignOut, onFirebaseAuthStateChanged } from './utils/firebase'
import { User } from 'firebase/auth'
import './App.css'

const MemoThumbnail = ({ lines }: { lines: LineConfig[] }) => {
  const thumbnailSize = 128

  // メモの範囲を計算して、サムネイルに合わせてスケールを調整
  const calculateBounds = () => {
    if (lines.length === 0) return { minX: 0, minY: 0, maxX: thumbnailSize, maxY: thumbnailSize }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    lines.forEach(line => {
      if (line.points && line.points.length >= 2) {
        for (let i = 0; i < line.points.length; i += 2) {
          const x = line.points[i]
          const y = line.points[i + 1]
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
    })

    if (minX === Infinity) {
      return { minX: 0, minY: 0, maxX: thumbnailSize, maxY: thumbnailSize }
    }

    const padding = 20
    const contentWidth = maxX - minX + padding * 2
    const contentHeight = maxY - minY + padding * 2
    const scaleX = thumbnailSize / contentWidth
    const scaleY = thumbnailSize / contentHeight
    const scale = Math.min(scaleX, scaleY)

    return {
      minX: minX - padding,
      minY: minY - padding,
      maxX: maxX + padding,
      maxY: maxY + padding,
      scale
    }
  }

  const bounds = calculateBounds()
  const scale = bounds.scale || 1

  return (
    <div className="memo-thumbnail">
      <Stage
        width={thumbnailSize}
        height={thumbnailSize}
        scaleX={scale}
        scaleY={scale}
        x={-bounds.minX * scale}
        y={-bounds.minY * scale}
      >
        <Layer>
          {lines.map((line, i) => (
            <Line
              key={i}
              points={line.points}
              stroke={line.stroke}
              strokeWidth={line.strokeWidth}
              tension={line.tension}
              lineCap={line.lineCap as any}
              lineJoin={line.lineJoin as any}
              globalCompositeOperation={line.globalCompositeOperation as any}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  )
}

const CLIENT_ID = '205887830808-k14l2jn5u56fvrvf7hbet84gf4hj5k2e.apps.googleusercontent.com'

function AppContent({ firebaseUser, onSignOut }: { firebaseUser: User, onSignOut: () => Promise<void> }) {
  const [lines, setLines] = useState<LineConfig[]>([])
  const [memoList, setMemoList] = useState<Memo[]>([])
  const [viewMode, setViewMode] = useState<'editor' | 'list'>('list')
  const [googleDriveStatus, setGoogleDriveStatus] = useState<'not-connected' | 'connecting' | 'connected'>('not-connected')
  const [googleDriveFolderId, setGoogleDriveFolderId] = useState<string | null>(null)
  const [isSaveHelpOpen, setIsSaveHelpOpen] = useState(false)
  const [deleteTargetMemo, setDeleteTargetMemo] = useState<Memo | null>(null)
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false)
  const [isReauthPromptOpen, setIsReauthPromptOpen] = useState(false)
  const authTimeoutRef = useRef<number | null>(null)

  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      googleDriveHelper.setAccessToken(tokenResponse.access_token)
      
      try {
        // 既存の「手書きメモ」フォルダを検索
        let folder = await googleDriveHelper.findFolder('手書きメモ')
        
        // 存在しない場合のみ新規作成
        if (!folder) {
          folder = await googleDriveHelper.createFolder('手書きメモ')
        }
        
        setGoogleDriveFolderId(folder.id)
        
        // ローカルストレージに保存
        localStorage.setItem('googleDriveFolderId', folder.id)
        
        if (authTimeoutRef.current) {
          window.clearTimeout(authTimeoutRef.current)
          authTimeoutRef.current = null
        }
        setGoogleDriveStatus('connected')
        await loadMemoList()
        // 認証後にローカルにあるがDriveにないファイルをアップロード
        const allMemos = await indexedDBHelper.getAllMemos()
        const driveFiles = await googleDriveHelper.listFiles(folder.id)
        for (const memo of allMemos) {
          const driveFile = driveFiles.find(f => f.id === memo.googleDriveFileId)
          if (shouldUploadMemo(memo, driveFile)) {
            await syncMemoToGoogleDrive(memo, folder.id)
          }
        }
        await loadMemoList()
      } catch (error) {
        console.error('Google Driveフォルダ作成エラー:', error)
        alert('Google Driveフォルダの作成に失敗しました')
        if (authTimeoutRef.current) {
          window.clearTimeout(authTimeoutRef.current)
          authTimeoutRef.current = null
        }
        setGoogleDriveStatus('not-connected')
      }
    },
    onError: (error) => {
      console.error('Google Login Error:', error)
      alert('Google認証に失敗しました')
      if (authTimeoutRef.current) {
        window.clearTimeout(authTimeoutRef.current)
        authTimeoutRef.current = null
      }
      setGoogleDriveStatus('not-connected')
    },
    scope: 'https://www.googleapis.com/auth/drive.file'
  })
  const isDrawing = useRef(false)
  const isPanning = useRef(false)
  const stageRef = useRef<Konva.Stage>(null)
  const [penColor, setPenColor] = useState('#000000')
  const [penWidth, setPenWidth] = useState(2)
  const [toolMode, setToolMode] = useState<'pen' | 'eraser'>('pen')
  const [currentLine, setCurrentLine] = useState<LineConfig | null>(null)
  const [memoTitle, setMemoTitle] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [memoId, setMemoId] = useState<string>('')
  const [memoCreatedAt, setMemoCreatedAt] = useState<Date>(new Date())
  const [scale, setScale] = useState(1)
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 })
  const [lastPointerPos, setLastPointerPos] = useState({ x: 0, y: 0 })
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })
  const [touchMode, setTouchMode] = useState<'default' | 'draw'>('default')
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const lastPinchDistRef = useRef(0)
  const lastSavedSnapshotRef = useRef('')
  const penSideButtonPointersRef = useRef<Set<number>>(new Set())

  const createDefaultTitle = async () => {
    const now = new Date()
    const baseTitle = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_`
    
    const memos = await indexedDBHelper.getAllMemos()
    const existingTitles = new Set(memos.map(m => m.title))
    
    if (!existingTitles.has(baseTitle)) {
      return baseTitle
    }

    let counter = 1
    while (existingTitles.has(`${baseTitle}(${counter})`)) {
      counter++
    }
    
    return `${baseTitle}(${counter})`
  }

  const syncMemoToGoogleDrive = async (memo: Memo, folderId: string): Promise<Memo> => {
    const memoToSync = {
      ...memo
    }
    const memoData = JSON.stringify(memoToSync)

    if (memo.googleDriveFileId) {
      await googleDriveHelper.renameFile(memo.googleDriveFileId, `${memo.title}.json`)
      const file = await googleDriveHelper.updateFile(memo.googleDriveFileId, memoData)
      const syncedMemo = {
        ...memoToSync,
        googleDriveSyncedAt: new Date(file.modifiedTime)
      }
      await indexedDBHelper.saveMemo(syncedMemo)
      return syncedMemo
    }

    const file = await googleDriveHelper.saveFile(folderId, `${memo.title}.json`, memoData)
    const syncedMemo = {
      ...memoToSync,
      googleDriveFileId: file.id,
      googleDriveSyncedAt: new Date(file.modifiedTime)
    }
    await indexedDBHelper.saveMemo(syncedMemo)
    return syncedMemo
  }

  const shouldUploadMemo = (memo: Memo, googleDriveFile?: { modifiedTime: string }) => {
    if (!googleDriveFile) return true
    if (!memo.googleDriveSyncedAt) return true

    const localUpdatedAt = new Date(memo.updatedAt).getTime()
    const lastSyncedAt = new Date(memo.googleDriveSyncedAt).getTime()
    const googleDriveModifiedAt = new Date(googleDriveFile.modifiedTime).getTime()

    return localUpdatedAt > lastSyncedAt && localUpdatedAt > googleDriveModifiedAt
  }

  const shouldDownloadMemo = (memo: Memo | undefined, googleDriveFile: { modifiedTime: string }) => {
    if (!memo) return true
    if (!memo.googleDriveSyncedAt) return true

    const localUpdatedAt = new Date(memo.updatedAt).getTime()
    const lastSyncedAt = new Date(memo.googleDriveSyncedAt).getTime()
    const googleDriveModifiedAt = new Date(googleDriveFile.modifiedTime).getTime()

    return googleDriveModifiedAt > lastSyncedAt && googleDriveModifiedAt > localUpdatedAt
  }

  const loadMemoList = async () => {
    const memos = await indexedDBHelper.getAllMemos()
    
    // Google Driveからもメモを取得（連携済みの場合）
    if (googleDriveStatus === 'connected' && googleDriveFolderId) {
      try {
        const googleDriveFiles = await googleDriveHelper.listFiles(googleDriveFolderId)
        const googleDriveFileIds = new Set(googleDriveFiles.map(f => f.id))
        
        // Google Driveのファイルをローカルに同期
        for (const file of googleDriveFiles) {
          const localMemo = memos.find(m => m.googleDriveFileId === file.id)

          if (!shouldDownloadMemo(localMemo, file)) {
            continue
          }

          const fileData = await googleDriveHelper.getFile(file.id)
          const googleDriveMemo: Memo = {
            ...JSON.parse(fileData),
            googleDriveFileId: file.id,
            googleDriveSyncedAt: new Date()
          }

          // Google Driveのファイル名からタイトルを抽出して更新
          const fileNameWithoutExt = file.name.replace('.json', '')
          if (googleDriveMemo.title !== fileNameWithoutExt) {
            googleDriveMemo.title = fileNameWithoutExt
          }

          await indexedDBHelper.saveMemo(googleDriveMemo)
          const index = memos.findIndex(m => m.id === googleDriveMemo.id)
          if (index === -1) {
            memos.push(googleDriveMemo)
          } else {
            memos[index] = googleDriveMemo
          }
        }

        // ローカルにあるがGoogle Driveにないファイルを削除（同期済みのファイルのみ）
        for (const memo of memos) {
          if (memo.googleDriveFileId && !googleDriveFileIds.has(memo.googleDriveFileId)) {
            await indexedDBHelper.deleteMemo(memo.id)
            const index = memos.findIndex(m => m.id === memo.id)
            if (index !== -1) {
              memos.splice(index, 1)
            }
          }
        }

      } catch (error) {
        console.error('Google Drive同期エラー:', error)
      }
    }
    
    setMemoList([...memos].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()))
  }

  const handleGoogleDriveConnect = async () => {
    setGoogleDriveStatus('connecting')
    if (authTimeoutRef.current) {
      window.clearTimeout(authTimeoutRef.current)
    }
    authTimeoutRef.current = window.setTimeout(() => {
      setGoogleDriveStatus('not-connected')
      authTimeoutRef.current = null
    }, 10000)
    try {
      await googleDriveHelper.initialize()
      googleLogin()
    } catch (error) {
      console.error('Google Drive連携エラー:', error)
      alert('Google Drive連携に失敗しました')
      if (authTimeoutRef.current) {
        window.clearTimeout(authTimeoutRef.current)
        authTimeoutRef.current = null
      }
      setGoogleDriveStatus('not-connected')
    }
  }

  const handleGoogleDriveDisconnect = async () => {
    try {
      googleLogout()
      googleDriveHelper.clearAccessToken()
      setGoogleDriveFolderId(null)
      localStorage.removeItem('googleDriveFolderId')
      setGoogleDriveStatus('not-connected')
    } catch (error) {
      console.error('Google Drive切断エラー:', error)
      alert('Google Driveの切断に失敗しました')
    }
  }

  useEffect(() => {
    const now = new Date()
    setMemoId(now.getTime().toString())
    setMemoCreatedAt(now)
    loadMemoList()
    
    const initializeTitle = async () => {
      const title = await createDefaultTitle()
      setMemoTitle(title)
    }
    initializeTitle()

    // Google Drive連携状態を復元
    const savedFolderId = localStorage.getItem('googleDriveFolderId')
    if (savedFolderId) {
      setGoogleDriveFolderId(savedFolderId)
      // Google Drive Helperを初期化
      googleDriveHelper.initialize().catch(() => {
        setGoogleDriveStatus('not-connected')
        setGoogleDriveFolderId(null)
        localStorage.removeItem('googleDriveFolderId')
      })
    }

    // 常に連携確認モーダルを表示
    setIsReauthPromptOpen(true)

    // ウィンドウサイズに合わせてStageのサイズを設定
    const updateStageSize = () => {
      setStageSize({
        width: window.innerWidth,
        height: window.innerHeight - 80 // ツールバーの分を引く
      })
    }

    updateStageSize()
    window.addEventListener('resize', updateStageSize)

    // StageにPointer Eventsを設定
    const stage = stageRef.current
    if (stage) {
      stage.container().style.touchAction = 'none'
    }

    return () => {
      window.removeEventListener('resize', updateStageSize)
    }
  }, [])

  useEffect(() => {
    if (!memoId || lines.length === 0) return

    const snapshot = JSON.stringify({ memoId, memoTitle, lines })
    if (snapshot === lastSavedSnapshotRef.current) return

    const autoSave = setTimeout(async () => {
      const existingMemo = (await indexedDBHelper.getAllMemos()).find(memo => memo.id === memoId)
      const memo: Memo = {
        id: memoId,
        title: memoTitle,
        lines: lines,
        createdAt: memoCreatedAt,
        updatedAt: new Date(),
        googleDriveFileId: existingMemo?.googleDriveFileId
      }
      await indexedDBHelper.saveMemo(memo)
      lastSavedSnapshotRef.current = snapshot
      await loadMemoList()
      console.log('ローカルにリアルタイム保存しました')
    }, 500)

    return () => clearTimeout(autoSave)
  }, [lines, memoTitle, memoId, memoCreatedAt])

  // 定期同期（5分おき）
  useEffect(() => {
    if (googleDriveStatus !== 'connected' || !googleDriveFolderId) return

    const syncInterval = setInterval(async () => {
      try {
        const memos = await indexedDBHelper.getAllMemos()
        const googleDriveFiles = await googleDriveHelper.listFiles(googleDriveFolderId)
        const googleDriveFileIds = new Set(googleDriveFiles.map(f => f.id))

        // Google Driveのファイルをローカルに同期
        for (const file of googleDriveFiles) {
          const localMemo = memos.find(m => m.googleDriveFileId === file.id)

          if (!shouldDownloadMemo(localMemo, file)) {
            continue
          }

          const fileData = await googleDriveHelper.getFile(file.id)
          const googleDriveMemo: Memo = {
            ...JSON.parse(fileData),
            googleDriveFileId: file.id,
            googleDriveSyncedAt: new Date()
          }

          // Google Driveのファイル名からタイトルを抽出して更新
          const fileNameWithoutExt = file.name.replace('.json', '')
          if (googleDriveMemo.title !== fileNameWithoutExt) {
            googleDriveMemo.title = fileNameWithoutExt
          }

          await indexedDBHelper.saveMemo(googleDriveMemo)
        }

        // ローカルにあるがGoogle Driveにないファイルを削除（同期済みのファイルのみ）
        const latestMemos = await indexedDBHelper.getAllMemos()
        for (const memo of latestMemos) {
          if (memo.googleDriveFileId && !googleDriveFileIds.has(memo.googleDriveFileId)) {
            await indexedDBHelper.deleteMemo(memo.id)
          }
        }

        const finalMemos = await indexedDBHelper.getAllMemos()
        for (const memo of finalMemos) {
          const googleDriveFile = googleDriveFiles.find(file => file.id === memo.googleDriveFileId)
          if (shouldUploadMemo(memo, googleDriveFile)) {
            await syncMemoToGoogleDrive(memo, googleDriveFolderId)
          }
        }

        await loadMemoList()
        console.log('定期同期が完了しました（ローカルとGoogle Driveの双方向同期）')
      } catch (error) {
        console.error('定期同期エラー:', error)
      }
    }, 5 * 60 * 1000) // 5分おき

    return () => clearInterval(syncInterval)
  }, [googleDriveStatus, googleDriveFolderId])

  // 背景のドットを拡大縮小・移動と連動させる
  useEffect(() => {
    const container = canvasContainerRef.current
    if (!container) return

    const dotSpacing = 50
    const scaledSpacing = dotSpacing * scale
    container.style.backgroundSize = `${scaledSpacing}px ${scaledSpacing}px`
    container.style.backgroundPosition = `${stagePos.x}px ${stagePos.y}px`
  }, [scale, stagePos])

  const getPointerPosition = () => {
    const stage = stageRef.current
    if (!stage) return null
    return stage.getPointerPosition()
  }

  const getCanvasPointerPosition = () => {
    const pos = getPointerPosition()
    if (!pos) return null
    return {
      x: (pos.x - stagePos.x) / scale,
      y: (pos.y - stagePos.y) / scale
    }
  }

  const isPenSideButtonPressed = (evt: PointerEvent) => {
    return evt.pointerType === 'pen' && (
      evt.button === 2 ||
      evt.button === 5 ||
      (evt.buttons & 2) === 2 ||
      (evt.buttons & 4) === 4 ||
      (evt.buttons & 32) === 32
    )
  }

  const isEraserInput = (evt: PointerEvent) => {
    if (toolMode === 'eraser') return true
    if (evt.pointerType !== 'pen') return false
    return isPenSideButtonPressed(evt) || penSideButtonPointersRef.current.has(evt.pointerId)
  }

  const handleStart = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const evt = e.evt

    if (evt.pointerType === 'pen') {
      if (isPenSideButtonPressed(evt)) {
        penSideButtonPointersRef.current.add(evt.pointerId)
      } else {
        penSideButtonPointersRef.current.delete(evt.pointerId)
      }
    }

    if (evt.pointerType === 'touch' && evt.isPrimary) {
      activePointersRef.current.clear()
      lastPinchDistRef.current = 0
    }

    activePointersRef.current.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })
    const currentPointerCount = activePointersRef.current.size

    if (currentPointerCount === 2) {
      const pointers = Array.from(activePointersRef.current.values())
      lastPinchDistRef.current = Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y)
      isDrawing.current = false
      isPanning.current = false
      setCurrentLine(null)
    }

    if (evt.pointerType === 'touch' && touchMode === 'default') {
      // 2本指の場合はピンチズームのみ
      if (currentPointerCount >= 2) {
        return
      }
      // 1本指の場合はパン
      isPanning.current = true
      const pos = getPointerPosition()
      if (pos) {
        setLastPointerPos({ x: pos.x, y: pos.y })
      }
      return
    }

    if (evt.pointerType === 'mouse' && (evt.button === 1 || (evt.button === 0 && evt.shiftKey))) {
      isPanning.current = true
      const pos = getPointerPosition()
      if (pos) {
        setLastPointerPos({ x: pos.x, y: pos.y })
      }
      return
    }

    isDrawing.current = true
    const pos = getCanvasPointerPosition()
    if (!pos) return

    const isEraser = isEraserInput(evt)

    const newLine: LineConfig = {
      points: [pos.x, pos.y],
      stroke: isEraser ? '#000000' : penColor,
      strokeWidth: isEraser ? Math.max(penWidth * 3, 12) : penWidth,
      tension: 0.5,
      lineCap: 'round' as any,
      lineJoin: 'round' as any,
      globalCompositeOperation: isEraser ? 'destination-out' : 'source-over'
    }
    setCurrentLine(newLine)
    setLines([...lines, newLine])
  }

  const handleMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const evt = e.evt

    // アクティブなポインターを更新
    activePointersRef.current.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })

    if (isPenSideButtonPressed(evt)) {
      penSideButtonPointersRef.current.add(evt.pointerId)
    }

    // 2本指のピンチズーム（タッチのみ）
    if (evt.pointerType === 'touch' && activePointersRef.current.size === 2) {
      const pointers = Array.from(activePointersRef.current.values())
      if (pointers.length === 2) {
        const dist = Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y)
        if (lastPinchDistRef.current > 0) {
          const scaleBy = dist / lastPinchDistRef.current
          const oldScale = scale
          const newScale = oldScale * scaleBy

          if (newScale >= 0.2 && newScale <= 5) {
            const center = {
              x: (pointers[0].x + pointers[1].x) / 2,
              y: (pointers[0].y + pointers[1].y) / 2
            }

            const mousePointTo = {
              x: (center.x - stagePos.x) / oldScale,
              y: (center.y - stagePos.y) / oldScale
            }

            setScale(newScale)
            setStagePos({
              x: center.x - mousePointTo.x * newScale,
              y: center.y - mousePointTo.y * newScale
            })
          }

          lastPinchDistRef.current = dist
        }
        return
      }
    }

    if (evt.pointerType === 'touch' && activePointersRef.current.size !== 2) {
      lastPinchDistRef.current = 0
    }

    if (isPanning.current) {
      const pos = getPointerPosition()
      if (!pos) return

      const dx = pos.x - lastPointerPos.x
      const dy = pos.y - lastPointerPos.y

      setStagePos({
        x: stagePos.x + dx,
        y: stagePos.y + dy
      })

      setLastPointerPos({ x: pos.x, y: pos.y })
      return
    }

    if (!isDrawing.current || !currentLine) return

    const point = getCanvasPointerPosition()
    if (!point) return

    const isEraser = isEraserInput(evt)

    const updatedLine: LineConfig = {
      ...currentLine,
      stroke: isEraser ? '#000000' : currentLine.stroke,
      strokeWidth: isEraser ? Math.max(penWidth * 3, 12) : currentLine.strokeWidth,
      globalCompositeOperation: isEraser ? 'destination-out' : currentLine.globalCompositeOperation,
      points: [...(currentLine.points || []), point.x, point.y]
    }
    setCurrentLine(updatedLine)

    setLines(prevLines => {
      const newLines = [...prevLines]
      newLines[newLines.length - 1] = updatedLine
      return newLines
    })
  }

  const handleEnd = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const evt = e.evt

    // アクティブなポインターを削除
    activePointersRef.current.delete(evt.pointerId)
    penSideButtonPointersRef.current.delete(evt.pointerId)

    if (activePointersRef.current.size < 2) {
      lastPinchDistRef.current = 0
    }

    isDrawing.current = false
    isPanning.current = false
    setCurrentLine(null)
  }

  const handleTitleClick = () => {
    setIsEditingTitle(true)
  }

  const handleTitleBlur = async () => {
    setIsEditingTitle(false)
    
    // 重複チェック（自分以外のメモと同じタイトルの場合は自動的に連番を付与）
    const memos = await indexedDBHelper.getAllMemos()
    const existingMemo = memos.find(m => m.title === memoTitle && m.id !== memoId)
    
    let finalTitle = memoTitle
    if (existingMemo && memoTitle.trim() !== '') {
      // 連番を付与
      let counter = 1
      while (memos.find(m => m.title === `${memoTitle}(${counter})` && m.id !== memoId)) {
        counter++
      }
      finalTitle = `${memoTitle}(${counter})`
      setMemoTitle(finalTitle)
    }

    // Google Drive連携済みの場合、ファイル名も変更
    const currentMemo = memos.find(m => m.id === memoId)
    if (currentMemo?.googleDriveFileId && googleDriveStatus === 'connected') {
      try {
        await googleDriveHelper.renameFile(currentMemo.googleDriveFileId, `${finalTitle}.json`)
        console.log('Google Driveのファイル名を変更しました')
      } catch (error) {
        console.error('Google Driveファイル名変更エラー:', error)
      }
    }
  }

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMemoTitle(e.target.value)
  }

  const handleSave = async () => {
    const existingMemo = (await indexedDBHelper.getAllMemos()).find(memo => memo.id === memoId)
    const memo: Memo = {
      id: memoId,
      title: memoTitle,
      lines: lines,
      createdAt: memoCreatedAt,
      updatedAt: new Date(),
      googleDriveFileId: existingMemo?.googleDriveFileId
    }
    
    // ローカルに保存
    await indexedDBHelper.saveMemo(memo)
    lastSavedSnapshotRef.current = JSON.stringify({ memoId, memoTitle, lines })
    
    // Google Driveに保存（連携済みの場合）
    if (googleDriveStatus === 'connected' && googleDriveFolderId) {
      try {
        const syncedMemo = await syncMemoToGoogleDrive(memo, googleDriveFolderId)
        setMemoTitle(syncedMemo.title)
        await loadMemoList()
        alert('保存しました（Google Driveにも保存されました）')
      } catch (error) {
        console.error('Google Drive保存エラー:', error)
        await loadMemoList()
        alert('ローカルに保存しましたが、Google Driveへの保存に失敗しました')
      }
    } else {
      await loadMemoList()
      alert('保存しました')
    }
  }

  const handleSync = async () => {
    if (googleDriveStatus !== 'connected' || !googleDriveFolderId) {
      alert('Google Driveに連携されていません')
      return
    }

    // 未保存の変更がある場合は保存してから同期
    const currentSnapshot = JSON.stringify({ memoId, memoTitle, lines })
    if (currentSnapshot !== lastSavedSnapshotRef.current && viewMode === 'editor') {
      const existingMemo = (await indexedDBHelper.getAllMemos()).find(memo => memo.id === memoId)
      const memo: Memo = {
        id: memoId,
        title: memoTitle,
        lines: lines,
        createdAt: memoCreatedAt,
        updatedAt: new Date(),
        googleDriveFileId: existingMemo?.googleDriveFileId
      }
      await indexedDBHelper.saveMemo(memo)
      lastSavedSnapshotRef.current = currentSnapshot
      if (googleDriveFolderId) {
        await syncMemoToGoogleDrive(memo, googleDriveFolderId)
      }
    }

    try {
      const memos = await indexedDBHelper.getAllMemos()
      const googleDriveFiles = await googleDriveHelper.listFiles(googleDriveFolderId)
      const googleDriveFileIds = new Set(googleDriveFiles.map(f => f.id))

      // Google Driveのファイルをローカルに同期
      for (const file of googleDriveFiles) {
        const localMemo = memos.find(m => m.googleDriveFileId === file.id)
        if (!shouldDownloadMemo(localMemo, file)) continue
        const fileData = await googleDriveHelper.getFile(file.id)
        const googleDriveMemo: Memo = {
          ...JSON.parse(fileData),
          googleDriveFileId: file.id,
          googleDriveSyncedAt: new Date()
        }
        const fileNameWithoutExt = file.name.replace('.json', '')
        if (googleDriveMemo.title !== fileNameWithoutExt) {
          googleDriveMemo.title = fileNameWithoutExt
        }
        await indexedDBHelper.saveMemo(googleDriveMemo)
      }

      // ローカルにあるがGoogle Driveにないファイルを削除（同期済みのみ）
      for (const memo of memos) {
        if (memo.googleDriveFileId && !googleDriveFileIds.has(memo.googleDriveFileId)) {
          await indexedDBHelper.deleteMemo(memo.id)
        }
      }

      // ローカルからGoogle Driveへアップロード
      const latestMemos = await indexedDBHelper.getAllMemos()
      for (const memo of latestMemos) {
        const driveFile = googleDriveFiles.find(f => f.id === memo.googleDriveFileId)
        if (shouldUploadMemo(memo, driveFile)) {
          await syncMemoToGoogleDrive(memo, googleDriveFolderId)
        }
      }

      await loadMemoList()
      alert('同期が完了しました')
    } catch (error) {
      console.error('同期エラー:', error)
      alert('同期に失敗しました')
    }
  }

  const handleOpenMemo = (memo: Memo) => {
    setMemoId(memo.id)
    setMemoTitle(memo.title)
    setMemoCreatedAt(new Date(memo.createdAt))
    setLines(memo.lines)
    setScale(1)
    setStagePos({ x: 0, y: 0 })
    setCurrentLine(null)
    setViewMode('editor')
  }

  const handleNewMemo = async () => {
    const now = new Date()
    setMemoId(now.getTime().toString())
    const title = await createDefaultTitle()
    setMemoTitle(title)
    setMemoCreatedAt(now)
    setLines([])
    setScale(1)
    setStagePos({ x: 0, y: 0 })
    setCurrentLine(null)
    setViewMode('editor')
  }

  const handleDeleteMemo = async () => {
    if (!deleteTargetMemo) return

    try {
      // ローカルから削除
      await indexedDBHelper.deleteMemo(deleteTargetMemo.id)

      // Google Driveから削除（連携済みの場合）
      if (googleDriveStatus === 'connected' && deleteTargetMemo.googleDriveFileId) {
        try {
          await googleDriveHelper.deleteFile(deleteTargetMemo.googleDriveFileId)
        } catch (error) {
          console.error('Google Drive削除エラー:', error)
          alert('ローカルから削除しましたが、Google Driveからの削除に失敗しました')
        }
      }

      await loadMemoList()
      setDeleteTargetMemo(null)
    } catch (error) {
      console.error('削除エラー:', error)
      alert('削除に失敗しました')
    }
  }

  const formatDateTime = (value: Date) => {
    return new Date(value).toLocaleString('ja-JP')
  }

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const scaleBy = 1.1
    const oldScale = scale
    const pointer = e.target.getStage()?.getPointerPosition()
    if (!pointer) return

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale
    }

    const newScale = e.evt.deltaY > 0 ? oldScale * scaleBy : oldScale / scaleBy

    setScale(newScale)
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale
    })
  }

  const handleZoomIn = () => {
    const newScale = scale * 1.2
    if (newScale <= 5) {
      setScale(newScale)
    }
  }

  const handleZoomOut = () => {
    const newScale = scale / 1.2
    if (newScale >= 0.2) {
      setScale(newScale)
    }
  }

  const handleResetZoom = () => {
    setScale(1)
    setStagePos({ x: 0, y: 0 })
  }

  return (
    <div className="App">
      <div className="toolbar">
        <div className="toolbar-left">
          <button onClick={() => setViewMode(viewMode === 'editor' ? 'list' : 'editor')}>
            {viewMode === 'editor' ? '一覧' : '編集'}
          </button>
          {isEditingTitle ? (
            <input
              type="text"
              value={memoTitle}
              onChange={handleTitleChange}
              onBlur={handleTitleBlur}
              autoFocus
              className="title-input"
            />
          ) : (
            <h2 onClick={handleTitleClick} className="memo-title">
              {memoTitle}
            </h2>
          )}
          <button onClick={handleSync} disabled={googleDriveStatus !== 'connected'} title={googleDriveStatus !== 'connected' ? 'Google Drive未連携' : '同期'}>同期</button>
          <button onClick={handleSave}>保存</button>
          <button className="help-button" onClick={() => setIsSaveHelpOpen(true)}>?</button>
          <button onClick={() => setIsClearConfirmOpen(true)}>クリア</button>
        </div>
        <div className="toolbar-right">
          <div className="tool-group">
            <button 
              className={touchMode === 'default' ? 'active' : ''}
              onClick={() => setTouchMode('default')}
            >
              デフォルト
            </button>
            <button 
              className={touchMode === 'draw' ? 'active' : ''}
              onClick={() => setTouchMode('draw')}
            >
              描画
            </button>
          </div>
          <div className="tool-group">
            <button onClick={handleZoomOut}>-</button>
            <button onClick={handleZoomIn}>+</button>
            <button onClick={handleResetZoom}>リセット</button>
          </div>
          <div className="tool-group">
            <label>色:</label>
            <input type="color" value={penColor} onChange={(e) => setPenColor(e.target.value)} />
          </div>
          <div className="tool-group">
            <label>太さ:</label>
            <input type="range" min="1" max="20" value={penWidth} onChange={(e) => setPenWidth(Number(e.target.value))} />
            <span>{penWidth}px</span>
          </div>
          <div className="tool-group">
            <button className={toolMode === 'pen' ? 'active' : ''} onClick={() => setToolMode('pen')}>ペン</button>
            <button className={toolMode === 'eraser' ? 'active' : ''} onClick={() => setToolMode('eraser')}>消しゴム</button>
          </div>
        </div>
      </div>
      {isSaveHelpOpen && (
        <div className="modal-overlay" onClick={() => setIsSaveHelpOpen(false)}>
          <div className="save-help-modal" onClick={(e) => e.stopPropagation()}>
            <h3>保存のしくみ</h3>
            <ul>
              <li>描画やタイトルを変更すると、約0.5秒後にローカルへ自動保存します。</li>
              <li>Google Drive連携済みの場合、5分おきに更新日時を確認し、変更があるメモだけGoogle Driveへアップロードします。</li>
              <li>5分おきの同期では、Google Drive側の更新日時も確認し、変更があるメモだけローカルへダウンロードします。</li>
              <li>ツールバーの保存ボタンを押すと、ローカルへ保存し、Google Drive連携済みならすぐGoogle Driveにも保存します。</li>
              <li>Google Drive未連携の場合は、ローカル保存のみ行います。</li>
            </ul>
            <button onClick={() => setIsSaveHelpOpen(false)}>閉じる</button>
          </div>
        </div>
      )}
      {deleteTargetMemo && (
        <div className="modal-overlay" onClick={() => setDeleteTargetMemo(null)}>
          <div className="delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>削除の確認</h3>
            <p>「{deleteTargetMemo.title}」を削除してもよろしいですか？</p>
            <p className="delete-warning">削除したメモは復元できません。</p>
            <div className="modal-buttons">
              <button className="cancel-button" onClick={() => setDeleteTargetMemo(null)}>キャンセル</button>
              <button className="delete-confirm-button" onClick={handleDeleteMemo}>削除</button>
            </div>
          </div>
        </div>
      )}
      {isClearConfirmOpen && (
        <div className="modal-overlay" onClick={() => setIsClearConfirmOpen(false)}>
          <div className="delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>クリアの確認</h3>
            <p>内容を削除しますか？</p>
            <p className="delete-warning">削除した内容は復元できません。</p>
            <div className="modal-buttons">
              <button className="cancel-button" onClick={() => setIsClearConfirmOpen(false)}>キャンセル</button>
              <button className="delete-confirm-button" onClick={() => { setLines([]); setIsClearConfirmOpen(false); }}>クリア</button>
            </div>
          </div>
        </div>
      )}
      {isReauthPromptOpen && (
        <div className="modal-overlay" onClick={() => setIsReauthPromptOpen(false)}>
          <div className="delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Google Drive連携</h3>
            <p>Google Driveに連携しますか？</p>
            <div className="modal-buttons">
              <button className="cancel-button" onClick={() => setIsReauthPromptOpen(false)}>いいえ</button>
              <button className="delete-confirm-button" onClick={() => { setIsReauthPromptOpen(false); handleGoogleDriveConnect(); }}>はい</button>
            </div>
          </div>
        </div>
      )}
      {viewMode === 'list' ? (
        <div className="memo-list-container">
          <div className="memo-list-header">
            <h3>メモ一覧</h3>
            <div className="memo-list-actions">
              <span className="login-user">{firebaseUser.displayName ?? firebaseUser.email}</span>
              {googleDriveStatus === 'connected' ? (
                <button onClick={handleGoogleDriveDisconnect}>Google Driveを切断</button>
              ) : (
                <button onClick={handleGoogleDriveConnect} disabled={googleDriveStatus === 'connecting'}>
                  {googleDriveStatus === 'connecting' ? '連携中...' : 'Google Driveに保存する'}
                </button>
              )}
              <button onClick={handleNewMemo}>新規作成</button>
              <button className="signout-button" onClick={onSignOut}>ログアウト</button>
            </div>
          </div>
          {memoList.length === 0 ? (
            <p className="empty-message">保存されたメモはありません</p>
          ) : (
            <div className="memo-list">
              {memoList.map((memo) => (
                <div className="memo-list-item" key={memo.id} onClick={() => handleOpenMemo(memo)}>
                  <div className="memo-list-info">
                    <span className="memo-list-title">{memo.title}</span>
                    <span className="memo-list-meta">作成: {formatDateTime(memo.createdAt)}</span>
                    <span className="memo-list-meta">更新: {formatDateTime(memo.updatedAt)}</span>
                  </div>
                  <div className="memo-list-right">
                    <MemoThumbnail lines={memo.lines} />
                    <button className="delete-button" onClick={(e) => { e.stopPropagation(); setDeleteTargetMemo(memo); }}>削除</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="canvas-container" ref={canvasContainerRef}>
          <Stage
            width={stageSize.width}
            height={stageSize.height}
            scaleX={scale}
            scaleY={scale}
            x={stagePos.x}
            y={stagePos.y}
            onPointerDown={handleStart}
            onPointerMove={handleMove}
            onPointerUp={handleEnd}
            onPointerCancel={handleEnd}
            onWheel={handleWheel}
            ref={stageRef}
          >
            <Layer>
              {lines.map((line, i) => (
                <Line key={i} points={line.points} stroke={line.stroke} strokeWidth={line.strokeWidth} tension={line.tension} lineCap={line.lineCap as any} lineJoin={line.lineJoin as any} globalCompositeOperation={line.globalCompositeOperation as any} />
              ))}
            </Layer>
          </Stage>
        </div>
      )}
      <div className="info">
        <p>ヒント: 中クリックまたはShift+クリックで画面移動 | デフォルトモード: 指でパン、2本指でズーム | 描画モード: 指で描画、2本指でパン・ズーム</p>
      </div>
    </div>
  )
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async () => {
    setIsLoading(true)
    setError(null)
    try {
      await firebaseSignIn()
      onLogin()
    } catch (err) {
      console.error('ログインエラー:', err)
      setError('ログインに失敗しました。もう一度お試しください。')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>手書きメモ</h1>
        <p>Googleアカウントでログインしてください</p>
        {error && <p className="login-error">{error}</p>}
        <button className="login-button" onClick={handleLogin} disabled={isLoading}>
          {isLoading ? 'ログイン中...' : 'Googleでログイン'}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    const unsubscribe = onFirebaseAuthStateChanged((user) => {
      setFirebaseUser(user)
    })
    return () => unsubscribe()
  }, [])

  if (firebaseUser === undefined) {
    return <div className="login-screen"><div className="login-card"><p>読み込み中...</p></div></div>
  }

  if (firebaseUser === null) {
    return <LoginScreen onLogin={() => {}} />
  }

  return (
    <GoogleOAuthProvider clientId={CLIENT_ID}>
      <AppContent firebaseUser={firebaseUser} onSignOut={async () => { await firebaseSignOut() }} />
    </GoogleOAuthProvider>
  )
}
