// src/App.jsx
import { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:4000'); // Point to backend

function App() {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('black');
  const [strokeWidth, setStrokeWidth] = useState(5);
  const [userCursor, setUserCursor] = useState({ x: 0, y: 0, color: 'black' });

  useEffect(() => {
    socket.on('draw', (data) => {
      drawOnCanvas(data.x, data.y, data.color, data.strokeWidth, data.isDrawing);
    });
  }, []);

  const startDrawing = (e) => {
    setIsDrawing(true);
    drawOnCanvas(e.clientX, e.clientY);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const drawOnCanvas = (x, y) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (isDrawing) {
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    socket.emit('draw', { x, y, color, strokeWidth, isDrawing });
  };

  return (
    <div className="App">
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        onMouseDown={startDrawing}
        onMouseUp={stopDrawing}
        onMouseMove={drawOnCanvas}
        className="border"
      />
      <div className="controls">
        <button onClick={() => setColor('red')}>Red</button>
        <button onClick={() => setColor('blue')}>Blue</button>
        <input
          type="range"
          min="1"
          max="10"
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(e.target.value)}
        />
      </div>
    </div>
  );
}

export default App;
