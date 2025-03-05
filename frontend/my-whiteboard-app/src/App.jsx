import React, { useState, useEffect, useRef } from "react";
import { FaPen, FaEraser, FaTrash, FaUndo, FaRedo } from "react-icons/fa";
import { io } from "socket.io-client";
import "./App.css";

//const socket = io("https://collaborative-whiteboard-fsg8.onrender.com");
const socket = io("http://localhost:1000");

function App() {
    const [isDrawing, setIsDrawing] = useState(false);
    const [color, setColor] = useState("#000000");
    const [strokeWidth, setStrokeWidth] = useState(5);
    const [isEraser, setIsEraser] = useState(false);
    const [history, setHistory] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [connectedUsers, setConnectedUsers] = useState([]);
    const [cursors, setCursors] = useState({});
    const [canUndoRedo, setCanUndoRedo] = useState({ canUndo: false, canRedo: false });
    const canvasRef = useRef(null);
    const ctxRef = useRef(null);
    const lastPoint = useRef({ x: 0, y: 0 });
    const userColor = useRef(null);
    const isTouchDevice = useRef(false);
    const currentStroke = useRef([]);
    const userId = useRef(null);
    const globalCanvasState = useRef(null);
    const userStrokes = useRef({});
    const drawingLock = useRef(false); // Add lock to prevent concurrent drawing conflicts

    // Maintain separate history per user
    useEffect(() => {
        // Update undo/redo button state
        setCanUndoRedo({
            canUndo: userStrokes.current[socket.id]?.length > 0,
            canRedo: redoStack.length > 0 && redoStack.some(action => action.userId === socket.id)
        });
    }, [history, redoStack]);

    useEffect(() => {
        const canvas = canvasRef.current;
        canvas.width = window.innerWidth * 0.9;
        canvas.height = window.innerHeight * 0.7;
        const ctx = canvas.getContext("2d");
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctxRef.current = ctx;
        userStrokes.current = {};

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
            setConnectedUsers(prev => {
                // Ensure we don't add the same user twice
                if (prev.some(u => u.id === user.id)) {
                    return prev;
                }
                return [...prev, user];
            });

            if (user.id === socket.id) {
                userColor.current = user.color;
                userId.current = user.id;

                // Initialize user strokes
                if (!userStrokes.current[socket.id]) {
                    userStrokes.current[socket.id] = [];
                }
            }
        });

        // Listen for initial canvas state
        socket.on("initialCanvas", (data) => {
            if (data.state) {
                loadCanvasState(data.state);
                globalCanvasState.current = data.state;
            }

            // Initialize user strokes from server data
            if (data.userStrokes) {
                userStrokes.current = data.userStrokes;
            }
        });

        // Listen for user disconnections
        socket.on("userDisconnected", (disconnectedUserId) => {
            setConnectedUsers(prev => prev.filter(user => user.id !== disconnectedUserId));
            setCursors(prev => {
                const newCursors = { ...prev };
                delete newCursors[disconnectedUserId];
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

        // Listen for drawing from other users
        socket.on("drawing", (data) => {
            const { x, y, color, strokeWidth, isEraser, prevX, prevY, userId: drawingUserId } = data;

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

        // Listen for draw lock to prevent conflicts
        socket.on("drawLock", (data) => {
            if (data.userId !== socket.id) {
                drawingLock.current = data.locked;
            }
        });

        // Listen for stroke end from other users
        socket.on("strokeEnd", (data) => {
            // Add the stroke to the appropriate user's history
            if (!userStrokes.current[data.userId]) {
                userStrokes.current[data.userId] = [];
            }

            userStrokes.current[data.userId].push(data.stroke);
            globalCanvasState.current = data.globalState;

            // Release draw lock
            drawingLock.current = false;
        });

        socket.on("clear", () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            userStrokes.current = {};
            setHistory([]);
            setRedoStack([]);
            globalCanvasState.current = null;
        });

        // Listen for user count updates
        socket.on("userCountUpdate", (count) => {
            // Check if we need to update the connected users count
            if (connectedUsers.length !== count) {
                socket.emit("requestUserList");
            }
        });

        socket.on("userListUpdate", (userList) => {
            setConnectedUsers(userList);
        });

        // Listen for undo from other users
        socket.on("undo", (data) => {
            // Update the global canvas state
            globalCanvasState.current = data.globalState;

            // Update the strokes for the user who did the undo
            if (userStrokes.current[data.userId]) {
                userStrokes.current[data.userId] = userStrokes.current[data.userId].slice(0, -1);
            }

            // Reload the canvas with the new state
            loadCanvasState(data.globalState);
        });

        // Listen for redo from other users
        socket.on("redo", (data) => {
            // Update the global canvas state
            globalCanvasState.current = data.globalState;

            // Add the stroke back to the user's history
            if (data.stroke && data.userId) {
                if (!userStrokes.current[data.userId]) {
                    userStrokes.current[data.userId] = [];
                }
                userStrokes.current[data.userId].push(data.stroke);
            }

            // Reload the canvas with the new state
            loadCanvasState(data.globalState);
        });

        // Cleanup
        return () => {
            socket.off("newUser");
            socket.off("initialCanvas");
            socket.off("userDisconnected");
            socket.off("cursorMove");
            socket.off("drawing");
            socket.off("strokeEnd");
            socket.off("clear");
            socket.off("undo");
            socket.off("redo");
            socket.off("drawLock");
            socket.off("userCountUpdate");
            socket.off("userListUpdate");
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
        if (isTouchDevice.current || drawingLock.current) return;

        const { offsetX, offsetY } = nativeEvent;

        // Acquire drawing lock
        drawingLock.current = true;
        socket.emit("drawLock", { userId: socket.id, locked: true });

        ctxRef.current.beginPath();
        ctxRef.current.moveTo(offsetX, offsetY);
        setIsDrawing(true);
        lastPoint.current = { x: offsetX, y: offsetY };

        // Reset the current stroke
        currentStroke.current = [{
            x: offsetX,
            y: offsetY,
            color,
            strokeWidth,
            isEraser,
            userId: socket.id
        }];
    };

    // Touch event handlers
    const handleTouchStart = (e) => {
        e.preventDefault();
        if (drawingLock.current) return;

        const touch = e.touches[0];
        const rect = canvasRef.current.getBoundingClientRect();
        const offsetX = touch.clientX - rect.left;
        const offsetY = touch.clientY - rect.top;

        // Acquire drawing lock
        drawingLock.current = true;
        socket.emit("drawLock", { userId: socket.id, locked: true });

        ctxRef.current.beginPath();
        ctxRef.current.moveTo(offsetX, offsetY);
        setIsDrawing(true);
        lastPoint.current = { x: offsetX, y: offsetY };

        // Reset the current stroke
        currentStroke.current = [{
            x: offsetX,
            y: offsetY,
            color,
            strokeWidth,
            isEraser,
            userId: socket.id
        }];
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

        // Add the point to the current stroke
        currentStroke.current.push({
            x: offsetX,
            y: offsetY,
            color,
            strokeWidth,
            isEraser,
            userId: socket.id
        });

        // Broadcast the drawing to other clients
        socket.emit("drawing", {
            x: offsetX,
            y: offsetY,
            color,
            strokeWidth,
            isEraser,
            prevX: lastPoint.current.x,
            prevY: lastPoint.current.y,
            userId: socket.id
        });

        lastPoint.current = { x: offsetX, y: offsetY };
    };

    const stopDrawing = () => {
        if (!isDrawing) return;
        ctxRef.current.closePath();
        setIsDrawing(false);

        if (currentStroke.current.length > 0) {
            // Save the stroke to user's history
            if (!userStrokes.current[socket.id]) {
                userStrokes.current[socket.id] = [];
            }

            const currentStrokeData = [...currentStroke.current];
            userStrokes.current[socket.id].push(currentStrokeData);

            // Reset any redos
            setRedoStack([]);

            // Save the global canvas state
            const currentCanvasState = canvasRef.current.toDataURL();
            globalCanvasState.current = currentCanvasState;

            // Notify other clients that this stroke is complete
            socket.emit("strokeEnd", {
                userId: socket.id,
                stroke: currentStrokeData,
                globalState: currentCanvasState
            });
        }

        // Release drawing lock
        drawingLock.current = false;
        socket.emit("drawLock", { userId: socket.id, locked: false });

        lastPoint.current = { x: 0, y: 0 };
        currentStroke.current = [];
    };

    // Load a specific canvas state
    const loadCanvasState = (imageData) => {
        if (!imageData) {
            ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            return;
        }

        const img = new Image();
        img.src = imageData;
        img.onload = () => {
            ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            ctxRef.current.drawImage(img, 0, 0);
        };
    };

    const handleUndo = () => {
        if (!userStrokes.current[socket.id] || userStrokes.current[socket.id].length === 0) {
            return;
        }

        // Get the stroke to undo
        const strokeToUndo = userStrokes.current[socket.id].pop();

        // Add to redo stack
        setRedoStack(prev => [{
            stroke: strokeToUndo,
            userId: socket.id
        }, ...prev]);

        // Redraw the canvas without this user's last stroke
        recreateCanvas();

        // Get the new canvas state
        const newCanvasState = canvasRef.current.toDataURL();
        globalCanvasState.current = newCanvasState;

        // Notify other clients
        socket.emit("undo", {
            userId: socket.id,
            globalState: newCanvasState
        });
    };

    const handleRedo = () => {
        const redoIndex = redoStack.findIndex(item => item.userId === socket.id);
        if (redoIndex === -1) return;

        // Get the stroke to redo
        const itemToRedo = redoStack[redoIndex];

        // Add the stroke back to the user's history
        if (!userStrokes.current[socket.id]) {
            userStrokes.current[socket.id] = [];
        }
        userStrokes.current[socket.id].push(itemToRedo.stroke);

        // Remove from redo stack
        setRedoStack(prev => {
            const newStack = [...prev];
            newStack.splice(redoIndex, 1);
            return newStack;
        });

        // Redraw the canvas with this stroke
        recreateCanvas();

        // Get the new canvas state
        const newCanvasState = canvasRef.current.toDataURL();
        globalCanvasState.current = newCanvasState;

        // Notify other clients
        socket.emit("redo", {
            userId: socket.id,
            stroke: itemToRedo.stroke,
            globalState: newCanvasState
        });
    };

    // Recreate the canvas from all stored strokes
    const recreateCanvas = () => {
        ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

        // Redraw strokes from all users
        Object.keys(userStrokes.current).forEach(uid => {
            userStrokes.current[uid].forEach(stroke => {
                if (stroke && stroke.length > 0) {
                    drawStroke(stroke);
                }
            });
        });
    };

    // Helper to draw a stroke
    const drawStroke = (stroke) => {
        if (!stroke || stroke.length === 0) return;

        const ctx = ctxRef.current;

        for (let i = 0; i < stroke.length; i++) {
            const point = stroke[i];

            if (!point) continue; // Skip undefined points

            ctx.beginPath();
            ctx.strokeStyle = point.isEraser ? "#FFFFFF" : point.color;
            ctx.lineWidth = point.strokeWidth;

            if (i === 0) {
                // First point in stroke
                ctx.moveTo(point.x, point.y);
                ctx.lineTo(point.x, point.y);
            } else {
                // Connect to previous point
                const prevPoint = stroke[i - 1];
                if (prevPoint) {
                    ctx.moveTo(prevPoint.x, prevPoint.y);
                    ctx.lineTo(point.x, point.y);
                }
            }

            ctx.stroke();
        }
    };

    const handleClear = () => {
        socket.emit("clear");
        ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        userStrokes.current = {};
        setHistory([]);
        setRedoStack([]);
        globalCanvasState.current = null;
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
            <h1>Collaborative Whiteboard</h1>
            <div className="controls">
                <button
                    className={`tool-btn ${!isEraser ? 'active' : ''}`}
                    onClick={() => setIsEraser(false)}
                >
                    <FaPen /> Pen
                </button>
                <button
                    className={`tool-btn ${isEraser ? 'active' : ''}`}
                    onClick={() => setIsEraser(true)}
                >
                    <FaEraser /> Eraser
                </button>
                <button className="tool-btn" onClick={handleClear}>
                    <FaTrash /> Clear
                </button>
                <button
                    className="tool-btn"
                    onClick={handleUndo}
                    disabled={!canUndoRedo.canUndo}
                    style={{ opacity: canUndoRedo.canUndo ? 1 : 0.5 }}
                >
                    <FaUndo /> Undo
                </button>
                <button
                    className="tool-btn"
                    onClick={handleRedo}
                    disabled={!canUndoRedo.canRedo}
                    style={{ opacity: canUndoRedo.canRedo ? 1 : 0.5 }}
                >
                    <FaRedo /> Redo
                </button>
                <div className="color-picker">
                    <label>Color:</label>
                    <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
                </div>
                <div className="stroke-width">
                    <label>Size: {strokeWidth}px</label>
                    <input
                        type="range"
                        min="1"
                        max="20"
                        value={strokeWidth}
                        onChange={(e) => setStrokeWidth(e.target.value)}
                    />
                </div>
                <div className="user-count">
                    <span>{connectedUsers.length} users connected</span>
                </div>
            </div>
            <div className="canvas-container">
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