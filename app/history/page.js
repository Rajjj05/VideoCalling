"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { getUserMeetingHistory } from "../lib/firestore";
import { useAuth } from "../contexts/AuthContext";

export default function History() {
  const { user } = useAuth();
  const [meetings, setMeetings] = useState([]);

  useEffect(() => {
    async function fetchHistory() {
      if (user) {
        try {
          const historyDocs = await getUserMeetingHistory(user.uid);
          setMeetings(historyDocs);
        } catch (error) {
          console.error("Error fetching meeting history:", error);
        }
      }
    }
    fetchHistory();
  }, [user]);

  return (
    <ProtectedRoute>
      <div className="max-w-4xl mx-auto p-4">
        <h1 className="text-3xl font-bold mb-8">Meeting History</h1>
        <div className="space-y-4">
          {meetings.length > 0 ? (
            meetings.map((meeting, index) => (
              <div key={index} className="p-4 border rounded-lg">
                {/* Using meetingId as the title; update if you store a proper title */}
                <h2 className="text-xl font-semibold mb-2">
                  {meeting.meetingId}
                </h2>
                <p className="text-gray-600 mb-2">
                  {new Date(meeting.joinedAt.seconds * 1000).toLocaleString()} -
                  Duration: {(meeting.duration / 60).toFixed(0)} minutes
                </p>
                {/* If you have participants info, replace the placeholder below */}
                <p className="mb-2">Participants: N/A</p>
                <Link
                  href={`/notes/${meeting.id}`}
                  className="text-blue-500 hover:underline"
                >
                  View Notes
                </Link>
              </div>
            ))
          ) : (
            <p>No meeting history available.</p>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
