import Link from "next/link";
import { Button } from "../components/ui/button";
import { ComponentShowcase } from "./components/ComponentShowcase";
export const metadata = {
  title: "VideoConf App",
  description: "Modern video conferencing web application",
};

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <h1 className="text-4xl font-bold mb-8">Welcome to VideoConf</h1>
      <Button asChild>
        <Link href="/meetings">Start Meeting</Link>
      </Button>
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8">
        <FeatureCard
          title="High-Quality Video"
          description="Experience crystal-clear video and audio in your meetings."
        />
        <FeatureCard
          title="Secure Meetings"
          description="Your meetings are protected with end-to-end encryption."
        />
        <FeatureCard
          title="Collaborative Tools"
          description="Share screens, take notes, and chat in real-time."
        />
      </div>
    </div>
  );
}

function FeatureCard({ title, description }) {
  return (
    <div className="p-6 border rounded-lg">
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p>{description}</p>
    </div>
  );
}
