"use client"

import { useState, useEffect, useRef, useCallback } from "react"
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
  arrayUnion,
  serverTimestamp
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
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    }
  ],
  iceCandidatePoolSize: 10,
}

function ParticipantTile({ participant, stream, isLocal = false }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <Card className="relative aspect-video overflow-hidden">
      <CardContent className="p-0 h-full">
        {(!isVideoOff || !isLocal) && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isLocal}
            className="w-full h-full object-cover"
          />
        )}
        {(isVideoOff || !stream) && (
          <div className="flex items-center justify-center w-full h-full bg-secondary">
            <span className="text-4xl">{participant.userName?.[0]?.toUpperCase() || 'U'}</span>
          </div>
        )}
        <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center">
          <Badge variant="secondary" className="text-xs">
            {isLocal ? "You" : participant.userName} {participant.isHost && "(Host)"}
          </Badge>
          {participant.isMuted && (
            <Badge variant="destructive" className="text-xs">
              Muted
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function VideoCalling({ meetingId, userId, userName, onMeetingEnd }) {
  const [participants, setParticipants] = useState([])
  const [currentPage, setCurrentPage] = useState(1)
  const [localStream, setLocalStream] = useState(null)
  const [remoteStreams, setRemoteStreams] = useState({})
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [isHost, setIsHost] = useState(false)
  const [copied, setCopied] = useState(false)
  const [mediaError, setMediaError] = useState(null)
  const [isInitializing, setIsInitializing] = useState(true)
  const peerConnections = useRef({})
  const startTime = useRef(Date.now())
  const localVideoRef = useRef(null)
  const cleanupRef = useRef(false)

  // Function to request media permissions with retry logic
  const requestMediaPermissions = useCallback(async (video = true, audio = true, retryCount = 0) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: video ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        } : false,
        audio: audio ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } : false
      });
      setMediaError(null)
      return stream;
    } catch (error) {
      console.error('Media permission error:', error);
      setMediaError(error.message);

      if (retryCount < 2) {
        // Wait for a short time before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
        return requestMediaPermissions(video, audio, retryCount + 1);
      }

      if (error.name === 'NotAllowedError') {
        alert('Please allow camera and microphone access to join the meeting.');
      } else if (error.name === 'NotFoundError') {
        alert('No camera or microphone found. Please check your devices.');
      } else if (error.name === 'NotReadableError') {
        alert('Your camera or microphone is already in use by another application.');
      } else {
        alert('Error accessing media devices. Please check your permissions and try again.');
      }
      throw error;
    }
  }, []);

  // Enhanced cleanup function
  const cleanup = useCallback(async () => {
    if (cleanupRef.current) return;
    cleanupRef.current = true;

    try {
      // Stop all tracks in the local stream
      if (localStream) {
        localStream.getTracks().forEach(track => {
          track.stop();
        });
      }

      // Close all peer connections
      Object.values(peerConnections.current).forEach(pc => {
        if (pc && typeof pc.close === 'function') {
          pc.close();
        }
      });

      // Clear all state
      setLocalStream(null);
      setRemoteStreams({});
      peerConnections.current = {};
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }, [localStream]);

  // Setup effect
  useEffect(() => {
    let unsubscribeParticipants = null;
    let unsubscribeRTC = null;

    const setupMeeting = async () => {
      try {
        const meetingsRef = collection(db, 'meetings');
        const meetingQuery = query(meetingsRef, where('meetingId', '==', meetingId));
        const querySnapshot = await getDocs(meetingQuery);

        if (querySnapshot.empty) {
          throw new Error('Meeting not found');
        }

        const meetingDoc = querySnapshot.docs[0];
        const meetingData = meetingDoc.data();
        const meetingDocId = meetingDoc.id;

        if (meetingData.status === 'ended') {
          throw new Error('This meeting has ended');
        }

        const isUserHost = meetingData.hostId === userId;
        setIsHost(isUserHost);

        // Initialize media stream
        const stream = await requestMediaPermissions();
        if (cleanupRef.current) return;
        
        setLocalStream(stream);

        // Add local participant
        const localParticipant = {
          userId,
          userName,
          isHost: isUserHost,
          isMuted: false,
          isVideoOff: false
        };
        setParticipants(prev => [localParticipant]);

        const participantsRef = collection(db, `meetings/${meetingDocId}/participants`);
        const rtcRef = collection(db, `meetings/${meetingDocId}/rtc`);

        // Add to participants collection
        await addDoc(participantsRef, {
          userId,
          userName,
          joinedAt: serverTimestamp(),
          isHost: isUserHost,
          isMuted: false,
          videoOn: true
        });

        // Listen for participants
        unsubscribeParticipants = onSnapshot(participantsRef, (snapshot) => {
          if (cleanupRef.current) return;
          
          const currentParticipants = [];
          snapshot.forEach((doc) => {
            const participantData = doc.data();
            if (participantData.userId !== userId) {
              currentParticipants.push({
                ...participantData,
                docId: doc.id
              });
            }
          });
          
          setParticipants(prev => {
            const localParticipant = prev.find(p => p.userId === userId) || {
              userId,
              userName,
              isHost: isUserHost,
              isMuted: false,
              isVideoOff: false
            };
            return [localParticipant, ...currentParticipants];
          });
        });

        // Listen for RTC signaling
        unsubscribeRTC = onSnapshot(rtcRef, async (snapshot) => {
          if (cleanupRef.current) return;
          const changes = snapshot.docChanges();
          
          for (const change of changes) {
            if (change.type === 'added') {
              const data = change.doc.data();
              if (data.receiverId === userId) {
                handleRTCMessage(data, participantsRef);
              }
            }
          }
        });

      } catch (error) {
        console.error('Error setting up meeting:', error);
        setMediaError(error.message);
        if (typeof onMeetingEnd === 'function') {
          onMeetingEnd();
        }
      }
    };

    setupMeeting();

    return () => {
      cleanup();
      if (unsubscribeParticipants) unsubscribeParticipants();
      if (unsubscribeRTC) unsubscribeRTC();
    };
  }, [meetingId, userId, userName, requestMediaPermissions, cleanup, onMeetingEnd]);

  const createPeerConnection = async (peerId, stream, participantData, initiator = false) => {
    try {
      console.log('Creating peer connection for:', peerId, 'initiator:', initiator)
      const pc = new RTCPeerConnection(ICE_SERVERS)
      peerConnections.current[peerId] = pc

      // Add all local tracks to the peer connection
      if (stream) {
        stream.getTracks().forEach(track => {
          console.log('Adding track to peer connection:', track.kind)
          pc.addTrack(track, stream)
        })
      }

      // Handle ICE candidates
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          console.log('Sending ICE candidate to:', peerId)
          const meetingsRef = collection(db, 'meetings')
          const meetingQuery = query(meetingsRef, where('meetingId', '==', meetingId))
          const querySnapshot = await getDocs(meetingQuery)
          
          if (!querySnapshot.empty) {
            const meetingDocId = querySnapshot.docs[0].id
            const rtcRef = collection(db, `meetings/${meetingDocId}/rtc`)
            await addDoc(rtcRef, {
              type: 'candidate',
              candidate: event.candidate.toJSON(),
              senderId: userId,
              receiverId: peerId,
              timestamp: new Date().toISOString()
            })
          }
        }
      }

      pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state with ${peerId}:`, pc.iceConnectionState)
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          // If connection fails, try reconnecting
          console.log('Connection failed, attempting to reconnect...')
          if (initiator) {
            pc.restartIce()
            createAndSendOffer(pc, peerId)
          }
        }
      }

      pc.ontrack = (event) => {
        console.log('Received remote track from:', peerId, event.streams[0].getTracks())
        const [remoteStream] = event.streams
        
        setRemoteStreams(prev => ({
          ...prev,
          [peerId]: remoteStream
        }))
      }

      if (initiator) {
        await createAndSendOffer(pc, peerId)
      }

      return pc
    } catch (error) {
      console.error('Error creating peer connection:', error)
      throw error
    }
  }

  const createAndSendOffer = async (pc, peerId) => {
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: true
      })
      await pc.setLocalDescription(offer)
      
      const meetingsRef = collection(db, 'meetings')
      const meetingQuery = query(meetingsRef, where('meetingId', '==', meetingId))
      const querySnapshot = await getDocs(meetingQuery)
      
      if (!querySnapshot.empty) {
        const meetingDocId = querySnapshot.docs[0].id
        const rtcRef = collection(db, `meetings/${meetingDocId}/rtc`)
        await addDoc(rtcRef, {
          type: 'offer',
          offer: {
            type: offer.type,
            sdp: offer.sdp
          },
          senderId: userId,
          receiverId: peerId,
          timestamp: new Date().toISOString()
        })
      }
    } catch (error) {
      console.error('Error creating and sending offer:', error)
    }
  }

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
        const participantsRef = collection(db, `meetings/${meetingDocId}/participants`)
        // Query for this user's participant document
        const participantQuery = query(participantsRef, where('userId', '==', userId))
        const participantSnapshot = await getDocs(participantQuery)
        
        if (!participantSnapshot.empty) {
          // Delete the participant document
          await deleteDoc(participantSnapshot.docs[0].ref)
        }
      }
      
      // Cleanup
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop())
      }
      Object.values(peerConnections.current).forEach(pc => pc.close())
      
      // Call the onMeetingEnd callback if provided
      if (typeof onMeetingEnd === 'function') {
        onMeetingEnd()
      }
    } catch (error) {
      console.error('Error ending call:', error)
      // Still try to navigate away even if there's an error
      if (typeof onMeetingEnd === 'function') {
        onMeetingEnd()
      }
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
          {/* Local participant */}
          <ParticipantTile
            participant={participants.find(p => p.userId === userId) || { userName }}
            stream={localStream}
            isLocal={true}
          />
          {/* Remote participants */}
          {participants
            .filter(p => p.userId !== userId)
            .map((participant) => (
              <ParticipantTile
                key={participant.userId}
                participant={participant}
                stream={remoteStreams[participant.userId]}
                isLocal={false}
              />
            ))}
        </div>
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

