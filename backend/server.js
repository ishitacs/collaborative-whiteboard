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
let userStrokes = {}; // Store strokes for each user

// Generate a random HSL color
const getRandomColor = () => {
  return `hsl(${Math.floor(Math.random() * 360)}, 100%, 50%)`;
};

io.on("connection", (socket) => {
  console.log("New client connected: " + socket.id);

  const userColor = getRandomColor();

  // Add user to list if they don't already exist
  if (!users.some(user => user.id === socket.id)) {
    users.push({ id: socket.id, color: userColor });
  }

  // Initialize user strokes if needed
  if (!userStrokes[socket.id]) {
    userStrokes[socket.id] = [];
  }

  // Send the new user to all clients
  io.emit("newUser", { id: socket.id, color: userColor });

  // Send current canvas state and all user strokes to the new user
  socket.emit("initialCanvas", {
    state: globalCanvasState,
    userStrokes: userStrokes,
    users: users // Send current users list
  });

  // Handle cursor movement
  socket.on("cursorMove", (data) => {
    // Broadcast cursor position to all other clients
    socket.broadcast.emit("cursorMove", data);
  });

  // Handle drawing notifications
  socket.on("drawing", (data) => {
    // Broadcast immediately to all other clients
    socket.broadcast.emit("drawing", data);
  });

  // Handle stroke completion
  socket.on("strokeEnd", (data) => {
    // Update global canvas state
    globalCanvasState = data.globalState;

    // Store the stroke
    if (!userStrokes[data.userId]) {
      userStrokes[data.userId] = [];
    }
    userStrokes[data.userId].push(data.stroke);

    // Broadcast to other clients
    socket.broadcast.emit("strokeEnd", data);
  });

  // Handle canvas clearing
  socket.on("clear", () => {
    globalCanvasState = null;
    userStrokes = {};
    io.emit("clear");
  });

  // Handle undo
  socket.on("undo", (data) => {
    // Update global canvas state
    globalCanvasState = data.globalState;

    // Remove the last stroke from this user
    if (userStrokes[data.userId] && userStrokes[data.userId].length > 0) {
      userStrokes[data.userId].pop();
    }

    // Broadcast to other clients
    socket.broadcast.emit("undo", data);
  });

  // Handle redo
  socket.on("redo", (data) => {
    // Update global canvas state
    globalCanvasState = data.globalState;

    // Add the stroke back to the user's history
    if (data.stroke && data.userId) {
      if (!userStrokes[data.userId]) {
        userStrokes[data.userId] = [];
      }
      userStrokes[data.userId].push(data.stroke);
    }

    // Broadcast to other clients
    socket.broadcast.emit("redo", data);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("Client disconnected: " + socket.id);

    // Remove the user from the active users list
    users = users.filter((user) => user.id !== socket.id);

    // Notify other clients about the disconnection
    socket.broadcast.emit("userDisconnected", socket.id);

    // Keep the user's strokes in case they reconnect
  });
});

// Server heartbeat to ensure canvas state is synchronized
setInterval(() => {
  // If there are any active users, send a canvas update check
  if (users.length > 0 && globalCanvasState) {
    io.emit("canvasStateCheck", {
      timestamp: Date.now(),
      checksum: generateSimpleChecksum(globalCanvasState)
    });
  }
}, 10000); // Check every 10 seconds

// Simple checksum function for quick verification of canvas state
function generateSimpleChecksum(str) {
  let hash = 0;
  if (!str) return hash;

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return hash;
}

server.listen(process.env.PORT || 1000, () => {
  console.log(`Server running on port ${process.env.PORT || 1000}`);
});