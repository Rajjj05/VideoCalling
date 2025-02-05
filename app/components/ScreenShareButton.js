// components/ScreenShareButton.js
import { useState } from "react";

export default function ScreenShareButton({ pc, localStream }) {
  const [isSharing, setIsSharing] = useState(false);

  const handleScreenShare = async () => {
    if (!navigator.mediaDevices.getDisplayMedia) {
      alert("Screen sharing is not supported on this device.");
      return;
    }

    try {
      if (!isSharing) {
        // Start screen sharing
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });

        const sender = pc.getSenders().find((s) => s.track.kind === "video");
        if (sender) {
          sender.replaceTrack(screenStream.getVideoTracks()[0]);
        }

        setIsSharing(true);

        screenStream.getVideoTracks()[0].onended = () => {
          stopScreenShare(sender);
        };
      }
    } catch (err) {
      console.error("Screen sharing failed:", err);
    }
  };

  const stopScreenShare = async (sender) => {
    if (localStream) {
      sender.replaceTrack(localStream.getVideoTracks()[0]);
    }
    setIsSharing(false);
  };

  return (
    <button
      onClick={handleScreenShare}
      className="px-4 py-2 bg-blue-600 text-white rounded"
    >
      {isSharing ? "Stop Sharing" : "Share Screen"}
    </button>
  );
}
