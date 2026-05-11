import { useRef, useEffect, useState } from 'react'
import { Stage, Layer, Line } from 'react-konva'
import Konva from 'konva'
import './App.css'

function App() {
  const [lines, setLines] = useState<Konva.LineConfig[]>([])
  const isDrawing = useRef(false)
  const stageRef = useRef<Konva.Stage>(null)
  const [penColor, setPenColor] = useState('#000000')
  const [penWidth, setPenWidth] = useState(2)
  const [currentLine, setCurrentLine] = useState<Konva.LineConfig | null>(null)

  const getPointerPosition = () => {
    const stage = stageRef.current
    if (!stage) return null
    return stage.getPointerPosition()
  }

  const handleStart = () => {
    isDrawing.current = true
    const pos = getPointerPosition()
    if (!pos) return

    const newLine: Konva.LineConfig = {
      points: [pos.x, pos.y],
      stroke: penColor,
      strokeWidth: penWidth,
      tension: 0.5,
      lineCap: 'round',
      lineJoin: 'round'
    }
    setCurrentLine(newLine)
    setLines([...lines, newLine])
  }

  const handleMove = () => {
    if (!isDrawing.current || !currentLine) return

    const point = getPointerPosition()
    if (!point) return

    const updatedLine = {
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

  return (
    <div className="App">
      <h1>手書きメモアプリ</h1>
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
              <Line key={i} points={line.points} stroke={line.stroke} strokeWidth={line.strokeWidth} tension={line.tension} lineCap={line.lineCap} lineJoin={line.lineJoin} />
            ))}
          </Layer>
        </Stage>
      </div>
    </div>
  )
}

export default App
