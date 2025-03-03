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

io.on("connection", (socket) => {
  console.log("New client connected: " + socket.id);

  const userColor = `hsl(${Math.floor(Math.random() * 360)}, 100%, 50%)`;
  users.push({ id: socket.id, color: userColor });

  io.emit("newUser", { id: socket.id, color: userColor });

  socket.on("drawing", (data) => {
    socket.broadcast.emit("drawing", data);
  });

  socket.on("cursorMove", (data) => {
    socket.broadcast.emit("cursorMove", data);
  });

  socket.on("settingsChanged", (settings) => {
    socket.broadcast.emit("settingsChanged", settings);
  });

  socket.on("clear", () => {
    io.emit("clear");
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected: " + socket.id);
    users = users.filter((user) => user.id !== socket.id);
    io.emit("userDisconnected", socket.id);
  });
});

server.listen(6969, () => {
  console.log("Server running on port 6969");
});