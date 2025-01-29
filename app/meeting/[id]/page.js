"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "../../../components/ui/button"
import { ProtectedRoute } from "../../components/ProtectedRoute"
import { VideoCalling } from "../../components/VideoCalling"
import { useAuth } from "../../contexts/AuthContext"
import { db } from "../../lib/firebase"
import { collection, getDocs, query, where } from "firebase/firestore"

export default function MeetingRoom() {
  const { id: meetingId } = useParams()
  const { user } = useAuth()
  const router = useRouter()
  const [error, setError] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const checkMeeting = async () => {
      try {
        // Check if meeting exists and is active
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

        setIsLoading(false)
      } catch (error) {
        console.error('Error checking meeting:', error)
        setError('Failed to join meeting')
      }
    }

    checkMeeting()
  }, [meetingId])

  const handleMeetingEnd = () => {
    router.push('/meetings')
  }

  if (error) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center min-h-screen">
          <div className="bg-red-100 border border-red-400 text-red-700 px-6 py-4 rounded-lg mb-4">
            {error}
          </div>
          <Button onClick={() => router.push('/meetings')}>
            Back to Meetings
          </Button>
        </div>
      </ProtectedRoute>
    )
  }

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <div className="flex flex-col h-screen">
        <VideoCalling
          meetingId={meetingId}
          userId={user.uid}
          onMeetingEnd={handleMeetingEnd}
        />
      </div>
    </ProtectedRoute>
  )
}

