"use client";

import { useState, useEffect } from "react";
import { Input } from "../../components/ui/input";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { getUserNotes } from "../lib/firestore";
import { useAuth } from "../contexts/AuthContext";

export default function Notes() {
  const { user } = useAuth();
  const [notes, setNotes] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    async function fetchNotes() {
      if (user) {
        try {
          const userNotes = await getUserNotes(user.uid);
          setNotes(userNotes);
        } catch (error) {
          console.error("Error fetching notes:", error);
        }
      }
    }
    fetchNotes();
  }, [user]);

  const filteredNotes = notes.filter((note) =>
    note.content.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <ProtectedRoute>
      <div className="max-w-4xl mx-auto p-4">
        <h1 className="text-3xl font-bold mb-8">Meeting Notes</h1>
        <Input
          type="text"
          placeholder="Search notes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="mb-4"
        />
        <div className="space-y-4">
          {filteredNotes.length > 0 ? (
            filteredNotes.map((note, index) => (
              <div key={index} className="p-4 border rounded-lg">
                {/* Display the meeting ID as the title; replace with a meeting title if available */}
                <h2 className="text-xl font-semibold mb-2">{note.meetingId}</h2>
                {/* Convert Firestore Timestamp to a JS Date object */}
                <p className="text-gray-600 mb-2">
                  {new Date(note.createdAt.seconds * 1000).toLocaleString()}
                </p>
                <p>{note.content}</p>
              </div>
            ))
          ) : (
            <p>No notes found.</p>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
