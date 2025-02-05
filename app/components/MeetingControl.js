// components/MeetingControls.js
import { useState } from "react";

export default function MeetingControls({
  meetingId,
  userId,
  isHost,
  onLeave,
  onEnd,
  localStream,
}) {
  const [leaving, setLeaving] = useState(false);

  const handleLeaveMeeting = () => {
    setLeaving(true);

    // Stop all tracks in the local media stream
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }

    onLeave();
  };

  return (
    <div className="flex justify-center gap-4 p-4">
      {/* Leave Meeting Button */}
      <button
        onClick={handleLeaveMeeting}
        className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        disabled={leaving}
      >
        {leaving ? "Leaving..." : "Leave Meeting"}
      </button>

      {/* Host Only: End Meeting Button */}
      {isHost && (
        <button
          onClick={onEnd}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          End Meeting
        </button>
      )}
    </div>
  );
}
