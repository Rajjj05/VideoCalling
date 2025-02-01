"use client"

import { useState, useEffect, useRef } from "react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { db } from "../lib/firebase";
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
} from "firebase/firestore";
import { saveMeetingHistory } from "../lib/firestore";

const ICE_SERVERS = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302"] },
    {
      urls: "turn:numb.viagenie.ca",
      credential: "muazkh",
      username: "webrtc@live.com"
    }
  ],
};

export function VideoCalling({ meetingId, userId, onMeetingEnd }) {
  const [participants, setParticipants] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const peerConnections = useRef({});

  useEffect(() => {
    const setupMeeting = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);

        const participantsRef = collection(db, `meetings/${meetingId}/participants`);
        await addDoc(participantsRef, { userId, joinedAt: new Date().toISOString() });

        onSnapshot(participantsRef, (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            if (change.type === "added" && data.userId !== userId) {
              createPeerConnection(data.userId, stream);
            }
          });
        });
      } catch (error) {
        console.error("Error setting up meeting:", error);
      }
    };

    setupMeeting();
  }, [meetingId, userId]);

  const createPeerConnection = async (peerId, localStream) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnections.current[peerId] = pc;

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
      setParticipants((prev) => {
        if (!prev.find((p) => p.id === peerId)) {
          return [...prev, { id: peerId, stream: event.streams[0] }];
        }
        return prev;
      });
    };

    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await addDoc(collection(db, `meetings/${meetingId}/rtc`), {
          type: "candidate",
          candidate: event.candidate.toJSON(),
          senderId: userId,
          receiverId: peerId,
        });
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await addDoc(collection(db, `meetings/${meetingId}/rtc`), {
      type: "offer",
      offer,
      senderId: userId,
      receiverId: peerId,
    });

    onSnapshot(collection(db, `meetings/${meetingId}/rtc`), async (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        const data = change.doc.data();
        if (data.receiverId === userId) {
          if (data.type === "offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await addDoc(collection(db, `meetings/${meetingId}/rtc`), {
              type: "answer",
              answer,
              senderId: userId,
              receiverId: data.senderId,
            });
          } else if (data.type === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          } else if (data.type === "candidate") {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        }
      });
    });
  };

  return (
    <div>
      <Card className="p-4">
        <CardContent>
          <video ref={(ref) => ref && localStream && (ref.srcObject = localStream)} autoPlay muted={isMuted} className="w-full h-auto" />
        </CardContent>
      </Card>
      {participants.map((p) => (
        <Card key={p.id} className="p-4 mt-2">
          <CardContent>
            <video ref={(ref) => ref && p.stream && (ref.srcObject = p.stream)} autoPlay className="w-full h-auto" />
          </CardContent>
        </Card>
      ))}
      <div className="flex justify-center mt-4 space-x-4">
        <Button variant={isMuted ? "destructive" : "secondary"} onClick={() => setIsMuted(!isMuted)}>
          {isMuted ? "Unmute" : "Mute"}
        </Button>
        <Button variant={isVideoOff ? "destructive" : "secondary"} onClick={() => setIsVideoOff(!isVideoOff)}>
          {isVideoOff ? "Turn On Video" : "Turn Off Video"}
        </Button>
        <Button variant="destructive" onClick={onMeetingEnd}>Leave Meeting</Button>
      </div>
    </div>
  );
}

export default VideoCalling;
