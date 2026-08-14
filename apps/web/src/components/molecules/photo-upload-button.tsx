"use client";

import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";

/**
 * Camera-icon trigger + hidden file input + multipart POST to
 * `/students/:id/photo` — shared by the student list row (small icon next
 * to the name) and the student profile page (icon next to the larger
 * photo). Both callers gate whether this renders at all the same way
 * (`canCreate || assignmentTypes.includes("CLASS_TEACHER")`, see
 * students/page.tsx) — the real authorization is enforced server-side
 * (StudentService.uploadPhoto), this is purely the upload control.
 */
export function PhotoUploadButton({
  studentId,
  label,
  onUploaded,
  iconClassName = "h-3.5 w-3.5",
  className,
}: {
  studentId: string;
  label: string;
  onUploaded?: (avatarUrl: string) => void;
  iconClassName?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await apiFetch<{ avatarUrl: string }>(`/students/${studentId}/photo`, {
        method: "POST",
        auth: true,
        body: formData,
      });
      onUploaded?.(result.avatarUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to upload photo");
    } finally {
      setUploading(false);
    }
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="text-muted transition-colors hover:text-foreground disabled:opacity-50"
        aria-label={label}
        title="Upload passport photo"
      >
        <Camera className={iconClassName} />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}
