let socket = null;
let isWebSocketOpen = false; // Flag to track if WebSocket is open

const connectWebSocket = () => {
  socket = new WebSocket("ws://localhost:8080"); // Ensure correct URL for your WebSocket server

  socket.onopen = () => {
    console.log("WebSocket connected");
    isWebSocketOpen = true; // Set the flag to true when connection is open
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleSignalingMessage(data);
  };

  socket.onclose = () => {
    console.log("WebSocket disconnected");
    isWebSocketOpen = false; // Reset the flag when connection is closed
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
};

const handleSignalingMessage = (data) => {
  console.log("Received signaling message:", data);
  // Handle incoming signaling message (e.g., offer, answer, candidate)
};

const sendSignalingMessage = (data) => {
  if (isWebSocketOpen) {
    socket.send(JSON.stringify(data)); // Send message only if WebSocket is open
  } else {
    console.error("WebSocket is not open.");
  }
};

export { connectWebSocket, sendSignalingMessage };
