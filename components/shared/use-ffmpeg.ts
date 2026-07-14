"use client";

import * as React from "react";
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { getFFmpeg, onFfmpegProgress, isFFmpegLoaded } from "@/lib/ffmpeg";

export function useFFmpeg() {
  const [loaded, setLoaded] = React.useState(false);
  const [loadRatio, setLoadRatio] = React.useState(0);
  const [jobRatio, setJobRatio] = React.useState(0);

  React.useEffect(() => {
    setLoaded(isFFmpegLoaded());
    const unsub = onFfmpegProgress((p) => setJobRatio(p.ratio));
    return unsub;
  }, []);

  const ensure = React.useCallback(async (): Promise<FFmpeg> => {
    const ff = await getFFmpeg(setLoadRatio);
    setLoaded(true);
    return ff;
  }, []);

  return { ensure, loaded, loadRatio, jobRatio, setJobRatio };
}
