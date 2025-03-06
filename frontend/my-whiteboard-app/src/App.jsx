import React, { useState, useEffect, useRef } from "react";
import { FaPen, FaEraser, FaTrash, FaUndo, FaRedo } from "react-icons/fa";
import { io } from "socket.io-client";
import "./App.css";

//const socket = io("https://collaborative-whiteboard-fsg8.onrender.com");
const socket = io("http://localhost:1001");

function App() {
    const [isDrawing, setIsDrawing] = useState(false);
    const [color, setColor] = useState("#000000");
    const [strokeWidth, setStrokeWidth] = useState(5);
    const [isEraser, setIsEraser] = useState(false);
    const [history, setHistory] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [canUndoRedo, setCanUndoRedo] = useState({ canUndo: false, canRedo: false });
    const [activeUsers, setActiveUsers] = useState([]);
    const canvasRef = useRef(null);
    const ctxRef = useRef(null);
    const lastPoint = useRef({ x: 0, y: 0 });
    const userColor = useRef(null);
    const isTouchDevice = useRef(false);
    const currentStroke = useRef([]);
    const userId = useRef(null);
    const globalCanvasState = useRef(null);
    const userStrokes = useRef({});
    const cursorsRef = useRef({});
    const userLastPoints = useRef({}); // Track last point for each user

    useEffect(() => {
        setCanUndoRedo({
            canUndo: userStrokes.current[socket.id]?.length > 0,
            canRedo: redoStack.length > 0 && redoStack.some(action => action.userId === socket.id)
        });
    }, [history, redoStack]);

    useEffect(() => {
        const canvas = canvasRef.current;
        canvas.width = window.innerWidth * 0.85;
        canvas.height = window.innerHeight * 0.9;
        const ctx = canvas.getContext("2d");
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctxRef.current = ctx;
        userStrokes.current = {};
        userLastPoints.current = {}; // Initialize last points storage

        isTouchDevice.current = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        updateCursor();
        createCursorOverlay();

        const handleResize = () => {
            const imageData = canvas.toDataURL();
            canvas.width = window.innerWidth * 0.85;
            canvas.height = window.innerHeight * 0.9;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            const img = new Image();
            img.onload = () => ctx.drawImage(img, 0, 0);
            img.src = imageData;
        };

        window.addEventListener('resize', handleResize);

        socket.on("newUser", (user) => {
            if (user.id === socket.id) {
                userColor.current = user.color;
                userId.current = user.id;
                if (!userStrokes.current[socket.id]) {
                    userStrokes.current[socket.id] = [];
                }
                userLastPoints.current[socket.id] = null; // Initialize last point for new user
            }
            setActiveUsers(prev => {
                if (!prev.some(u => u.id === user.id)) {
                    return [...prev, user];
                }
                return prev;
            });
        });

        socket.on("initialCanvas", (data) => {
            if (data.state) {
                loadCanvasState(data.state);
                globalCanvasState.current = data.state;
            }
            if (data.userStrokes) {
                userStrokes.current = data.userStrokes;
            }
            if (data.users) {
                setActiveUsers(data.users);
                // Initialize last points for all users
                data.users.forEach(user => {
                    userLastPoints.current[user.id] = null;
                });
            }
        });

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

        socket.on("drawing", (data) => {
            const { x, y, color, strokeWidth, isEraser, userId: drawingUserId, isNewStroke } = data;

            if (drawingUserId !== socket.id) {
                cursorsRef.current[drawingUserId] = {
                    x, y, color, isDrawing: true
                };
                updateCursors();

                ctxRef.current.beginPath();

                if (isNewStroke || !userLastPoints.current[drawingUserId]) {
                    // Start new stroke
                    ctxRef.current.moveTo(x, y);
                    userLastPoints.current[drawingUserId] = { x, y };
                } else {
                    // Continue from last point
                    const lastPoint = userLastPoints.current[drawingUserId];
                    ctxRef.current.moveTo(lastPoint.x, lastPoint.y);
                    ctxRef.current.lineTo(x, y);
                }

                ctxRef.current.strokeStyle = isEraser ? "#FFFFFF" : color;
                ctxRef.current.lineWidth = strokeWidth;
                ctxRef.current.stroke();

                // Update last point for this user
                userLastPoints.current[drawingUserId] = { x, y };
            }
        });

        socket.on("strokeEnd", (data) => {
            if (!userStrokes.current[data.userId]) {
                userStrokes.current[data.userId] = [];
            }
            userStrokes.current[data.userId].push(data.stroke);
            globalCanvasState.current = data.globalState;

            // Reset last point for the user who finished their stroke
            userLastPoints.current[data.userId] = null;

            if (cursorsRef.current[data.userId]) {
                cursorsRef.current[data.userId].isDrawing = false;
                updateCursors();
            }
        });

        socket.on("clear", () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            userStrokes.current = {};
            userLastPoints.current = {}; // Reset all last points
            setHistory([]);
            setRedoStack([]);
            globalCanvasState.current = null;
        });

        socket.on("undo", (data) => {
            globalCanvasState.current = data.globalState;
            if (userStrokes.current[data.userId]) {
                userStrokes.current[data.userId] = userStrokes.current[data.userId].slice(0, -1);
            }
            loadCanvasState(data.globalState);
            userLastPoints.current[data.userId] = null; // Reset last point for the user
        });

        socket.on("redo", (data) => {
            globalCanvasState.current = data.globalState;
            if (data.stroke && data.userId) {
                if (!userStrokes.current[data.userId]) {
                    userStrokes.current[data.userId] = [];
                }
                userStrokes.current[data.userId].push(data.stroke);
            }
            loadCanvasState(data.globalState);
        });

        socket.on("userDisconnected", (userId) => {
            setActiveUsers(prev => prev.filter(user => user.id !== userId));
            delete cursorsRef.current[userId];
            delete userLastPoints.current[userId]; // Clean up last point for disconnected user
            updateCursors();
        });

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
            const canvasContainer = document.querySelector('.canvas-container');
            canvasContainer.style.position = 'relative';
            canvasContainer.appendChild(overlay);
        }
    };

    const updateCursors = () => {
        const overlay = document.getElementById('cursor-overlay');
        if (!overlay) return;

        overlay.innerHTML = '';

        Object.keys(cursorsRef.current).forEach(uid => {
            const cursorData = cursorsRef.current[uid];
            if (!cursorData) return;

            const cursor = document.createElement('div');
            cursor.className = 'user-cursor';
            cursor.style.position = 'absolute';
            cursor.style.left = `${cursorData.x}px`;
            cursor.style.top = `${cursorData.y}px`;
            cursor.style.pointerEvents = 'none';

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

    const updateCursor = () => {
        if (!canvasRef.current) return;

        if (isEraser) {
            canvasRef.current.style.cursor = "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"black\" stroke-width=\"2\"><path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\"/><path d=\"M15.5 2.5a2.121 2.121 0 0 1 3 3L12 12l-4 1 1-4 6.5-6.5z\"/></svg>') 0 0, auto";
        } else {
            canvasRef.current.style.cursor = "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"black\" stroke-width=\"2\"><path d=\"M12 19l7-7 3 3-7 7-3-3z\"/><path d=\"M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z\"/><path d=\"M2 2l7.586 7.586\"/><circle cx=\"11\" cy=\"11\" r=\"2\"/></svg>') 0 0, auto";
        }
    };

    useEffect(() => {
        updateCursor();
    }, [isEraser]);

    const trackCursorMovement = (e) => {
        const { offsetX, offsetY } = getCoordinates(e);
        socket.emit("cursorMove", {
            userId: socket.id,
            x: offsetX,
            y: offsetY,
            color: userColor.current || color,
            isDrawing: isDrawing
        });
    };

    const getCoordinates = (event) => {
        if (event.touches) {
            const touch = event.touches[0];
            const rect = canvasRef.current.getBoundingClientRect();
            return {
                offsetX: touch.clientX - rect.left,
                offsetY: touch.clientY - rect.top
            };
        } else {
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
        userLastPoints.current[socket.id] = { x: offsetX, y: offsetY };

        currentStroke.current = [{
            x: offsetX,
            y: offsetY,
            color,
            strokeWidth,
            isEraser,
            userId: socket.id
        }];

        socket.emit("cursorMove", {
            userId: socket.id,
            x: offsetX,
            y: offsetY,
            color: userColor.current || color,
            isDrawing: true
        });

        socket.emit("drawing", {
            x: offsetX,
            y: offsetY,
            color,
            strokeWidth,
            isEraser,
            userId: socket.id,
            isNewStroke: true
        });
    };

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
        if (isDrawing) {
            const { offsetX, offsetY } = getCoordinates(e);
            draw(offsetX, offsetY);
        }
    };

    const draw = (offsetX, offsetY) => {
        if (!isDrawing) return;

        ctxRef.current.beginPath();
        ctxRef.current.moveTo(lastPoint.current.x, lastPoint.current.y);
        ctxRef.current.lineTo(offsetX, offsetY);
        ctxRef.current.strokeStyle = isEraser ? "#FFFFFF" : color;
        ctxRef.current.lineWidth = strokeWidth;
        ctxRef.current.stroke();

        currentStroke.current.push({
            x: offsetX,
            y: offsetY,
            color,
            strokeWidth,
            isEraser,
            userId: socket.id
        });

        socket.emit("drawing", {
            x: offsetX,
            y: offsetY,
            color,
            strokeWidth,
            isEraser,
            userId: socket.id,
            isNewStroke: false
        });

        lastPoint.current = { x: offsetX, y: offsetY };
        userLastPoints.current[socket.id] = { x: offsetX, y: offsetY };
    };

    const stopDrawing = () => {
        if (!isDrawing) return;
        ctxRef.current.closePath();
        setIsDrawing(false);

        if (currentStroke.current.length > 0) {
            if (!userStrokes.current[socket.id]) {
                userStrokes.current[socket.id] = [];
            }

            const currentStrokeData = [...currentStroke.current];
            userStrokes.current[socket.id].push(currentStrokeData);
            setRedoStack([]);

            const currentCanvasState = canvasRef.current.toDataURL();
            globalCanvasState.current = currentCanvasState;

            socket.emit("strokeEnd", {
                userId: socket.id,
                stroke: currentStrokeData,
                globalState: currentCanvasState
            });

            socket.emit("cursorMove", {
                userId: socket.id,
                x: lastPoint.current.x,
                y: lastPoint.current.y,
                color: userColor.current || color,
                isDrawing: false
            });
        }

        lastPoint.current = { x: 0, y: 0 };
        userLastPoints.current[socket.id] = null;
        currentStroke.current = [];
    };

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

        const strokeToUndo = userStrokes.current[socket.id].pop();
        setRedoStack(prev => [{
            stroke: strokeToUndo,
            userId: socket.id
        }, ...prev]);

        recreateCanvas();

        const newCanvasState = canvasRef.current.toDataURL();
        globalCanvasState.current = newCanvasState;

        socket.emit("undo", {
            userId: socket.id,
            globalState: newCanvasState
        });
    };

    const handleRedo = () => {
        const redoIndex = redoStack.findIndex(item => item.userId === socket.id);
        if (redoIndex === -1) return;

        const itemToRedo = redoStack[redoIndex];

        if (!userStrokes.current[socket.id]) {
            userStrokes.current[socket.id] = [];
        }
        userStrokes.current[socket.id].push(itemToRedo.stroke);

        setRedoStack(prev => {
            const newStack = [...prev];
            newStack.splice(redoIndex, 1);
            return newStack;
        });

        recreateCanvas();

        const newCanvasState = canvasRef.current.toDataURL();
        globalCanvasState.current = newCanvasState;

        socket.emit("redo", {
            userId: socket.id,
            stroke: itemToRedo.stroke,
            globalState: newCanvasState
        });
    };

    const recreateCanvas = () => {
        ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

        Object.keys(userStrokes.current).forEach(uid => {
            userStrokes.current[uid].forEach(stroke => {
                if (stroke && stroke.length > 0) {
                    drawStroke(stroke);
                }
            });
        });
    };

    const drawStroke = (stroke) => {
        if (!stroke || stroke.length === 0) return;

        const ctx = ctxRef.current;

        for (let i = 0; i < stroke.length; i++) {
            const point = stroke[i];
            if (!point) continue;

            ctx.beginPath();
            ctx.strokeStyle = point.isEraser ? "#FFFFFF" : point.color;
            ctx.lineWidth = point.strokeWidth;

            if (i === 0) {
                ctx.moveTo(point.x, point.y);
                ctx.lineTo(point.x, point.y);
            } else {
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
        userLastPoints.current = {};
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