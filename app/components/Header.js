"use client";

import Link from "next/link";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "@radix-ui/react-icons"; // Keep these
import { Menu } from "lucide-react"; // Use Lucide for the menu icon

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
            resetActiveMeetingContext(); // Reset context if meeting has ended
          }
        }
      }
    };

    checkMeetingStatus();
  }, [activeMeeting]);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        {/* Mobile Menu */}
        <div className="mr-4 flex items-center md:hidden">
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[240px] sm:w-[300px]">
              <nav className="flex flex-col space-y-4">
                <Link href="/" onClick={() => setIsMobileMenuOpen(false)}>
                  Home
                </Link>
                <Link
                  href="/meetings"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Meetings
                </Link>
                <Link href="/notes" onClick={() => setIsMobileMenuOpen(false)}>
                  Notes
                </Link>
                <Link
                  href="/history"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  History
                </Link>
              </nav>
            </SheetContent>
          </Sheet>
        </div>

        {/* Desktop Navigation */}
        <div className="mr-4 hidden md:flex">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <span className="hidden font-bold sm:inline-block">VideoConf</span>
          </Link>

          {/* Show "Join Active Meeting" only if it's ongoing */}
          {activeMeeting && !isMeetingEnded ? (
            <Link
              href={`/meeting/${activeMeeting}`}
              className="text-blue-400 font-semibold"
            >
              Join Active Meeting
            </Link>
          ) : (
            <span className="text-gray-400">No Active Meeting</span>
          )}

          <nav className="flex items-center space-x-6 text-sm font-medium">
            <Link href="/">Home</Link>
            <Link href="/meetings">Meetings</Link>
            <Link href="/notes">Notes</Link>
            <Link href="/history">History</Link>
          </nav>
        </div>

        {/* Right-side Icons & User Controls */}
        <div className="flex flex-1 items-center justify-end space-x-2">
          {/* Theme Toggle */}
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

          {/* User Avatar & Auth Controls */}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Avatar>
                  <AvatarImage src={user.photoURL} alt={user.displayName} />
                  <AvatarFallback>{user.displayName?.charAt(0)}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={logout}>Logout</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button onClick={login}>Login</Button>
          )}
        </div>
      </div>
    </header>
  );
}
