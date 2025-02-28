const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

let canvasState = null;
let users = {};

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Send the current canvas state to the newly connected user
  if (canvasState) {
    socket.emit("load-canvas", canvasState);
  }

  // Assign a random color to the new user
  users[socket.id] = { color: getRandomColor() };

  // Notify others of the new user
  io.emit("user-list", users);

  // Handle drawing event
  socket.on("draw", (data) => {
    socket.broadcast.emit("draw", data);
  });

  // Handle eraser event
  socket.on("erase", (data) => {
    socket.broadcast.emit("erase", data);
  });

  // Handle cursor movement
  socket.on("cursor-move", (data) => {
    users[socket.id].x = data.x;
    users[socket.id].y = data.y;
    io.emit("user-cursor", users);
  });

  // Handle clearing the canvas
  socket.on("clear", () => {
    canvasState = null;
    io.emit("clear-canvas");
  });

  // Handle undo/redo actions
  socket.on("undo", (data) => {
    canvasState = data;
    io.emit("undo-action", data);
  });

  socket.on("redo", (data) => {
    canvasState = data;
    io.emit("redo-action", data);
  });

  // Handle disconnect event
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    delete users[socket.id];
    io.emit("user-list", users);
  });
});

function getRandomColor() {
  return `#${Math.floor(Math.random() * 16777215).toString(16)}`;
}

const PORT = process.env.PORT || 5173;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});