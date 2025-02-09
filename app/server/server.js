// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mediasoup = require("mediasoup");
const app = express();
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

let rooms = {}; // Store rooms and participants
let mediasoupWorkers = [];
let mediaRouters = {}; // Media Routers for each room

// Mediasoup Worker initialization
async function createMediasoupWorker() {
  const worker = await mediasoup.createWorker();
  worker.on("died", (error) => {
    console.error("Mediasoup worker died:", error);
  });
  mediasoupWorkers.push(worker);
  return worker;
}

async function createRouter(worker) {
  const router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: "video",
        mimeType: "video/vp8",
        clockRate: 90000,
        payloadType: 101,
      },
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        payloadType: 100,
      },
    ],
  });
  return router;
}

wss.on("connection", (ws) => {
  let roomId = null;
  let userId = null;

  // Handle incoming messages from the client
  ws.on("message", async (message) => {
    const data = JSON.parse(message);
    const { type, roomId: _roomId, userId: _userId } = data;

    if (type === "join") {
      // Join a room
      roomId = _roomId;
      userId = _userId;

      // Create room and router if they don't exist
      if (!rooms[roomId]) {
        rooms[roomId] = [];
        const worker = await createMediasoupWorker();
        const router = await createRouter(worker);
        mediaRouters[roomId] = router;
      }

      rooms[roomId].push(ws);
      console.log(`Participant ${userId} joined room: ${roomId}`);

      // Notify all participants that a new participant joined
      broadcast(roomId, {
        type: "new-participant",
        userId,
        message: `${userId} has joined the room.`,
      });
    }

    if (type === "offer" || type === "answer" || type === "candidate") {
      // Forward signaling messages to all participants in the room
      broadcast(roomId, data);
    }

    if (type === "leave") {
      // Participant leaves the room
      rooms[roomId] = rooms[roomId].filter((client) => client !== ws);
      broadcast(roomId, {
        type: "participant-left",
        userId,
        message: `${userId} has left the room.`,
      });
    }
  });

  // Handle WebSocket close
  ws.on("close", () => {
    if (roomId) {
      console.log(`Participant ${userId} disconnected`);
      rooms[roomId] = rooms[roomId].filter((client) => client !== ws);
    }
  });
});

// Broadcast a message to all participants in a room
function broadcast(roomId, message) {
  const participants = rooms[roomId];
  if (participants) {
    participants.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }
}

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
