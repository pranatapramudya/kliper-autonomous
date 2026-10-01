import React from 'react';
import { AbsoluteFill, Video, useCurrentFrame, useVideoConfig, staticFile, interpolate } from 'remotion';

export interface Word {
  word: string;
  start: number;
  end: number;
  punctuated_word?: string;
  speaker?: number;
}

export interface KliperCompositionProps {
  clipVideoUrl: string;
  words: Word[];
  title: string;
  ctaText?: string;
  campaignAsset?: string;
  uniqueSpeakers?: number;
  dominantSpeaker?: number;
  clipDuration?: number;
}

// Palet warna per speaker — beda speaker, beda warna neon
const SPEAKER_COLORS: Record<number, string> = {
  0: '#FFFFFF',
  1: '#FFE033',
  2: '#00F2FE',
  3: '#FF6BFF',
  4: '#7AFF7A',
};

const SPEAKER_ACTIVE_COLORS: Record<number, string> = {
  0: '#00F2FE',
  1: '#FFB800',
  2: '#FF2E96',
  3: '#C400FF',
  4: '#00FF88',
};

const SPEAKER_LABELS: Record<number, string> = {
  0: 'HOST',
  1: 'GUEST 1',
  2: 'GUEST 2',
  3: 'GUEST 3',
  4: 'GUEST 4',
};

function getSpeakerColor(speaker: number, active?: boolean): string {
  const palette = active ? SPEAKER_ACTIVE_COLORS : SPEAKER_COLORS;
  return palette[speaker] ?? (active ? '#FF6BFF' : '#FFFFFF');
}

export const KliperComposition: React.FC<KliperCompositionProps> = ({
  clipVideoUrl,
  words,
  title,
  ctaText,
  campaignAsset,
  uniqueSpeakers = 1,
  dominantSpeaker = 0,
  clipDuration,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const currentTime = frame / fps;

  // Find current active word (add 0.15s margin for fluid transition)
  let currentWordIndex = -1;
  for (let i = 0; i < words.length; i++) {
    if (currentTime >= words[i].start - 0.15 && currentTime <= words[i].end + 0.15) {
      currentWordIndex = i;
      break;
    }
  }
  if (currentWordIndex === -1) {
    for (let i = words.length - 1; i >= 0; i--) {
      if (words[i].end < currentTime) {
        currentWordIndex = i;
        break;
      }
    }
  }

  // Subtitle window — 6 words biased toward current for better overlap support
  const windowSize = 6;
  const startIndex = Math.max(0, currentWordIndex - 2);
  const endIndex = Math.min(words.length - 1, startIndex + windowSize - 1);
  const visibleWords = words.slice(startIndex, endIndex + 1);

  // Current speaker detection
  const currentSpeaker = currentWordIndex >= 0 ? (words[currentWordIndex]?.speaker ?? dominantSpeaker) : dominantSpeaker;
  const isMultiSpeaker = (uniqueSpeakers ?? 1) > 1;

  // Hook overlay — tampil 0-3.5 detik pertama
  const hookOpacity = interpolate(currentTime, [0, 0.3, 2.8, 3.5], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const hookScale = interpolate(currentTime, [0, 0.3], [0.85, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Progress bar
  const progress = frame / durationInFrames;

  const videoSrc = staticFile(clipVideoUrl.replace(/^\//, ''));

  // --- RETENTION EFFECTS (Subtle Movement) ---
  const cutInterval = 2.5; // Potong/jump cut tiap 2.5 detik
  const currentInterval = Math.floor(currentTime / cutInterval);
  const baseScale = currentInterval % 2 === 0 ? 1.0 : 1.05; // Alternate scale (subtle jump cut)
  const timeInInterval = currentTime % cutInterval;
  const slowZoom = 1 + (timeInInterval * 0.012); // Slow zoom biar gak kaku
  const videoScale = baseScale * slowZoom;

  return (
    <AbsoluteFill style={{ backgroundColor: 'black', overflow: 'hidden' }}>
      {/* VIDEO LAYER */}
      <Video
        src={videoSrc}
        style={{ 
          width: '100%', 
          height: '100%', 
          objectFit: 'cover',
          transform: `scale(${videoScale})`,
          transformOrigin: 'center center',
        }}
      />

      {/* GRADIENT SCRIM bawah — subtitle readability */}
      <AbsoluteFill
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 35%, transparent 60%)',
          pointerEvents: 'none',
        }}
      />

      {/* GRADIENT SCRIM atas — title readability */}
      <AbsoluteFill
        style={{
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 25%)',
          pointerEvents: 'none',
        }}
      />

      {/* HOOK OVERLAY — 3 detik pertama */}
      {hookOpacity > 0 && (
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            opacity: hookOpacity,
            pointerEvents: 'none',
          }}
        >
          <div style={{ transform: `scale(${hookScale})`, maxWidth: '85%', textAlign: 'center', padding: '0 40px' }}>
            <div
              style={{
                fontFamily: 'Montserrat, sans-serif',
                fontWeight: 900,
                fontSize: 52,
                color: '#FFFFFF',
                textShadow: `0 0 30px ${getSpeakerColor(dominantSpeaker, true)}, 3px 3px 0px #000, 0 0 60px rgba(0,0,0,0.8)`,
                lineHeight: 1.2,
                textTransform: 'uppercase',
                letterSpacing: 1,
                WebkitTextStroke: '1.5px black',
              }}
            >
              {title}
            </div>
          </div>
        </AbsoluteFill>
      )}

      {/* SPEAKER BADGE — hanya muncul kalau multi-speaker */}
      {isMultiSpeaker && (
        <AbsoluteFill style={{ top: 60, left: 0, pointerEvents: 'none' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              backgroundColor: 'rgba(0,0,0,0.65)',
              border: `2px solid ${getSpeakerColor(currentSpeaker, true)}`,
              borderRadius: 40,
              padding: '10px 28px',
              marginLeft: 60,
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                backgroundColor: getSpeakerColor(currentSpeaker, true),
                boxShadow: `0 0 10px ${getSpeakerColor(currentSpeaker, true)}`,
                transition: 'all 0.3s ease-out',
              }}
            />
            <span
              style={{
                fontFamily: 'Montserrat, sans-serif',
                fontWeight: 800,
                fontSize: 26,
                color: getSpeakerColor(currentSpeaker, true),
                letterSpacing: 2,
                transition: 'all 0.3s ease-out',
              }}
            >
              {SPEAKER_LABELS[currentSpeaker] ?? `SPEAKER ${currentSpeaker}`}
            </span>
          </div>
        </AbsoluteFill>
      )}

      {/* KARAOKE SUBTITLES — CapCut-style word pop */}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingBottom: 180,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            maxWidth: '88%',
            textAlign: 'center',
            gap: '12px 18px',
          }}
        >
          {visibleWords.map((w, idx) => {
            const isActive = currentTime >= w.start && currentTime <= w.end;
            const isPast = currentTime > w.end;
            const wordScale = isActive ? 1.18 : 1;
            const speakerActiveColor = getSpeakerColor(w.speaker ?? 0, true);
            const speakerColor = getSpeakerColor(w.speaker ?? 0);

            return (
              <span
                key={`${startIndex + idx}-${w.word}`}
                style={{
                  fontFamily: 'Montserrat, sans-serif',
                  fontWeight: 900,
                  fontSize: isActive ? 72 : 64,
                  color: isActive ? speakerActiveColor : (isPast ? 'rgba(255,255,255,0.5)' : speakerColor),
                  transform: `scale(${wordScale})`,
                  display: 'inline-block',
                  transition: 'all 0.08s ease-out',
                  textShadow: isActive
                    ? `3px 3px 0px #000, 0 0 25px ${speakerActiveColor}, 0 0 50px rgba(0,0,0,0.9)`
                    : '2px 2px 0px #000, 0 0 15px rgba(0,0,0,0.7)',
                  WebkitTextStroke: isActive ? '2px black' : '1.5px black',
                  lineHeight: 1.1,
                }}
              >
                {w.punctuated_word || w.word}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>

      {/* CAMPAIGN CTA LAYER */}
      {(ctaText || campaignAsset) && (
        <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 120 }}>
          <div
            style={{
              backgroundColor: 'rgba(0,0,0,0.75)',
              padding: '16px 36px',
              borderRadius: 50,
              display: 'flex',
              alignItems: 'center',
              gap: '15px',
              border: `2px solid ${getSpeakerColor(dominantSpeaker, true)}`,
            }}
          >
            {campaignAsset && <img src={campaignAsset} style={{ height: 40 }} alt="Campaign Asset" />}
            {ctaText && (
              <span style={{ color: 'white', fontFamily: 'Montserrat, sans-serif', fontSize: 32, fontWeight: 800, letterSpacing: 1 }}>
                {ctaText}
              </span>
            )}
          </div>
        </AbsoluteFill>
      )}

      {/* PROGRESS BAR */}
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: 6, backgroundColor: 'rgba(255,255,255,0.15)' }}>
          <div
            style={{
              height: '100%',
              width: `${progress * 100}%`,
              background: `linear-gradient(to right, ${getSpeakerColor(dominantSpeaker, true)}, #FFFFFF)`,
              boxShadow: `0 0 12px ${getSpeakerColor(dominantSpeaker, true)}`,
            }}
          />
        </div>
      </AbsoluteFill>

      {/* WATERMARK */}
      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', pointerEvents: 'none', zIndex: 100 }}>
        <div style={{ width: '100%', textAlign: 'center', paddingBottom: 20 }}>
          <span
            style={{
              fontFamily: 'Montserrat, sans-serif',
              fontWeight: 700,
              fontSize: 26,
              letterSpacing: 7,
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.5)',
              textShadow: '0 2px 10px rgba(0,0,0,0.8), 0 0 30px rgba(0,0,0,0.5)',
            }}
          >
            KLIPER MEDIA
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
