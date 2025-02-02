"use client";

import Link from "next/link";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../../components/ui/button";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "@radix-ui/react-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "../../components/ui/avatar";
import { useContext, useState, useEffect } from "react";
import { MeetingContext } from "../contexts/MeetingContext";
import { db } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export function Header() {
  const { user, login, logout } = useAuth();
  const { setTheme, theme } = useTheme();
  const { activeMeeting, resetActiveMeetingContext } =
    useContext(MeetingContext);
  const [isMeetingEnded, setIsMeetingEnded] = useState(false);

  useEffect(() => {
    // Check if the active meeting has ended
    const checkMeetingStatus = async () => {
      if (activeMeeting) {
        const meetingRef = doc(db, "meetings", activeMeeting);
        const meetingDoc = await getDoc(meetingRef);
        if (meetingDoc.exists()) {
          const meetingData = meetingDoc.data();
          if (meetingData.status === "ended") {
            setIsMeetingEnded(true);
          }
        }
      }
    };

    checkMeetingStatus();
  }, [activeMeeting]);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="mr-4 hidden md:flex">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <span className="hidden font-bold sm:inline-block">VideoConf</span>
          </Link>

          {/* Show the "Join Active Meeting" link only if the meeting is active and hasn't ended */}
          {activeMeeting && !isMeetingEnded ? (
            <Link href={`/meeting/${activeMeeting}`} className="text-blue-400">
              Join Active Meeting
            </Link>
          ) : (
            <span>No Active Meeting</span>
          )}

          <nav className="flex items-center space-x-6 text-sm font-medium">
            <Link href="/">Home</Link>
            <Link href="/meetings">Meetings</Link>
            <Link href="/notes">Notes</Link>
            <Link href="/history">History</Link>
          </nav>
        </div>

        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <nav className="flex items-center space-x-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <SunIcon className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                  <MoonIcon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                  <span className="sr-only">Toggle theme</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setTheme("light")}>
                  Light
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("dark")}>
                  Dark
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("system")}>
                  System
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Avatar>
                    <AvatarImage src={user.photoURL} alt={user.displayName} />
                    <AvatarFallback>
                      {user.displayName?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={logout}>Logout</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button onClick={login}>Login</Button>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
