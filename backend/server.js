const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(express.static("public"));

let users = [];
let globalCanvasState = null;
let userStrokes = {};
let activeDrawingSessions = new Map(); // Track active drawing sessions per user

const getRandomColor = () => {
  return `hsl(${Math.floor(Math.random() * 360)}, 100%, 50%)`;
};

io.on("connection", (socket) => {
  console.log("New client connected: " + socket.id);

  const userColor = getRandomColor();

  if (!users.some(user => user.id === socket.id)) {
    users.push({ id: socket.id, color: userColor });
  }

  if (!userStrokes[socket.id]) {
    userStrokes[socket.id] = [];
  }

  io.emit("newUser", { id: socket.id, color: userColor });

  socket.emit("initialCanvas", {
    state: globalCanvasState,
    userStrokes: userStrokes,
    users: users
  });

  socket.on("cursorMove", (data) => {
    socket.broadcast.emit("cursorMove", data);
  });

  socket.on("drawing", (data) => {
    // Store the last point for this user's drawing session
    if (!activeDrawingSessions.has(socket.id)) {
      activeDrawingSessions.set(socket.id, {
        lastPoint: null,
        isDrawing: false
      });
    }

    const session = activeDrawingSessions.get(socket.id);

    // Only broadcast if this is a valid drawing point
    if (data.isNewStroke || session.lastPoint) {
      // Update session with current point
      session.lastPoint = { x: data.x, y: data.y };
      session.isDrawing = true;

      // Broadcast to other clients with the correct previous point
      socket.broadcast.emit("drawing", {
        ...data,
        sessionId: socket.id // Add session ID to prevent cross-session line connections
      });
    }
  });

  socket.on("strokeEnd", (data) => {
    // Clear the drawing session for this user
    if (activeDrawingSessions.has(socket.id)) {
      const session = activeDrawingSessions.get(socket.id);
      session.lastPoint = null;
      session.isDrawing = false;
    }

    globalCanvasState = data.globalState;

    if (!userStrokes[data.userId]) {
      userStrokes[data.userId] = [];
    }
    userStrokes[data.userId].push(data.stroke);

    socket.broadcast.emit("strokeEnd", data);
  });

  socket.on("clear", () => {
    globalCanvasState = null;
    userStrokes = {};
    activeDrawingSessions.clear();
    io.emit("clear");
  });

  socket.on("undo", (data) => {
    globalCanvasState = data.globalState;

    if (userStrokes[data.userId] && userStrokes[data.userId].length > 0) {
      userStrokes[data.userId].pop();
    }

    socket.broadcast.emit("undo", data);
  });

  socket.on("redo", (data) => {
    globalCanvasState = data.globalState;

    if (data.stroke && data.userId) {
      if (!userStrokes[data.userId]) {
        userStrokes[data.userId] = [];
      }
      userStrokes[data.userId].push(data.stroke);
    }

    socket.broadcast.emit("redo", data);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected: " + socket.id);
    users = users.filter((user) => user.id !== socket.id);
    activeDrawingSessions.delete(socket.id); // Clean up drawing session
    socket.broadcast.emit("userDisconnected", socket.id);
  });
});

// Periodic canvas state synchronization
setInterval(() => {
  if (users.length > 0 && globalCanvasState) {
    io.emit("canvasStateCheck", {
      timestamp: Date.now(),
      checksum: generateSimpleChecksum(globalCanvasState)
    });
  }
}, 10000);

function generateSimpleChecksum(str) {
  let hash = 0;
  if (!str) return hash;

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

server.listen(process.env.PORT || 1001, () => {
  console.log(`Server running on port ${process.env.PORT || 1001}`);
});