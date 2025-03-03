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
    const [connectedUsers, setConnectedUsers] = useState([]);
    const [cursors, setCursors] = useState({});

    // Refs
    const canvasRef = useRef(null);
    const ctxRef = useRef(null);
    const lastPoint = useRef({ x: 0, y: 0 });
    const userColor = useRef(null);
    const userId = useRef(null);
    const isTouchDevice = useRef(false);

    // Drawing history tracking
    const drawCommandsRef = useRef([]); // All drawing commands from all users
    const myDrawCommandsRef = useRef([]); // Only current user's commands
    const redoStackRef = useRef([]); // Redo stack for current user
    const lastCommandIdRef = useRef(0); // Used to generate unique command IDs

    useEffect(() => {
        const canvas = canvasRef.current;
        canvas.width = window.innerWidth * 0.9;
        canvas.height = window.innerHeight * 0.7;
        const ctx = canvas.getContext("2d");
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctxRef.current = ctx;

        // Check if device supports touch
        isTouchDevice.current = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        // Handle window resize
        const handleResize = () => {
            // Save current dimensions
            const prevWidth = canvas.width;
            const prevHeight = canvas.height;

            // Update dimensions
            canvas.width = window.innerWidth * 0.9;
            canvas.height = window.innerHeight * 0.7;

            // Restore context properties
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            // Re-render all commands with adjusted scale
            const scaleX = canvas.width / prevWidth;
            const scaleY = canvas.height / prevHeight;
            redrawCanvas(drawCommandsRef.current, scaleX, scaleY);
        };

        window.addEventListener('resize', handleResize);

        // Listen for new user connections
        socket.on("newUser", (user) => {
            setConnectedUsers(prev => [...prev, user]);
            if (user.id === socket.id) {
                userColor.current = user.color;
                userId.current = user.id;
            }
        });

        // Listen for drawing history
        socket.on("drawingHistory", (commands) => {
            if (commands && commands.length) {
                drawCommandsRef.current = commands;
                redrawCanvas(commands);
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

        // Listen for new drawing commands
        socket.on("drawCommand", (command) => {
            const updatedCommands = [...drawCommandsRef.current, command];
            drawCommandsRef.current = updatedCommands;
            executeDrawCommand(command);
        });

        // Listen for undo commands from other users
        socket.on("undoCommand", (data) => {
            const { userId, commandId } = data;

            // Find and remove the command
            const updatedCommands = drawCommandsRef.current.filter(cmd =>
                !(cmd.userId === userId && cmd.id === commandId)
            );

            // Update our command history
            drawCommandsRef.current = updatedCommands;

            // Redraw the canvas completely
            redrawCanvas(updatedCommands);
        });

        // Listen for redo commands from other users
        socket.on("redoCommand", (command) => {
            const updatedCommands = [...drawCommandsRef.current, command];
            drawCommandsRef.current = updatedCommands;
            executeDrawCommand(command);
        });

        socket.on("clear", () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawCommandsRef.current = [];
            myDrawCommandsRef.current = [];
            redoStackRef.current = [];
        });

        // Request drawing history when connecting
        socket.emit("requestDrawingHistory");

        // Cleanup
        return () => {
            socket.off("newUser");
            socket.off("drawingHistory");
            socket.off("userDisconnected");
            socket.off("cursorMove");
            socket.off("drawCommand");
            socket.off("undoCommand");
            socket.off("redoCommand");
            socket.off("clear");
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    // Execute a single draw command
    const executeDrawCommand = (command) => {
        const ctx = ctxRef.current;

        if (command.type === 'draw') {
            const { x, y, prevX, prevY, color, strokeWidth, isEraser } = command;

            ctx.beginPath();
            ctx.strokeStyle = isEraser ? "#FFFFFF" : color;
            ctx.lineWidth = strokeWidth;

            if (prevX !== null && prevY !== null) {
                ctx.moveTo(prevX, prevY);
                ctx.lineTo(x, y);
            } else {
                ctx.moveTo(x, y);
                ctx.lineTo(x, y);
            }

            ctx.stroke();
        }
    };

    // Redraw the entire canvas using all commands
    const redrawCanvas = (commands, scaleX = 1, scaleY = 1) => {
        const ctx = ctxRef.current;
        const canvas = canvasRef.current;

        // Clear the canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Redraw all commands
        if (commands && commands.length) {
            // Apply scale transform if needed
            if (scaleX !== 1 || scaleY !== 1) {
                ctx.save();
                ctx.scale(scaleX, scaleY);
            }

            commands.forEach(command => {
                executeDrawCommand(command);
            });

            // Restore transform if scaling was applied
            if (scaleX !== 1 || scaleY !== 1) {
                ctx.restore();
            }
        }
    };

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
        setIsDrawing(true);
        lastPoint.current = { x: offsetX, y: offsetY };
    };

    // Touch event handlers
    const handleTouchStart = (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = canvasRef.current.getBoundingClientRect();
        const offsetX = touch.clientX - rect.left;
        const offsetY = touch.clientY - rect.top;

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

        // Create a draw command
        const commandId = ++lastCommandIdRef.current;
        const drawCommand = {
            id: commandId,
            type: 'draw',
            userId: socket.id,
            x: offsetX,
            y: offsetY,
            prevX: lastPoint.current.x,
            prevY: lastPoint.current.y,
            color: isEraser ? "#FFFFFF" : color,
            strokeWidth,
            isEraser
        };

        // Add to local command history
        drawCommandsRef.current.push(drawCommand);
        myDrawCommandsRef.current.push(drawCommand);

        // Execute the command locally
        executeDrawCommand(drawCommand);

        // Send to server
        socket.emit("drawCommand", drawCommand);

        // Update last point
        lastPoint.current = { x: offsetX, y: offsetY };
    };

    const stopDrawing = () => {
        setIsDrawing(false);
        lastPoint.current = { x: 0, y: 0 };

        // Clear redo stack when a new drawing is made
        if (myDrawCommandsRef.current.length > 0) {
            redoStackRef.current = [];
        }
    };

    const handleUndo = () => {
        // Get the most recent command from this user
        const userCommands = myDrawCommandsRef.current;

        if (userCommands.length === 0) return;

        // Get the last command
        const lastCommand = userCommands[userCommands.length - 1];

        // Remove it from my commands
        myDrawCommandsRef.current = userCommands.slice(0, -1);

        // Add to redo stack
        redoStackRef.current.push(lastCommand);

        // Tell server to undo this command
        socket.emit("undoCommand", {
            userId: lastCommand.userId,
            commandId: lastCommand.id
        });

        // Remove from all commands
        drawCommandsRef.current = drawCommandsRef.current.filter(cmd =>
            !(cmd.userId === lastCommand.userId && cmd.id === lastCommand.id)
        );

        // Redraw canvas
        redrawCanvas(drawCommandsRef.current);
    };

    const handleRedo = () => {
        // Get the most recent undone command
        if (redoStackRef.current.length === 0) return;

        const commandToRedo = redoStackRef.current.pop();

        // Add back to my commands
        myDrawCommandsRef.current.push(commandToRedo);

        // Add to all commands
        drawCommandsRef.current.push(commandToRedo);

        // Send to server
        socket.emit("redoCommand", commandToRedo);

        // Execute command locally
        executeDrawCommand(commandToRedo);
    };

    const handleClear = () => {
        socket.emit("clear");
        ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        drawCommandsRef.current = [];
        myDrawCommandsRef.current = [];
        redoStackRef.current = [];
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