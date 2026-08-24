"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogClose } from "../molecules/dialog";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

/**
 * Live camera capture used by CreateStudentForm's optional "Student photo"
 * step. Captures a still via getUserMedia + canvas rather than uploading —
 * the resulting File is handed back to the caller, who uploads it only
 * after the student record itself exists (POST /students/:id/photo needs
 * a studentId). Falls back to a plain file input (same accept as
 * PhotoUploadButton) when getUserMedia is unavailable or denied, so the
 * feature degrades instead of dead-ending — camera access requires a
 * secure context and can fail for reasons with no good recovery path.
 */
export function PhotoCaptureDialog({
  open,
  onOpenChange,
  onCapture,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [stillDataUrl, setStillDataUrl] = useState<string | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    if (!open) {
      stopStream();
      setStillDataUrl(null);
      setError(null);
      return;
    }

    let cancelled = false;

    async function startStream() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stopStream();
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(allDevices.filter((d) => d.kind === "videoinput"));
      } catch {
        if (!cancelled) setError("Camera unavailable — choose a photo file instead.");
      }
    }

    void startStream();
    return () => {
      cancelled = true;
    };
  }, [open, deviceId]);

  useEffect(() => stopStream, []);

  function handleCapture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    setStillDataUrl(canvas.toDataURL("image/jpeg", 0.9));
  }

  function handleUsePhoto() {
    if (!stillDataUrl) return;
    fetch(stillDataUrl)
      .then((res) => res.blob())
      .then((blob) => {
        onCapture(new File([blob], "student-photo.jpg", { type: "image/jpeg" }));
        onOpenChange(false);
      });
  }

  function handleFileFallback(file: File | undefined) {
    if (!file) return;
    onCapture(file);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle className="font-display text-lg">Take student photo</DialogTitle>
          <DialogClose asChild>
            <button type="button" aria-label="Close" className="text-muted hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </div>

        {error ? (
          <div className="space-y-3">
            <p className="text-sm text-danger">{error}</p>
            <Label htmlFor="photo-capture-fallback">Upload a photo file instead</Label>
            <input
              id="photo-capture-fallback"
              type="file"
              accept="image/*"
              className="block w-full text-sm"
              onChange={(e) => handleFileFallback(e.target.files?.[0])}
            />
          </div>
        ) : (
          <div className="space-y-3">
            {devices.length > 1 && !stillDataUrl && (
              <div>
                <Label htmlFor="photo-capture-device">Camera</Label>
                <Select value={deviceId} onValueChange={setDeviceId}>
                  <SelectTrigger id="photo-capture-device" className="mt-1">
                    <SelectValue placeholder="Default camera" />
                  </SelectTrigger>
                  <SelectContent>
                    {devices.map((d, i) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || `Camera ${i + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="overflow-hidden rounded-lg border border-border bg-card-inset">
              {stillDataUrl ? (
                <img src={stillDataUrl} alt="Captured student photo" className="aspect-square w-full object-cover" />
              ) : (
                <video ref={videoRef} autoPlay muted playsInline className="aspect-square w-full object-cover" />
              )}
            </div>

            {stillDataUrl ? (
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setStillDataUrl(null)}>
                  <RotateCcw className="h-4 w-4" /> Retake
                </Button>
                <Button type="button" className="flex-1" onClick={handleUsePhoto}>
                  Use this photo
                </Button>
              </div>
            ) : (
              <Button type="button" className="w-full" onClick={handleCapture}>
                <Camera className="h-4 w-4" /> Capture
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
