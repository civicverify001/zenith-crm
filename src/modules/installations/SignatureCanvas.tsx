import { useRef, useState, useEffect } from 'react'

interface Props {
  onCapture: (dataUrl: string) => void
  onClear: () => void
  width?: number
  height?: number
}

export function SignatureCanvas({ onCapture, onClear, width = 400, height = 150 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(0, 0, width, height)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [width, height])

  function getPos(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      }
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    setIsDrawing(true)
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing) return
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const pos = getPos(e)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    setHasSignature(true)
  }

  function endDraw() {
    setIsDrawing(false)
    if (hasSignature && canvasRef.current) {
      onCapture(canvasRef.current.toDataURL('image/png'))
    }
  }

  function clear() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(0, 0, width, height)
    setHasSignature(false)
    onClear()
  }

  return (
    <div>
      <div className="text-xs text-muted mb-1.5">Sign below:</div>
      <div className="border border-border rounded-lg overflow-hidden" style={{ width, maxWidth: '100%' }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="cursor-crosshair touch-none w-full"
          style={{ height }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <button
          onClick={clear}
          className="text-xs text-muted hover:text-white transition-colors"
        >
          Clear signature
        </button>
        {hasSignature && (
          <span className="text-xs text-green">✓ Signature captured</span>
        )}
      </div>
    </div>
  )
}
