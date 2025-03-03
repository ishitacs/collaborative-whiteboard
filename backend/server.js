// server.js
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
let canvasState = null;
// Track active drawing sessions
let drawingSessions = {};

io.on("connection", (socket) => {
  console.log("New client connected: " + socket.id);
  const userColor = `hsl(${Math.floor(Math.random() * 360)}, 100%, 50%)`;
  users.push({ id: socket.id, color: userColor });

  // Send the new user to all clients
  io.emit("newUser", { id: socket.id, color: userColor });

  // If we have a saved canvas state, send it to the new user
  if (canvasState) {
    socket.emit("canvasState", canvasState);
  }

  socket.on("drawing", (data) => {
    // Add the user ID to the data if it's not already there
    if (!data.userId) {
      data.userId = socket.id;
    }

    // Update drawing session tracking
    if (data.isNewPath) {
      drawingSessions[socket.id] = {
        lastX: data.x,
        lastY: data.y,
        isActive: true
      };
    } else if (drawingSessions[socket.id]) {
      drawingSessions[socket.id].lastX = data.x;
      drawingSessions[socket.id].lastY = data.y;
    }

    // Broadcast to all other clients
    socket.broadcast.emit("drawing", data);
  });

  socket.on("endPath", (userId) => {
    if (drawingSessions[userId]) {
      drawingSessions[userId].isActive = false;
    }
    socket.broadcast.emit("endPath", userId);
  });

  socket.on("cursorMove", (data) => {
    socket.broadcast.emit("cursorMove", data);
  });

  socket.on("settingsChanged", (settings) => {
    socket.broadcast.emit("settingsChanged", settings);
  });

  socket.on("clear", () => {
    canvasState = null;
    drawingSessions = {}; // Clear all drawing sessions
    io.emit("clear");
  });

  // Handlers for undo and redo
  socket.on("undo", (imageData) => {
    canvasState = imageData;
    socket.broadcast.emit("undo", imageData);
  });

  socket.on("redo", (imageData) => {
    canvasState = imageData;
    socket.broadcast.emit("redo", imageData);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected: " + socket.id);
    users = users.filter((user) => user.id !== socket.id);

    // Clean up drawing sessions
    if (drawingSessions[socket.id]) {
      delete drawingSessions[socket.id];
    }

    io.emit("userDisconnected", socket.id);
  });
});

server.listen(process.env.PORT || 6969, () => {
  console.log(`Server running on port ${process.env.PORT || 6969}`);
});