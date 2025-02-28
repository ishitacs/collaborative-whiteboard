import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';
import { useWindowSize } from './utils';

const socket = io('http://localhost:5000'); // Ensure backend is running on localhost:5000

const App = () => {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const [color, setColor] = useState('#000000');
  const [lineWidth, setLineWidth] = useState(5);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState('pen'); // 'pen', 'eraser'
  const [actions, setActions] = useState([]); // Store actions
  const [redoStack, setRedoStack] = useState([]); // Store actions for redo
  const [cursorColor, setCursorColor] = useState('red');
  const [users, setUsers] = useState([]);
  const { width, height } = useWindowSize();

  // Initialize canvas context
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctxRef.current = ctx;
    canvas.width = width;
    canvas.height = height;

    socket.on('draw', (data) => {
      drawOnCanvas(data);
    });

    socket.on('clear', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    socket.on('users', (userList) => {
      setUsers(userList);
    });
  }, [width, height]);

  // Start drawing on canvas
  const startDrawing = (e) => {
    const { offsetX, offsetY } = e.nativeEvent;
    ctxRef.current.beginPath();
    ctxRef.current.moveTo(offsetX, offsetY);
    setIsDrawing(true);
  };

  // Draw on canvas based on current tool
  const draw = (e) => {
    if (!isDrawing) return;

    const { offsetX, offsetY } = e.nativeEvent;
    if (tool === 'pen') {
      ctxRef.current.lineTo(offsetX, offsetY);
      ctxRef.current.strokeStyle = color;
      ctxRef.current.lineWidth = lineWidth;
      ctxRef.current.stroke();
    } else if (tool === 'eraser') {
      ctxRef.current.clearRect(offsetX - lineWidth / 2, offsetY - lineWidth / 2, lineWidth, lineWidth);
    }

    const drawingData = {
      x: offsetX,
      y: offsetY,
      tool,
      color,
      lineWidth,
    };

    // Add the action to history for undo/redo
    setActions((prevActions) => [...prevActions, drawingData]);
    socket.emit('draw', drawingData);
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
    }
  };

  // Clear canvas
  const clearCanvas = () => {
    ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setActions([]); // Clear actions
    setRedoStack([]); // Clear redo stack
    socket.emit('clear');
  };

  // Undo functionality
  const undo = () => {
    if (actions.length === 0) return;

    const lastAction = actions.pop(); // Pop the last action
    setRedoStack([lastAction, ...redoStack]); // Push it to redo stack
    redrawCanvas(actions); // Redraw the canvas with the updated actions
  };

  // Redo functionality
  const redo = () => {
    if (redoStack.length === 0) return;

    const redoAction = redoStack.shift(); // Pop the first action from redo stack
    setActions([...actions, redoAction]); // Add it back to actions array
    redrawCanvas([...actions, redoAction]); // Redraw the canvas with the updated actions
  };

  // Redraw canvas based on actions
  const redrawCanvas = (actionHistory) => {
    ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    actionHistory.forEach((action) => {
      drawOnCanvas(action);
    });
  };

  // Draw on the canvas (used for both user and broadcasted drawing)
  const drawOnCanvas = (data) => {
    const { x, y, tool, color, lineWidth } = data;

    if (tool === 'pen') {
      ctxRef.current.beginPath();
      ctxRef.current.moveTo(x, y);
      ctxRef.current.lineTo(x, y);
      ctxRef.current.strokeStyle = color;
      ctxRef.current.lineWidth = lineWidth;
      ctxRef.current.stroke();
    } else if (tool === 'eraser') {
      ctxRef.current.clearRect(x - lineWidth / 2, y - lineWidth / 2, lineWidth, lineWidth);
    }
  };

  return (
    <div className="app">
      <div className="toolbar">
        <button onClick={() => setTool('pen')}>Pen</button>
        <button onClick={() => setTool('eraser')}>Eraser</button>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        <input
          type="range"
          min="1"
          max="10"
          value={lineWidth}
          onChange={(e) => setLineWidth(e.target.value)}
        />
        <button onClick={clearCanvas}>Clear</button>
        <button onClick={undo}>Undo</button>
        <button onClick={redo}>Redo</button>
      </div>

      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
      />
      
      <div className="users">
        {users.map((user) => (
          <div key={user.id} style={{ color: user.cursorColor }}>{user.name}</div>
        ))}
      </div>
    </div>
  );
};

export default App;
