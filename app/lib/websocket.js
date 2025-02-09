let socket = null;
const WebSocket = require("ws");

let rooms = {}; // Store rooms and participants

// Start WebSocket server
const connectWebSocket = (server) => {
  const wss = new WebSocket.Server({ server });

  wss.on("connection", (ws) => {
    console.log("A new client connected");

    // Handle incoming messages from clients
    ws.on("message", (message) => {
      const data = JSON.parse(message);
      const { type, meetingId } = data;

      if (type === "join") {
        // Participant joins the meeting
        if (!rooms[meetingId]) {
          rooms[meetingId] = [];
        }
        rooms[meetingId].push(ws);
        console.log(`Participant joined room: ${meetingId}`);

        // Notify all participants in the room that a new participant has joined
        broadcast(meetingId, {
          type: "participant-joined",
          meetingId,
        });
      }

      if (type === "offer" || type === "answer" || type === "candidate") {
        // Forward signaling messages to all participants in the room
        broadcast(meetingId, data);
      }

      if (type === "leave") {
        // Participant leaves the meeting
        leaveRoom(meetingId, ws);
      }
    });

    // Handle WebSocket closing (participant leaving)
    ws.on("close", () => {
      console.log("A client disconnected");
      for (let meetingId in rooms) {
        leaveRoom(meetingId, ws);
      }
    });
  });

  console.log("WebSocket server started");
};

// Broadcast a message to all participants in a specific room
const broadcast = (meetingId, message) => {
  const participants = rooms[meetingId];
  if (participants) {
    participants.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }
};

// Remove a participant from a room
const leaveRoom = (meetingId, ws) => {
  const participants = rooms[meetingId];
  if (participants) {
    const index = participants.indexOf(ws);
    if (index !== -1) {
      participants.splice(index, 1);
      console.log("Participant left room:", meetingId);
      // Notify other participants
      broadcast(meetingId, { type: "participant-left", meetingId });
    }
  }
};

module.exports = { connectWebSocket };
