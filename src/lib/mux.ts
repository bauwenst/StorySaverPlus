import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
} from "mediabunny";

export async function readVideoFacts(videoBlob: Blob): Promise<{ width: number; height: number; frameRate: number }> {
  const input = new Input({ source: new BlobSource(videoBlob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return { width: 0, height: 0, frameRate: 0 };
    const [width, height, metrics] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.computeFrameRateMetrics({ targetPacketCount: 120 }),
    ]);
    const frameRate = metrics.underlyingFrameRate ?? metrics.bestGuessFrameRate ?? metrics.averageFrameRate;
    return {
      width: Number.isFinite(width) ? width : 0,
      height: Number.isFinite(height) ? height : 0,
      frameRate: Number.isFinite(frameRate) ? frameRate : 0,
    };
  } catch {
    return { width: 0, height: 0, frameRate: 0 };
  } finally {
    input.dispose();
  }
}

// Instagram's sharpest story video has no audio track. Copy that video and the
// best audio into one MP4 without re-encoding, so the frames stay untouched.
export async function muxVideoAndAudio(videoBlob: Blob, audioBlob: Blob): Promise<Blob> {
  const videoInput = new Input({ source: new BlobSource(videoBlob), formats: ALL_FORMATS });
  const audioInput = new Input({ source: new BlobSource(audioBlob), formats: ALL_FORMATS });
  try {
    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target,
    });
    const videoConversion = await Conversion.init({
      input: videoInput,
      output,
      audio: { discard: true },
      copy: { mode: "forced" },
      composable: true,
      showWarnings: false,
    });
    const audioConversion = await Conversion.init({
      input: audioInput,
      output,
      video: { discard: true },
      copy: { mode: "forced" },
      composable: true,
      showWarnings: false,
    });
    const keptVideo = videoConversion.utilizedTracks.some((track) => track.isVideoTrack());
    const keptAudio = audioConversion.utilizedTracks.some((track) => track.isAudioTrack());
    if (!keptVideo || !keptAudio) {
      throw new Error("Could not combine the full-quality tracks without re-encoding them.");
    }
    await output.start();
    await Promise.all([videoConversion.execute(), audioConversion.execute()]);
    await output.finalize();
    if (!target.buffer || target.buffer.byteLength < 500) {
      throw new Error("Combining the tracks produced an empty file.");
    }
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    videoInput.dispose();
    audioInput.dispose();
  }
}
