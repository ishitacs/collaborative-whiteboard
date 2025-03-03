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

io.on("connection", (socket) => {
  console.log("New client connected: " + socket.id);

  const userColor = `hsl(${Math.floor(Math.random() * 360)}, 100%, 50%)`;

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
    userStrokes: userStrokes
  });

  socket.on("drawing", (data) => {
    socket.broadcast.emit("drawing", data);
  });

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

  socket.on("cursorMove", (data) => {
    socket.broadcast.emit("cursorMove", data);
  });

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

  socket.on("disconnect", () => {
    console.log("Client disconnected: " + socket.id);

    // Remove the user from the active users list
    users = users.filter((user) => user.id !== socket.id);

    // Keep the user's strokes in case they reconnect
    // We could add a cleanup mechanism to remove strokes from disconnected users
    // after a period of time if needed

    // Notify all clients about the disconnection
    io.emit("userDisconnected", socket.id);
  });
});

// Periodically clean up users list to ensure accuracy
setInterval(() => {
  const connectedSocketIds = Array.from(io.sockets.sockets.keys());

  // Remove any users that are no longer connected
  users = users.filter(user => connectedSocketIds.includes(user.id));

  // Optionally, also send updated user count to all clients
  io.emit("userCountUpdate", users.length);
}, 30000); // Check every 30 seconds

server.listen(process.env.PORT || 1000, () => {
  console.log(`Server running on port ${process.env.PORT || 1000}`);
});