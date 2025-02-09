// server/server.js
const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 8080 }); // Set your WebSocket server to listen on port 8080

// Store connected clients
const clients = [];

wss.on("connection", (ws) => {
  console.log("New client connected");

  // Store client in the clients array
  clients.push(ws);

  // When a message is received from a client, relay it to all other clients
  ws.on("message", (message) => {
    const data = JSON.parse(message);
    console.log("Received signaling message:", data);

    // Broadcast the message to all clients except the sender
    clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  });

  // Handle the client closing the connection
  ws.on("close", () => {
    const index = clients.indexOf(ws);
    if (index !== -1) {
      clients.splice(index, 1); // Remove client from the list when disconnected
    }
    console.log("Client disconnected");
  });
});

// Server startup message
console.log("WebSocket server running on ws://localhost:8000");
