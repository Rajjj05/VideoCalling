"use client";

import React, { createContext, useState, useEffect } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

export const MeetingContext = createContext();

export const MeetingProvider = ({ children }) => {
  const [activeMeeting, setActiveMeeting] = useState(null);

  useEffect(() => {
    const storedActiveMeeting = localStorage.getItem("activeMeeting");
    if (storedActiveMeeting) {
      setActiveMeeting(JSON.parse(storedActiveMeeting));
    }
  }, []);

  // Function to set active meeting in the context
  const setActiveMeetingContext = (meetingId) => {
    setActiveMeeting(meetingId);
    localStorage.setItem("activeMeeting", JSON.stringify(meetingId));
  };

  const resetActiveMeetingContext = () => {
    setActiveMeeting(null);
    localStorage.removeItem("activeMeeting");
  };

  return (
    <MeetingContext.Provider
      value={{
        activeMeeting,
        setActiveMeetingContext,
        resetActiveMeetingContext,
      }}
    >
      {children}
    </MeetingContext.Provider>
  );
};
