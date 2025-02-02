// CreateMeeting.js
import { doc, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useContext } from "react";
import { MeetingContext } from "../contexts/MeetingContext";

const createMeeting = async (user) => {
  const meetingId = generateMeetingId(); // Implement this function
  const meetingRef = doc(db, "meetings", meetingId);

  await setDoc(meetingRef, {
    hostId: user.uid,
    status: "active",
    // other meeting details
  });

  // Update user's active meeting
  const userRef = doc(db, "users", user.uid);
  await setDoc(userRef, { activeMeeting: meetingId }, { merge: true });

  // Update context
  setActiveMeeting(meetingId);
};
