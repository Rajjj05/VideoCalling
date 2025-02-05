// components/ScreenShareButton.js
import { useState } from "react";

export default function ScreenShareButton({ pc, localStream }) {
  const [isSharing, setIsSharing] = useState(false);
  let screenStream = null;
  let originalTrack = null;

  const startScreenShare = async () => {
    try {
      // Ask user to select a screen, window, or tab to share
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: false, // Set to true if system audio sharing is needed
      });

      setIsSharing(true);
      const screenTrack = screenStream.getVideoTracks()[0];

      // Store the original video track before replacing it
      originalTrack = localStream.getVideoTracks()[0];

      // Replace video track in peer connection
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) sender.replaceTrack(screenTrack);

      // Stop screen sharing when user presses "Stop Sharing"
      screenTrack.onended = () => stopScreenShare();
    } catch (error) {
      console.error("Error starting screen share:", error);
    }
  };

  const stopScreenShare = () => {
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
    }

    setIsSharing(false);

    // Restore the original webcam video track
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (sender && originalTrack) {
      sender.replaceTrack(originalTrack);
    }
  };

  return (
    <button
      onClick={isSharing ? stopScreenShare : startScreenShare}
      className={`px-4 py-2 rounded text-white ${
        isSharing
          ? "bg-red-600 hover:bg-red-700"
          : "bg-blue-600 hover:bg-blue-700"
      }`}
    >
      {isSharing ? "Stop Sharing" : "Share Screen"}
    </button>
  );
}
