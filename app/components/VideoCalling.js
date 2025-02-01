"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "../../components/ui/button";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  CheckIcon,
} from "@radix-ui/react-icons";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
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
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { saveMeetingHistory } from "../lib/firestore";

const PARTICIPANTS_PER_PAGE = 10;

// Use an ICE server configuration that merges the improvements.
// (Feel free to add additional TURN servers if desired.)
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "14d1d3a0d3a8e901f0e4999b",
      credential: "7xR3j5YVEqZb9K+6",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "14d1d3a0d3a8e901f0e4999b",
      credential: "7xR3j5YVEqZb9K+6",
    },
  ],
  iceCandidatePoolSize: 10,
};

function ParticipantTile({
  participant,
  stream,
  isLocal = false,
  isVideoOff = false,
}) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <Card className="relative aspect-video overflow-hidden">
      <CardContent className="p-0 h-full">
        {(!isVideoOff || !isLocal) && stream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isLocal}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full bg-secondary">
            <span className="text-4xl">
              {participant.userName?.[0]?.toUpperCase() || "U"}
            </span>
          </div>
        )}
        <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center">
          <Badge variant="secondary" className="text-xs">
            {isLocal ? "You" : participant.userName}{" "}
            {participant.isHost && "(Host)"}
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

export default function VideoCalling({
  meetingId,
  userId,
  userName,
  onMeetingEnd,
}) {
  const [participants, setParticipants] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const peerConnections = useRef({});
  const startTime = useRef(Date.now());
  const cleanupRef = useRef(false);

  // Request media permissions with retry logic.
  const requestMediaPermissions = useCallback(
    async (video = true, audio = true, retryCount = 0) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: video
            ? {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: "user",
              }
            : false,
          audio: audio
            ? {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              }
            : false,
        });
        setMediaError(null);
        return stream;
      } catch (error) {
        console.error("Media permission error:", error);
        setMediaError(error.message);
        if (retryCount < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return requestMediaPermissions(video, audio, retryCount + 1);
        }
        if (error.name === "NotAllowedError") {
          alert(
            "Please allow camera and microphone access to join the meeting."
          );
        } else if (error.name === "NotFoundError") {
          alert("No camera or microphone found. Please check your devices.");
        } else if (error.name === "NotReadableError") {
          alert(
            "Your camera or microphone is already in use by another application."
          );
        } else {
          alert(
            "Error accessing media devices. Please check your permissions and try again."
          );
        }
        throw error;
      }
    },
    []
  );

  // Create (or recreate) a peer connection for a given peer.
  const createPeerConnection = async (peerId, initiator = false) => {
    try {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnections.current[peerId] = pc;

      // Add local tracks to the connection.
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });
      }

      // Send ICE candidates to the peer.
      pc.onicecandidate = async ({ candidate }) => {
        if (candidate) {
          const meetingsRef = collection(db, "meetings");
          const meetingQuery = query(
            meetingsRef,
            where("meetingId", "==", meetingId)
          );
          const querySnapshot = await getDocs(meetingQuery);
          if (!querySnapshot.empty) {
            const meetingDocId = querySnapshot.docs[0].id;
            const rtcRef = collection(db, `meetings/${meetingDocId}/rtc`);
            await addDoc(rtcRef, {
              type: "candidate",
              candidate: candidate.toJSON(),
              senderId: userId,
              receiverId: peerId,
              timestamp: new Date().toISOString(),
            });
          }
        }
      };

      // Reconnect if the ICE connection state degrades.
      pc.oniceconnectionstatechange = () => {
        if (["disconnected", "failed"].includes(pc.iceConnectionState)) {
          console.log(
            `Connection with ${peerId} is ${pc.iceConnectionState}. Attempting to reconnect...`
          );
          if (initiator) {
            pc.restartIce();
            createAndSendOffer(pc, peerId);
          }
        }
      };

      // When a remote track is received, update the remoteStreams state.
      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        setRemoteStreams((prev) => ({
          ...prev,
          [peerId]: remoteStream,
        }));
      };

      if (initiator) {
        await createAndSendOffer(pc, peerId);
      }
      return pc;
    } catch (error) {
      console.error("Error creating peer connection for", peerId, error);
      throw error;
    }
  };

  // Create an offer and send it via Firestore signaling.
  const createAndSendOffer = async (pc, peerId) => {
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: true,
      });
      await pc.setLocalDescription(offer);
      const meetingsRef = collection(db, "meetings");
      const meetingQuery = query(
        meetingsRef,
        where("meetingId", "==", meetingId)
      );
      const querySnapshot = await getDocs(meetingQuery);
      if (!querySnapshot.empty) {
        const meetingDocId = querySnapshot.docs[0].id;
        const rtcRef = collection(db, `meetings/${meetingDocId}/rtc`);
        await addDoc(rtcRef, {
          type: "offer",
          offer: { type: offer.type, sdp: offer.sdp },
          senderId: userId,
          receiverId: peerId,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("Error creating and sending offer:", error);
    }
  };

  // Handle incoming RTC signaling messages.
  const handleRTCMessage = async (data, participantsRef) => {
    try {
      let pc = peerConnections.current[data.senderId];
      if (!pc) {
        // Create a peer connection if one doesn’t exist yet.
        pc = await createPeerConnection(data.senderId);
      }
      if (data.type === "offer") {
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        // Send answer back via Firestore.
        const meetingsRef = collection(db, "meetings");
        const meetingQuery = query(
          meetingsRef,
          where("meetingId", "==", meetingId)
        );
        const querySnapshot = await getDocs(meetingQuery);
        if (!querySnapshot.empty) {
          const meetingDocId = querySnapshot.docs[0].id;
          const rtcRef = collection(db, `meetings/${meetingDocId}/rtc`);
          await addDoc(rtcRef, {
            type: "answer",
            answer: { type: answer.type, sdp: answer.sdp },
            senderId: userId,
            receiverId: data.senderId,
            timestamp: new Date().toISOString(),
          });
        }
      } else if (data.type === "answer") {
        await pc.setRemoteDescription(data.answer);
      } else if (data.type === "candidate") {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          // Buffer candidate if remote description isn’t set yet.
          pc.candidateBuffer = pc.candidateBuffer || [];
          pc.candidateBuffer.push(data.candidate);
        }
      }
    } catch (error) {
      console.error("Error handling RTC message:", error);
    }
  };

  // Cleanup function to stop all tracks and close connections.
  const cleanup = useCallback(async () => {
    if (cleanupRef.current) return;
    cleanupRef.current = true;
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    Object.values(peerConnections.current).forEach((pc) => {
      if (pc && typeof pc.close === "function") pc.close();
    });
    setLocalStream(null);
    setRemoteStreams({});
    peerConnections.current = {};
  }, [localStream]);

  // Setup meeting: initialize media, add this user to participants,
  // and set up Firestore listeners for participants and RTC messages.
  useEffect(() => {
    let unsubscribeParticipants = null;
    let unsubscribeRTC = null;

    const setupMeeting = async () => {
      try {
        // Locate the meeting document.
        const meetingsRef = collection(db, "meetings");
        const meetingQuery = query(
          meetingsRef,
          where("meetingId", "==", meetingId)
        );
        const meetingSnapshot = await getDocs(meetingQuery);
        if (meetingSnapshot.empty) {
          throw new Error("Meeting not found");
        }
        const meetingDoc = meetingSnapshot.docs[0];
        const meetingData = meetingDoc.data();
        const meetingDocId = meetingDoc.id;

        if (meetingData.status === "ended") {
          throw new Error("This meeting has ended");
        }

        const isUserHost = meetingData.hostId === userId;
        setIsHost(isUserHost);

        // Request media.
        const stream = await requestMediaPermissions();
        if (cleanupRef.current) return;
        setLocalStream(stream);

        // Add local participant.
        const localParticipant = {
          userId,
          userName,
          isHost: isUserHost,
          isMuted: false,
          videoOn: true,
        };
        setParticipants((prev) => [localParticipant]);

        // Add this participant to Firestore.
        const participantsRef = collection(
          db,
          `meetings/${meetingDocId}/participants`
        );
        await addDoc(participantsRef, {
          userId,
          userName,
          joinedAt: serverTimestamp(),
          isHost: isUserHost,
          isMuted: false,
          videoOn: true,
        });

        // Listen for changes in the participants list.
        unsubscribeParticipants = onSnapshot(participantsRef, (snapshot) => {
          if (cleanupRef.current) return;
          const currentParticipants = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            if (data.userId !== userId) {
              currentParticipants.push({ ...data, docId: doc.id });
            }
          });
          setParticipants((prev) => {
            const localExists = prev.find((p) => p.userId === userId);
            return localExists
              ? [localExists, ...currentParticipants]
              : [localParticipant, ...currentParticipants];
          });
        });

        // Listen for RTC signaling messages.
        const rtcRef = collection(db, `meetings/${meetingDocId}/rtc`);
        unsubscribeRTC = onSnapshot(rtcRef, async (snapshot) => {
          if (cleanupRef.current) return;
          snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
              const data = change.doc.data();
              // Process only messages intended for this user.
              if (data.receiverId === userId) {
                handleRTCMessage(data, participantsRef);
              }
            }
          });
        });
      } catch (error) {
        console.error("Error setting up meeting:", error);
        setMediaError(error.message);
        if (typeof onMeetingEnd === "function") onMeetingEnd();
      }
    };

    setupMeeting();

    return () => {
      cleanup();
      unsubscribeParticipants && unsubscribeParticipants();
      unsubscribeRTC && unsubscribeRTC();
    };
  }, [
    meetingId,
    userId,
    userName,
    requestMediaPermissions,
    cleanup,
    onMeetingEnd,
  ]);

  const toggleMute = async () => {
    if (localStream) {
      try {
        const audioTracks = localStream.getAudioTracks();
        if (audioTracks.length === 0) {
          // Try to add an audio track if none exists.
          const newStream = await requestMediaPermissions(false, true);
          const newAudioTrack = newStream.getAudioTracks()[0];
          if (newAudioTrack) {
            localStream.addTrack(newAudioTrack);
            setIsMuted(false);
          }
        } else {
          audioTracks.forEach((track) => {
            track.enabled = !track.enabled;
          });
          setIsMuted(!isMuted);
        }
        // Update Firestore participant document.
        const meetingsRef = collection(db, "meetings");
        const meetingQuery = query(
          meetingsRef,
          where("meetingId", "==", meetingId)
        );
        const meetingSnapshot = await getDocs(meetingQuery);
        if (!meetingSnapshot.empty) {
          const meetingDocId = meetingSnapshot.docs[0].id;
          const participantsRef = collection(
            db,
            `meetings/${meetingDocId}/participants`
          );
          const participantQuery = query(
            participantsRef,
            where("userId", "==", userId)
          );
          const participantSnapshot = await getDocs(participantQuery);
          if (!participantSnapshot.empty) {
            await updateDoc(participantSnapshot.docs[0].ref, {
              isMuted: !isMuted,
              lastUpdated: new Date().toISOString(),
            });
          }
        }
      } catch (error) {
        console.error("Error toggling mute:", error);
        alert(
          "Failed to toggle audio. Please check your microphone permissions."
        );
      }
    }
  };

  const toggleVideo = async () => {
    try {
      if (!localStream) {
        // Request a new video stream if needed.
        const newStream = await requestMediaPermissions(true, false);
        setLocalStream(newStream);
        setIsVideoOff(false);
      } else {
        const videoTracks = localStream.getVideoTracks();
        if (videoTracks.length === 0 && !isVideoOff) {
          // Try to add a video track.
          const newStream = await requestMediaPermissions(true, false);
          const newVideoTrack = newStream.getVideoTracks()[0];
          if (newVideoTrack) {
            localStream.addTrack(newVideoTrack);
            setIsVideoOff(false);
          }
        } else {
          videoTracks.forEach((track) => {
            track.enabled = !track.enabled;
          });
          setIsVideoOff(!isVideoOff);
        }
        // Update Firestore participant document.
        const meetingsRef = collection(db, "meetings");
        const meetingQuery = query(
          meetingsRef,
          where("meetingId", "==", meetingId)
        );
        const meetingSnapshot = await getDocs(meetingQuery);
        if (!meetingSnapshot.empty) {
          const meetingDocId = meetingSnapshot.docs[0].id;
          const participantsRef = collection(
            db,
            `meetings/${meetingDocId}/participants`
          );
          const participantQuery = query(
            participantsRef,
            where("userId", "==", userId)
          );
          const participantSnapshot = await getDocs(participantQuery);
          if (!participantSnapshot.empty) {
            await updateDoc(participantSnapshot.docs[0].ref, {
              videoOn: !isVideoOff,
              lastUpdated: new Date().toISOString(),
            });
          }
        }
      }
    } catch (error) {
      console.error("Error toggling video:", error);
      alert("Failed to toggle video. Please check your camera permissions.");
    }
  };

  const endCall = async () => {
    try {
      const duration = Math.floor((Date.now() - startTime.current) / 1000);
      const meetingsRef = collection(db, "meetings");
      const meetingQuery = query(
        meetingsRef,
        where("meetingId", "==", meetingId)
      );
      const meetingSnapshot = await getDocs(meetingQuery);
      if (!meetingSnapshot.empty) {
        const meetingDocId = meetingSnapshot.docs[0].id;
        // Save meeting history.
        await saveMeetingHistory(userId, meetingId, duration);
        if (isHost) {
          const meetingRef = doc(db, "meetings", meetingDocId);
          await updateDoc(meetingRef, {
            status: "ended",
            endedAt: new Date().toISOString(),
          });
        }
        const participantsRef = collection(
          db,
          `meetings/${meetingDocId}/participants`
        );
        const participantQuery = query(
          participantsRef,
          where("userId", "==", userId)
        );
        const participantSnapshot = await getDocs(participantQuery);
        if (!participantSnapshot.empty) {
          await deleteDoc(participantSnapshot.docs[0].ref);
        }
      }
      // Cleanup local stream and peer connections.
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      Object.values(peerConnections.current).forEach((pc) => pc.close());
      if (typeof onMeetingEnd === "function") onMeetingEnd();
    } catch (error) {
      console.error("Error ending call:", error);
      if (typeof onMeetingEnd === "function") onMeetingEnd();
    }
  };

  const copyMeetingId = async () => {
    try {
      await navigator.clipboard.writeText(meetingId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Pagination (if you have many participants)
  const totalPages = Math.ceil(participants.length / PARTICIPANTS_PER_PAGE);
  const paginatedParticipants = participants.slice(
    (currentPage - 1) * PARTICIPANTS_PER_PAGE,
    currentPage * PARTICIPANTS_PER_PAGE
  );

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
            participant={
              participants.find((p) => p.userId === userId) || { userName }
            }
            stream={localStream}
            isLocal={true}
            isVideoOff={isVideoOff}
          />
          {/* Remote participants */}
          {paginatedParticipants
            .filter((p) => p.userId !== userId)
            .map((participant) => (
              <ParticipantTile
                key={participant.userId}
                participant={participant}
                stream={remoteStreams[participant.userId]}
                isLocal={false}
                isVideoOff={participant.videoOn === false}
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
      {/* (Optional) Pagination controls */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center p-4 space-x-2">
          <Button
            onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <span>
            {currentPage} / {totalPages}
          </span>
          <Button
            onClick={() =>
              setCurrentPage((prev) => Math.min(prev + 1, totalPages))
            }
          >
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
