"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Navigation from "../components/Navigation";
import UploadModal from "../components/UploadModal";

interface ExperienceSource {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  status: string;
  created_at: string;
  updated_at: string;
  storage_uploaded_at?: string | null;
  latest_extraction_id?: string | null;
  latest_draft_revision_id?: string | null;
  latest_approved_revision_id?: string | null;
  active_revision_id?: string | null;
  actions?: string[];
}

function readApiError(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") {
    return fallback;
  }
  const error = (data as Record<string, unknown>).error;
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return fallback;
}

export default function DocumentsPage() {
  const [experienceSources, setExperienceSources] = useState<ExperienceSource[]>([]);
  const [experienceLoading, setExperienceLoading] = useState(true);
  const [experienceError, setExperienceError] = useState<string | null>(null);
  const [showExperienceUploadModal, setShowExperienceUploadModal] = useState(false);

  const fetchExperienceSources = useCallback(async () => {
    try {
      setExperienceLoading(true);
      setExperienceError(null);
      const res = await fetch("/api/experiences");
      const data = await res.json();
      if (data.error) {
        setExperienceError(readApiError(data, "Failed to fetch experience sources"));
      } else {
        setExperienceSources(data.sources || []);
      }
    } catch (err) {
      setExperienceError(err instanceof Error ? err.message : "Failed to fetch experience sources");
    } finally {
      setExperienceLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(fetchExperienceSources);
  }, [fetchExperienceSources]);

  const formatDate = (s: string) => {
    try {
      const d = new Date(s);
      return isNaN(d.getTime())
        ? s
        : d.toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          });
    } catch {
      return s;
    }
  };

  const formatFileSize = (b: number) =>
    b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(2)} KB` : `${(b / (1024 * 1024)).toFixed(2)} MB`;

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-7xl mx-auto p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Documents</h1>
        </div>

        <section>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Experience</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{experienceSources.length} sources</p>
            </div>
            <button
              onClick={() => setShowExperienceUploadModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Upload Experience
            </button>
          </div>

          {experienceLoading ? (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400">Loading experience sources...</p>
            </div>
          ) : experienceError ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-200">Error: {experienceError}</p>
            </div>
          ) : experienceSources.length === 0 ? (
            <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-12 text-center">
              <p className="text-gray-500 dark:text-gray-400 mb-4">No experience sources uploaded yet.</p>
              <button
                onClick={() => setShowExperienceUploadModal(true)}
                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                Upload your first experience
              </button>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        File Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Size
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Updated
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                    {experienceSources.map((source) => (
                      <tr key={source.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{source.file_name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
                            {source.file_type || "unknown"}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                            {source.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {formatFileSize(source.file_size)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {formatDate(source.updated_at || source.created_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex items-center gap-3">
                            <Link
                              href={`/experiences/${source.id}`}
                              className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              Open
                            </Link>
                            <span className="text-gray-500 dark:text-gray-400">
                              {source.actions && source.actions.length > 0 ? source.actions.join(", ") : "None"}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <UploadModal
          kind="experience"
          isOpen={showExperienceUploadModal}
          onClose={() => setShowExperienceUploadModal(false)}
          onUploadSuccess={fetchExperienceSources}
        />
      </main>
    </div>
  );
}
