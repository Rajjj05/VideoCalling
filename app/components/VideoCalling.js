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
} from "firebase/firestore";

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

        const localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        const pc = new RTCPeerConnection(configuration);
        pcRef.current = pc;

        localStream.getTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });

        pc.ontrack = (event) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
          }
        };

        const roomRef = meetingDoc.ref;

        pc.onicecandidate = async (event) => {
          if (!event.candidate) return;
          const jsonCandidate = event.candidate.toJSON();
          if (hostFlag) {
            const callerCandidates = collection(roomRef, "callerCandidates");
            await addDoc(callerCandidates, jsonCandidate);
          } else {
            const calleeCandidates = collection(roomRef, "calleeCandidates");
            await addDoc(calleeCandidates, jsonCandidate);
          }
        };

        if (hostFlag) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await updateDoc(roomRef, {
            offer: { type: offer.type, sdp: offer.sdp },
          });

          onSnapshot(roomRef, (snapshot) => {
            const data = snapshot.data();
            if (data?.answer && !pc.currentRemoteDescription) {
              const answer = new RTCSessionDescription(data.answer);
              pc.setRemoteDescription(answer);
            }
          });

          const calleeCandidates = collection(roomRef, "calleeCandidates");
          onSnapshot(calleeCandidates, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
              if (change.type === "added") {
                const candidate = new RTCIceCandidate(change.doc.data());
                pc.addIceCandidate(candidate);
              }
            });
          });
        } else {
          onSnapshot(roomRef, async (snapshot) => {
            const data = snapshot.data();
            if (data?.offer && !pc.currentRemoteDescription) {
              await pc.setRemoteDescription(
                new RTCSessionDescription(data.offer)
              );
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
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
                pc.addIceCandidate(candidate);
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
    };
  }, [meetingId, userId]);

  const handleEndMeeting = async () => {
    try {
      // Update meeting status to "ended" in Firestore
      const meetingRef = doc(db, "meetings", meetingId);
      await updateDoc(meetingRef, {
        status: "ended",
      });

      // Call the passed function to handle the redirection
      onMeetingEnd();
    } catch (err) {
      console.error("Error ending meeting:", err);
      setError("An error occurred while ending the meeting.");
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

      <div className="p-4">
        <button
          onClick={handleEndMeeting}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          End Call
        </button>
      </div>
    </div>
  );
}
