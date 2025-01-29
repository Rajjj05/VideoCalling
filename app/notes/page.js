"use client";
import { useState, useEffect } from "react"
import { Input } from "../../components/ui/input"
import { ProtectedRoute } from "../components/ProtectedRoute"

export default function Notes() {
  const [notes, setNotes] = useState([])
  const [searchTerm, setSearchTerm] = useState("")

  useEffect(() => {
    // Fetch notes from Firebase here
  }, [])

  const filteredNotes = notes.filter((note) => note.content.toLowerCase().includes(searchTerm.toLowerCase()))

  return (
    (<ProtectedRoute>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Meeting Notes</h1>
        <Input
          type="text"
          placeholder="Search notes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="mb-4" />
        <div className="space-y-4">
          {filteredNotes.map((note, index) => (
            <div key={index} className="p-4 border rounded-lg">
              <h2 className="text-xl font-semibold mb-2">{note.meetingTitle}</h2>
              <p className="text-gray-600 mb-2">{new Date(note.date).toLocaleString()}</p>
              <p>{note.content}</p>
            </div>
          ))}
        </div>
      </div>
    </ProtectedRoute>)
  );
}

