"use client";
import { useState } from "react";
import { saveNote } from "../lib/firestore"; // Adjust the path as needed

export default function MeetingNotes({ meetingId, userId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const handleSave = async () => {
    if (!noteContent.trim()) return;
    try {
      setSaving(true);
      // Call your saveNote function to save the note with meetingId, userId, and content
      await saveNote(meetingId, userId, noteContent);
      setNoteContent("");
      setMessage("Note saved!");
      // Clear the success message after 3 seconds
      setTimeout(() => setMessage(""), 3000);
    } catch (err) {
      console.error("Error saving note:", err);
      setMessage("Error saving note");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Floating button to toggle the notes panel */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 bg-blue-600 text-white p-3 rounded-full shadow-lg z-50"
        title="Meeting Notes"
      >
        📝
      </button>

      {/* Overlay panel for taking notes */}
      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-80 p-4 relative">
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-2 right-2 text-gray-600 hover:text-gray-800"
              title="Close"
            >
              ✖
            </button>
            <h2 className="text-xl font-bold mb-2">Meeting Notes</h2>
            <textarea
              className="w-full h-32 p-2 border rounded mb-2"
              placeholder="Type your note here..."
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700"
            >
              {saving ? "Saving..." : "Save Note"}
            </button>
            {message && <p className="mt-2 text-sm text-gray-700">{message}</p>}
          </div>
        </div>
      )}
    </>
  );
}
