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
      ],
    },
  ],
}

export function VideoCalling({ meetingId, userId, onMeetingEnd }) {
  const [participants, setParticipants] = useState([])
  const [currentPage, setCurrentPage] = useState(1)
  const [localStream, setLocalStream] = useState(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [isHost, setIsHost] = useState(false)
  const [copied, setCopied] = useState(false)
  const [mediaError, setMediaError] = useState(null)
  const peerConnections = useRef({})
  const startTime = useRef(Date.now())

  // Function to request media permissions
  const requestMediaPermissions = async (video = true, audio = true) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: video ? {
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } : false,
        audio: audio
      });
      return stream;
    } catch (error) {
      console.error('Media permission error:', error);
      setMediaError(error.message);
      if (error.name === 'NotAllowedError') {
        alert('Please allow camera and microphone access to join the meeting.');
      } else if (error.name === 'NotFoundError') {
        alert('No camera or microphone found. Please check your devices.');
      } else {
        alert('Error accessing media devices. Please check your permissions.');
      }
      throw error;
    }
  };

  useEffect(() => {
    const setupMeeting = async () => {
      try {
        // Get meeting details
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
          // Request initial media permissions
          const stream = await requestMediaPermissions();
          setLocalStream(stream);
          setIsMuted(false);
          setIsVideoOff(false);

          // Add local participant
          setParticipants([{
            id: `local-${userId}`,
            userId: userId,
            stream,
            name: isUserHost ? 'You (Host)' : 'You',
            isMuted: false,
            videoOn: true,
            isHost: isUserHost
          }]);

          // Create participant document first
          const participantsRef = collection(db, `meetings/${meetingDocId}/participants`)
          const participantDoc = await addDoc(participantsRef, {
            userId: userId,
            displayName: isUserHost ? 'Host' : `Participant ${Date.now()}`,
            joinedAt: new Date().toISOString(),
            isMuted: false,
            videoOn: true,
            isHost: isUserHost
          })

          // Set up signaling
          const rtcRef = collection(db, `meetings/${meetingDocId}/rtc`)
          
          // Listen for existing participants
          const existingParticipants = await getDocs(query(participantsRef, where('userId', '!=', userId)))
          
          // Create peer connections for existing participants
          existingParticipants.forEach(async (participantDoc) => {
            const participantData = participantDoc.data()
            const peerId = participantData.userId
            
            // Create peer connection
            const pc = new RTCPeerConnection(ICE_SERVERS)
            peerConnections.current[peerId] = pc

            // Add local tracks
            stream.getTracks().forEach(track => {
              pc.addTrack(track, stream)
            })

            // Handle ICE candidates
            pc.onicecandidate = async (event) => {
              if (event.candidate) {
                await addDoc(rtcRef, {
                  type: 'candidate',
                  candidate: event.candidate,
                  senderId: userId,
                  receiverId: peerId,
                  timestamp: new Date().toISOString()
                })
              }
            }

            // Handle incoming tracks
            pc.ontrack = (event) => {
              console.log('Received remote track from:', peerId)
              setParticipants(prev => {
                // Remove any existing entries for this peer
                const filtered = prev.filter(p => p.userId !== peerId)
                
                return [...filtered, {
                  id: `remote-${peerId}`,
                  userId: peerId,
                  stream: event.streams[0],
                  name: participantData.displayName,
                  isMuted: participantData.isMuted,
                  videoOn: participantData.videoOn,
                  isHost: participantData.isHost
                }]
              })
            }

            // Create and send offer
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            await addDoc(rtcRef, {
              type: 'offer',
              offer: offer,
              senderId: userId,
              receiverId: peerId,
              timestamp: new Date().toISOString()
            })
          })

          // Listen for WebRTC signaling messages
          const unsubscribe = onSnapshot(rtcRef, async (snapshot) => {
            snapshot.docChanges().forEach(async change => {
              if (change.type === 'added') {
                const data = change.doc.data()
                if (data.receiverId === userId) {
                  if (data.type === 'offer') {
                    const peerId = data.senderId
                    let pc = peerConnections.current[peerId]
                    
                    if (!pc) {
                      pc = new RTCPeerConnection(ICE_SERVERS)
                      peerConnections.current[peerId] = pc

                      // Add local tracks
                      stream.getTracks().forEach(track => {
                        pc.addTrack(track, stream)
                      })

                      // Handle ICE candidates
                      pc.onicecandidate = async (event) => {
                        if (event.candidate) {
                          await addDoc(rtcRef, {
                            type: 'candidate',
                            candidate: event.candidate,
                            senderId: userId,
                            receiverId: peerId,
                            timestamp: new Date().toISOString()
                          })
                        }
                      }

                      // Handle incoming tracks
                      pc.ontrack = (event) => {
                        console.log('Received remote track from:', peerId)
                        setParticipants(prev => {
                          // Remove any existing entries for this peer
                          const filtered = prev.filter(p => p.userId !== peerId)
                          
                          // Get participant info
                          const participantInfo = existingParticipants.docs.find(
                            doc => doc.data().userId === peerId
                          )?.data() || {}

                          return [...filtered, {
                            id: `remote-${peerId}`,
                            userId: peerId,
                            stream: event.streams[0],
                            name: participantInfo.displayName || 'Participant',
                            isMuted: participantInfo.isMuted || false,
                            videoOn: participantInfo.videoOn || true,
                            isHost: participantInfo.isHost || false
                          }]
                        })
                      }
                    }

                    await pc.setRemoteDescription(new RTCSessionDescription(data.offer))
                    const answer = await pc.createAnswer()
                    await pc.setLocalDescription(answer)
                    await addDoc(rtcRef, {
                      type: 'answer',
                      answer: answer,
                      senderId: userId,
                      receiverId: peerId,
                      timestamp: new Date().toISOString()
                    })
                  } else if (data.type === 'answer') {
                    const pc = peerConnections.current[data.senderId]
                    if (pc) {
                      await pc.setRemoteDescription(new RTCSessionDescription(data.answer))
                    }
                  } else if (data.type === 'candidate') {
                    const pc = peerConnections.current[data.senderId]
                    if (pc) {
                      await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
                    }
                  }
                }
              }
            })
          })

          // Listen for participant updates
          const participantUnsubscribe = onSnapshot(participantsRef, (snapshot) => {
            snapshot.docChanges().forEach(change => {
              const participantData = change.doc.data()
              if (change.type === 'modified' && participantData.userId !== userId) {
                setParticipants(prev => {
                  return prev.map(p => {
                    if (p.userId === participantData.userId) {
                      return {
                        ...p,
                        isMuted: participantData.isMuted,
                        videoOn: participantData.videoOn
                      }
                    }
                    return p
                  })
                })
              } else if (change.type === 'removed' && participantData.userId !== userId) {
                setParticipants(prev => prev.filter(p => p.userId !== participantData.userId))
                if (peerConnections.current[participantData.userId]) {
                  peerConnections.current[participantData.userId].close()
                  delete peerConnections.current[participantData.userId]
                }
              }
            })
          })

          // Cleanup function
          return () => {
            unsubscribe()
            participantUnsubscribe()
            Object.values(peerConnections.current).forEach(pc => pc.close())
            stream.getTracks().forEach(track => track.stop())
            if (participantDoc) {
              deleteDoc(participantDoc.ref)
            }
          }
        } catch (mediaError) {
          console.error('Error accessing media devices:', mediaError)
          // Continue with limited functionality if possible
          if (!mediaError.name.includes('NotAllowed')) {
            // Try audio only if video fails
            try {
              const audioOnlyStream = await requestMediaPermissions(false, true);
              setLocalStream(audioOnlyStream);
              setIsVideoOff(true);
              // Add local participant with audio only
              setParticipants([{
                id: `local-${userId}`,
                userId: userId,
                stream: audioOnlyStream,
                name: 'You',
                isMuted: false,
                videoOn: false,
                isHost: isUserHost
              }]);
            } catch (audioError) {
              console.error('Failed to get audio access:', audioError);
              setMediaError('No media access available');
            }
          }
        }
      } catch (error) {
        console.error('Error setting up meeting:', error)
      }
    }

    setupMeeting()
  }, [meetingId, userId])

  const toggleMute = async () => {
    if (localStream) {
      try {
        const audioTracks = localStream.getAudioTracks();
        
        if (audioTracks.length === 0) {
          // No audio track exists, try to add one
          try {
            const newStream = await requestMediaPermissions(false, true);
            const newAudioTrack = newStream.getAudioTracks()[0];
            if (newAudioTrack) {
              localStream.addTrack(newAudioTrack);
              setIsMuted(false);
            }
          } catch (error) {
            console.error('Failed to add audio track:', error);
            alert('Unable to enable microphone. Please check your permissions.');
            return;
          }
        } else {
          // Toggle existing audio tracks
          audioTracks.forEach(track => {
            track.enabled = !track.enabled;
          });
          setIsMuted(!isMuted);
        }

        // Update Firebase status
        const meetingsRef = collection(db, 'meetings');
        const meetingQuery = query(meetingsRef, where('meetingId', '==', meetingId));
        const querySnapshot = await getDocs(meetingQuery);
        
        if (!querySnapshot.empty) {
          const meetingDocId = querySnapshot.docs[0].id;
          // Get participants collection
          const participantsRef = collection(db, `meetings/${meetingDocId}/participants`);
          // Query for this user's participant document
          const participantQuery = query(participantsRef, where('userId', '==', userId));
          const participantSnapshot = await getDocs(participantQuery);
          
          if (!participantSnapshot.empty) {
            // Update the existing document
            await updateDoc(participantSnapshot.docs[0].ref, {
              isMuted: !isMuted,
              lastUpdated: new Date().toISOString()
            });
          }
        }
      } catch (error) {
        console.error('Error toggling mute:', error);
        alert('Failed to toggle audio. Please check your microphone permissions.');
      }
    }
  };

  const toggleVideo = async () => {
    try {
      if (!localStream) {
        // Try to get video access if no stream exists
        const newStream = await requestMediaPermissions(true, false);
        setLocalStream(newStream);
        setIsVideoOff(false);
      } else {
        const videoTracks = localStream.getVideoTracks();
        
        if (videoTracks.length === 0 && !isVideoOff) {
          // No video track exists and video is supposed to be on, try to add one
          try {
            const newStream = await requestMediaPermissions(true, false);
            const newVideoTrack = newStream.getVideoTracks()[0];
            if (newVideoTrack) {
              localStream.addTrack(newVideoTrack);
              setIsVideoOff(false);
            }
          } catch (error) {
            console.error('Failed to add video track:', error);
            alert('Unable to enable camera. Please check your permissions.');
            return;
          }
        } else {
          // Toggle existing video tracks
          videoTracks.forEach(track => {
            track.enabled = !track.enabled;
          });
          setIsVideoOff(!isVideoOff);
        }
      }

      // Update Firebase status
      const meetingsRef = collection(db, 'meetings');
      const meetingQuery = query(meetingsRef, where('meetingId', '==', meetingId));
      const querySnapshot = await getDocs(meetingQuery);
      
      if (!querySnapshot.empty) {
        const meetingDocId = querySnapshot.docs[0].id;
        // Get participants collection
        const participantsRef = collection(db, `meetings/${meetingDocId}/participants`);
        // Query for this user's participant document
        const participantQuery = query(participantsRef, where('userId', '==', userId));
        const participantSnapshot = await getDocs(participantQuery);
        
        if (!participantSnapshot.empty) {
          // Update the existing document
          await updateDoc(participantSnapshot.docs[0].ref, {
            videoOn: !isVideoOff,
            lastUpdated: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      console.error('Error toggling video:', error);
      alert('Failed to toggle video. Please check your camera permissions.');
    }
  };

  const endCall = async () => {
    try {
      // Calculate duration
      const duration = Math.floor((Date.now() - startTime.current) / 1000)
      
      // Get meeting document ID first
      const meetingsRef = collection(db, 'meetings')
      const meetingQuery = query(meetingsRef, where('meetingId', '==', meetingId))
      const querySnapshot = await getDocs(meetingQuery)
      
      if (!querySnapshot.empty) {
        const meetingDocId = querySnapshot.docs[0].id

        // Save meeting history
        await saveMeetingHistory(userId, meetingId, duration)
        
        // If host, end meeting for all
        if (isHost) {
          const meetingRef = doc(db, 'meetings', meetingDocId)
          await updateDoc(meetingRef, { 
            status: 'ended',
            endedAt: new Date().toISOString()
          })
        }

        // Get participants collection
        const participantsRef = collection(db, `meetings/${meetingDocId}/participants`);
        // Query for this user's participant document
        const participantQuery = query(participantsRef, where('userId', '==', userId));
        const participantSnapshot = await getDocs(participantQuery);
        
        if (!participantSnapshot.empty) {
          // Delete the participant document
          await deleteDoc(participantSnapshot.docs[0].ref);
        }
      }
      
      // Cleanup
      localStream?.getTracks().forEach(track => {
        track.stop()
      })
      Object.values(peerConnections.current).forEach(pc => {
        pc.close()
      })
      
      // Navigate away
      onMeetingEnd?.()
    } catch (error) {
      console.error('Error ending call:', error)
    }
  }

  const copyMeetingId = async () => {
    try {
      await navigator.clipboard.writeText(meetingId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const totalPages = Math.ceil(participants.length / PARTICIPANTS_PER_PAGE)
  const paginatedParticipants = participants.slice(
    (currentPage - 1) * PARTICIPANTS_PER_PAGE,
    currentPage * PARTICIPANTS_PER_PAGE
  )

  return (
    <div className="flex flex-col h-full">
      {mediaError && (
        <div className="p-4 bg-red-100 text-red-700 text-center">
          {mediaError}. Please check your device permissions.
        </div>
      )}
      {isHost && (
        <div className="p-4 bg-muted/50 flex items-center justify-center space-x-4">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium">Meeting ID:</span>
            <code className="bg-muted px-2 py-1 rounded">{meetingId}</code>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={copyMeetingId}
            className="flex items-center space-x-1"
          >
            {copied ? (
              <>
                <CheckIcon className="h-4 w-4" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <CopyIcon className="h-4 w-4" />
                <span>Copy ID</span>
              </>
            )}
          </Button>
        </div>
      )}
      <div className="flex-grow relative">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 p-2">
          {paginatedParticipants.map((participant) => (
            <ParticipantTile 
              key={participant.id} 
              participant={participant}
            />
          ))}
        </div>
        {totalPages > 1 && (
          <Card className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
            <CardContent className="flex items-center space-x-2 p-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}>
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>
              <span className="text-sm">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}>
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
      <div className="p-4 flex justify-center space-x-4">
        <Button
          variant={isMuted ? "destructive" : "secondary"}
          onClick={toggleMute}
        >
          {isMuted ? "Unmute" : "Mute"}
        </Button>
        <Button
          variant={isVideoOff ? "destructive" : "secondary"}
          onClick={toggleVideo}
        >
          {isVideoOff ? "Turn On Video" : "Turn Off Video"}
        </Button>
        <Button variant="destructive" onClick={endCall}>
          {isHost ? "End Meeting" : "Leave Meeting"}
        </Button>
      </div>
    </div>
  )
}

function ParticipantTile({ participant }) {
  const videoRef = useRef()

  useEffect(() => {
    if (participant.stream && videoRef.current) {
      videoRef.current.srcObject = participant.stream
    }
  }, [participant.stream])

  return (
    <Card className="relative aspect-video overflow-hidden">
      <CardContent className="p-0">
        {participant.videoOn ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={participant.id === 'You'}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full bg-secondary">
            <span className="text-4xl">{participant.name[0].toUpperCase()}</span>
          </div>
        )}
        <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center">
          <Badge variant="secondary" className="text-xs">
            {participant.name} {participant.isHost && "(Host)"}
          </Badge>
          {participant.isMuted && (
            <Badge variant="destructive" className="text-xs">
              Muted
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

