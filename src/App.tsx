import { useRef, useEffect, useState } from 'react'
import { Stage, Layer, Line } from 'react-konva'
import Konva from 'konva'
import { indexedDBHelper, Memo, LineConfig } from './utils/indexedDB'
import './App.css'

function App() {
  const [lines, setLines] = useState<LineConfig[]>([])
  const [memoList, setMemoList] = useState<Memo[]>([])
  const [viewMode, setViewMode] = useState<'editor' | 'list'>('list')
  const isDrawing = useRef(false)
  const isPanning = useRef(false)
  const stageRef = useRef<Konva.Stage>(null)
  const [penColor, setPenColor] = useState('#000000')
  const [penWidth, setPenWidth] = useState(2)
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

  const createDefaultTitle = () => {
    const now = new Date()
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_`
  }

  const loadMemoList = async () => {
    const memos = await indexedDBHelper.getAllMemos()
    setMemoList([...memos].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()))
  }

  useEffect(() => {
    const now = new Date()
    setMemoTitle(createDefaultTitle())
    setMemoId(now.getTime().toString())
    setMemoCreatedAt(now)
    loadMemoList()

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
      const memo: Memo = {
        id: memoId,
        title: memoTitle,
        lines: lines,
        createdAt: memoCreatedAt,
        updatedAt: new Date()
      }
      await indexedDBHelper.saveMemo(memo)
      lastSavedSnapshotRef.current = snapshot
      await loadMemoList()
      console.log('ローカルにリアルタイム保存しました')
    }, 500)

    return () => clearTimeout(autoSave)
  }, [lines, memoTitle, memoId, memoCreatedAt])

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

  const handleStart = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const evt = e.evt

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

    const newLine: LineConfig = {
      points: [pos.x, pos.y],
      stroke: penColor,
      strokeWidth: penWidth,
      tension: 0.5,
      lineCap: 'round' as any,
      lineJoin: 'round' as any
    }
    setCurrentLine(newLine)
    setLines([...lines, newLine])
  }

  const handleMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const evt = e.evt

    // アクティブなポインターを更新
    activePointersRef.current.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })

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

    const updatedLine: LineConfig = {
      ...currentLine,
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

  const handleTitleBlur = () => {
    setIsEditingTitle(false)
  }

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMemoTitle(e.target.value)
  }

  const handleSave = async () => {
    const memo: Memo = {
      id: memoId,
      title: memoTitle,
      lines: lines,
      createdAt: memoCreatedAt,
      updatedAt: new Date()
    }
    await indexedDBHelper.saveMemo(memo)
    lastSavedSnapshotRef.current = JSON.stringify({ memoId, memoTitle, lines })
    await loadMemoList()
    alert('保存しました')
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

  const handleNewMemo = () => {
    const now = new Date()
    setMemoId(now.getTime().toString())
    setMemoTitle(createDefaultTitle())
    setMemoCreatedAt(now)
    setLines([])
    setScale(1)
    setStagePos({ x: 0, y: 0 })
    setCurrentLine(null)
    setViewMode('editor')
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
        </div>
        <div className="toolbar-right">
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
            <button onClick={handleZoomOut}>-</button>
            <button onClick={handleZoomIn}>+</button>
            <button onClick={handleResetZoom}>リセット</button>
          </div>
          <button onClick={() => setViewMode(viewMode === 'editor' ? 'list' : 'editor')}>
            {viewMode === 'editor' ? '一覧' : '編集'}
          </button>
          <button onClick={() => setLines([])}>クリア</button>
          <button onClick={handleSave}>保存</button>
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
        </div>
      </div>
      {viewMode === 'list' ? (
        <div className="memo-list-container">
          <div className="memo-list-header">
            <h3>メモ一覧</h3>
            <button onClick={handleNewMemo}>新規作成</button>
          </div>
          {memoList.length === 0 ? (
            <p className="empty-message">保存されたメモはありません</p>
          ) : (
            <div className="memo-list">
              {memoList.map((memo) => (
                <button className="memo-list-item" key={memo.id} onClick={() => handleOpenMemo(memo)}>
                  <span className="memo-list-title">{memo.title}</span>
                  <span className="memo-list-meta">作成: {formatDateTime(memo.createdAt)}</span>
                  <span className="memo-list-meta">更新: {formatDateTime(memo.updatedAt)}</span>
                </button>
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
                <Line key={i} points={line.points} stroke={line.stroke} strokeWidth={line.strokeWidth} tension={line.tension} lineCap={line.lineCap as any} lineJoin={line.lineJoin as any} />
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

export default App
