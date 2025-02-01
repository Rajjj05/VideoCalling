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

// Merge your ICE servers (including TURN credentials) with additional options.
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

  // Request media permissions with retry logic
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
        alert(
          `Error accessing media devices: ${error.name}. Please check your permissions.`
        );
        throw error;
      }
    },
    []
  );

  // Create a peer connection and add local tracks. Buffer candidates if remote description not yet set.
  const createPeerConnection = async (peerId, initiator = false) => {
    try {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnections.current[peerId] = pc;

      // Add each local track to the connection.
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });
      }

      // Handle ICE candidate events.
      pc.onicecandidate = async ({ candidate }) => {
        if (candidate) {
          // Send candidate via Firebase signaling.
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

      // Restart ICE if connection fails.
      pc.oniceconnectionstatechange = () => {
        if (["disconnected", "failed"].includes(pc.iceConnectionState)) {
          console.log(
            `Connection with ${peerId} is ${pc.iceConnectionState}. Restarting ICE...`
          );
          if (initiator) {
            pc.restartIce();
            createAndSendOffer(pc, peerId);
          }
        }
      };

      // When receiving remote tracks, update remoteStreams.
      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        setRemoteStreams((prev) => ({ ...prev, [peerId]: remoteStream }));
      };

      // If this peer is the initiator, create and send an offer.
      if (initiator) {
        await createAndSendOffer(pc, peerId);
      }
      return pc;
    } catch (error) {
      console.error("Error creating peer connection for", peerId, error);
      throw error;
    }
  };

  // Create and send an offer using Firebase for signaling.
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

  // Handle incoming RTC messages from Firebase signaling.
  const handleRTCMessage = async (data) => {
    try {
      let pc = peerConnections.current[data.senderId];
      if (!pc) {
        pc = await createPeerConnection(data.senderId);
      }
      switch (data.type) {
        case "offer":
          await pc.setRemoteDescription(data.offer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          // Send answer via Firebase.
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
          break;
        case "answer":
          await pc.setRemoteDescription(data.answer);
          break;
        case "candidate":
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (err) {
            if (!pc.remoteDescription) {
              pc.candidateBuffer = pc.candidateBuffer || [];
              pc.candidateBuffer.push(data.candidate);
            }
          }
          break;
        default:
          console.warn("Unknown RTC message type:", data.type);
      }
    } catch (error) {
      console.error("Error handling RTC message:", error);
    }
  };

  // Cleanup: stop media tracks and close all peer connections.
  const cleanup = useCallback(async () => {
    if (cleanupRef.current) return;
    cleanupRef.current = true;
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    Object.values(peerConnections.current).forEach((pc) => {
      if (pc && typeof pc.close === "function") {
        pc.close();
      }
    });
    setLocalStream(null);
    setRemoteStreams({});
    peerConnections.current = {};
  }, [localStream]);

  // Setup meeting: request media, add user to Firestore, and listen for RTC messages.
  useEffect(() => {
    let unsubscribeParticipants = null;
    let unsubscribeRTC = null;

    const setupMeeting = async () => {
      try {
        // Query the meeting document.
        const meetingsRef = collection(db, "meetings");
        const meetingQuery = query(
          meetingsRef,
          where("meetingId", "==", meetingId)
        );
        const meetingSnapshot = await getDocs(meetingQuery);
        if (meetingSnapshot.empty) throw new Error("Meeting not found");
        const meetingDoc = meetingSnapshot.docs[0];
        const meetingData = meetingDoc.data();
        if (meetingData.status === "ended")
          throw new Error("This meeting has ended");
        setIsHost(meetingData.hostId === userId);

        // Request media.
        const stream = await requestMediaPermissions();
        if (cleanupRef.current) return;
        setLocalStream(stream);

        // Add local participant to UI.
        const localParticipant = {
          userId,
          userName,
          isHost: meetingData.hostId === userId,
          isMuted: false,
          videoOn: true,
        };
        setParticipants((prev) => [localParticipant]);

        // Add participant document to Firestore.
        const participantsRef = collection(
          db,
          `meetings/${meetingDoc.id}/participants`
        );
        await addDoc(participantsRef, {
          userId,
          userName,
          joinedAt: serverTimestamp(),
          isHost: meetingData.hostId === userId,
          isMuted: false,
          videoOn: true,
        });

        // Listen for participant updates.
        unsubscribeParticipants = onSnapshot(participantsRef, (snapshot) => {
          if (cleanupRef.current) return;
          const currentParticipants = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            if (data.userId !== userId)
              currentParticipants.push({ ...data, docId: doc.id });
          });
          setParticipants((prev) => {
            const localExists = prev.find((p) => p.userId === userId);
            return localExists
              ? [localExists, ...currentParticipants]
              : [localParticipant, ...currentParticipants];
          });
        });

        // Listen for RTC signaling messages.
        const rtcRef = collection(db, `meetings/${meetingDoc.id}/rtc`);
        unsubscribeRTC = onSnapshot(rtcRef, (snapshot) => {
          if (cleanupRef.current) return;
          snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
              const data = change.doc.data();
              if (data.receiverId === userId) {
                handleRTCMessage(data);
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

  // Toggle mute by enabling/disabling audio tracks.
  const toggleMute = async () => {
    if (localStream) {
      try {
        const audioTracks = localStream.getAudioTracks();
        if (audioTracks.length === 0) {
          const newStream = await requestMediaPermissions(false, true);
          const newAudioTrack = newStream.getAudioTracks()[0];
          if (newAudioTrack) {
            localStream.addTrack(newAudioTrack);
            setIsMuted(false);
          }
        } else {
          audioTracks.forEach((track) => (track.enabled = !track.enabled));
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
        alert("Failed to toggle audio.");
      }
    }
  };

  // Toggle video by enabling/disabling video tracks.
  const toggleVideo = async () => {
    try {
      if (!localStream) {
        const newStream = await requestMediaPermissions(true, false);
        setLocalStream(newStream);
        setIsVideoOff(false);
      } else {
        const videoTracks = localStream.getVideoTracks();
        if (videoTracks.length === 0 && !isVideoOff) {
          const newStream = await requestMediaPermissions(true, false);
          const newVideoTrack = newStream.getVideoTracks()[0];
          if (newVideoTrack) {
            localStream.addTrack(newVideoTrack);
            setIsVideoOff(false);
          }
        } else {
          videoTracks.forEach((track) => (track.enabled = !track.enabled));
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
      alert("Failed to toggle video.");
    }
  };

  // End the call: save meeting history, update Firestore, clean up streams and connections.
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
          <ParticipantTile
            participant={
              participants.find((p) => p.userId === userId) || { userName }
            }
            stream={localStream}
            isLocal={true}
            isVideoOff={isVideoOff}
          />
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
