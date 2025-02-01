"use client"

import { useState } from "react"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { ProtectedRoute } from "../components/ProtectedRoute"
import { useRouter } from "next/navigation"
import { useAuth } from "../contexts/AuthContext"
import { db } from "../lib/firebase"
import { collection, addDoc, doc, getDoc, getDocs, query, where, updateDoc } from "firebase/firestore"
import { v4 as uuidv4 } from "uuid"

export default function Meetings() {
  const [meetingId, setMeetingId] = useState("")
  const [error, setError] = useState("")
  const router = useRouter()
  const { user } = useAuth()

  const createMeeting = async () => {
    try {
      const newMeetingId = uuidv4()
      const meetingRef = await addDoc(collection(db, 'meetings'), {
        meetingId: newMeetingId,
        hostId: user.uid,
        hostName: user.displayName,
        createdAt: new Date().toISOString(),
        status: 'active',
        participants: []
      })

      router.push(`/meeting/${newMeetingId}`)
    } catch (error) {
      console.error('Error creating meeting:', error)
      setError('Failed to create meeting. Please try again.')
    }
  }

  const joinMeeting = async () => {
    if (!meetingId.trim()) {
      setError('Please enter a meeting ID')
      return
    }

    try {
      // Query the meeting by meetingId
      const meetingsRef = collection(db, 'meetings')
      const querySnapshot = await getDocs(query(meetingsRef, where('meetingId', '==', meetingId)))
      
      if (querySnapshot.empty) {
        setError('Meeting not found')
        return
      }

      const meetingDoc = querySnapshot.docs[0]
      const meetingData = meetingDoc.data()

      if (meetingData.status !== 'active') {
        setError('This meeting has ended')
        return
      }

      router.push(`/meeting/${meetingId}`)
    } catch (error) {
      console.error('Error joining meeting:', error)
      setError('Failed to join meeting. Please try again.')
    }
  }

  return (
    <ProtectedRoute>
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-8">Meetings</h1>
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="p-6 border rounded-lg">
            <h2 className="text-xl font-semibold mb-4">Create a New Meeting</h2>
            <p className="text-gray-600 mb-4">
              Start a new meeting as a host and invite others to join.
            </p>
            <Button onClick={createMeeting} className="w-full">
              Create Meeting
            </Button>
          </div>
          <div className="p-6 border rounded-lg">
            <h2 className="text-xl font-semibold mb-4">Join a Meeting</h2>
            <p className="text-gray-600 mb-4">
              Enter a meeting ID to join as a participant.
            </p>
            <div className="flex flex-col space-y-4">
              <Input
                type="text"
                placeholder="Enter meeting ID"
                value={meetingId}
                onChange={(e) => setMeetingId(e.target.value)}
              />
              <Button onClick={joinMeeting}>Join Meeting</Button>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}

