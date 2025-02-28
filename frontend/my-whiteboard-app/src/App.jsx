import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css"; // Include your custom CSS if necessary

const socket = io("http://localhost:5000");

const App = () => {
  const canvasRef = useRef(null);
  const [color, setColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(5);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const [actions, setActions] = useState([]); // Stack for undo
  const [undoneActions, setUndoneActions] = useState([]); // Stack for redo
  const [tool, setTool] = useState("pen"); // Active tool: 'pen' or 'eraser'
  const [cursors, setCursors] = useState({});

  useEffect(() => {
    socket.on("canvas-data", (data) => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      ctx.putImageData(data.imageData, 0, 0);
    });

    socket.on("user-drawing", (data) => {
      drawLineOnCanvas(data.x, data.y, data.lastX, data.lastY, data.color, data.strokeWidth);
    });

    socket.on("clear-canvas", () => {
      clearCanvas();
    });

    socket.on("undo-action", (lastAction) => {
      undoAction(lastAction);
    });

    socket.on("redo-action", (lastAction) => {
      redoAction(lastAction);
    });

    socket.on("user-cursor", (data) => {
      setCursors((prev) => ({
        ...prev,
        [data.id]: { x: data.x, y: data.y, color: data.color }
      }));
    });

    return () => {
      socket.off("canvas-data");
      socket.off("user-drawing");
      socket.off("clear-canvas");
      socket.off("undo-action");
      socket.off("redo-action");
      socket.off("user-cursor");
    };
  }, []);

  const startDrawing = (e) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const x = e.nativeEvent.offsetX;
    const y = e.nativeEvent.offsetY;
    setLastPos({ x, y });

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const x = e.nativeEvent.offsetX;
    const y = e.nativeEvent.offsetY;

    // Check for eraser tool
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out"; // Erase mode
      ctx.lineWidth = strokeWidth * 2; // Make eraser a bit larger
    } else {
      ctx.globalCompositeOperation = "source-over"; // Normal drawing mode
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
    }

    ctx.lineTo(x, y);
    ctx.stroke();

    socket.emit("draw", {
      x,
      y,
      lastX: lastPos.x,
      lastY: lastPos.y,
      color,
      strokeWidth,
      tool
    });

    setLastPos({ x, y });

    setActions((prevActions) => [
      ...prevActions,
      { type: "draw", x, y, lastPos, color, strokeWidth, tool }
    ]);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit("clear");
  };

  const undoAction = (lastAction) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    ctx.putImageData(lastAction.imageData, 0, 0);
    setUndoneActions((prev) => [...prev, lastAction]);
  };

  const redoAction = (lastAction) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    ctx.putImageData(lastAction.imageData, 0, 0);
  };

  const onUndo = () => {
    if (actions.length === 0) return;
    const lastAction = actions.pop();
    setActions(actions);
    setUndoneActions([...undoneActions, lastAction]);
    socket.emit("undo", lastAction);
  };

  const onRedo = () => {
    if (undoneActions.length === 0) return;
    const lastAction = undoneActions.pop();
    setUndoneActions(undoneActions);
    socket.emit("redo", lastAction);
  };

  const handleColorChange = (e) => setColor(e.target.value);

  const handleStrokeWidthChange = (e) => setStrokeWidth(Number(e.target.value));

  const toggleTool = () => {
    setTool(tool === "pen" ? "eraser" : "pen");
  };

  return (
    <div className="App">
      <div className="toolbar">
        <input type="color" value={color} onChange={handleColorChange} />
        {/* Seekbar for stroke width */}
        <div>
          <label htmlFor="strokeWidth" className="block mb-2 text-sm">Stroke Width: {strokeWidth}</label>
          <input
            id="strokeWidth"
            type="range"
            min="1"
            max="20"
            value={strokeWidth}
            onChange={handleStrokeWidthChange}
            className="w-48"
          />
        </div>
        <button onClick={clearCanvas}>Clear</button>
        <button onClick={onUndo}>Undo</button>
        <button onClick={onRedo}>Redo</button>
        <button onClick={toggleTool}>
          {tool === "pen" ? "Switch to Eraser" : "Switch to Pen"}
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
      />
      <div className="cursors">
        {Object.keys(cursors).map((key) => (
          <div
            key={key}
            className="cursor"
            style={{
              position: "absolute",
              top: cursors[key].y + "px",
              left: cursors[key].x + "px",
              backgroundColor: cursors[key].color,
              width: 10,
              height: 10,
              borderRadius: "50%",
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default App;
