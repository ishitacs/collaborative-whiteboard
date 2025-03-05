import React, { useState, useEffect, useRef } from "react";
import { FaPen, FaEraser, FaTrash, FaUndo, FaRedo } from "react-icons/fa";
import { io } from "socket.io-client";
import "./App.css";

const socket = io("https://collaborative-whiteboard-fsg8.onrender.com");
//const socket = io("http://localhost:1000");

function App() {
    const [isDrawing, setIsDrawing] = useState(false);
    const [color, setColor] = useState("#000000");
    const [strokeWidth, setStrokeWidth] = useState(5);
    const [isEraser, setIsEraser] = useState(false);
    const [history, setHistory] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [canUndoRedo, setCanUndoRedo] = useState({ canUndo: false, canRedo: false });
    const [activeUsers, setActiveUsers] = useState([]); // Track active users
    const canvasRef = useRef(null);
    const ctxRef = useRef(null);
    const lastPoint = useRef({ x: 0, y: 0 });
    const userColor = useRef(null);
    const isTouchDevice = useRef(false);
    const currentStroke = useRef([]);
    const userId = useRef(null);
    const globalCanvasState = useRef(null);
    const userStrokes = useRef({});
    const cursorsRef = useRef({}); // Store cursor positions of all users

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
        canvas.width = window.innerWidth * 0.85; // Adjusted to account for side toolbar
        canvas.height = window.innerHeight * 0.9;
        const ctx = canvas.getContext("2d");
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctxRef.current = ctx;
        userStrokes.current = {};

        // Check if device supports touch
        isTouchDevice.current = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        // Set custom cursor based on current tool
        updateCursor();

        // Create cursor overlay for other users
        createCursorOverlay();

        // Handle window resize
        const handleResize = () => {
            const imageData = canvas.toDataURL();
            canvas.width = window.innerWidth * 0.85;
            canvas.height = window.innerHeight * 0.9;

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
            if (user.id === socket.id) {
                userColor.current = user.color;
                userId.current = user.id;

                // Initialize user strokes
                if (!userStrokes.current[socket.id]) {
                    userStrokes.current[socket.id] = [];
                }
            }

            // Update active users list
            setActiveUsers(prev => {
                if (!prev.some(u => u.id === user.id)) {
                    return [...prev, user];
                }
                return prev;
            });
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

            // Initialize active users
            if (data.users) {
                setActiveUsers(data.users);
            }
        });

        // Listen for cursor movement from other users
        socket.on("cursorMove", (data) => {
            if (data.userId !== socket.id) {
                cursorsRef.current[data.userId] = {
                    x: data.x,
                    y: data.y,
                    color: data.color,
                    isDrawing: data.isDrawing
                };
                updateCursors();
            }
        });

        // Listen for drawing from other users
        socket.on("drawing", (data) => {
            const { x, y, color, strokeWidth, isEraser, prevX, prevY, userId: drawingUserId, isNewStroke } = data;

            // Update cursor position for this user
            if (drawingUserId !== socket.id) {
                cursorsRef.current[drawingUserId] = {
                    x, y, color, isDrawing: true
                };
                updateCursors();

                ctxRef.current.beginPath();
                ctxRef.current.strokeStyle = isEraser ? "#FFFFFF" : color;
                ctxRef.current.lineWidth = strokeWidth;

                if (isNewStroke || prevX === null || prevY === null) {
                    // Start a new path if this is the beginning of a stroke
                    ctxRef.current.moveTo(x, y);
                    ctxRef.current.lineTo(x, y);
                } else {
                    // Continue the existing stroke
                    ctxRef.current.moveTo(prevX, prevY);
                    ctxRef.current.lineTo(x, y);
                }
                ctxRef.current.stroke();
            }
        });

        // Listen for strokeEnd from other users
        socket.on("strokeEnd", (data) => {
            // Add the stroke to the appropriate user's history
            if (!userStrokes.current[data.userId]) {
                userStrokes.current[data.userId] = [];
            }

            userStrokes.current[data.userId].push(data.stroke);
            globalCanvasState.current = data.globalState;

            // Update cursor state to not drawing
            if (cursorsRef.current[data.userId]) {
                cursorsRef.current[data.userId].isDrawing = false;
                updateCursors();
            }
        });

        socket.on("clear", () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            userStrokes.current = {};
            setHistory([]);
            setRedoStack([]);
            globalCanvasState.current = null;
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

        // User disconnect
        socket.on("userDisconnected", (userId) => {
            // Remove from active users
            setActiveUsers(prev => prev.filter(user => user.id !== userId));

            // Remove cursor
            delete cursorsRef.current[userId];
            updateCursors();
        });

        // Cleanup
        return () => {
            socket.off("newUser");
            socket.off("initialCanvas");
            socket.off("userDisconnected");
            socket.off("drawing");
            socket.off("strokeEnd");
            socket.off("clear");
            socket.off("undo");
            socket.off("redo");
            socket.off("cursorMove");
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    // Create cursor overlay element
    const createCursorOverlay = () => {
        if (!document.getElementById('cursor-overlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'cursor-overlay';
            overlay.style.position = 'absolute';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.pointerEvents = 'none';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.zIndex = '1000';

            // Add to canvas container
            const canvasContainer = document.querySelector('.canvas-container');
            canvasContainer.style.position = 'relative';
            canvasContainer.appendChild(overlay);
        }
    };

    // Update cursor positions of all users
    const updateCursors = () => {
        const overlay = document.getElementById('cursor-overlay');
        if (!overlay) return;

        // Clear existing cursors
        overlay.innerHTML = '';

        // Add cursor for each user
        Object.keys(cursorsRef.current).forEach(uid => {
            const cursorData = cursorsRef.current[uid];
            if (!cursorData) return;

            const cursor = document.createElement('div');
            cursor.className = 'user-cursor';
            cursor.style.position = 'absolute';
            cursor.style.left = `${cursorData.x}px`;
            cursor.style.top = `${cursorData.y}px`;
            cursor.style.pointerEvents = 'none';

            // Draw cursor with different style based on if user is drawing
            if (cursorData.isDrawing) {
                cursor.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 16 16">
                        <circle cx="8" cy="8" r="6" fill="${cursorData.color}" stroke="white" stroke-width="1" />
                    </svg>
                `;
            } else {
                cursor.innerHTML = `
                    <svg width="24" height="24" viewBox="0 0 24 24">
                        <path d="M12 1L3 21h6l1.5-4h3l1.5 4h6L12 1z" fill="${cursorData.color}" stroke="white" stroke-width="1" />
                    </svg>
                `;
            }

            overlay.appendChild(cursor);
        });
    };

    // Update cursor based on current tool
    const updateCursor = () => {
        if (!canvasRef.current) return;

        if (isEraser) {
            canvasRef.current.style.cursor = "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"black\" stroke-width=\"2\"><path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\"/><path d=\"M15.5 2.5a2.121 2.121 0 0 1 3 3L12 12l-4 1 1-4 6.5-6.5z\"/></svg>') 0 0, auto";
        } else {
            canvasRef.current.style.cursor = "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"black\" stroke-width=\"2\"><path d=\"M12 19l7-7 3 3-7 7-3-3z\"/><path d=\"M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z\"/><path d=\"M2 2l7.586 7.586\"/><circle cx=\"11\" cy=\"11\" r=\"2\"/></svg>') 0 0, auto";
        }
    };

    // Effect to update cursor when tool changes
    useEffect(() => {
        updateCursor();
    }, [isEraser]);

    // Track cursor movement on the canvas
    const trackCursorMovement = (e) => {
        const { offsetX, offsetY } = getCoordinates(e);

        // Broadcast cursor position to other users
        socket.emit("cursorMove", {
            userId: socket.id,
            x: offsetX,
            y: offsetY,
            color: userColor.current || color,
            isDrawing: isDrawing
        });
    };

    // Get coordinates from mouse or touch event
    const getCoordinates = (event) => {
        if (event.touches) {
            // Touch event
            const touch = event.touches[0];
            const rect = canvasRef.current.getBoundingClientRect();
            return {
                offsetX: touch.clientX - rect.left,
                offsetY: touch.clientY - rect.top
            };
        } else {
            // Mouse event
            return {
                offsetX: event.nativeEvent.offsetX,
                offsetY: event.nativeEvent.offsetY
            };
        }
    };

    const startDrawing = (event) => {
        if (isTouchDevice.current && !event.touches) return;

        const { offsetX, offsetY } = getCoordinates(event);

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

        // Update cursor state
        socket.emit("cursorMove", {
            userId: socket.id,
            x: offsetX,
            y: offsetY,
            color: userColor.current || color,
            isDrawing: true
        });

        // Emit the first point of the stroke with isNewStroke flag
        socket.emit("drawing", {
            x: offsetX,
            y: offsetY,
            color,
            strokeWidth,
            isEraser,
            prevX: null,
            prevY: null,
            userId: socket.id,
            isNewStroke: true
        });
    };

    // Touch event handlers
    const handleTouchStart = (e) => {
        e.preventDefault();
        startDrawing(e);
    };

    const handleTouchMove = (e) => {
        e.preventDefault();
        if (!isDrawing) return;

        const { offsetX, offsetY } = getCoordinates(e);
        draw(offsetX, offsetY);
    };

    const handleTouchEnd = (e) => {
        e.preventDefault();
        stopDrawing();
    };

    const handleMouseMove = (e) => {
        if (isTouchDevice.current) return;

        trackCursorMovement(e);

        const { offsetX, offsetY } = getCoordinates(e);

        // Update for drawing if needed
        if (isDrawing) {
            draw(offsetX, offsetY);
        }
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

        // Calculate if this is the first point in a new stroke
        const isNewStroke = currentStroke.current.length === 1;

        // Broadcast the drawing to other clients
        socket.emit("drawing", {
            x: offsetX,
            y: offsetY,
            color,
            strokeWidth,
            isEraser,
            prevX: lastPoint.current.x,
            prevY: lastPoint.current.y,
            userId: socket.id,
            isNewStroke: isNewStroke
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

            // Update cursor state to not drawing
            socket.emit("cursorMove", {
                userId: socket.id,
                x: lastPoint.current.x,
                y: lastPoint.current.y,
                color: userColor.current || color,
                isDrawing: false
            });
        }

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

    return (
        <div className="App">
            <h1>Collaborative Whiteboard</h1>
            <div className="main-content">
                <div className="vertical-toolbar">
                    <button
                        className={`tool-btn ${!isEraser ? 'active' : ''}`}
                        onClick={() => setIsEraser(false)}
                        title="Pen"
                    >
                        <FaPen />
                    </button>
                    <button
                        className={`tool-btn ${isEraser ? 'active' : ''}`}
                        onClick={() => setIsEraser(true)}
                        title="Eraser"
                    >
                        <FaEraser />
                    </button>
                    <button
                        className="tool-btn"
                        onClick={handleClear}
                        title="Clear All"
                    >
                        <FaTrash />
                    </button>
                    <button
                        className="tool-btn"
                        onClick={handleUndo}
                        disabled={!canUndoRedo.canUndo}
                        style={{ opacity: canUndoRedo.canUndo ? 1 : 0.5 }}
                        title="Undo"
                    >
                        <FaUndo />
                    </button>
                    <button
                        className="tool-btn"
                        onClick={handleRedo}
                        disabled={!canUndoRedo.canRedo}
                        style={{ opacity: canUndoRedo.canRedo ? 1 : 0.5 }}
                        title="Redo"
                    >
                        <FaRedo />
                    </button>
                    <div className="color-picker">
                        <label>Color</label>
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
                </div>
            </div>
        </div>
    );
}

export default App;