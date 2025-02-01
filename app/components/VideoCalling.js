"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "../../components/ui/button"
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, CheckIcon } from "@radix-ui/react-icons"
import { Card, CardContent } from "../../components/ui/card"
import { Badge } from "../../components/ui/badge"
import { db } from "../lib/firebase"
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  doc, 
  updateDoc, 
  deleteDoc, 
  getDocs, 
  query, 
  where,
  getFirestore,
  arrayUnion
} from "firebase/firestore"
import { saveMeetingHistory } from "../lib/firestore"

const PARTICIPANTS_PER_PAGE = 10
const ICE_SERVERS = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
      ],
    },
  ],
  iceCandidatePoolSize: 10
}

export function VideoCalling({ meetingId, userId, onMeetingEnd }) {
  // ... existing state declarations ...

  useEffect(() => {
    const setupMeeting = async () => {
      try {
        const meetingsRef = collection(db, 'meetings')
        const meetingQuery = query(meetingsRef, where('meetingId', '==', meetingId))
        const querySnapshot = await getDocs(meetingQuery)
        
        if (querySnapshot.empty) {
          console.error('Meeting not found')
          return
        }

        const meetingDoc = querySnapshot.docs[0]
        const meetingData = meetingDoc.data()
        const meetingDocId = meetingDoc.id
        const isUserHost = meetingData.hostId === userId
        setIsHost(isUserHost)

        try {
          const stream = await requestMediaPermissions()
          setLocalStream(stream)
          setIsMuted(false)
          setIsVideoOff(false)

          // Add local participant first
          setParticipants([{
            id: `local-${userId}`,
            userId: userId,
            stream,
            name: isUserHost ? 'You (Host)' : 'You',
            isMuted: false,
            videoOn: true,
            isHost: isUserHost
          }])

          // Create participant document
          const participantsRef = collection(db, `meetings/${meetingDocId}/participants`)
          const participantDoc = await addDoc(participantsRef, {
            userId: userId,
            displayName: isUserHost ? 'Host' : `Participant ${Date.now()}`,
            joinedAt: new Date().toISOString(),
            isMuted: false,
            videoOn: true,
            isHost: isUserHost
          })

          // Listen for all participants (including host)
          const participantsUnsub = onSnapshot(participantsRef, async (snapshot) => {
            const allParticipants = snapshot.docs
              .filter(doc => doc.data().userId !== userId)
              .map(doc => ({ id: doc.id, ...doc.data() }))

            // Create peer connections for new participants
            allParticipants.forEach(async (participant) => {
              if (!peerConnections.current[participant.userId]) {
                createPeerConnection(participant.userId, stream)
              }
            })
          })

          // Handle signaling messages
          const rtcRef = collection(db, `meetings/${meetingDocId}/rtc`)
          const rtcUnsub = onSnapshot(rtcRef, async (snapshot) => {
            snapshot.docChanges().forEach(async change => {
              if (change.type === 'added') {
                const data = change.doc.data()
                if (data.receiverId === userId) {
                  await handleSignalingMessage(data)
                }
              }
            })
          })

          return () => {
            participantsUnsub()
            rtcUnsub()
            // ... cleanup code ...
          }
        } catch (error) {
          console.error('Error setting up media:', error)
        }
      } catch (error) {
        console.error('Meeting setup error:', error)
      }
    }

    setupMeeting()
  }, [meetingId, userId])

  const createPeerConnection = async (peerId, localStream) => {
    try {
      const pc = new RTCPeerConnection(ICE_SERVERS)
      peerConnections.current[peerId] = pc

      // Add local tracks
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream)
      })

      // ICE Candidate handling
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          await sendICECandidate(peerId, event.candidate)
        }
      }

      pc.ontrack = (event) => {
        handleRemoteTrack(peerId, event)
      }

      // Create and send offer
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await sendOffer(peerId, offer)
    } catch (error) {
      console.error('Peer connection error:', error)
    }
  }

  const handleSignalingMessage = async (data) => {
    try {
      const pc = peerConnections.current[data.senderId]
      
      switch (data.type) {
        case 'offer':
          await handleOffer(data.senderId, data.offer)
          break
        case 'answer':
          await handleAnswer(data.senderId, data.answer)
          break
        case 'candidate':
          await handleICECandidate(data.senderId, data.candidate)
          break
      }
    } catch (error) {
      console.error('Error handling signaling message:', error)
    }
  }

  const handleOffer = async (peerId, offer) => {
    const pc = new RTCPeerConnection(ICE_SERVERS)
    peerConnections.current[peerId] = pc

    // Add local tracks
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream)
    })

    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await sendICECandidate(peerId, event.candidate)
      }
    }

    pc.ontrack = (event) => {
      handleRemoteTrack(peerId, event)
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await sendAnswer(peerId, answer)
  }

  const handleAnswer = async (peerId, answer) => {
    const pc = peerConnections.current[peerId]
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer))
    }
  }

  const handleICECandidate = async (peerId, candidate) => {
    const pc = peerConnections.current[peerId]
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
      } catch (error) {
        if (!pc.remoteDescription) {
          // Buffer candidate if remote description not set
          pc.candidateBuffer = pc.candidateBuffer || []
          pc.candidateBuffer.push(new RTCIceCandidate(candidate))
        } else {
          console.error('Error adding ICE candidate:', error)
        }
      }
    }
  }

  const handleRemoteTrack = (peerId, event) => {
    const remoteStream = event.streams[0]
    setParticipants(prev => {
      const existing = prev.find(p => p.userId === peerId)
      if (existing) return prev
      
      return [...prev, {
        id: `remote-${peerId}`,
        userId: peerId,
        stream: remoteStream,
        name: `Participant ${peerId.slice(0, 5)}`,
        isMuted: false,
        videoOn: true,
        isHost: false
      }]
    })
  }

  const sendOffer = async (peerId, offer) => {
    const meetingsRef = collection(db, 'meetings')
    const q = query(meetingsRef, where('meetingId', '==', meetingId))
    const snapshot = await getDocs(q)
    
    if (!snapshot.empty) {
      const meetingDocId = snapshot.docs[0].id
      const rtcRef = collection(db, `meetings/${meetingDocId}/rtc`)
      
      await addDoc(rtcRef, {
        type: 'offer',
        offer: offer,
        senderId: userId,
        receiverId: peerId,
        timestamp: new Date().toISOString()
      })
    }
  }

  // Similar functions for sendAnswer and sendICECandidate

  // ... rest of the component code ...
}