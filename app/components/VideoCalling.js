// components/VideoCalling.js
import { useEffect, useRef, useState } from "react";
import { db } from "../lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  onSnapshot,
  addDoc,
  doc,
} from "firebase/firestore";
import MeetingNotes from "./MeetingNotes";
import MeetingControls from "./MeetingControl";
import ScreenShareButton from "./ScreenShareButton";

const configuration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export default function VideoCalling({
  meetingId,
  userId,
  userName,
  onMeetingEnd,
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const [error, setError] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);

  useEffect(() => {
    let unsubscribe = null;

    const initializeMeeting = async () => {
      try {
        const meetingsRef = collection(db, "meetings");
        const meetingQuery = query(
          meetingsRef,
          where("meetingId", "==", meetingId)
        );
        const querySnapshot = await getDocs(meetingQuery);

        if (querySnapshot.empty) {
          setError("Meeting not found");
          return;
        }

        const meetingDoc = querySnapshot.docs[0];
        const meetingData = meetingDoc.data();
        const hostFlag = meetingData.hostId === userId;
        setIsHost(hostFlag);

        const roomRef = meetingDoc.ref;

        // Listen for meeting status updates
        unsubscribe = onSnapshot(roomRef, (snapshot) => {
          const data = snapshot.data();
          if (data?.status === "ended") {
            setMeetingEnded(true);
          }
        });

        if (meetingData.status === "ended") {
          setMeetingEnded(true);
          return;
        }

        // Fetch user media
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        const pc = new RTCPeerConnection(configuration);
        pcRef.current = pc;

        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        pc.ontrack = (event) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
          }
        };

        pc.onicecandidate = async (event) => {
          if (!event.candidate) return;
          const jsonCandidate = event.candidate.toJSON();
          const candidatesCollection = hostFlag
            ? collection(roomRef, "callerCandidates")
            : collection(roomRef, "calleeCandidates");
          await addDoc(candidatesCollection, jsonCandidate);
        };

        if (hostFlag) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await updateDoc(roomRef, {
            offer: { type: offer.type, sdp: offer.sdp },
          });

          onSnapshot(roomRef, (snapshot) => {
            const data = snapshot.data();
            if (data?.answer && !pcRef.current.remoteDescription) {
              const answer = new RTCSessionDescription(data.answer);
              pcRef.current.setRemoteDescription(answer);
            }
          });

          const calleeCandidates = collection(roomRef, "calleeCandidates");
          onSnapshot(calleeCandidates, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
              if (change.type === "added") {
                const candidate = new RTCIceCandidate(change.doc.data());
                pcRef.current.addIceCandidate(candidate);
              }
            });
          });
        } else {
          onSnapshot(roomRef, async (snapshot) => {
            const data = snapshot.data();
            if (data?.offer && !pcRef.current.remoteDescription) {
              await pcRef.current.setRemoteDescription(
                new RTCSessionDescription(data.offer)
              );
              const answer = await pcRef.current.createAnswer();
              await pcRef.current.setLocalDescription(answer);
              await updateDoc(roomRef, {
                answer: { type: answer.type, sdp: answer.sdp },
              });
            }
          });

          const callerCandidates = collection(roomRef, "callerCandidates");
          onSnapshot(callerCandidates, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
              if (change.type === "added") {
                const candidate = new RTCIceCandidate(change.doc.data());
                pcRef.current.addIceCandidate(candidate);
              }
            });
          });
        }
      } catch (err) {
        console.error("Error during setup:", err);
        setError("An error occurred while setting up the call.");
      }
    };

    initializeMeeting();

    return () => {
      if (unsubscribe) unsubscribe();
      if (pcRef.current) {
        pcRef.current.close();
      }
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [meetingId, userId]);

  // ✅ Leave Meeting
  const handleLeaveMeeting = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (pcRef.current) {
      pcRef.current.close();
    }
    setLocalStream(null);
    setError("You have left the meeting.");
  };

  // ✅ End Meeting (For Host)
  const handleEndMeeting = async () => {
    try {
      const meetingRef = doc(db, "meetings", meetingId);
      await updateDoc(meetingRef, { status: "ended" });
      setMeetingEnded(true);
      onMeetingEnd();
    } catch (err) {
      console.error("Error ending meeting:", err);
      setError("An error occurred while ending the meeting.");
    }
  };

  // ✅ Toggle Video
  const toggleVideo = () => {
    if (localStream) {
      const newState = !isVideoOn;
      setIsVideoOn(newState);
      localStream.getVideoTracks()[0].enabled = newState;
    }
  };

  // ✅ Toggle Audio
  const toggleAudio = () => {
    if (localStream) {
      const newState = !isAudioOn;
      setIsAudioOn(newState);
      localStream.getAudioTracks()[0].enabled = newState;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {meetingEnded && (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded m-4">
          <p className="text-lg font-bold">Meeting has ended.</p>
        </div>
      )}

      <div className="flex flex-1">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-1/2 bg-black"
        />
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-1/2 bg-black"
        />
      </div>

      {/* ✅ Audio/Video Toggle Buttons */}
      <div className="p-4 flex justify-between">
        <button
          onClick={toggleAudio}
          className="px-4 py-2 bg-green-600 text-white rounded"
        >
          {isAudioOn ? "Mute Audio" : "Unmute Audio"}
        </button>
        <button
          onClick={toggleVideo}
          className="px-4 py-2 bg-green-600 text-white rounded"
        >
          {isVideoOn ? "Turn Off Video" : "Turn On Video"}
        </button>
      </div>

      {/* ✅ Screen Sharing */}
      <ScreenShareButton pc={pcRef.current} localStream={localStream} />

      {/* ✅ Meeting Controls */}
      <MeetingControls
        meetingId={meetingId}
        userId={userId}
        isHost={isHost}
        onLeave={handleLeaveMeeting}
        onEnd={handleEndMeeting}
        localStream={localStream}
      />

      {/* ✅ Meeting Notes */}
      <MeetingNotes meetingId={meetingId} userId={userId} />
    </div>
  );
}
