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
    (async () => {
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

        // Listen for changes in the meeting status to show the "Meeting ended" message
        const roomRef = meetingDoc.ref;
        const unsubscribe = onSnapshot(roomRef, (snapshot) => {
          const data = snapshot.data();
          if (data && data.status === "ended") {
            setMeetingEnded(true);
          }
        });

        if (meetingData.status === "ended") {
          setMeetingEnded(true);
          return;
        }

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
    })();

    return () => {
      if (pcRef.current) {
        pcRef.current.close();
      }
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [meetingId, userId]);

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

  const handleLeaveMeeting = async () => {
    // Remove user stream without affecting meeting status
    console.log("User is leaving the meeting...");
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }

    if (pcRef.current) {
      pcRef.current.close();
    }

    // Allow user to rejoin later with the same meeting ID
    setLocalStream(null);
    setError("You have left the meeting.");
  };

  const toggleVideo = () => {
    if (localStream) {
      const newState = !isVideoOn;
      setIsVideoOn(newState);
      localStream.getVideoTracks()[0].enabled = newState;
    }
  };

  const toggleAudio = () => {
    if (localStream) {
      const newState = !isAudioOn;
      setIsAudioOn(newState);
      localStream.getAudioTracks()[0].enabled = newState;
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 bg-gray-200">
        <p className="text-lg font-bold">Meeting ID: {meetingId}</p>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded m-4">
          {error}
        </div>
      )}

      {/* Display "Meeting has ended" message if the meeting is ended */}
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

      {/* Meeting Controls - End / Leave */}
      <MeetingControls
        meetingId={meetingId}
        userId={userId}
        isHost={isHost}
        onLeave={handleLeaveMeeting}
        onEnd={handleEndMeeting}
        localStream={localStream}
      />

      {/* Screen Sharing */}
      <ScreenShareButton pc={pcRef.current} localStream={localStream} />

      {/* Meeting Notes */}
      <MeetingNotes meetingId={meetingId} userId={userId} />
    </div>
  );
}
