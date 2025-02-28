import React, { useRef, useState, useEffect } from "react";
import { FaPen, FaEraser, FaUndo, FaRedo, FaTrash } from "react-icons/fa";
import './App.css';

const App = () => {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(5);
  const [isEraser, setIsEraser] = useState(false);
  const [history, setHistory] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = window.innerWidth * 0.9;
    canvas.height = window.innerHeight * 0.7;
    const ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctxRef.current = ctx;
  }, []);

  const startDrawing = ({ nativeEvent }) => {
    const { offsetX, offsetY } = nativeEvent;
    ctxRef.current.beginPath();
    ctxRef.current.moveTo(offsetX, offsetY);
    setIsDrawing(true);
  };

  const draw = ({ nativeEvent }) => {
    if (!isDrawing) return;
    const { offsetX, offsetY } = nativeEvent;
    ctxRef.current.lineTo(offsetX, offsetY);
    ctxRef.current.strokeStyle = isEraser ? "#FFFFFF" : color;
    ctxRef.current.lineWidth = strokeWidth;
    ctxRef.current.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    ctxRef.current.closePath();
    setIsDrawing(false);
    setHistory((prev) => [...prev, canvasRef.current.toDataURL()]);
    setRedoStack([]);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    ctxRef.current.clearRect(0, 0, canvas.width, canvas.height);
    setHistory([]);
    setRedoStack([]);
  };

  const undo = () => {
    if (history.length === 0) return;
    const prev = [...history];
    const lastState = prev.pop();
    setRedoStack((prevRedo) => [...prevRedo, canvasRef.current.toDataURL()]);
    setHistory(prev);
    restoreCanvas(lastState);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const nextRedo = [...redoStack];
    const lastRedo = nextRedo.pop();
    setHistory((prev) => [...prev, canvasRef.current.toDataURL()]);
    setRedoStack(nextRedo);
    restoreCanvas(lastRedo);
  };

  const restoreCanvas = (imageData) => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    const img = new Image();
    img.src = imageData;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
  };

  return (
    <div className="app-container">
      <h1 className="title">🖌️ Collaborative Whiteboard</h1>
      <div className="toolbar">
        <button className={isEraser ? "tool-button" : "tool-button active"} onClick={() => setIsEraser(false)}>
          <FaPen /> Pen
        </button>
        <button className={isEraser ? "tool-button active" : "tool-button"} onClick={() => setIsEraser(true)}>
          <FaEraser /> Eraser
        </button>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        <input type="range" min="2" max="20" value={strokeWidth} onChange={(e) => setStrokeWidth(e.target.value)} />
        <button className="tool-button clear" onClick={clearCanvas}>
          <FaTrash /> Clear
        </button>
        <button className="tool-button" onClick={undo}>
          <FaUndo /> Undo
        </button>
        <button className="tool-button" onClick={redo}>
          <FaRedo /> Redo
        </button>
      </div>
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
      />
    </div>
  );
};

export default App;
