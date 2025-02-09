"use client"; // Ensure this component runs on the client side

import { useState, useEffect } from "react";
import { useParams } from "next/navigation"; // Correct for App Router
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import VideoCall from "../../components/VideoCall"; // Import the VideoCall component

export default function MeetingPage() {
  const { id: meetingId } = useParams(); // Access the meetingId from the URL using useParams
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [meeting, setMeeting] = useState(null);

  useEffect(() => {
    if (!meetingId) return; // Only fetch if meetingId is available

    const fetchMeeting = async () => {
      try {
        console.log("Fetching meeting with meetingId:", meetingId); // Log for debugging

        const meetingsRef = collection(db, "meetings");
        const q = query(meetingsRef, where("meetingId", "==", meetingId));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const meetingData = querySnapshot.docs[0].data();
          console.log("Fetched meeting data:", meetingData); // Log fetched data
          setMeeting(meetingData);
          if (meetingData.status === "ended") {
            setError("This meeting has ended.");
          } else {
            setIsLoading(false);
          }
        } else {
          setError("Meeting not found.");
        }
      } catch (err) {
        console.error("Error fetching meeting data:", err);
        setError("Error fetching meeting data.");
      }
    };

    fetchMeeting(); // Fetch meeting data when meetingId is available
  }, [meetingId]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return (
      <div>
        <p>{error}</p>
        <button onClick={() => router.push("/meetings")}>
          Back to Meetings
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2>Meeting: {meeting.roomName}</h2>
      <VideoCall meetingId={meetingId} isHost={meeting.hostId === user.uid} />
    </div>
  );
}
