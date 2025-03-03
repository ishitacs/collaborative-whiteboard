// App.js
import React, { useState, useEffect, useRef } from "react";
import { FaPen, FaEraser, FaTrash, FaUndo, FaRedo } from "react-icons/fa";
import { io } from "socket.io-client";
import "./App.css";

const socket = io("https://collaborative-whiteboard-fsg8.onrender.com");

function App() {
    const [isDrawing, setIsDrawing] = useState(false);
    const [color, setColor] = useState("#000000");
    const [strokeWidth, setStrokeWidth] = useState(5);
    const [isEraser, setIsEraser] = useState(false);
    const [history, setHistory] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const canvasRef = useRef(null);
    const ctxRef = useRef(null);
    const lastPoint = useRef({ x: 0, y: 0 }); // Track the last point

    useEffect(() => {
        const canvas = canvasRef.current;
        canvas.width = window.innerWidth * 0.9;
        canvas.height = window.innerHeight * 0.7;
        const ctx = canvas.getContext("2d");
        ctx.lineCap = "round";
        ctx.lineJoin = "round"; // Ensures smooth lines
        ctxRef.current = ctx;

        socket.on("drawing", (data) => {
            const { x, y, color, strokeWidth, isEraser, prevX, prevY } = data;
            ctxRef.current.beginPath();
            ctxRef.current.strokeStyle = isEraser ? "#FFFFFF" : color;
            ctxRef.current.lineWidth = strokeWidth;

            if (prevX !== null && prevY !== null) {
                ctxRef.current.moveTo(prevX, prevY);
                ctxRef.current.lineTo(x, y);
            } else {
                ctxRef.current.moveTo(x, y);
                ctxRef.current.lineTo(x, y);
            }
            ctxRef.current.stroke();
        });

        socket.on("clear", () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            setHistory([]);
            setRedoStack([]);
        });
    }, []);

    const startDrawing = ({ nativeEvent }) => {
        const { offsetX, offsetY } = nativeEvent;
        ctxRef.current.beginPath();
        ctxRef.current.moveTo(offsetX, offsetY);
        setIsDrawing(true);
        lastPoint.current = { x: offsetX, y: offsetY }; // Store the starting point
    };

    const draw = ({ nativeEvent }) => {
        if (!isDrawing) return;
        const { offsetX, offsetY } = nativeEvent;
        ctxRef.current.lineTo(offsetX, offsetY);
        ctxRef.current.strokeStyle = isEraser ? "#FFFFFF" : color;
        ctxRef.current.lineWidth = strokeWidth;
        ctxRef.current.stroke();

        socket.emit("drawing", {
            x: offsetX,
            y: offsetY,
            color,
            strokeWidth,
            isEraser,
            prevX: lastPoint.current.x, // Include the last point
            prevY: lastPoint.current.y,
        });

        lastPoint.current = { x: offsetX, y: offsetY }; // Update the last point
    };

    const stopDrawing = () => {
        if (!isDrawing) return;
        ctxRef.current.closePath();
        setIsDrawing(false);
        setHistory((prev) => [...prev, canvasRef.current.toDataURL()]);
        setRedoStack([]);
        lastPoint.current = { x: 0, y: 0 }; // Reset the last point
    };

    const handleUndo = () => {
        if (history.length === 0) return;
        setRedoStack((prev) => [history[history.length - 1], ...prev]);
        setHistory((prev) => prev.slice(0, -1));
        redrawCanvas(history.slice(0, -1));
    };

    const handleRedo = () => {
        if (redoStack.length === 0) return;
        setHistory((prev) => [...prev, redoStack[0]]);
        setRedoStack((prev) => prev.slice(1));
        redrawCanvas([...history, redoStack[0]]);
    };

    const redrawCanvas = (imageHistory) => {
        const canvas = canvasRef.current;
        const ctx = ctxRef.current;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (imageHistory.length > 0) {
            const img = new Image();
            img.src = imageHistory[imageHistory.length - 1];
            img.onload = () => ctx.drawImage(img, 0, 0);
        }
    };

    const handleClear = () => {
        socket.emit("clear");
        ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        setHistory([]);
        setRedoStack([]);
    };

    return (
        <div className="App">
            <h1 className="text-3xl text-center my-4">Collaborative Whiteboard</h1>
            <div className="controls">
                <button onClick={() => setIsEraser(false)}><FaPen /> Pen</button>
                <button onClick={() => setIsEraser(true)}><FaEraser /> Eraser</button>
                <button onClick={handleClear}><FaTrash /> Clear</button>
                <button onClick={handleUndo}><FaUndo /> Undo</button>
                <button onClick={handleRedo}><FaRedo /> Redo</button>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
                <input type="range" min="1" max="20" value={strokeWidth} onChange={(e) => setStrokeWidth(e.target.value)} />
            </div>
            <canvas ref={canvasRef} onMouseDown={startDrawing} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} onMouseMove={draw} />
        </div>
    );
}

export default App;