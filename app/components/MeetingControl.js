// components/MeetingControls.js
import { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import { doc, updateDoc, getDoc } from "firebase/firestore";

export default function MeetingControls({
  meetingId,
  userId,
  isHost,
  onLeave,
  onEnd,
}) {
  const [meetingEnded, setMeetingEnded] = useState(false);

  useEffect(() => {
    const checkMeetingStatus = async () => {
      const meetingRef = doc(db, "meetings", meetingId);
      const meetingSnap = await getDoc(meetingRef);
      if (meetingSnap.exists() && meetingSnap.data().status === "ended") {
        setMeetingEnded(true);
      }
    };

    checkMeetingStatus();
  }, [meetingId]);

  const handleLeaveMeeting = () => {
    onLeave();
  };

  const handleEndMeeting = async () => {
    try {
      const meetingRef = doc(db, "meetings", meetingId);
      await updateDoc(meetingRef, { status: "ended" });
      onEnd();
    } catch (err) {
      console.error("Error ending meeting:", err);
    }
  };

  if (meetingEnded) {
    return (
      <div className="bg-red-100 text-red-700 p-4 rounded-md text-center">
        <p>Meeting has ended.</p>
      </div>
    );
  }

  return (
    <div className="flex justify-center gap-4 p-4">
      {/* Leave Meeting Button */}
      <button
        onClick={handleLeaveMeeting}
        className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
      >
        Leave Meeting
      </button>

      {/* Host Only: End Meeting Button */}
      {isHost && (
        <button
          onClick={handleEndMeeting}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          End Meeting
        </button>
      )}
    </div>
  );
}
