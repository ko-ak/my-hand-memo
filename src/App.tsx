import { useRef, useEffect, useState } from 'react'
import { Stage, Layer, Line } from 'react-konva'
import Konva from 'konva'
import { indexedDBHelper, Memo, LineConfig } from './utils/indexedDB'
import './App.css'

function App() {
  const [lines, setLines] = useState<LineConfig[]>([])
  const isDrawing = useRef(false)
  const stageRef = useRef<Konva.Stage>(null)
  const [penColor, setPenColor] = useState('#000000')
  const [penWidth, setPenWidth] = useState(2)
  const [currentLine, setCurrentLine] = useState<LineConfig | null>(null)
  const [memoTitle, setMemoTitle] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [memoId, setMemoId] = useState<string>('')

  useEffect(() => {
    const now = new Date()
    const defaultTitle = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_`
    setMemoTitle(defaultTitle)
    setMemoId(Date.now().toString())
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

  const handleStart = () => {
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

  return (
    <div className="App">
      <div className="memo-header">
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
      <div className="toolbar">
        <div className="tool-group">
          <label>色:</label>
          <input type="color" value={penColor} onChange={(e) => setPenColor(e.target.value)} />
        </div>
        <div className="tool-group">
          <label>太さ:</label>
          <input type="range" min="1" max="20" value={penWidth} onChange={(e) => setPenWidth(Number(e.target.value))} />
          <span>{penWidth}px</span>
        </div>
        <button onClick={() => setLines([])}>クリア</button>
        <button onClick={handleSave}>保存</button>
      </div>
      <div className="canvas-container">
        <Stage
          width={800}
          height={600}
          onMouseDown={handleStart}
          onMousemove={handleMove}
          onMouseup={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
          ref={stageRef}
        >
          <Layer>
            {lines.map((line, i) => (
              <Line key={i} points={line.points} stroke={line.stroke} strokeWidth={line.strokeWidth} tension={line.tension} lineCap={line.lineCap as any} lineJoin={line.lineJoin as any} />
            ))}
          </Layer>
        </Stage>
      </div>
    </div>
  )
}

export default App
