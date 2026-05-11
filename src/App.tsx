import { useRef, useEffect, useState } from 'react'
import { Stage, Layer, Line } from 'react-konva'
import Konva from 'konva'
import { indexedDBHelper, Memo, LineConfig } from './utils/indexedDB'
import './App.css'

function App() {
  const [lines, setLines] = useState<LineConfig[]>([])
  const isDrawing = useRef(false)
  const isPanning = useRef(false)
  const stageRef = useRef<Konva.Stage>(null)
  const [penColor, setPenColor] = useState('#000000')
  const [penWidth, setPenWidth] = useState(2)
  const [currentLine, setCurrentLine] = useState<LineConfig | null>(null)
  const [memoTitle, setMemoTitle] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [memoId, setMemoId] = useState<string>('')
  const [scale, setScale] = useState(1)
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 })
  const [lastPointerPos, setLastPointerPos] = useState({ x: 0, y: 0 })
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })
  const [touchMode, setTouchMode] = useState<'default' | 'draw'>('default')

  useEffect(() => {
    const now = new Date()
    const defaultTitle = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_`
    setMemoTitle(defaultTitle)
    setMemoId(Date.now().toString())

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
    const autoSave = setInterval(async () => {
      if (lines.length > 0) {
        const memo: Memo = {
          id: memoId,
          title: memoTitle,
          lines: lines,
          createdAt: new Date(),
          updatedAt: new Date()
        }
        await indexedDBHelper.saveMemo(memo)
        console.log('自動保存しました')
      }
    }, 5 * 60 * 1000) // 5分ごとに自動保存

    return () => clearInterval(autoSave)
  }, [lines, memoTitle, memoId])

  const getPointerPosition = () => {
    const stage = stageRef.current
    if (!stage) return null
    return stage.getPointerPosition()
  }

  const handleStart = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const evt = e.evt

    if (evt.pointerType === 'touch' && touchMode === 'default') {
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
    const pos = getPointerPosition()
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

  const handleMove = () => {
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

    const point = getPointerPosition()
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

  const handleEnd = () => {
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
      createdAt: new Date(),
      updatedAt: new Date()
    }
    await indexedDBHelper.saveMemo(memo)
    alert('保存しました')
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
            <button onClick={handleZoomIn}>+</button>
            <button onClick={handleZoomOut}>-</button>
            <button onClick={handleResetZoom}>リセット</button>
          </div>
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
      <div className="canvas-container">
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
      <div className="info">
        <p>ヒント: 中クリックまたはShift+クリックで画面移動 | デフォルトモード: 指でパン、2本指でズーム | 描画モード: 指で描画、2本指でパン・ズーム</p>
      </div>
    </div>
  )
}

export default App
