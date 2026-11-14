"use client";
import JdFitPanel from "./components/JdFitPanel";
import Navigation from "./components/Navigation";

export default function Home() {
  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-4xl mx-auto p-8">
        <h1 className="text-3xl font-bold mb-6">RAG Search</h1>
        <JdFitPanel />
      </main>
    </div>
  );
}
