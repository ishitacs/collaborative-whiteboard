const express = require("express");
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serving the frontend (optional)
app.use(express.static('public'));

let users = [];  // To store the users and their colors

// Handle new client connections
io.on("connection", (socket) => {
  console.log("New client connected: " + socket.id);

  // Assign random color to the user (can be improved later to manage colors more effectively)
  const userColor = `hsl(${Math.floor(Math.random() * 360)}, 100%, 50%)`;
  users.push({ id: socket.id, color: userColor });

  // Broadcast to all users when a new user joins
  io.emit("newUser", { id: socket.id, color: userColor });

  // Listen to drawing events from users
  socket.on("drawing", (data) => {
    // Broadcast drawing data to all users
    socket.broadcast.emit("drawing", data);
  });

  // Listen to cursor position updates
  socket.on("cursorMove", (data) => {
    // Broadcast cursor position update
    socket.broadcast.emit("cursorMove", data);
  });

  // Listen for settings change (color and strokeWidth)
  socket.on("settingsChanged", (settings) => {
    // Broadcast settings change to all users
    socket.broadcast.emit("settingsChanged", settings);
  });

  // Handle clear event (clear canvas for all users)
  socket.on("clear", () => {
    io.emit("clear");  // Broadcast clear event to all users
  });

  // Handle user disconnection
  socket.on("disconnect", () => {
    console.log("Client disconnected: " + socket.id);
    users = users.filter(user => user.id !== socket.id);
    io.emit("userDisconnected", socket.id);  // Broadcast user disconnection
  });
});

// Start the server
server.listen(6969, () => {
  console.log("Server running on port 6969");
});
