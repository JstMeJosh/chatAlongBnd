import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import connectDB from "./config/db.js";
import Message from "./models/Message.js";

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ["http://localhost:5173", process.env.CLIENT_URL], methods: ["GET", "POST"] },
});

// In-memory user tracking: { socketId: { username, room } }
const users = {};

// Helper: Broadcast updated user list to a specific room
const broadcastUserList = (room) => {
  const roomUsers = Object.values(users)
    .filter((u) => u.room === room)
    .map((u) => u.username);
  io.in(room).emit("user_list", [...new Set(roomUsers)]);
};

app.get("/messages/:room", async (req, res) => {
  try {
    const { room } = req.params;
    const messages = await Message.find({ room }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

io.on("connection", (socket) => {
  socket.on("join_room", (data) => {
    const { room, username } = data;
    if (room && username) {
      socket.join(room);
      users[socket.id] = { username, room };

      broadcastUserList(room);

      socket.to(room).emit("receive_message", {
        author: "System",
        message: `${username} joined 👋`,
        room,
        timestamp: new Date(),
      });
    }
  });

  socket.on("send_message", async (data) => {
    try {
      await Message.create({
        room: data.room,
        username: data.author,
        message: data.message,
      });
      socket.to(data.room).emit("receive_message", data);
    } catch (error) {
      console.error(error);
    }
  });

  socket.on("leave_room", (data) => {
    const { room, username } = data;
    if (room) {
      delete users[socket.id];
      broadcastUserList(room);
      socket.leave(room);
      socket.to(room).emit("receive_message", {
        author: "System",
        message: `${username} left 🚪`,
        room,
        timestamp: new Date(),
      });
    }
  });

  socket.on("disconnect", () => {
    if (users[socket.id]) {
      const { room, username } = users[socket.id];
      delete users[socket.id];
      broadcastUserList(room);
      socket.to(room).emit("receive_message", {
        author: "System",
        message: `${username} disconnected ❌`,
        room,
        timestamp: new Date(),
      });
    }
  });
});

const PORT = process.env.PORT || 3001;
connectDB().then(() => {
  server.listen(PORT, () => console.log(`Server on ${PORT} ✅`));
});