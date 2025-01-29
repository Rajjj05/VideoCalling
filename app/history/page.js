"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ProtectedRoute } from "../components/ProtectedRoute"

export default function History() {
  const [meetings, setMeetings] = useState([])

  useEffect(() => {
    // Fetch meeting history from Firebase here
  }, [])

  return (
    (<ProtectedRoute>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Meeting History</h1>
        <div className="space-y-4">
          {meetings.map((meeting, index) => (
            <div key={index} className="p-4 border rounded-lg">
              <h2 className="text-xl font-semibold mb-2">{meeting.title}</h2>
              <p className="text-gray-600 mb-2">
                {new Date(meeting.date).toLocaleString()} - Duration: {meeting.duration} minutes
              </p>
              <p className="mb-2">Participants: {meeting.participants.join(", ")}</p>
              <Link href={`/notes/${meeting.id}`} className="text-blue-500 hover:underline">
                View Notes
              </Link>
            </div>
          ))}
        </div>
      </div>
    </ProtectedRoute>)
  );
}

