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
    const [connectedUsers, setConnectedUsers] = useState([]);
    const [cursors, setCursors] = useState({});
    const canvasRef = useRef(null);
    const ctxRef = useRef(null);
    const lastPoint = useRef({ x: 0, y: 0 }); // Track the last point
    const userColor = useRef(null);
    const isTouchDevice = useRef(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        canvas.width = window.innerWidth * 0.9;
        canvas.height = window.innerHeight * 0.7;
        const ctx = canvas.getContext("2d");
        ctx.lineCap = "round";
        ctx.lineJoin = "round"; // Ensures smooth lines
        ctxRef.current = ctx;

        // Check if device supports touch
        isTouchDevice.current = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        // Handle window resize
        const handleResize = () => {
            const imageData = canvas.toDataURL();
            canvas.width = window.innerWidth * 0.9;
            canvas.height = window.innerHeight * 0.7;

            // Restore context properties
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            // Restore drawing
            const img = new Image();
            img.onload = () => ctx.drawImage(img, 0, 0);
            img.src = imageData;
        };

        window.addEventListener('resize', handleResize);

        // Listen for new user connections
        socket.on("newUser", (user) => {
            setConnectedUsers(prev => [...prev, user]);
            if (user.id === socket.id) {
                userColor.current = user.color;
            }
        });

        // Listen for user disconnections
        socket.on("userDisconnected", (userId) => {
            setConnectedUsers(prev => prev.filter(user => user.id !== userId));
            setCursors(prev => {
                const newCursors = { ...prev };
                delete newCursors[userId];
                return newCursors;
            });
        });

        // Listen for cursor movements from other users
        socket.on("cursorMove", (data) => {
            setCursors(prev => ({
                ...prev,
                [data.userId]: { x: data.x, y: data.y, color: data.color }
            }));
        });

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

        // NEW: Listen for undo and redo events
        socket.on("undo", (lastImageData) => {
            setHistory(prev => prev.slice(0, -1));
            setRedoStack(prev => [lastImageData, ...prev]);
            redrawCanvas(lastImageData);
        });

        socket.on("redo", (imageData) => {
            setHistory(prev => [...prev, imageData]);
            setRedoStack(prev => prev.slice(1));
            redrawCanvas(imageData);
        });

        // Cleanup
        return () => {
            socket.off("newUser");
            socket.off("userDisconnected");
            socket.off("cursorMove");
            socket.off("drawing");
            socket.off("clear");
            socket.off("undo");
            socket.off("redo");
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    // Mouse movement tracking for cursor position
    const handleMouseMove = (e) => {
        if (isTouchDevice.current) return;

        const { offsetX, offsetY } = e.nativeEvent;

        // Emit cursor position to others
        socket.emit("cursorMove", {
            userId: socket.id,
            x: offsetX,
            y: offsetY,
            color: userColor.current || color
        });

        // Update for drawing if needed
        if (isDrawing) {
            draw(offsetX, offsetY);
        }
    };

    const startDrawing = ({ nativeEvent }) => {
        if (isTouchDevice.current) return;

        const { offsetX, offsetY } = nativeEvent;
        ctxRef.current.beginPath();
        ctxRef.current.moveTo(offsetX, offsetY);
        setIsDrawing(true);
        lastPoint.current = { x: offsetX, y: offsetY }; // Store the starting point
    };

    // NEW: Touch event handlers
    const handleTouchStart = (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = canvasRef.current.getBoundingClientRect();
        const offsetX = touch.clientX - rect.left;
        const offsetY = touch.clientY - rect.top;

        ctxRef.current.beginPath();
        ctxRef.current.moveTo(offsetX, offsetY);
        setIsDrawing(true);
        lastPoint.current = { x: offsetX, y: offsetY };
    };

    const handleTouchMove = (e) => {
        e.preventDefault();
        if (!isDrawing) return;

        const touch = e.touches[0];
        const rect = canvasRef.current.getBoundingClientRect();
        const offsetX = touch.clientX - rect.left;
        const offsetY = touch.clientY - rect.top;

        draw(offsetX, offsetY);
    };

    const handleTouchEnd = (e) => {
        e.preventDefault();
        stopDrawing();
    };

    const draw = (offsetX, offsetY) => {
        if (!isDrawing) return;

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

        // Save the canvas state after drawing
        const newState = canvasRef.current.toDataURL();
        setHistory((prev) => [...prev, newState]);
        setRedoStack([]);
        lastPoint.current = { x: 0, y: 0 }; // Reset the last point
    };

    const handleUndo = () => {
        if (history.length === 0) return;

        const lastState = history[history.length - 1];
        const newHistory = history.slice(0, -1);

        // Get the previous state or create blank if none exists
        const previousState = newHistory.length > 0
            ? newHistory[newHistory.length - 1]
            : null;

        // Emit undo event with the previous state
        socket.emit("undo", previousState);

        // Update local state
        setRedoStack((prev) => [lastState, ...prev]);
        setHistory(newHistory);
        redrawCanvas(previousState);
    };

    const handleRedo = () => {
        if (redoStack.length === 0) return;

        const stateToRestore = redoStack[0];

        // Emit redo event
        socket.emit("redo", stateToRestore);

        // Update local state
        setHistory((prev) => [...prev, stateToRestore]);
        setRedoStack((prev) => prev.slice(1));
        redrawCanvas(stateToRestore);
    };

    const redrawCanvas = (imageData) => {
        const canvas = canvasRef.current;
        const ctx = ctxRef.current;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (imageData) {
            const img = new Image();
            img.src = imageData;
            img.onload = () => ctx.drawImage(img, 0, 0);
        }
    };

    const handleClear = () => {
        socket.emit("clear");
        ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        setHistory([]);
        setRedoStack([]);
    };

    // Render other users' cursors
    const renderCursors = () => {
        return Object.entries(cursors).map(([userId, cursor]) => (
            <div
                key={userId}
                className="cursor"
                style={{
                    left: `${cursor.x}px`,
                    top: `${cursor.y}px`,
                    backgroundColor: cursor.color
                }}
            >
                <div className="cursor-point"></div>
                <div className="cursor-label" style={{ backgroundColor: cursor.color }}>
                    User {userId.slice(0, 4)}
                </div>
            </div>
        ));
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
                <div className="user-count">
                    <span>{connectedUsers.length} users connected</span>
                </div>
            </div>
            <div className="canvas-container" style={{ position: 'relative' }}>
                <canvas
                    ref={canvasRef}
                    onMouseDown={startDrawing}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onMouseMove={handleMouseMove}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                />
                {renderCursors()}
            </div>
        </div>
    );
}

export default App;